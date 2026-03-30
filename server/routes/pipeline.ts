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

  return {
    id:           info.id,
    name:         info.name,
    projectSlug:  info.slug,
    status,
    stages,
    elapsedSec:   Math.floor((new Date(info.lastActiveAt).getTime() - new Date(info.startedAt).getTime()) / 1000),
    inputTokens:  info.inputTokens,
    outputTokens: info.outputTokens,
    totalTokens:  info.inputTokens + info.outputTokens,
    startedAt:    info.startedAt,
    lastActiveAt: info.lastActiveAt,
    elapsedLabel: elapsedLabel(info.startedAt, info.lastActiveAt),
    completedAgo: isActive ? undefined : relAgo(info.lastActiveAt),
    model:        info.model || 'claude-sonnet-4-6',
    cwd:          info.cwd,
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

// ─── Routes ──────────────────────────────────────────────────────────────────

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
