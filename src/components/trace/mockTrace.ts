// Deterministic mock trace generator — used for demo data and as a client-side
// fallback when the backend trace endpoint is unavailable. Seeded by run id so
// the same run always renders the same trace.

import type { SpanStatus, TraceRun, TraceSpan } from './types'

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

const MODELS = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5']

// USD per 1M tokens (input / output) — rough public list pricing.
const RATES: Record<string, { in: number; out: number }> = {
  'claude-opus-4-7':   { in: 15, out: 75 },
  'claude-sonnet-4-6': { in: 3,  out: 15 },
  'claude-haiku-4-5':  { in: 0.8, out: 4 },
}

function costOf(model: string, input: number, output: number): number {
  const r = RATES[model] ?? RATES['claude-sonnet-4-6']
  return +(((input / 1e6) * r.in) + ((output / 1e6) * r.out)).toFixed(4)
}

export interface MockTraceOpts {
  id:      string
  name?:   string
  model?:  string
  status?: SpanStatus
  source?: string
}

export function buildMockTrace(opts: MockTraceOpts): TraceRun {
  const { id, name = 'Agent run', source = 'claude' } = opts
  const rnd = mulberry32(hashStr(id))
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a))
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]

  const primaryModel = opts.model && RATES[opts.model] ? opts.model : pick(MODELS)
  const runStatus: SpanStatus = opts.status ?? (rnd() > 0.85 ? 'failed' : 'success')

  const spans: TraceSpan[] = []
  let seq = 0
  const sid = () => `${id}-s${seq++}`

  const ROOT = sid()
  let cursor = 0

  const addModel = (parentId: string, label: string, status: SpanStatus = 'success'): TraceSpan => {
    const model = rnd() > 0.7 ? pick(MODELS) : primaryModel
    const input = between(1500, 9000)
    const output = status === 'failed' ? between(0, 120) : between(180, 2600)
    const dur = between(700, 4200)
    const span: TraceSpan = {
      id: sid(), parentId, name: label, kind: 'model', status,
      startMs: cursor, durationMs: dur, model,
      tokens: { input, output, total: input + output },
      cost: costOf(model, input, output),
      attributes: {
        model, temperature: +(rnd() * 0.9).toFixed(2), maxTokens: pick([4096, 8192, 16384]),
        stopReason: status === 'failed' ? 'error' : 'end_turn',
        ...(status === 'failed' ? { error: 'upstream 529 overloaded' } : {}),
      },
    }
    cursor += dur + between(20, 160)
    spans.push(span)
    return span
  }

  const TOOLS = ['Read', 'Bash', 'Edit', 'Grep', 'Glob', 'WebSearch', 'mcp__contextstream__search']
  const addTool = (parentId: string, status: SpanStatus = 'success'): TraceSpan => {
    const tool = pick(TOOLS)
    const dur = between(90, 2600)
    const span: TraceSpan = {
      id: sid(), parentId, name: tool, kind: 'tool', status,
      startMs: cursor, durationMs: dur, tool,
      attributes: {
        tool,
        input: tool === 'Bash' ? { command: 'npm run build' }
          : tool === 'Read' ? { file: 'src/components/trace/TraceViewer.tsx' }
          : tool === 'WebSearch' ? { query: 'langfuse waterfall trace ui' }
          : { pattern: 'TraceSpan', path: 'src/**/*.ts' },
        ...(status === 'failed'
          ? { error: 'ENOENT: no such file or directory', exitCode: 1 }
          : { resultPreview: 'ok — 42 matches', bytes: between(120, 18000) }),
      },
    }
    cursor += dur + between(10, 90)
    spans.push(span)
    return span
  }

  const addMemory = (parentId: string, label: string): TraceSpan => {
    const dur = between(40, 420)
    const hits = between(1, 7)
    const span: TraceSpan = {
      id: sid(), parentId, name: label, kind: 'memory', status: 'success',
      startMs: cursor, durationMs: dur,
      attributes: { store: pick(['contextstream', 'local-fs', 'vector']), hits, query: label },
    }
    cursor += dur + between(10, 60)
    spans.push(span)
    return span
  }

  // ── Build the tree ─────────────────────────────────────────────────────────
  const plan = (): TraceSpan => {
    const start = cursor
    const span: TraceSpan = {
      id: sid(), parentId: ROOT, name: 'Plan task', kind: 'plan', status: 'success',
      startMs: start, durationMs: 0, attributes: { steps: between(2, 5) },
    }
    spans.push(span)
    addModel(span.id, 'Reasoning · planning')
    span.durationMs = cursor - start
    return span
  }

  const recall = (): TraceSpan => {
    const start = cursor
    const span: TraceSpan = {
      id: sid(), parentId: ROOT, name: 'Recall context', kind: 'memory', status: 'success',
      startMs: start, durationMs: 0, attributes: { source },
    }
    spans.push(span)
    const n = between(2, 4)
    for (let i = 0; i < n; i++) addMemory(span.id, pick(['user preferences', 'project facts', 'prior decisions', 'feedback notes']))
    span.durationMs = cursor - start
    return span
  }

  const step = (n: number, status: SpanStatus): TraceSpan => {
    const start = cursor
    const verb = pick(['Search', 'Analyze', 'Implement', 'Verify', 'Compose'])
    const span: TraceSpan = {
      id: sid(), parentId: ROOT, name: `Step ${n}: ${verb}`, kind: 'agent', status,
      startMs: start, durationMs: 0, attributes: { step: n, goal: verb },
    }
    spans.push(span)
    addModel(span.id, `${verb} · model call`, status === 'failed' ? 'failed' : 'success')
    const tools = between(1, 3)
    for (let i = 0; i < tools; i++) {
      const toolStatus: SpanStatus = (status === 'failed' && i === tools - 1) ? 'failed' : 'success'
      addTool(span.id, toolStatus)
    }
    span.durationMs = cursor - start
    return span
  }

  plan()
  recall()
  const stepCount = between(2, 4)
  for (let i = 1; i <= stepCount; i++) {
    const last = i === stepCount
    const s: SpanStatus = last && runStatus === 'failed' ? 'failed'
      : last && runStatus === 'running' ? 'running'
      : 'success'
    step(i, s)
  }
  if (runStatus !== 'failed') {
    const start = cursor
    const msg: TraceSpan = {
      id: sid(), parentId: ROOT, name: 'Final message', kind: 'message',
      status: runStatus === 'running' ? 'running' : 'success',
      startMs: start, durationMs: between(60, 300),
      attributes: { preview: 'Done — summary of changes and next steps.' },
    }
    cursor += msg.durationMs
    spans.push(msg)
  }

  // ── Root + totals ────────────────────────────────────────────────────────────
  const totalTokens = spans.reduce((n, s) => n + (s.tokens?.total ?? 0), 0)
  const totalCost = +spans.reduce((n, s) => n + (s.cost ?? 0), 0).toFixed(4)
  const models = Array.from(new Set(spans.filter(s => s.model).map(s => s.model!)))

  spans.unshift({
    id: ROOT, parentId: null, name, kind: 'run', status: runStatus,
    startMs: 0, durationMs: cursor,
    tokens: { input: 0, output: 0, total: totalTokens },
    cost: totalCost,
    attributes: { id, source, status: runStatus },
  })

  return {
    id, name, source, status: runStatus,
    startedAt: new Date(Date.now() - cursor).toISOString(),
    durationMs: cursor,
    totalTokens, totalCost,
    models: models.length ? models : [primaryModel],
    spanCount: spans.length,
    spans,
  }
}
