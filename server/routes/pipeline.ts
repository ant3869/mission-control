/**
 * Pipeline view data → /api/pipeline
 *
 * Sources real pipeline data from:
 *  - JSONL session files → active runs + history (stages inferred from tool sequence)
 *  - claude-cli scheduled-tasks MCP (via subprocess) → cron/scheduled jobs
 *
 * GET /api/pipeline/runs        → active + recent sessions as pipeline runs
 * GET /api/pipeline/scheduled   → scheduled tasks from MCP
 */
import { Router } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { execSync } from 'child_process'

export const pipelineRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type StageStatus  = 'completed' | 'running' | 'failed' | 'pending' | 'skipped'
export type RunStatus    = 'running' | 'queued' | 'completed' | 'failed'

// Timeline (Gantt) segment kinds, one bar each on a run's execution row.
export type SegmentKind  = 'queue' | 'stage' | 'retry' | 'wait' | 'failed'

export interface PipelineSegment {
  kind:        SegmentKind
  label:       string
  startMs:     number        // offset from the run's queuedAt
  durationMs:  number
  status?:     StageStatus   // for stage/failed segments
  stageName?:  string
  attempt?:    number        // retry attempt index (1-based) for retry segments
}

export interface PipelineStage {
  name:        string
  status:      StageStatus
  durationSec?: number
  toolCount?:  number
}

export interface PipelineRun {
  id:          string
  name:        string
  projectSlug: string
  status:      RunStatus
  stages:      PipelineStage[]
  elapsedSec:  number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  startedAt:   string
  lastActiveAt: string
  elapsedLabel: string
  completedAgo?: string
  model:       string
  cwd:         string
  // ── Execution-timeline fields (Gantt view) ──
  queuedAt:    string         // startedAt minus queue wait
  completedAt: string | null  // null while running
  queueMs:     number         // time spent queued before first stage
  waitMs:      number         // total blocked / waiting-on-model time
  retries:     number         // total stage retries in the run
  totalMs:     number         // queued → completed span, drives the timeline scale
  timeline:    PipelineSegment[]
}

export interface ScheduledTask {
  taskId:      string
  description: string
  schedule:    string
  cronExpr:    string
  enabled:     boolean
  nextRunAt:   string | null
  lastRunAt:   string | null
  nextRunLabel: string
  lastRunLabel: string
}

// ─── Run-trace types ──────────────────────────────────────────────────────────
// Transport-agnostic so real Hermes / OpenClaw trace ingestion can fill the same
// shape later. Kept in sync with src/components/trace/types.ts.

export type SpanStatusT = 'success' | 'running' | 'failed' | 'skipped'
export type SpanKind    = 'run' | 'plan' | 'agent' | 'model' | 'tool' | 'memory' | 'message'

export interface TraceSpan {
  id:          string
  parentId:    string | null
  name:        string
  kind:        SpanKind
  status:      SpanStatusT
  startMs:     number
  durationMs:  number
  model?:      string
  tool?:       string
  tokens?:     { input: number; output: number; total: number }
  cost?:       number
  attributes?: Record<string, unknown>
}

export interface TraceRun {
  id:          string
  name:        string
  source?:     string
  status:      SpanStatusT
  startedAt:   string
  durationMs:  number
  totalTokens: number
  totalCost:   number
  models:      string[]
  spanCount:   number
  spans:       TraceSpan[]
}

// ─── JSONL discovery ──────────────────────────────────────────────────────────

function findClaudeProjectsDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
    join(process.cwd(), '.claude', 'projects'),
    join(process.cwd(), 'mnt', '.claude', 'projects'),
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude',  'projects') : '',
    process.env.APPDATA     ? join(process.env.APPDATA,     'claude',  'projects') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'projects') : '',
  ].filter(Boolean)
  return candidates.find(p => {
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

function collectJsonlFiles(dir: string): Array<{ path: string; slug: string; mtime: number }> {
  const files: Array<{ path: string; slug: string; mtime: number }> = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      try {
        if (statSync(full).isDirectory()) {
          for (const child of readdirSync(full)) {
            if (!child.endsWith('.jsonl')) continue
            const cp = join(full, child)
            try { files.push({ path: cp, slug: entry, mtime: statSync(cp).mtimeMs }) } catch {}
          }
        }
      } catch {}
    }
  } catch {}
  return files.sort((a, b) => b.mtime - a.mtime)
}

// ─── Tool phase analysis ──────────────────────────────────────────────────────

interface ToolPhase { name: string; tools: string[]; count: number; firstAt: number; lastAt: number }

const TOOL_PHASE_MAP: Record<string, string> = {
  Read: 'Analyze', Glob: 'Analyze', Grep: 'Analyze',
  Bash: 'Execute', Write: 'Code', Edit: 'Code', MultiEdit: 'Code', NotebookEdit: 'Code',
  WebSearch: 'Search', WebFetch: 'Search',
  Agent: 'Orchestrate', TodoWrite: 'Plan', ExitPlanMode: 'Plan',
  Skill: 'Compose',
}

function toolPhase(name: string): string {
  if (TOOL_PHASE_MAP[name]) return TOOL_PHASE_MAP[name]
  if (name.startsWith('mcp__')) {
    const lower = name.toLowerCase()
    if (lower.includes('search') || lower.includes('fetch')) return 'Search'
    if (lower.includes('calendar') || lower.includes('task') || lower.includes('create')) return 'Plan'
    if (lower.includes('list') || lower.includes('read') || lower.includes('get')) return 'Analyze'
    return 'Integrate'
  }
  return 'Execute'
}

// ─── JSONL session parser ─────────────────────────────────────────────────────

interface SessionInfo {
  id:          string
  slug:        string
  name:        string
  model:       string
  cwd:         string
  startedAt:   string
  lastActiveAt: string
  mtime:       number
  inputTokens: number
  outputTokens: number
  phases:      ToolPhase[]    // distinct tool phases in order encountered
  phaseCounts: Record<string, number>
  messageCount: number
  lastToolAt:  number        // ms timestamp of last tool_use
}

function parseSessionForPipeline(file: { path: string; slug: string; mtime: number }): SessionInfo | null {
  try {
    const raw   = readFileSync(file.path, 'utf8')
    const lines = raw.split('\n').filter(l => l.trim().startsWith('{'))

    let model         = ''
    let cwd           = ''
    let startedAt     = ''
    let lastActive    = ''
    let inputTok      = 0
    let outputTok     = 0
    let msgCount      = 0
    let firstName     = ''
    let lastToolAt    = 0

    const phaseSeq: Array<{ phase: string; tool: string; tsMs: number }> = []

    for (const line of lines) {
      let e: any
      try { e = JSON.parse(line) } catch { continue }

      if (!startedAt && e.timestamp) startedAt = e.timestamp
      if (e.timestamp)  lastActive = e.timestamp
      if (e.cwd && !cwd) cwd = e.cwd

      if (e.usage) { inputTok += e.usage.input_tokens ?? 0; outputTok += e.usage.output_tokens ?? 0 }
      if (e.message?.model) model = e.message.model

      if (e.type !== 'user' && e.type !== 'assistant') continue
      if (!e.message) continue
      msgCount++

      const { role, content } = e.message

      if (role === 'user' && !firstName) {
        const text = typeof content === 'string' ? content
          : Array.isArray(content)
            ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
            : ''
        if (text && text.length > 2 && !text.startsWith('This session is being continued')) {
          firstName = text.slice(0, 80).replace(/\n/g, ' ')
        }
      }

      if (role === 'assistant' && Array.isArray(content)) {
        if (e.message.usage) { inputTok += e.message.usage.input_tokens ?? 0; outputTok += e.message.usage.output_tokens ?? 0 }
        for (const block of content) {
          if (block.type === 'tool_use' && block.name) {
            const phase = toolPhase(block.name)
            const tsMs  = e.timestamp ? new Date(e.timestamp).getTime() : 0
            phaseSeq.push({ phase, tool: block.name, tsMs })
            if (tsMs > lastToolAt) lastToolAt = tsMs
          }
        }
      }
    }

    if (!startedAt) return null

    // Collapse consecutive same-phase entries, preserve order of first appearance
    const phases: ToolPhase[] = []
    const phaseCounts: Record<string, number> = {}
    let   cur: ToolPhase | null = null

    for (const p of phaseSeq) {
      phaseCounts[p.phase] = (phaseCounts[p.phase] ?? 0) + 1
      if (cur && cur.name === p.phase) {
        cur.count++
        cur.lastAt = p.tsMs
        if (!cur.tools.includes(p.tool)) cur.tools.push(p.tool)
      } else {
        cur = { name: p.phase, tools: [p.tool], count: 1, firstAt: p.tsMs, lastAt: p.tsMs }
        phases.push(cur)
      }
    }

    return {
      id:           basename(file.path).replace('.jsonl', ''),
      slug:         file.slug,
      name:         firstName || basename(file.path).replace('.jsonl', '').slice(0, 30),
      model,
      cwd,
      startedAt,
      lastActiveAt: lastActive,
      mtime:        file.mtime,
      inputTokens:  inputTok,
      outputTokens: outputTok,
      phases,
      phaseCounts,
      messageCount: msgCount,
      lastToolAt,
    }
  } catch {
    return null
  }
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function relAgo(iso: string | number): string {
  const ts  = typeof iso === 'number' ? iso : new Date(iso).getTime()
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60)  return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)  return `${min}m ago`
  const hr  = Math.floor(min / 60)
  if (hr  < 24)  return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function relFuture(iso: string): string {
  if (!iso) return ''
  const sec = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (sec < 0)    return 'overdue'
  if (sec < 60)   return `in ${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60)   return `in ${min}m`
  const hr  = Math.floor(min / 60)
  if (hr  < 24)   return `in ${hr}h`
  return `in ${Math.floor(hr / 24)}d`
}

function elapsedLabel(startedAt: string, lastActiveAt: string): string {
  const start = new Date(startedAt).getTime()
  const end   = new Date(lastActiveAt).getTime()
  const sec   = Math.floor((end - start) / 1000)
  if (sec < 60)  return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60)  return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

// ─── Execution timeline (Gantt) builder ──────────────────────────────────────
// Lays the run out as contiguous segments: queue → (wait | retry | stage)* .
// Stage durations and inter-stage waits come from the real JSONL phase
// timestamps; queue time and occasional retries are seeded per-run (the JSONL
// has no signal for them) so the value is stable across refreshes. Swap the
// seeded bits for real queue/retry telemetry when a run store provides it.

function buildTimeline(
  info: SessionInfo,
  isActive: boolean,
  isFailed: boolean,
  startMs: number,
  lastMs: number,
): { queueMs: number; waitMs: number; retries: number; totalMs: number; queuedAt: string; segments: PipelineSegment[] } {
  const rng = mulberry32(hashStr(`${info.id}:timeline`))
  const between = (a: number, b: number) => Math.round(a + rng() * (b - a))

  const segments: PipelineSegment[] = []
  let waitMs  = 0
  let retries = 0

  // Queue segment — seeded (no queue signal in JSONL)
  const queueMs = between(500, 8000)
  segments.push({ kind: 'queue', label: 'Queued', startMs: 0, durationMs: queueMs })
  let cursor = queueMs

  // Ensure there is always something to render
  let phases = info.phases
  if (phases.length === 0) {
    let t = startMs
    phases = ['Analyze', 'Execute', 'Complete'].map(name => {
      const d = between(1500, 6000)
      const p: ToolPhase = { name, tools: [], count: 1, firstAt: t, lastAt: t + d }
      t += d + between(200, 1800)
      return p
    })
  }

  let prevLastAt = phases[0]?.firstAt || startMs

  for (let i = 0; i < phases.length; i++) {
    const ph     = phases[i]
    const isLast = i === phases.length - 1
    const firstAt = ph.firstAt || prevLastAt
    const lastAt  = ph.lastAt && ph.lastAt > firstAt ? ph.lastAt : firstAt + between(1200, 5000)

    // Real gap before this phase → waiting / blocked-on-model segment
    const gap = firstAt - prevLastAt
    if (gap > 1500) {
      segments.push({ kind: 'wait', label: 'Waiting', startMs: cursor, durationMs: gap })
      cursor += gap
      waitMs += gap
    }

    // Seeded retry: a failed attempt that re-ran (not on a run that ends failed)
    if (!(isFailed && isLast) && rng() < 0.1) {
      const rdur = between(700, 2600)
      segments.push({ kind: 'retry', label: `${ph.name} retry`, stageName: ph.name, attempt: 1, status: 'failed', startMs: cursor, durationMs: rdur })
      cursor += rdur
      retries++
    }

    const dur = Math.max(lastAt - firstAt, 400)
    let status: StageStatus = 'completed'
    if (isActive && isLast) status = 'running'
    else if (isFailed && isLast) status = 'failed'

    segments.push({
      kind:      isFailed && isLast ? 'failed' : 'stage',
      label:     ph.name,
      stageName: ph.name,
      status,
      startMs:   cursor,
      durationMs: dur,
    })
    cursor += dur
    prevLastAt = lastAt
  }

  return {
    queueMs, waitMs, retries,
    totalMs:  cursor,
    queuedAt: new Date(startMs - queueMs).toISOString(),
    segments,
  }
}

// ─── Build pipeline runs from sessions ────────────────────────────────────────

function sessionToRun(info: SessionInfo, now: number): PipelineRun {
  const ageMin    = (now - new Date(info.lastActiveAt).getTime()) / 60_000
  const isActive  = ageMin < 5
  const isFailed  = info.messageCount === 0

  let status: RunStatus = 'completed'
  if (isActive)  status = 'running'
  else if (isFailed) status = 'failed'

  // Build stages list
  const stages: PipelineStage[] = [
    { name: 'Initialize', status: 'completed', durationSec: 0 },
  ]

  for (let i = 0; i < info.phases.length; i++) {
    const ph     = info.phases[i]
    const isLast = i === info.phases.length - 1

    let stageStatus: StageStatus = 'completed'
    if (isActive && isLast) stageStatus = 'running'
    else if (isFailed && isLast) stageStatus = 'failed'

    const dur = ph.lastAt && ph.firstAt ? Math.round((ph.lastAt - ph.firstAt) / 1000) : undefined

    stages.push({
      name:       ph.name,
      status:     stageStatus,
      durationSec: dur,
      toolCount:  ph.count,
    })
  }

  if (!isActive && !isFailed && stages.length > 0) {
    stages.push({ name: 'Complete', status: 'completed' })
  }

  const startMs = new Date(info.startedAt).getTime()
  const lastMs  = new Date(info.lastActiveAt).getTime()
  const tl = buildTimeline(info, isActive, isFailed, startMs, lastMs)

  return {
    id:           info.id,
    name:         info.name,
    projectSlug:  info.slug,
    status,
    stages,
    elapsedSec:   Math.floor((lastMs - startMs) / 1000),
    inputTokens:  info.inputTokens,
    outputTokens: info.outputTokens,
    totalTokens:  info.inputTokens + info.outputTokens,
    startedAt:    info.startedAt,
    lastActiveAt: info.lastActiveAt,
    elapsedLabel: elapsedLabel(info.startedAt, info.lastActiveAt),
    completedAgo: isActive ? undefined : relAgo(info.lastActiveAt),
    model:        info.model || 'claude-sonnet-4-6',
    cwd:          info.cwd,
    queuedAt:     tl.queuedAt,
    completedAt:  isActive ? null : info.lastActiveAt,
    queueMs:      tl.queueMs,
    waitMs:       tl.waitMs,
    retries:      tl.retries,
    totalMs:      tl.totalMs,
    timeline:     tl.segments,
  }
}

// ─── Scheduled tasks from MCP subprocess ─────────────────────────────────────

function fetchScheduledTasks(): ScheduledTask[] {
  // Try to get tasks by reading the MCP storage files directly
  // The scheduled-tasks MCP stores data at known paths; try them
  const storagePaths = [
    join(homedir(), '.claude', 'scheduled_tasks.json'),
    join(homedir(), '.config', 'claude', 'scheduled_tasks.json'),
    join(process.cwd(), 'mnt', '.claude', 'scheduled_tasks.json'),
    '/sessions/amazing-relaxed-galileo/mnt/.claude/scheduled_tasks.json',
  ]

  for (const p of storagePaths) {
    try {
      if (!existsSync(p)) continue
      const raw   = readFileSync(p, 'utf8')
      const tasks = JSON.parse(raw)
      if (Array.isArray(tasks)) {
        return tasks.map((t: any) => ({
          taskId:       t.taskId ?? t.id ?? String(Math.random()),
          description:  t.description ?? t.name ?? 'Unnamed task',
          schedule:     t.schedule ?? cronToHuman(t.cronExpression ?? ''),
          cronExpr:     t.cronExpression ?? t.cron ?? '',
          enabled:      t.enabled !== false,
          nextRunAt:    t.nextRunAt ?? t.next_run ?? null,
          lastRunAt:    t.lastRunAt ?? t.last_run ?? null,
          nextRunLabel: t.nextRunAt ? relFuture(t.nextRunAt) : '',
          lastRunLabel: t.lastRunAt ? relAgo(t.lastRunAt) : 'never',
        }))
      }
    } catch { /* skip */ }
  }

  return []
}

function cronToHuman(expr: string): string {
  if (!expr) return ''
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return expr
  const [min, hr, dom, , dow] = parts
  if (min === '0' && hr === '0' && dom === '*' && dow === '*') return 'Daily at midnight'
  if (min === '0' && dom === '*' && dow === '*') return `Daily at ${hr}:00`
  if (dom === '*' && dow === '1') return `Weekly on Monday`
  if (dom === '1' && dow === '*') return `Monthly on 1st`
  return expr
}

// ─── Run-trace generator ──────────────────────────────────────────────────────
// Deterministic, seeded by run id. Mirrors the client-side mock so the trace is
// stable per run. Swap this for real span ingestion when traces are persisted.

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TRACE_MODELS = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']
const TRACE_RATES: Record<string, { in: number; out: number }> = {
  'claude-opus-4-7':   { in: 15, out: 75 },
  'claude-sonnet-4-6': { in: 3,  out: 15 },
  'claude-haiku-4-5':  { in: 0.8, out: 4 },
}
function traceCost(model: string, input: number, output: number): number {
  const r = TRACE_RATES[model] ?? TRACE_RATES['claude-sonnet-4-6']
  return +(((input / 1e6) * r.in) + ((output / 1e6) * r.out)).toFixed(4)
}

function buildTrace(id: string, name: string, model: string, status: SpanStatusT, source: string): TraceRun {
  const rnd = mulberry32(hashStr(id))
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a))
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
  const primaryModel = model && TRACE_RATES[model] ? model : pick(TRACE_MODELS)

  const spans: TraceSpan[] = []
  let seq = 0
  const sid = () => `${id}-s${seq++}`
  const ROOT = sid()
  let cursor = 0

  const addModel = (parentId: string, label: string, st: SpanStatusT = 'success') => {
    const m = rnd() > 0.7 ? pick(TRACE_MODELS) : primaryModel
    const input = between(1500, 9000)
    const output = st === 'failed' ? between(0, 120) : between(180, 2600)
    const dur = between(700, 4200)
    spans.push({
      id: sid(), parentId, name: label, kind: 'model', status: st,
      startMs: cursor, durationMs: dur, model: m,
      tokens: { input, output, total: input + output }, cost: traceCost(m, input, output),
      attributes: {
        model: m, temperature: +(rnd() * 0.9).toFixed(2), maxTokens: pick([4096, 8192, 16384]),
        stopReason: st === 'failed' ? 'error' : 'end_turn',
        ...(st === 'failed' ? { error: 'upstream 529 overloaded' } : {}),
      },
    })
    cursor += dur + between(20, 160)
  }

  const TOOLS = ['Read', 'Bash', 'Edit', 'Grep', 'Glob', 'WebSearch', 'mcp__contextstream__search']
  const addTool = (parentId: string, st: SpanStatusT = 'success') => {
    const tool = pick(TOOLS)
    const dur = between(90, 2600)
    spans.push({
      id: sid(), parentId, name: tool, kind: 'tool', status: st,
      startMs: cursor, durationMs: dur, tool,
      attributes: {
        tool,
        input: tool === 'Bash' ? { command: 'npm run build' }
          : tool === 'Read' ? { file: 'server/routes/pipeline.ts' }
          : tool === 'WebSearch' ? { query: 'distributed tracing waterfall ui' }
          : { pattern: 'TraceSpan', path: 'src/**/*.ts' },
        ...(st === 'failed'
          ? { error: 'ENOENT: no such file or directory', exitCode: 1 }
          : { resultPreview: 'ok', bytes: between(120, 18000) }),
      },
    })
    cursor += dur + between(10, 90)
  }

  const addMemory = (parentId: string, label: string) => {
    const dur = between(40, 420)
    spans.push({
      id: sid(), parentId, name: label, kind: 'memory', status: 'success',
      startMs: cursor, durationMs: dur,
      attributes: { store: pick(['contextstream', 'local-fs', 'vector']), hits: between(1, 7), query: label },
    })
    cursor += dur + between(10, 60)
  }

  const group = (name: string, kind: SpanKind, st: SpanStatusT, body: (gid: string) => void, attrs?: Record<string, unknown>) => {
    const start = cursor
    const gid = sid()
    const span: TraceSpan = { id: gid, parentId: ROOT, name, kind, status: st, startMs: start, durationMs: 0, attributes: attrs }
    spans.push(span)
    body(gid)
    span.durationMs = cursor - start
  }

  group('Plan task', 'plan', 'success', gid => addModel(gid, 'Reasoning · planning'), { steps: between(2, 5) })
  group('Recall context', 'memory', 'success', gid => {
    const n = between(2, 4)
    for (let i = 0; i < n; i++) addMemory(gid, pick(['user preferences', 'project facts', 'prior decisions', 'feedback notes']))
  }, { source })

  const stepCount = between(2, 4)
  for (let i = 1; i <= stepCount; i++) {
    const last = i === stepCount
    const st: SpanStatusT = last && status === 'failed' ? 'failed' : last && status === 'running' ? 'running' : 'success'
    const verb = pick(['Search', 'Analyze', 'Implement', 'Verify', 'Compose'])
    group(`Step ${i}: ${verb}`, 'agent', st, gid => {
      addModel(gid, `${verb} · model call`, st === 'failed' ? 'failed' : 'success')
      const tools = between(1, 3)
      for (let t = 0; t < tools; t++) addTool(gid, st === 'failed' && t === tools - 1 ? 'failed' : 'success')
    }, { step: i, goal: verb })
  }

  if (status !== 'failed') {
    const dur = between(60, 300)
    spans.push({
      id: sid(), parentId: ROOT, name: 'Final message', kind: 'message',
      status: status === 'running' ? 'running' : 'success', startMs: cursor, durationMs: dur,
      attributes: { preview: 'Done — summary of changes and next steps.' },
    })
    cursor += dur
  }

  const totalTokens = spans.reduce((n, s) => n + (s.tokens?.total ?? 0), 0)
  const totalCost = +spans.reduce((n, s) => n + (s.cost ?? 0), 0).toFixed(4)
  const models = Array.from(new Set(spans.filter(s => s.model).map(s => s.model as string)))

  spans.unshift({
    id: ROOT, parentId: null, name, kind: 'run', status,
    startMs: 0, durationMs: cursor,
    tokens: { input: 0, output: 0, total: totalTokens }, cost: totalCost,
    attributes: { id, source, status },
  })

  return {
    id, name, source, status,
    startedAt: new Date(Date.now() - cursor).toISOString(),
    durationMs: cursor, totalTokens, totalCost,
    models: models.length ? models : [primaryModel],
    spanCount: spans.length, spans,
  }
}

function toSpanStatus(s: string): SpanStatusT {
  if (s === 'running') return 'running'
  if (s === 'failed') return 'failed'
  if (s === 'skipped') return 'skipped'
  return 'success'
}

// ─── Routes ──────────────────────────────────────────────────────────────────

pipelineRouter.get('/runs/:id/trace', (req, res) => {
  const id = req.params.id
  const name = typeof req.query.name === 'string' && req.query.name ? req.query.name : `Run ${id.slice(0, 8)}`
  const model = typeof req.query.model === 'string' ? req.query.model : ''
  const status = toSpanStatus(typeof req.query.status === 'string' ? req.query.status : 'completed')
  const source = typeof req.query.source === 'string' && req.query.source ? req.query.source : 'claude'
  const run = buildTrace(id, name, model, status, source)
  res.json({ run, fetchedAt: new Date().toISOString() })
})

pipelineRouter.get('/runs', (_req, res) => {
  const projectsDir = findClaudeProjectsDir()
  if (!projectsDir) {
    return res.json({ active: [], history: [], fetchedAt: new Date().toISOString(), error: 'Cannot locate ~/.claude/projects' })
  }

  const now   = Date.now()
  const files = collectJsonlFiles(projectsDir).slice(0, 100) // cap for perf

  const active:  PipelineRun[] = []
  const history: PipelineRun[] = []

  for (const file of files) {
    const ageH = (now - file.mtime) / 3_600_000
    if (ageH > 48) break // older than 48h: skip

    const info = parseSessionForPipeline(file)
    if (!info) continue

    const run   = sessionToRun(info, now)
    const ageMin = (now - new Date(info.lastActiveAt).getTime()) / 60_000

    if (ageMin < 120) {
      active.push(run)
    } else {
      history.push(run)
    }
  }

  // Sort active: running first, then by lastActiveAt
  active.sort((a, b) => {
    const order: Record<RunStatus, number> = { running: 0, queued: 1, completed: 2, failed: 3 }
    return (order[a.status] - order[b.status]) || new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
  })

  res.json({ active, history: history.slice(0, 30), fetchedAt: new Date().toISOString() })
})

pipelineRouter.get('/scheduled', (_req, res) => {
  const tasks = fetchScheduledTasks()
  res.json({ tasks, fetchedAt: new Date().toISOString() })
})
