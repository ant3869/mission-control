// title: Platform metrics normalizer
// path: server/lib/metrics.ts
// purpose: Produce one unified PlatformMetrics shape for both OpenClaw (pulled
//          over WebSocket RPC) and Hermes (pulled over REST), so a single
//          frontend metrics page renders either.

import type { AgentSource } from './agentEvents.js'
import { isLive } from './connectors.js'
import { getMetricsRaw } from './openclawWs.js'
import { fetchStatus, fetchSessions, fetchCronJobs, fetchAnalyticsUsage, fetchSkills, fetchToolsets } from './gateway.js'

export interface Breakdown { name: string; tokens: number; cost: number; count: number }
export interface SessionRow { key: string; title: string; channel: string; model: string; kind: string; tokens: number; cost: number; updatedAt: string | null; startedAt: string | null; status: string; runtimeMs: number; isHeartbeat: boolean }
export interface CronJobMetric { id: string; name: string; agentId: string; enabled: boolean; schedule: string; delivery: string; lastRunAt: string | null; nextRunAt: string | null }
export interface CronRunMetric { ts: string; jobId: string; status: string; action: string; error: string | null }
export interface ChannelMetric { id: string; label: string; enabled: boolean; configured: boolean; running: boolean; lastStartAt: string | null }
export interface MemoryFile { name: string; size: number; updatedAt: string | null; missing: boolean }
export interface SubAgentInfo { key: string; title: string; status: string; tokens: number; updatedAt: string | null }
export interface AutonomyFactor { label: string; score: number; detail: string }
export interface Autonomy { score: number; level: string; factors: AutonomyFactor[] }

export interface PlatformMetrics {
  source: AgentSource
  reachable: boolean
  version: string | null
  error: string | null
  latencyMs: number
  fetchedAt: string
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  cost: { total: number; input: number; output: number; cacheRead: number; cacheWrite: number }
  daily: Array<{ date: string; tokens: number; cost: number; input: number; output: number }>
  messages: { total: number; user: number; assistant: number; toolCalls: number; errors: number } | null
  tools: Array<{ name: string; count: number }>
  byModel: Breakdown[]
  byProvider: Breakdown[]
  byAgent: Breakdown[]
  byChannel: Breakdown[]
  latency: any | null
  sessions: { total: number }
  sessionList: SessionRow[]
  channels: ChannelMetric[]
  cron: { total: number; enabled: boolean; nextWakeAt: string | null; jobs: CronJobMetric[]; runs: CronRunMetric[]; runsTotal: number; failures: number; successRate: number }
  models: Array<{ id: string; name: string; provider: string }>
  skills: Array<{ name: string; description: string }>
  health: { ok: boolean; eventLoop: any | null; memory: any | null; updateAvailable: boolean }
  heartbeat: Array<{ agentId: string; every: string; enabled: boolean }>
  memoryFiles: MemoryFile[]
  subAgents: { total: number; recent: SubAgentInfo[] }
  autonomy: Autonomy
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// Heuristic "how autonomous is your agent" score (0-100) from activity signals.
function computeAutonomy(input: {
  user: number; assistant: number; toolCalls: number; total: number
  autonomousSessions: number; totalSessions: number; cronJobs: number; subAgents: number
}): Autonomy {
  const { user, assistant, toolCalls, total, autonomousSessions, totalSessions, cronJobs, subAgents } = input
  const toolAgency   = clamp01(toolCalls / (user + 1) / 3)            // tool calls per human turn
  const selfDirect   = totalSessions > 0 ? clamp01(autonomousSessions / totalSessions) : 0
  const scheduled    = clamp01(cronJobs / 6)                          // self-scheduled jobs
  const lowHumanDep  = total > 0 ? clamp01(1 - user / total) : 0      // share of non-human messages
  const delegation   = subAgents > 0 ? clamp01(0.4 + subAgents / 12) : 0
  const factors: AutonomyFactor[] = [
    { label: 'Tool agency',        score: Math.round(toolAgency * 100),  detail: `${toolCalls} tool calls vs ${user} human turns` },
    { label: 'Self-direction',     score: Math.round(selfDirect * 100),  detail: `${autonomousSessions}/${totalSessions} sessions cron/heartbeat/sub-agent` },
    { label: 'Scheduled work',     score: Math.round(scheduled * 100),   detail: `${cronJobs} cron job${cronJobs === 1 ? '' : 's'}` },
    { label: 'Low human reliance', score: Math.round(lowHumanDep * 100), detail: `${Math.round((1 - (total ? user / total : 1)) * 100)}% of messages self-generated` },
    { label: 'Delegation',         score: Math.round(delegation * 100),  detail: `${subAgents} sub-agent spawn${subAgents === 1 ? '' : 's'}` },
  ]
  const weights = [0.2, 0.25, 0.2, 0.2, 0.15]
  const raw = factors.reduce((s, f, i) => s + (f.score / 100) * weights[i], 0)
  const score = Math.round(raw * 100)
  const level = score >= 75 ? 'Highly autonomous' : score >= 55 ? 'Autonomous' : score >= 30 ? 'Semi-autonomous' : 'Assisted'
  return { score, level, factors }
}
const iso = (ms: any) => { const n = Number(ms); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null }

function breakdown(x: any): Breakdown[] {
  if (!x) return []
  const arr: any[] = Array.isArray(x) ? x : Object.entries(x).map(([k, v]) => ({ name: k, ...(v as any) }))
  return arr
    .map(e => {
      const tot = e?.totals ?? e ?? {}
      const name = e?.model
        ? (e.provider ? `${e.provider}/${e.model}` : String(e.model))
        : String(e?.provider ?? e?.agentId ?? e?.channel ?? e?.name ?? e?.id ?? e?.key ?? '')
      return {
        name,
        tokens: num(tot.totalTokens ?? tot.tokens ?? tot.total),
        cost: num(tot.totalCost ?? tot.cost),
        count: num(e?.count ?? e?.messages ?? e?.sessions ?? e?.calls),
      }
    })
    .filter(e => e.name && e.name !== 'undefined')
    .sort((a, b) => b.tokens - a.tokens || b.cost - a.cost)
}

function cronScheduleLabel(s: any): string {
  if (!s) return ''
  if (typeof s === 'string') return s
  if (s.expr) return `${s.expr}${s.tz ? ` (${s.tz})` : ''}`
  if (s.kind === 'interval' && s.everyMs) return `every ${Math.round(s.everyMs / 60000)}m`
  if (s.every) return String(s.every)
  return s.kind ? String(s.kind) : ''
}

function deliveryLabel(d: any): string {
  if (!d) return ''
  if (typeof d === 'string') return d
  return String(d.channel ?? d.to ?? d.target ?? d.platform ?? d.kind ?? '')
}

function empty(source: AgentSource, error: string, latencyMs = 0): PlatformMetrics {
  return {
    source, reachable: false, version: null, error, latencyMs, fetchedAt: new Date().toISOString(),
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: { total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    daily: [], messages: null, tools: [], byModel: [], byProvider: [], byAgent: [], byChannel: [],
    latency: null, sessions: { total: 0 }, sessionList: [], channels: [],
    cron: { total: 0, enabled: false, nextWakeAt: null, jobs: [], runs: [], runsTotal: 0, failures: 0, successRate: 100 },
    models: [], skills: [], health: { ok: false, eventLoop: null, memory: null, updateAvailable: false }, heartbeat: [],
    memoryFiles: [], subAgents: { total: 0, recent: [] },
    autonomy: { score: 0, level: 'Assisted', factors: [] },
  }
}

const isAutonomousKey = (key: string, kind = '') => /cron|heartbeat|subagent|schedule/i.test(`${key} ${kind}`)

// ─── OpenClaw (WebSocket RPC) ────────────────────────────────────────────────

async function openclawMetrics(force: boolean): Promise<PlatformMetrics> {
  const b = await getMetricsRaw(force)
  if (!b.reachable) return empty('openclaw', b.error ?? 'unreachable', b.latencyMs)
  const r = b.results
  const uc = r['usage.cost'] ?? {}
  const su = r['sessions.usage'] ?? {}
  const agg = su.aggregates ?? {}
  const t = uc.totals ?? su.totals ?? {}
  const health = r['health'] ?? {}
  const status = r['status'] ?? {}

  const cronJobs: CronJobMetric[] = (r['cron.list']?.jobs ?? []).map((j: any) => ({
    id: String(j.id ?? ''),
    name: String(j.name ?? j.id ?? 'job'),
    agentId: String(j.agentId ?? ''),
    enabled: j.enabled !== false,
    schedule: cronScheduleLabel(j.schedule),
    delivery: deliveryLabel(j.delivery),
    lastRunAt: iso(j.state?.lastRunAtMs ?? j.state?.lastRunMs ?? j.lastRunAtMs),
    nextRunAt: iso(j.state?.nextRunAtMs ?? j.nextRunAtMs),
  }))
  const cronRuns: CronRunMetric[] = (r['cron.runs']?.entries ?? []).map((e: any) => ({
    ts: iso(e.ts) ?? '', jobId: String(e.jobId ?? ''), status: String(e.status ?? ''), action: String(e.action ?? ''), error: e.error ?? null,
  }))
  const failures = cronRuns.filter(x => x.status === 'error' || x.status === 'failed').length
  const cronStatus = r['cron.status'] ?? {}

  const chSrc = health.channels ?? {}
  const chLabels = health.channelLabels ?? {}
  const channels: ChannelMetric[] = Object.entries(chSrc).map(([id, v]: [string, any]) => ({
    id, label: String(chLabels[id] ?? id),
    enabled: !!v?.enabled, configured: !!v?.configured, running: !!v?.running,
    lastStartAt: iso(v?.lastStartAt),
  }))

  const sessionList: SessionRow[] = (r['sessions.list']?.sessions ?? [])
    .map((s: any): SessionRow => ({
      key: String(s.key ?? s.sessionId ?? ''),
      title: String(s.displayName ?? s.key ?? 'session'),
      channel: String(s.channel ?? ''),
      model: String(s.model ?? ''),
      kind: String(s.kind ?? ''),
      tokens: num(s.totalTokens),
      cost: num(s.estimatedCostUsd ?? s.totalCost),
      updatedAt: iso(s.updatedAt),
      startedAt: iso(s.startedAt),
      status: String(s.status ?? ''),
      runtimeMs: num(s.runtimeMs),
      isHeartbeat: /cron|heartbeat|schedule/i.test([s.key, s.kind, s.origin?.provider].filter(Boolean).join(' ')),
    }))
    .sort((a: SessionRow, b: SessionRow) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
    .slice(0, 80)

  const subAgentSessions = sessionList.filter(s => /:subagent:/i.test(s.key) || /subagent/i.test(s.kind))
  const totalSessionsCount = num(r['sessions.list']?.totalCount) || sessionList.length || (su.sessions ?? []).length
  const autonomousSessions = sessionList.filter(s => s.isHeartbeat || isAutonomousKey(s.key, s.kind)).length
  const memoryFiles: MemoryFile[] = (r['agents.files.list']?.files ?? []).map((f: any): MemoryFile => ({
    name: String(f.name ?? ''), size: num(f.size), updatedAt: iso(f.updatedAtMs ?? f.updatedAt), missing: !!f.missing,
  }))
  const msg = agg.messages ?? {}
  const autonomy = computeAutonomy({
    user: num(msg.user), assistant: num(msg.assistant), toolCalls: num(msg.toolCalls), total: num(msg.total),
    autonomousSessions, totalSessions: sessionList.length, cronJobs: cronJobs.length, subAgents: subAgentSessions.length,
  })

  return {
    source: 'openclaw', reachable: true,
    version: b.version ?? status.runtimeVersion ?? null,
    error: null, latencyMs: b.latencyMs, fetchedAt: new Date().toISOString(),
    tokens: { input: num(t.input), output: num(t.output), cacheRead: num(t.cacheRead), cacheWrite: num(t.cacheWrite), total: num(t.totalTokens) || num(t.input) + num(t.output) },
    cost: { total: num(t.totalCost), input: num(t.inputCost), output: num(t.outputCost), cacheRead: num(t.cacheReadCost), cacheWrite: num(t.cacheWriteCost) },
    daily: (uc.daily ?? []).map((d: any) => ({ date: String(d.date), tokens: num(d.totalTokens), cost: num(d.totalCost), input: num(d.input), output: num(d.output) })),
    messages: agg.messages ? { total: num(agg.messages.total), user: num(agg.messages.user), assistant: num(agg.messages.assistant), toolCalls: num(agg.messages.toolCalls), errors: num(agg.messages.errors) } : null,
    tools: (agg.tools?.tools ?? []).map((x: any) => ({ name: String(x.name), count: num(x.count) })),
    byModel: breakdown(agg.byModel),
    byProvider: breakdown(agg.byProvider),
    byAgent: breakdown(agg.byAgent),
    byChannel: breakdown(agg.byChannel),
    latency: agg.latency ?? null,
    sessions: { total: totalSessionsCount },
    sessionList,
    channels,
    cron: {
      total: num(cronStatus.jobs) || cronJobs.length,
      enabled: cronStatus.enabled !== false,
      nextWakeAt: iso(cronStatus.nextWakeAtMs),
      jobs: cronJobs, runs: cronRuns.slice(0, 40), runsTotal: num(r['cron.runs']?.total),
      failures, successRate: cronRuns.length ? Math.round(((cronRuns.length - failures) / cronRuns.length) * 100) : 100,
    },
    models: (r['models.list']?.models ?? []).map((m: any) => ({ id: String(m.id), name: String(m.name ?? m.id), provider: String(m.provider ?? '') })),
    skills: (r['skills.status']?.skills ?? []).map((s: any) => ({ name: String(s.name), description: String(s.description ?? '') })),
    health: {
      ok: health.ok !== false,
      eventLoop: health.eventLoop ?? null,
      memory: r['doctor.memory.status']?.embedding ?? null,
      updateAvailable: !!r['update.status']?.sentinel,
    },
    heartbeat: (status.heartbeat?.agents ?? []).map((a: any) => ({ agentId: String(a.agentId ?? ''), every: String(a.every ?? ''), enabled: a.enabled !== false })),
    memoryFiles,
    subAgents: {
      total: subAgentSessions.length,
      recent: subAgentSessions.slice(0, 12).map((s): SubAgentInfo => ({ key: s.key, title: s.title, status: s.status, tokens: s.tokens, updatedAt: s.updatedAt })),
    },
    autonomy,
  }
}

// ─── Hermes (REST) — best-effort mapping ─────────────────────────────────────

async function hermesMetrics(): Promise<PlatformMetrics> {
  const [statusR, usageR, sessionsR, cronR, skillsR, toolsetsR] = await Promise.all([
    fetchStatus('hermes'), fetchAnalyticsUsage('hermes'), fetchSessions('hermes'), fetchCronJobs('hermes'), fetchSkills('hermes'), fetchToolsets('hermes'),
  ])
  if (!statusR.reachable && !usageR.ok) return empty('hermes', statusR.error ?? 'unreachable', statusR.latencyMs)

  const u: any = usageR.ok ? usageR.data ?? {} : {}
  const t = u.totals ?? {}
  const sessions: any[] = sessionsR.ok ? sessionsR.data ?? [] : []
  const cronRaw: any[] = cronR.ok ? cronR.data ?? [] : []

  // Daily token+cost series (Hermes: day / *_tokens / estimated_cost).
  const daily = (u.daily ?? []).map((d: any) => ({
    date: String(d.day ?? d.date ?? ''),
    tokens: num(d.input_tokens) + num(d.output_tokens) + num(d.cache_read_tokens),
    cost: num(d.estimated_cost ?? d.actual_cost),
    input: num(d.input_tokens), output: num(d.output_tokens),
  }))

  // Per-model breakdown (Hermes: by_model[].model / *_tokens / estimated_cost / sessions).
  const byModel: Breakdown[] = (u.by_model ?? []).map((b: any) => ({
    name: String(b.model ?? ''), tokens: num(b.input_tokens) + num(b.output_tokens) + num(b.cache_read_tokens),
    cost: num(b.estimated_cost ?? b.actual_cost), count: num(b.sessions ?? b.api_calls),
  })).filter((b: Breakdown) => b.name).sort((a: Breakdown, b: Breakdown) => b.tokens - a.tokens)

  // Provider breakdown from model prefix; channel/agent from sessions.
  const provAgg = new Map<string, Breakdown>()
  for (const b of byModel) {
    const prov = b.name.includes('/') ? b.name.split('/')[0] : 'other'
    const cur = provAgg.get(prov) ?? { name: prov, tokens: 0, cost: 0, count: 0 }
    cur.tokens += b.tokens; cur.cost += b.cost; cur.count += b.count
    provAgg.set(prov, cur)
  }
  const chanAgg = new Map<string, Breakdown>()
  for (const s of sessions) {
    const ch = String(s.source ?? 'unknown')
    const cur = chanAgg.get(ch) ?? { name: ch, tokens: 0, cost: 0, count: 0 }
    cur.tokens += num(s.input_tokens) + num(s.output_tokens) + num(s.cache_read_tokens)
    cur.cost += num(s.estimated_cost_usd ?? s.actual_cost_usd); cur.count += 1
    chanAgg.set(ch, cur)
  }

  const jobs: CronJobMetric[] = cronRaw.map((j: any) => ({
    id: String(j.id ?? ''), name: String(j.name ?? j.id ?? 'job'), agentId: String(j.workdir ?? ''),
    enabled: j.enabled !== false && !j.paused_at,
    schedule: String(j.schedule_display ?? cronScheduleLabel(j.schedule)),
    delivery: deliveryLabel(j.deliver),
    lastRunAt: iso(j.last_run_at), nextRunAt: iso(j.next_run_at),
  }))
  const cronFailures = cronRaw.filter((j: any) => j.last_status === 'error' || j.last_error).length

  const subAgentSessions = sessions.filter(s => s.parent_session_id)
  const autonomousSessions = sessions.filter(s => /cron|heartbeat|schedule/i.test(String(s.source ?? '')) || s.parent_session_id).length
  // Derive message stats consistently from the session sample (totals lack a
  // user/assistant/tool breakdown).
  const totalMessages = sessions.reduce((n, s) => n + num(s.message_count), 0)
  const totalToolCalls = sessions.reduce((n, s) => n + num(s.tool_call_count), 0)
  const assistantCalls = sessions.reduce((n, s) => n + num(s.api_call_count), 0)
  const userMsgs = Math.max(0, totalMessages - assistantCalls)

  return {
    source: 'hermes', reachable: statusR.reachable || usageR.ok,
    version: statusR.version, error: null, latencyMs: statusR.latencyMs, fetchedAt: new Date().toISOString(),
    tokens: { input: num(t.total_input), output: num(t.total_output), cacheRead: num(t.total_cache_read), cacheWrite: 0, total: num(t.total_input) + num(t.total_output) + num(t.total_cache_read) },
    cost: { total: num(t.total_estimated_cost ?? t.total_actual_cost), input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    daily,
    messages: { total: totalMessages, user: userMsgs, assistant: assistantCalls, toolCalls: totalToolCalls, errors: 0 },
    // Hermes has no per-tool usage counts; surface enabled toolsets sized by tool count.
    tools: (toolsetsR.ok ? toolsetsR.data ?? [] : [])
      .filter((ts: any) => ts.enabled !== false)
      .map((ts: any) => ({ name: String(ts.label ?? ts.name ?? ''), count: Array.isArray(ts.tools) ? ts.tools.length : 0 }))
      .filter((x: any) => x.name)
      .sort((a: any, b: any) => b.count - a.count),
    byModel,
    byProvider: [...provAgg.values()].sort((a, b) => b.tokens - a.tokens),
    byAgent: [],
    byChannel: [...chanAgg.values()].sort((a, b) => b.tokens - a.tokens),
    latency: null,
    sessions: { total: num(t.total_sessions) || sessions.length || num(statusR.activeSessions) },
    sessionList: sessions.map((s: any): SessionRow => ({
      key: String(s.id ?? ''),
      title: String(s.title ?? (s.preview ? String(s.preview).slice(0, 50) : '') ?? s.id) || String(s.id),
      channel: String(s.source ?? ''),
      model: String(s.model ?? ''),
      kind: s.parent_session_id ? 'subagent' : '',
      tokens: num(s.input_tokens) + num(s.output_tokens) + num(s.cache_read_tokens),
      cost: num(s.estimated_cost_usd ?? s.actual_cost_usd),
      updatedAt: iso(s.last_active),
      startedAt: iso(s.started_at),
      status: s.is_active ? 'active' : String(s.end_reason ?? ''),
      runtimeMs: 0,
      isHeartbeat: /cron|heartbeat/i.test(String(s.source ?? '')),
    })).sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()).slice(0, 80),
    channels: [...chanAgg.keys()].map(id => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1), enabled: true, configured: true, running: true, lastStartAt: null })),
    cron: { total: jobs.length, enabled: true, nextWakeAt: null, jobs, runs: [], runsTotal: 0, failures: cronFailures, successRate: jobs.length ? Math.round(((jobs.length - cronFailures) / jobs.length) * 100) : 100 },
    models: byModel.map(b => ({ id: b.name, name: b.name.includes('/') ? b.name.split('/').slice(1).join('/') : b.name, provider: b.name.includes('/') ? b.name.split('/')[0] : '' })),
    skills: (skillsR.ok ? skillsR.data ?? [] : []).map((s: any) => ({ name: String(s.name ?? ''), description: String(s.description ?? '') })).filter((s: any) => s.name),
    health: { ok: statusR.reachable, eventLoop: null, memory: null, updateAvailable: false },
    heartbeat: [],
    memoryFiles: [],
    subAgents: {
      total: subAgentSessions.length,
      recent: subAgentSessions.slice(0, 12).map((s: any): SubAgentInfo => ({ key: String(s.id ?? ''), title: String(s.title ?? s.id ?? ''), status: s.is_active ? 'active' : String(s.end_reason ?? ''), tokens: num(s.input_tokens) + num(s.output_tokens), updatedAt: iso(s.last_active) })),
    },
    autonomy: computeAutonomy({
      user: userMsgs, assistant: assistantCalls, toolCalls: totalToolCalls, total: totalMessages,
      autonomousSessions, totalSessions: sessions.length, cronJobs: jobs.length, subAgents: subAgentSessions.length,
    }),
  }
}

export async function getPlatformMetrics(source: AgentSource, force = false): Promise<PlatformMetrics> {
  if (!isLive(source)) return empty(source, 'not connected — add a token in Settings')
  return source === 'openclaw' ? openclawMetrics(force) : hermesMetrics()
}
