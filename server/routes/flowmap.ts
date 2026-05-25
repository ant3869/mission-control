// title: Flow Map backend route
// path: server/routes/flowmap.ts
// purpose: Serve a node-link traffic graph ("what is talking to what, and where is
//          the load concentrated?"). Derives nodes/edges from real session + cron
//          telemetry across OpenClaw/Hermes when available, and falls back to a
//          seeded mock topology so the view is always demonstrable.

import { Router } from 'express'
import { getSessions, getCron, getMemory, getToolUsage, type ToolUsage } from '../lib/agentSources.js'
import type { AgentSource } from '../lib/agentEvents.js'

export const flowmapRouter = Router()

// ─── Graph shapes (mirror src/types FlowGraph) ───────────────────────────────

type NodeType = 'channel' | 'agent' | 'runtime' | 'cron' | 'tool' | 'memory' | 'external'
type EdgeKind = 'message' | 'invocation' | 'token' | 'handoff'
type Range    = '1h' | '24h' | '7d' | 'all'

interface GNode {
  id: string
  label: string
  type: NodeType
  metrics: { messages?: number; invocations?: number; tokens?: number; sessions?: number }
  meta?: Record<string, string | number>
}

interface GSample { ts?: string; label: string; detail?: string }

interface GEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  volume: number
  metrics: { messages?: number; invocations?: number; tokens?: number; handoffs?: number }
  samples?: GSample[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RANGE_MS: Record<Range, number> = {
  '1h':  60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  'all': Infinity,
}

function parseRange(v: unknown): Range {
  const s = String(v ?? '24h')
  return (s === '1h' || s === '24h' || s === '7d' || s === 'all') ? s : '24h'
}

function edge(source: string, target: string, kind: EdgeKind, volume: number,
             metrics: GEdge['metrics'], samples?: GSample[]): GEdge {
  return { id: `${source}->${target}`, source, target, kind, volume: Math.round(volume), metrics, samples }
}

interface Vals {
  hermesMsgs: number;   openclawMsgs: number
  hermesCron: number;   openclawCron: number
  hermesTokens: number; openclawTokens: number
  hermesMem: number;    openclawMem: number
  hermesTools: number;  openclawTools: number
  hermesSessions: number; openclawSessions: number
  webCalls: number
}

interface SampleSets {
  discordHermes?: GSample[]
  apiOpenclaw?: GSample[]
  cronHermes?: GSample[]
  cronOpenclaw?: GSample[]
  hermesTools?: GSample[]
  openclawTools?: GSample[]
  toolsWeb?: GSample[]
}

// Top tool groups → node tooltip metadata (or an honest note when none seen).
function toolGroupMeta(groups: Record<string, number>): Record<string, string | number> {
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 4)
  if (entries.length === 0) return { note: 'no tool calls observed in range' }
  return Object.fromEntries(entries)
}

// Assemble a fixed flow topology, populated with the supplied metric values.
// Real and mock paths share this so the graph shape is stable across both.
function assemble(v: Vals, s: SampleSets, toolGroups: Record<string, number>): { nodes: GNode[]; edges: GEdge[] } {
  const totalTokens = v.hermesTokens + v.openclawTokens
  const totalCron   = v.hermesCron + v.openclawCron
  const totalTools  = v.hermesTools + v.openclawTools

  const nodes: GNode[] = [
    { id: 'discord',  label: 'Discord',          type: 'channel',  metrics: { messages: v.hermesMsgs }, meta: { surface: 'chat' } },
    { id: 'api',      label: 'Gateway API',      type: 'channel',  metrics: { messages: v.openclawMsgs }, meta: { surface: 'rest / ws' } },
    { id: 'cron',     label: 'Cron & Heartbeats', type: 'cron',    metrics: { invocations: totalCron }, meta: { note: 'scheduled triggers' } },
    { id: 'hermes',   label: 'Hermes',           type: 'agent',    metrics: { messages: v.hermesMsgs, tokens: v.hermesTokens, sessions: v.hermesSessions } },
    { id: 'openclaw', label: 'OpenClaw',         type: 'agent',    metrics: { messages: v.openclawMsgs, tokens: v.openclawTokens, sessions: v.openclawSessions } },
    { id: 'runtime',  label: 'Claude Runtime',   type: 'runtime',  metrics: { tokens: totalTokens }, meta: { note: 'shared LLM execution' } },
    { id: 'memory',   label: 'Memory Store',     type: 'memory',   metrics: { messages: v.hermesMem + v.openclawMem } },
    { id: 'tools',    label: 'Tool Groups',      type: 'tool',     metrics: { invocations: totalTools }, meta: toolGroupMeta(toolGroups) },
    { id: 'anthropic',label: 'Anthropic API',    type: 'external', metrics: { tokens: totalTokens } },
    { id: 'web',      label: 'Web / Research',   type: 'external', metrics: { invocations: v.webCalls } },
  ]

  const edges: GEdge[] = [
    edge('discord', 'hermes',   'message',    v.hermesMsgs,    { messages: v.hermesMsgs },    s.discordHermes),
    edge('api',     'openclaw', 'message',    v.openclawMsgs,  { messages: v.openclawMsgs },  s.apiOpenclaw),
    edge('cron',    'hermes',   'invocation', v.hermesCron,    { invocations: v.hermesCron }, s.cronHermes),
    edge('cron',    'openclaw', 'invocation', v.openclawCron,  { invocations: v.openclawCron }, s.cronOpenclaw),
    edge('hermes',  'runtime',  'token',      v.hermesTokens,  { tokens: v.hermesTokens }),
    edge('openclaw','runtime',  'token',      v.openclawTokens,{ tokens: v.openclawTokens }),
    edge('runtime', 'anthropic','token',      totalTokens,     { tokens: totalTokens }),
    edge('hermes',  'memory',   'handoff',    v.hermesMem,     { handoffs: v.hermesMem }),
    edge('openclaw','memory',   'handoff',    v.openclawMem,   { handoffs: v.openclawMem }),
    edge('hermes',  'tools',    'invocation', v.hermesTools,   { invocations: v.hermesTools }, s.hermesTools),
    edge('openclaw','tools',    'invocation', v.openclawTools, { invocations: v.openclawTools }, s.openclawTools),
    edge('tools',   'web',      'invocation', v.webCalls,      { invocations: v.webCalls },     s.toolsWeb),
  ]

  return { nodes, edges: edges.filter(e => e.volume > 0) }
}

// Seeded fallback so the view is useful before telemetry is connected.
function mockGraph(): { nodes: GNode[]; edges: GEdge[] } {
  return assemble(
    {
      hermesMsgs: 184, openclawMsgs: 132,
      hermesCron: 96,  openclawCron: 41,
      hermesTokens: 412_000, openclawTokens: 287_000,
      hermesMem: 38, openclawMem: 22,
      hermesTools: 74, openclawTools: 58,
      hermesSessions: 27, openclawSessions: 19,
      webCalls: 46,
    },
    {
      discordHermes: [
        { label: '#general — "summarize today\'s standup"', detail: 'user → Hermes', ts: new Date(Date.now() - 6e5).toISOString() },
        { label: '#alerts — "why did the deploy fail?"', detail: 'user → Hermes' },
      ],
      apiOpenclaw: [
        { label: 'POST /sessions — code review run', detail: 'gateway → OpenClaw' },
      ],
      cronHermes: [
        { label: 'daily-digest @ 09:00', detail: 'heartbeat → Hermes' },
        { label: 'inbox-sweep */15m', detail: 'cron → Hermes' },
      ],
      cronOpenclaw: [
        { label: 'repo-watch */30m', detail: 'cron → OpenClaw' },
      ],
      hermesTools: [
        { label: 'web_search', detail: 'Web & Search · #general' },
        { label: 'send_message', detail: 'Comms · #alerts' },
      ],
      openclawTools: [
        { label: 'edit_file', detail: 'Code & Files · code review run' },
        { label: 'bash', detail: 'Code & Files · repo-watch' },
      ],
      toolsWeb: [
        { label: 'web_fetch', detail: 'Web & Search · research run' },
      ],
    },
    { 'Code & Files': 71, 'Web & Search': 46, 'Comms': 9, 'Memory Tools': 6 },
  )
}

// ─── Real-data derivation ────────────────────────────────────────────────────

async function collect(source: AgentSource, since: number) {
  const [sessions, cron] = await Promise.all([getSessions(source), getCron(source)])
  const inWindow = sessions.filter(s => {
    if (since === Infinity) return true
    const t = new Date(s.lastActiveAt ?? 0).getTime()
    return Number.isFinite(t) && t >= since
  })
  const msgs   = inWindow.reduce((n, s) => n + (s.messageCount ?? 0), 0)
  const tokens = inWindow.reduce((n, s) => n + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0)
  const cronRuns = cron.reduce((n, j) => n + (j.runCount ?? 0), 0)
  const mem    = getMemory(source).length

  const sessionSamples: GSample[] = inWindow.slice(0, 5).map(s => ({
    ts: s.lastActiveAt ?? undefined,
    label: (s.title || s.firstMessage || s.id).slice(0, 80),
    detail: `${s.messageCount ?? 0} msgs`,
  }))
  const cronSamples: GSample[] = cron.slice(0, 5).map(j => ({
    label: `${j.name}${j.schedule ? ` @ ${j.schedule}` : ''}`.slice(0, 80),
    detail: j.sample?.slice(0, 80) || `${j.runCount ?? 0} runs`,
  }))

  return { sessions: inWindow.length, msgs, tokens, cronRuns, mem, sessionSamples, cronSamples }
}

function mergeGroups(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a }
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n
  return out
}

function toolSamples(u: ToolUsage, group?: string): GSample[] {
  return u.samples
    .filter(x => !group || x.group === group)
    .slice(0, 5)
    .map(x => ({ ts: x.ts, label: x.name, detail: `${x.group} · ${x.session}`.slice(0, 80) }))
}

// GET /api/flowmap/graph?range=1h|24h|7d|all
flowmapRouter.get('/graph', async (req, res) => {
  const range = parseRange(req.query.range)
  const since = RANGE_MS[range] === Infinity ? Infinity : Date.now() - RANGE_MS[range]

  let nodes: GNode[]
  let edges: GEdge[]
  let live = false

  try {
    const [hr, oc, hrTools, ocTools] = await Promise.all([
      collect('hermes', since), collect('openclaw', since),
      getToolUsage('hermes', since), getToolUsage('openclaw', since),
    ])
    const realSignal = hr.msgs + oc.msgs + hr.cronRuns + oc.cronRuns + hr.tokens + oc.tokens

    if (realSignal > 0) {
      live = true
      const v: Vals = {
        hermesMsgs: hr.msgs, openclawMsgs: oc.msgs,
        hermesCron: hr.cronRuns, openclawCron: oc.cronRuns,
        hermesTokens: hr.tokens, openclawTokens: oc.tokens,
        hermesMem: hr.mem, openclawMem: oc.mem,
        // Real tool-call counts parsed from transcript tool_use blocks.
        hermesTools: hrTools.total, openclawTools: ocTools.total,
        hermesSessions: hr.sessions, openclawSessions: oc.sessions,
        webCalls: (hrTools.byGroup['Web & Search'] ?? 0) + (ocTools.byGroup['Web & Search'] ?? 0),
      }
      const toolGroups = mergeGroups(hrTools.byGroup, ocTools.byGroup)
      ;({ nodes, edges } = assemble(v, {
        discordHermes: hr.sessionSamples,
        apiOpenclaw: oc.sessionSamples,
        cronHermes: hr.cronSamples,
        cronOpenclaw: oc.cronSamples,
        hermesTools: toolSamples(hrTools),
        openclawTools: toolSamples(ocTools),
        toolsWeb: [...toolSamples(hrTools, 'Web & Search'), ...toolSamples(ocTools, 'Web & Search')].slice(0, 5),
      }, toolGroups))
    } else {
      ;({ nodes, edges } = mockGraph())
    }
  } catch {
    ;({ nodes, edges } = mockGraph())
  }

  const stats = {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    totalMessages:    edges.filter(e => e.kind === 'message').reduce((n, e) => n + e.volume, 0),
    totalInvocations: edges.filter(e => e.kind === 'invocation').reduce((n, e) => n + e.volume, 0),
    totalTokens:      edges.filter(e => e.kind === 'token' && e.target === 'runtime').reduce((n, e) => n + e.volume, 0),
  }

  res.json({ nodes, edges, range, live, generatedAt: new Date().toISOString(), stats })
})
