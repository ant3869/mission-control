// title: Source-parameterized agent event store + derivations
// path: server/lib/agentEvents.ts
// purpose: Shared SQLite store for pushed agent events (OpenClaw, Hermes) plus
//          all derivations (sessions, agents, memory, cron, health, stats).
//          Every query is filtered by `source` so each agent platform is
//          tracked identically. Secrets are redacted on the way in.

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { redact } from './redact.js'

export type AgentSource = 'openclaw' | 'hermes'

// ─── DB (shared file; `source` column separates platforms) ──────────────────

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

// Table name kept as openclaw_events for backward compatibility with existing
// data; it now holds events from every source.
const db = new DatabaseSync(join(dataDir, 'openclaw.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS openclaw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    session_key TEXT,
    agent_id TEXT,
    ts TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_openclaw_events_ts ON openclaw_events(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_openclaw_events_session ON openclaw_events(session_key);
  CREATE INDEX IF NOT EXISTS idx_openclaw_events_source ON openclaw_events(source);
`)

export interface StoredRow {
  id: number
  source: string
  event_type: string
  session_key: string | null
  agent_id: string | null
  ts: string
  payload_json: string
}

type IncomingEvent = {
  source?: string
  eventType?: string
  sessionKey?: string | null
  agentId?: string | null
  ts?: string | number
  payload?: unknown
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function toIso(ts?: string | number): string {
  if (typeof ts === 'number') return new Date(ts).toISOString()
  if (typeof ts === 'string' && ts.trim()) {
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return new Date().toISOString()
}

function asObj(v: unknown): Record<string, any> {
  return v && typeof v === 'object' ? (v as Record<string, any>) : {}
}

function deepFindString(input: unknown, keys: string[]): string {
  const seen = new Set<unknown>()
  const walk = (value: unknown): string => {
    if (!value || typeof value !== 'object') return ''
    if (seen.has(value)) return ''
    seen.add(value)
    const obj = value as Record<string, any>
    for (const k of keys) {
      const direct = obj[k]
      if (typeof direct === 'string' && direct.trim()) return direct.trim()
    }
    for (const child of Object.values(obj)) {
      const found = walk(child)
      if (found) return found
    }
    return ''
  }
  return walk(input)
}

// Strip OpenClaw/Hermes inline directives (e.g. [[tts:text]]) from display text.
function cleanDisplay(s: string): string {
  return s.replace(/\[\[[^\]\n]{0,48}\]\]/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}

function extractToolJson(s: string): string {
  const t = s.trim()
  if (!t.startsWith('{')) return ''
  try {
    const obj = JSON.parse(t)
    if (!obj?.tool) return ''
    const name  = String(obj.tool.name ?? obj.tool.label ?? obj.tool.id ?? 'tool')
    const input = obj.tool.input ?? {}
    const cmd   = String(input.command ?? input.cmd ?? input.code ?? '').trim().slice(0, 120)
    const rc    = obj.result?.content
    let out = ''
    if (Array.isArray(rc)) {
      out = rc.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('\n').trim()
    } else if (typeof rc === 'string') { out = rc.trim() }
    return [`⚙ ${name}${cmd ? `: ${cmd}` : ''}`, out.slice(0, 500)].filter(Boolean).join('\n')
  } catch { return '' }
}

function extractContent(payload: any): string {
  if (!payload || typeof payload !== 'object') return ''
  const candidates = [
    payload.bodyForAgent, payload.body, payload.content, payload.text,
    payload.message, payload.response, payload.output, payload.reply,
    payload.finalText, payload.assistantText,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      const cleaned = cleanDisplay(value)
      return extractToolJson(cleaned) || cleaned
    }
  }
  return ''
}

function extractTitle(payload: unknown, fallback: string): string {
  const title = deepFindString(payload, ['title', 'conversationTitle', 'threadTitle', 'name', 'channel'])
  if (title) return title
  return fallback.length > 80 ? `${fallback.slice(0, 77)}...` : (fallback || 'Session')
}

function stableId(...parts: Array<string | null | undefined>): string {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16)
}

function getSessionGroupKey(row: StoredRow): string {
  const payload = asObj(JSON.parse(row.payload_json || '{}'))
  return String(
    row.session_key || payload.sessionKey || payload.conversationId ||
    payload.threadId || payload.channelId || row.agent_id || row.source,
  )
}

function relAge(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  const hrs = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs < 24) return `${hrs}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

function fmtAgo(iso: string): string {
  if (!iso) return 'unknown'
  const diff = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function isMessage(eventType: string): boolean {
  return eventType === 'message:received' || eventType === 'message:sent'
}

// ─── Ingestion ──────────────────────────────────────────────────────────────

export function ingestEvent(source: AgentSource, body: IncomingEvent): { ok: boolean; error?: string } {
  if (!body.eventType?.trim()) return { ok: false, error: 'eventType is required' }

  // Drop config blobs / mask secrets before anything is persisted.
  const safePayload = redact(body.payload ?? {})

  db.prepare(`
    INSERT INTO openclaw_events (source, event_type, session_key, agent_id, ts, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    source,
    body.eventType.trim(),
    body.sessionKey ?? null,
    body.agentId ?? null,
    toIso(body.ts),
    JSON.stringify(safePayload),
  )
  return { ok: true }
}

function allRows(source: AgentSource): StoredRow[] {
  return db.prepare(`
    SELECT id, source, event_type, session_key, agent_id, ts, payload_json
    FROM openclaw_events WHERE source = ?
    ORDER BY ts ASC, id ASC
  `).all(source) as unknown as StoredRow[]
}

// Raw event feed — redacted on read because rows captured before redaction was
// added may still contain secrets in their stored payloads.
export function getRawEvents(source: AgentSource, limit = 500) {
  const rows = db.prepare(`
    SELECT id, source, event_type, session_key, agent_id, ts, payload_json
    FROM openclaw_events WHERE source = ?
    ORDER BY ts DESC, id DESC LIMIT ?
  `).all(source, limit) as unknown as StoredRow[]

  return rows.map(row => ({
    id: row.id,
    source: row.source,
    eventType: row.event_type,
    sessionKey: row.session_key,
    agentId: row.agent_id,
    ts: row.ts,
    payload: redact(JSON.parse(row.payload_json || '{}')),
  }))
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function deriveSessions(source: AgentSource) {
  const rows = allRows(source)
  const buckets = new Map<string, StoredRow[]>()
  for (const row of rows) {
    const id = stableId(getSessionGroupKey(row))
    const arr = buckets.get(id) ?? []
    arr.push(row)
    buckets.set(id, arr)
  }

  return Array.from(buckets.entries()).map(([id, items]) => {
    const firstRow = items[0]
    const lastRow = items[items.length - 1]
    const firstPayload = asObj(JSON.parse(firstRow.payload_json || '{}'))
    const firstContent = extractContent(firstPayload)
    const messageRows = items.filter(r => isMessage(r.event_type))
    const isHeartbeat = items.some(r => r.session_key?.includes(':cron:'))

    return {
      id,
      projectSlug: source,
      title: isHeartbeat ? 'Heartbeat check-in' : extractTitle(firstPayload, firstContent),
      firstMessage: firstContent || `${source} activity`,
      messages: [] as any[],
      messageCount: messageRows.length,
      startedAt: firstRow.ts,
      lastActiveAt: lastRow.ts,
      cwd: `${source}/live`,
      inputTokens: 0,
      outputTokens: 0,
      isHeartbeat,
      source,
    }
  }).sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
}

export function deriveSessionDetail(source: AgentSource, sessionId: string) {
  const rows = allRows(source).filter(row => stableId(getSessionGroupKey(row)) === sessionId)
  if (rows.length === 0) return null

  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]
  const firstPayload = asObj(JSON.parse(firstRow.payload_json || '{}'))
  const firstContent = extractContent(firstPayload)

  const messages = rows
    .filter(r => isMessage(r.event_type))
    .map(r => {
      const payload = JSON.parse(r.payload_json || '{}')
      return {
        role: r.event_type === 'message:sent' ? 'assistant' : 'user',
        content: extractContent(payload) || `[${r.event_type}]`,
        timestamp: r.ts,
      }
    })
    .filter(m => m.content.trim() && !m.content.startsWith('[message:'))

  const isHeartbeat = rows.some(r => r.session_key?.includes(':cron:'))

  return {
    id: sessionId,
    projectSlug: source,
    title: isHeartbeat ? 'Heartbeat check-in' : extractTitle(firstPayload, firstContent),
    firstMessage: firstContent || `${source} activity`,
    messages,
    messageCount: messages.length,
    startedAt: firstRow.ts,
    lastActiveAt: lastRow.ts,
    cwd: `${source}/live`,
    inputTokens: 0,
    outputTokens: 0,
    isHeartbeat,
    source,
  }
}

// ─── Agents ──────────────────────────────────────────────────────────────────

type AgentState =
  | 'thinking' | 'coding' | 'writing' | 'searching'
  | 'planning' | 'reading' | 'sleeping' | 'idle' | 'error'

function eventToState(eventType: string): AgentState {
  if (eventType === 'message:sent') return 'writing'
  if (eventType === 'message:received') return 'reading'
  if (eventType === 'message:preprocessed') return 'thinking'
  return 'thinking'
}

function titleCaseWord(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function parseAgentName(source: AgentSource, sessionKey: string): string {
  const label = titleCaseWord(source)
  const parts = sessionKey.split(':')
  if (parts[0] === 'agent' && parts[1]) return `${label} ${titleCaseWord(parts[1])}`
  return label
}

function parseAgentId(source: AgentSource, sessionKey: string): string {
  const parts = sessionKey.split(':')
  if (parts[0] === 'agent' && parts[1]) return `${source}-${parts[1]}`
  return `${source}-${sessionKey}`
}

function parseChannelType(sessionKey: string): string {
  const parts = sessionKey.split(':')
  if (parts[0] === 'agent' && parts[2]) return parts[2]
  return 'unknown'
}

const isCronKey = (key: string | null | undefined) => !!key && key.includes(':cron:')
// Throwaway/manual session keys that should not be presented as real agents.
const isJunkKey = (key: string) =>
  !key.startsWith('agent:') && /(^|[-_:])(test|sample|demo|scratch|box-?test)s?([-_:]|$)/i.test(key)

export function deriveAgents(source: AgentSource) {
  const rows = allRows(source)
  const agentBuckets = new Map<string, StoredRow[]>()
  for (const row of rows) {
    const key = row.session_key || row.agent_id || source
    const parts = key.split(':')
    const agentKey = parts[0] === 'agent' ? `${parts[0]}:${parts[1]}` : key
    const arr = agentBuckets.get(agentKey) ?? []
    arr.push(row)
    agentBuckets.set(agentKey, arr)
  }

  const agents = []
  for (const [agentKey, items] of agentBuckets) {
    if (isJunkKey(agentKey)) continue

    // An "agent" is interactive activity. Cron/heartbeat runs are scheduled
    // jobs (shown in Pipeline), not agents — exclude them so a heartbeat prompt
    // never appears as an agent's current task.
    const interactive = items.filter(r => !isCronKey(r.session_key))
    if (interactive.length === 0) continue

    const firstRow = interactive[0]
    const lastRow = interactive[interactive.length - 1]

    const ageMin = (Date.now() - new Date(lastRow.ts).getTime()) / 60_000
    let state: AgentState
    if (ageMin > 60) state = 'idle'
    else if (ageMin > 15) state = 'sleeping'
    else state = eventToState(lastRow.event_type)

    const channels = new Set<string>()
    for (const r of interactive) if (r.session_key) channels.add(parseChannelType(r.session_key))

    const reversed = [...interactive].reverse()
    const lastReceived = reversed.find(r => r.event_type === 'message:received')
    const lastSent = reversed.find(r => r.event_type === 'message:sent')
    const lastTask = lastReceived ? extractContent(JSON.parse(lastReceived.payload_json || '{}')).slice(0, 120) : ''
    const lastToolInput = lastSent ? extractContent(JSON.parse(lastSent.payload_json || '{}')).slice(0, 80) : ''
    const messageCount = interactive.filter(r => isMessage(r.event_type)).length
    const sessionKeys = new Set(interactive.map(r => r.session_key).filter(Boolean))
    const cronRuns = new Set(items.filter(r => isCronKey(r.session_key)).map(r => r.session_key)).size

    agents.push({
      id:            parseAgentId(source, agentKey),
      name:          parseAgentName(source, agentKey),
      cwd:           `${source}/${agentKey}`,
      state,
      currentTask:   lastTask,
      lastTool:      channels.size > 0 ? `channels: ${[...channels].join(', ')}` : null,
      lastToolInput,
      model:         `${source}-runtime`,
      systemPrompt:  '',
      sessionCount:  sessionKeys.size,
      inputTokens:   0,
      outputTokens:  0,
      totalTokens:   0,
      cost:          0,
      lastActiveAt:  lastRow.ts,
      lastActiveAgo: fmtAgo(lastRow.ts),
      startedAt:     firstRow.ts,
      messageCount,
      cronRuns,
      source,
    })
  }
  agents.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
  return agents
}

// ─── Memory entries ───────────────────────────────────────────────────────────

export function deriveMemoryEntries(source: AgentSource) {
  const rows = allRows(source)
  if (rows.length === 0) return []

  const buckets = new Map<string, StoredRow[]>()
  for (const row of rows) {
    const id = stableId(getSessionGroupKey(row))
    const arr = buckets.get(id) ?? []
    arr.push(row)
    buckets.set(id, arr)
  }

  const entries = []
  for (const [id, items] of buckets) {
    const isHeartbeat = items.some(r => r.session_key?.includes(':cron:'))
    const sentMessages = items.filter(r => r.event_type === 'message:sent')
    const lastSent = sentMessages[sentMessages.length - 1]
    if (!lastSent) continue

    const content = extractContent(JSON.parse(lastSent.payload_json || '{}'))
    if (!content || content.startsWith('[message:')) continue

    const firstPayload = asObj(JSON.parse(items[0].payload_json || '{}'))
    const title = extractTitle(firstPayload, content)
    const ts = new Date(lastSent.ts).getTime()

    entries.push({
      id:          `${source}-${id}`,
      filename:    `${source}-${id}.md`,
      name:        isHeartbeat ? `Status: ${content.slice(0, 60)}` : title,
      description: content.slice(0, 140),
      type:        isHeartbeat ? 'reference' as const : 'user' as const,
      content,
      wordCount:   content.split(/\s+/).filter(Boolean).length,
      updatedAt:   ts,
      updatedAgo:  relAge(ts),
      source,
    })
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt)
  return entries
}

// ─── Health + stats ────────────────────────────────────────────────────────

export interface SourceHealth {
  status: 'healthy' | 'warning' | 'offline'
  lastEventAt: string | null
  eventCount: number
  latencyMs: number
}

export function deriveHealth(source: AgentSource): SourceHealth {
  const start = Date.now()
  try {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM openclaw_events WHERE source = ?').get(source) as any
    const lastRow = db.prepare('SELECT ts FROM openclaw_events WHERE source = ? ORDER BY ts DESC LIMIT 1').get(source) as any
    const latencyMs = Date.now() - start
    const eventCount = countRow?.cnt ?? 0
    const lastEventAt = lastRow?.ts ?? null
    if (eventCount === 0) return { status: 'offline', lastEventAt: null, eventCount: 0, latencyMs }
    const ageMin = lastEventAt ? (Date.now() - new Date(lastEventAt).getTime()) / 60_000 : Infinity
    const status = ageMin < 30 ? 'healthy' : ageMin < 120 ? 'warning' : 'offline'
    return { status, lastEventAt, eventCount, latencyMs }
  } catch {
    return { status: 'offline', lastEventAt: null, eventCount: 0, latencyMs: Date.now() - start }
  }
}

export function deriveEventStats(source: AgentSource, cutoffMs: number) {
  try {
    const rows = db.prepare(
      'SELECT ts, event_type FROM openclaw_events WHERE source = ? AND ts >= ? ORDER BY ts ASC',
    ).all(source, new Date(cutoffMs).toISOString()) as Array<{ ts: string; event_type: string }>

    const byDay = new Map<string, { events: number; messages: number }>()
    for (const r of rows) {
      const date = r.ts.slice(0, 10)
      const entry = byDay.get(date) ?? { events: 0, messages: 0 }
      entry.events++
      if (isMessage(r.event_type)) entry.messages++
      byDay.set(date, entry)
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stats]) => ({ date, ...stats }))
  } catch {
    return []
  }
}

// ─── Smart cron detection (derived from captured cron runs) ─────────────────

export interface AgentCronJob {
  id:           string
  rawId:        string   // gateway job id for live jobs; '' for derived
  source:       AgentSource
  name:         string
  schedule:     string
  cronExpr:     string
  prompt:       string
  deliver:      string
  enabled:      boolean
  nextRunAt:    string | null
  lastRunAt:    string | null
  nextRunLabel: string
  lastRunLabel: string
  runCount:     number
  successRate:  number
  origin:       'live' | 'derived'
  sample:       string
}

function classifyCron(content: string): string {
  const c = content.toLowerCase()
  if (/🌅|morning briefing|good morning/.test(c)) return 'Morning briefing'
  if (/status\.md|status snapshot|open-loops|sources of truth/.test(c)) return 'Status sync'
  if (/heartbeat_ok|no broken|no issues|all (good|clear|systems)|health check/.test(c)) return 'Heartbeat / health check'
  if (/backup|nightly/.test(c)) return 'Nightly backup'
  if (/digest|summary|recap/.test(c)) return 'Digest'
  const firstLine = content.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return firstLine ? firstLine.slice(0, 48) : 'Scheduled task'
}

function isFailureOutput(content: string): boolean {
  return /❌|\b(error|failed|failure|exception|broken)\b/i.test(content) &&
         !/no (errors?|failures?|broken)/i.test(content)
}

function inferSchedule(sortedMs: number[]): string {
  if (sortedMs.length < 2) return 'irregular'
  const gaps: number[] = []
  for (let i = 1; i < sortedMs.length; i++) gaps.push(sortedMs[i] - sortedMs[i - 1])
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]
  const min = median / 60_000
  if (min < 2) return 'every minute'
  if (min < 75) return `every ${Math.round(min / 5) * 5 || 1}m`
  const hr = min / 60
  if (hr < 1.5) return 'hourly'
  if (hr < 20) return `every ${Math.round(hr)}h`
  if (hr < 30) return 'daily'
  const days = hr / 24
  if (days < 9) return `every ${Math.round(days)}d`
  return 'weekly+'
}

function relFuture(ms: number): string {
  const sec = Math.floor((ms - Date.now()) / 1000)
  if (sec < 0) return 'due'
  if (sec < 60) return `in ${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `in ${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `in ${hr}h`
  return `in ${Math.floor(hr / 24)}d`
}

const SCHEDULE_TO_MS: Record<string, number> = {
  'every minute': 60_000,
  hourly: 3_600_000,
  daily: 86_400_000,
}

export function deriveCronJobs(source: AgentSource): AgentCronJob[] {
  const rows = allRows(source).filter(r => r.session_key?.includes(':cron:'))
  if (rows.length === 0) return []

  // Group rows into individual cron *runs* by their unique session key.
  const runs = new Map<string, StoredRow[]>()
  for (const r of rows) {
    const key = r.session_key as string
    const arr = runs.get(key) ?? []
    arr.push(r)
    runs.set(key, arr)
  }

  // Summarize each run: when it fired, what it produced, where it delivered.
  interface RunSummary { ms: number; deliver: string; output: string; prompt: string; agentKey: string }
  const summaries: RunSummary[] = []
  for (const [key, items] of runs) {
    items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    const sent = items.find(r => r.event_type === 'message:sent')
    const pre = items.find(r => r.event_type !== 'message:sent')
    const sentP = sent ? JSON.parse(sent.payload_json || '{}') : {}
    const preP = pre ? JSON.parse(pre.payload_json || '{}') : {}
    const parts = key.split(':')
    summaries.push({
      ms:       new Date((sent ?? items[items.length - 1]).ts).getTime(),
      deliver:  String(sentP.to ?? sentP.channelId ?? preP.channelId ?? 'agent'),
      output:   extractContent(sentP),
      prompt:   extractContent(preP),
      agentKey: parts[0] === 'agent' ? `${parts[0]}:${parts[1]}` : key,
    })
  }

  // Distinct recurring jobs = grouped by delivery target (different channel =
  // different purpose), falling back to the agent key.
  const groups = new Map<string, RunSummary[]>()
  for (const s of summaries) {
    const gk = `${s.agentKey}|${s.deliver}`
    const arr = groups.get(gk) ?? []
    arr.push(s)
    groups.set(gk, arr)
  }

  const jobs: AgentCronJob[] = []
  for (const [gk, runsForGroup] of groups) {
    runsForGroup.sort((a, b) => a.ms - b.ms)
    const times = runsForGroup.map(r => r.ms)
    const last = runsForGroup[runsForGroup.length - 1]
    const lastRunMs = times[times.length - 1]
    const schedule = inferSchedule(times)
    const intervalMs = SCHEDULE_TO_MS[schedule]
    const nextRunMs = intervalMs ? lastRunMs + intervalMs : null

    const failures = runsForGroup.filter(r => isFailureOutput(r.output)).length
    const successRate = Math.round(((runsForGroup.length - failures) / runsForGroup.length) * 100)
    const name = classifyCron(last.output || last.prompt)
    const deliver = last.deliver.replace(/^channel:/, '#')

    jobs.push({
      id:           `${source}-cron-${stableId(gk)}`,
      rawId:        '',
      source,
      name,
      schedule,
      cronExpr:     '',
      prompt:       last.prompt.slice(0, 160),
      deliver,
      enabled:      true,
      nextRunAt:    nextRunMs ? new Date(nextRunMs).toISOString() : null,
      lastRunAt:    new Date(lastRunMs).toISOString(),
      nextRunLabel: nextRunMs ? relFuture(nextRunMs) : '',
      lastRunLabel: fmtAgo(new Date(lastRunMs).toISOString()),
      runCount:     runsForGroup.length,
      successRate,
      origin:       'derived',
      sample:       (last.output || last.prompt).slice(0, 200),
    })
  }

  jobs.sort((a, b) => new Date(b.lastRunAt ?? 0).getTime() - new Date(a.lastRunAt ?? 0).getTime())
  return jobs
}
