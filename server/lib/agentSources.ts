// title: Per-source aggregator (captured events + live gateway pull)
// path: server/lib/agentSources.ts
// purpose: Combine push-captured data (SQLite) with live data pulled from the
//          OpenClaw/Hermes gateway REST API into one view per source. Used by
//          the openclaw/hermes routes and the cross-source views (agents,
//          memory, office, radar, pipeline).

import {
  type AgentSource, type AgentCronJob,
  deriveSessions, deriveSessionDetail, deriveAgents, deriveMemoryEntries,
  deriveHealth, deriveEventStats, deriveCronJobs,
} from './agentEvents.js'
import { isLive } from './connectors.js'
import {
  fetchStatus, fetchSessions, fetchSessionMessages, fetchCronJobs, fetchAnalyticsUsage,
} from './gateway.js'
import { getSnapshot as ocSnapshot, getHistory as ocHistory } from './openclawWs.js'

// OpenClaw speaks WebSocket RPC; Hermes speaks REST.
const usesWebSocket = (source: AgentSource) => source === 'openclaw'

const VALID_STATES = new Set([
  'thinking', 'coding', 'writing', 'searching', 'planning', 'reading', 'sleeping', 'idle', 'error',
])
function normState(s: any): string {
  const v = String(s ?? '').toLowerCase()
  if (VALID_STATES.has(v)) return v
  if (/run|busy|active|work|think|process/.test(v)) return 'thinking'
  if (/err|fail/.test(v)) return 'error'
  return 'idle'
}

function pick<T>(obj: any, keys: string[], fallback: T): T {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k] as T
  }
  return fallback
}

function toIso(v: any): string {
  if (!v) return ''
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString()
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function fmtAgo(iso: string): string {
  if (!iso) return ''
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function relFuture(iso: string): string {
  if (!iso) return ''
  const sec = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (sec < 0) return 'due'
  if (sec < 60) return `in ${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `in ${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `in ${hr}h`
  return `in ${Math.floor(hr / 24)}d`
}

// ─── Gateway → our shapes ────────────────────────────────────────────────────

// Extract readable text from a chat.history message's `content` (string or
// array of {type:text|tool_use|tool_result|thinking} blocks).
function extractMsgText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => {
      if (!b || typeof b !== 'object') return typeof b === 'string' ? b : ''
      if (b.type === 'text') return String(b.text ?? '')
      if (b.type === 'thinking' || b.type === 'reasoning') return String(b.thinking ?? b.text ?? '')
      if (b.type === 'tool_use' || b.type === 'toolUse') return `↳ tool: ${b.name ?? 'call'}`
      if (b.type === 'tool_result' || b.type === 'toolResult') return `↳ tool result`
      if (b.type === 'image') return '[image]'
      return String(b.text ?? '')
    }).filter(Boolean).join('\n')
  }
  return ''
}

function mapHistoryMessages(messages: any[]) {
  return messages
    .map((m: any) => ({
      role: String(m.role ?? '') === 'user' ? 'user' : 'assistant',
      content: extractMsgText(m.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
      timestamp: toIso(m.timestamp ?? m.ts ?? m.createdAt ?? m.time) || '',
    }))
    .filter(m => m.content)
}

function mapGatewaySession(source: AgentSource, s: any) {
  const id = String(pick(s, ['key', 'id', 'session_id', 'sessionId'], ''))
  const startedAt = toIso(pick(s, ['created_at', 'started_at', 'startedAt', 'start', 'first_message_at'], ''))
  const lastActiveAt = toIso(pick(s, ['updated_at', 'last_active_at', 'lastActiveAt', 'last_message_at', 'updatedAt'], startedAt))
  const inputTokens = Number(pick(s, ['input_tokens', 'inputTokens'], 0)) || 0
  const outputTokens = Number(pick(s, ['output_tokens', 'outputTokens'], 0)) || 0
  // Heartbeat/cron detection across OpenClaw's real fields (key, kind, origin.*).
  const hbHint = [s?.key, s?.kind, s?.origin?.provider, s?.origin?.label, s?.channel].filter(Boolean).join(' ')
  return {
    id: id || `${source}-${startedAt}`,
    projectSlug: source,
    title: String(pick(s, ['title', 'displayName', 'name', 'summary', 'label'], '') || `${source} session`),
    firstMessage: String(pick(s, ['first_message', 'firstMessage', 'preview', 'last_message', 'summary'], '') || s?.origin?.label || ''),
    messages: [] as any[],
    messageCount: Number(pick(s, ['message_count', 'messageCount', 'messages', 'count'], 0)) || 0,
    startedAt: startedAt || lastActiveAt,
    lastActiveAt: lastActiveAt || startedAt,
    cwd: String(pick(s, ['workdir', 'cwd', 'channel', 'platform'], `${source}/gateway`)),
    inputTokens,
    outputTokens,
    isHeartbeat: /cron|heartbeat|schedule/i.test(hbHint),
    source,
    origin: 'live' as const,
  }
}

function mapGatewayCron(source: AgentSource, j: any): AgentCronJob {
  const lastRunAt = toIso(pick(j, ['last_run_at', 'lastRunAt', 'last_run'], ''))
  const nextRunAt = toIso(pick(j, ['next_run_at', 'nextRunAt', 'next_run'], ''))
  const enabled = pick(j, ['enabled'], undefined) !== false && !pick(j, ['paused'], false)
  const runCount = Number(pick(j, ['run_count', 'runCount', 'runs'], 0)) || 0
  const successRate = Number(pick(j, ['success_rate', 'successRate'], 100))
  const rawId = String(pick(j, ['id', 'job_id', 'jobId', 'name'], Math.random().toString(36).slice(2)))
  return {
    id:           `${source}-cron-${rawId}`,
    rawId,
    source,
    name:         String(pick(j, ['name', 'title', 'id'], 'Scheduled job')),
    schedule:     String(pick(j, ['schedule', 'cron', 'cron_expr', 'when'], '')),
    cronExpr:     String(pick(j, ['cron', 'cron_expr', 'cronExpr', 'schedule'], '')),
    prompt:       String(pick(j, ['prompt', 'task', 'description'], '')).slice(0, 160),
    deliver:      String(pick(j, ['deliver', 'target', 'platform', 'channel'], '')),
    enabled,
    nextRunAt:    nextRunAt || null,
    lastRunAt:    lastRunAt || null,
    nextRunLabel: nextRunAt ? relFuture(nextRunAt) : '',
    lastRunLabel: lastRunAt ? fmtAgo(lastRunAt) : 'never',
    runCount,
    successRate:  Number.isFinite(successRate) ? successRate : 100,
    origin:       'live',
    sample:       String(pick(j, ['prompt', 'task', 'description'], '')).slice(0, 200),
  }
}

function mapWsAgent(source: AgentSource, a: any) {
  const rawId = String(pick(a, ['id', 'agentId', 'name', 'key'], '')) || 'agent'
  const lastActiveAt = toIso(pick(a, ['lastActiveAt', 'last_active_at', 'updatedAt', 'updated_at', 'lastSeen'], '')) || new Date().toISOString()
  return {
    id: `${source}-${rawId}`,
    name: String(pick(a, ['name', 'title', 'label', 'id'], source.charAt(0).toUpperCase() + source.slice(1))),
    cwd: `${source}/${rawId}`,
    state: normState(pick(a, ['state', 'status'], 'idle')),
    currentTask: String(pick(a, ['currentTask', 'task', 'lastMessage', 'summary', 'description'], '')),
    lastTool: null,
    lastToolInput: '',
    model: String(pick(a, ['model', 'runtime'], `${source}-runtime`)),
    systemPrompt: '',
    sessionCount: Number(pick(a, ['sessionCount', 'sessions', 'session_count'], 0)) || 0,
    inputTokens: 0, outputTokens: 0,
    totalTokens: Number(pick(a, ['totalTokens', 'tokens'], 0)) || 0, cost: 0,
    lastActiveAt,
    lastActiveAgo: fmtAgo(lastActiveAt),
    startedAt: toIso(pick(a, ['startedAt', 'createdAt', 'created_at'], lastActiveAt)) || lastActiveAt,
    source,
  }
}

// ─── Live transport helpers (WebSocket for OpenClaw, REST for Hermes) ────────

async function liveSessions(source: AgentSource) {
  if (usesWebSocket(source)) {
    const snap = await ocSnapshot()
    return snap.reachable ? snap.sessionsRaw.map(s => mapGatewaySession(source, s)) : []
  }
  const live = await fetchSessions(source)
  return live.ok && live.data ? live.data.map(s => mapGatewaySession(source, s)) : []
}

async function liveCron(source: AgentSource) {
  if (usesWebSocket(source)) {
    const snap = await ocSnapshot()
    return snap.reachable ? snap.cronRaw.map(j => mapGatewayCron(source, j)) : []
  }
  const live = await fetchCronJobs(source)
  return live.ok && live.data ? live.data.map(j => mapGatewayCron(source, j)) : []
}

async function liveAgents(source: AgentSource) {
  if (usesWebSocket(source)) {
    const snap = await ocSnapshot()
    return snap.reachable ? snap.agentsRaw.map(a => mapWsAgent(source, a)) : []
  }
  return [] // Hermes has no agents endpoint; synthesized from status below
}

export interface StatusProbe {
  reachable: boolean
  version: string | null
  gatewayStatus: string | null
  platforms: Array<{ name: string; status: string }>
  activeSessions: number | null
  latencyMs: number
  error: string | null
}

export async function probeStatus(source: AgentSource, force = false): Promise<StatusProbe> {
  if (usesWebSocket(source)) {
    const snap = await ocSnapshot(force)
    return {
      reachable: snap.reachable, version: snap.version,
      gatewayStatus: snap.reachable ? 'connected' : null, platforms: [],
      activeSessions: snap.activeSessions, latencyMs: snap.latencyMs, error: snap.error,
    }
  }
  const s = await fetchStatus(source)
  return {
    reachable: s.reachable, version: s.version, gatewayStatus: s.gatewayStatus,
    platforms: s.platforms, activeSessions: s.activeSessions, latencyMs: s.latencyMs, error: s.error,
  }
}

// ─── Aggregated getters ──────────────────────────────────────────────────────

export async function getSessions(source: AgentSource) {
  const derived = deriveSessions(source)
  if (!isLive(source)) return derived

  const mapped = await liveSessions(source)
  const seen = new Set(derived.map(d => d.id))
  const merged = [...derived]
  for (const m of mapped) if (!seen.has(m.id)) merged.push(m)
  merged.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
  return merged
}

export async function getSessionDetail(source: AgentSource, id: string) {
  const local = deriveSessionDetail(source, id)
  if (local && local.messages.length > 0) return local
  if (!isLive(source)) return local

  // OpenClaw: pull the transcript over WS via chat.history (id is the sessionKey).
  if (usesWebSocket(source)) {
    const h = await ocHistory(id)
    if (!h.reachable || h.messages.length === 0) return local
    const messages = mapHistoryMessages(h.messages)
    const base = local ?? {
      id, projectSlug: source, title: id, firstMessage: '', messageCount: messages.length,
      startedAt: messages[0]?.timestamp ?? '', lastActiveAt: messages[messages.length - 1]?.timestamp ?? '',
      cwd: `${source}/gateway`, inputTokens: 0, outputTokens: 0, isHeartbeat: id.includes(':cron:'), source,
    }
    return { ...base, messages, messageCount: messages.length }
  }

  const live = await fetchSessionMessages(source, id)
  if (live.ok && live.data) {
    const messages = live.data
      .map((m: any) => ({
        role: /assistant|agent|bot|out/i.test(String(m.role ?? m.author ?? m.direction ?? '')) ? 'assistant' : 'user',
        content: String(m.content ?? m.text ?? m.body ?? m.message ?? ''),
        timestamp: toIso(m.timestamp ?? m.ts ?? m.created_at ?? m.time),
      }))
      .filter((m: any) => m.content.trim())
    const base = local ?? {
      id, projectSlug: source, title: `${source} session`, firstMessage: '',
      messageCount: messages.length, startedAt: messages[0]?.timestamp ?? '',
      lastActiveAt: messages[messages.length - 1]?.timestamp ?? '', cwd: `${source}/gateway`,
      inputTokens: 0, outputTokens: 0, isHeartbeat: false, source,
    }
    return { ...base, messages, messageCount: messages.length }
  }
  return local
}

export async function getAgents(source: AgentSource) {
  const derived = deriveAgents(source)
  if (!isLive(source)) return derived

  // Merge captured agents with live ones (deduped by id).
  const live = await liveAgents(source)
  const seen = new Set(derived.map(d => d.id))
  const merged: any[] = [...derived]
  for (const a of live) if (!seen.has(a.id)) merged.push(a)
  if (merged.length > 0) {
    merged.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
    return merged
  }

  // Nothing captured or listed: synthesize a summary agent from gateway status.
  const status = await probeStatus(source)
  if (!status.reachable) return merged
  const now = new Date().toISOString()
  return [{
    id: `${source}-gateway`,
    name: source.charAt(0).toUpperCase() + source.slice(1),
    cwd: `${source}/gateway`,
    state: (status.activeSessions ?? 0) > 0 ? 'thinking' : 'idle',
    currentTask: status.gatewayStatus ? `Gateway: ${status.gatewayStatus}` : '',
    lastTool: status.platforms.length ? `platforms: ${status.platforms.map(p => p.name).join(', ')}` : null,
    lastToolInput: '',
    model: status.version ? `${source} ${status.version}` : `${source}-runtime`,
    systemPrompt: '',
    sessionCount: status.activeSessions ?? 0,
    inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0,
    lastActiveAt: now, lastActiveAgo: 'just now', startedAt: now,
    source,
  }]
}

export function getMemory(source: AgentSource) {
  return deriveMemoryEntries(source)
}

export async function getCron(source: AgentSource): Promise<AgentCronJob[]> {
  const derived = deriveCronJobs(source)
  if (!isLive(source)) return derived

  const liveJobs = await liveCron(source)
  if (liveJobs.length === 0) return derived

  // Keep all live jobs; add derived jobs whose delivery channel isn't already
  // represented (preserves heartbeat insight when the gateway omits it).
  const liveDelivers = new Set(liveJobs.map(j => j.deliver.replace(/^#/, '')))
  const extra = derived.filter(d => !liveDelivers.has(d.deliver.replace(/^#/, '')))
  return [...liveJobs, ...extra]
}

export interface SourceHealthFull {
  source: AgentSource
  status: 'healthy' | 'warning' | 'offline'
  eventCount: number
  lastEventAt: string | null
  latencyMs: number
  live: boolean
  reachable: boolean
  version: string | null
  activeSessions: number | null
  platforms: Array<{ name: string; status: string }>
}

export async function getHealth(source: AgentSource): Promise<SourceHealthFull> {
  const base = deriveHealth(source)
  if (!isLive(source)) {
    return {
      source, status: base.status, eventCount: base.eventCount, lastEventAt: base.lastEventAt,
      latencyMs: base.latencyMs, live: false, reachable: false, version: null,
      activeSessions: null, platforms: [],
    }
  }
  const s = await probeStatus(source)
  // A reachable gateway is healthy even with no pushed events.
  const status: SourceHealthFull['status'] =
    s.reachable ? 'healthy' : base.status === 'healthy' ? 'warning' : 'offline'
  return {
    source, status, eventCount: base.eventCount, lastEventAt: base.lastEventAt,
    latencyMs: s.latencyMs || base.latencyMs, live: true, reachable: s.reachable,
    version: s.version, activeSessions: s.activeSessions, platforms: s.platforms,
  }
}

export async function getAnalytics(source: AgentSource, days = 7) {
  if (!isLive(source)) return null
  const r = await fetchAnalyticsUsage(source, days)
  return r.ok ? r.data : null
}

export { deriveEventStats }
