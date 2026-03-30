// title: OpenClaw backend route
// path: server/routes/openclaw.ts
// purpose: Receive OpenClaw events and expose session endpoints for the Chats UI.

import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

export const openclawRouter = Router()

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

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

  CREATE INDEX IF NOT EXISTS idx_openclaw_events_ts
  ON openclaw_events(ts DESC);

  CREATE INDEX IF NOT EXISTS idx_openclaw_events_session
  ON openclaw_events(session_key);
`)

type IncomingEvent = {
  source?: string
  eventType?: string
  sessionKey?: string | null
  agentId?: string | null
  ts?: string | number
  payload?: unknown
}

type StoredRow = {
  id: number
  source: string
  event_type: string
  session_key: string | null
  agent_id: string | null
  ts: string
  payload_json: string
}

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

function extractContent(payload: any): string {
  if (!payload || typeof payload !== 'object') return ''

  const candidates = [
    payload.bodyForAgent,
    payload.body,
    payload.content,
    payload.text,
    payload.message,
    payload.response,
    payload.output,
    payload.reply,
    payload.finalText,
    payload.assistantText,
  ]

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return ''
}

function extractTitle(payload: unknown, fallback: string): string {
  const title = deepFindString(payload, [
    'title',
    'conversationTitle',
    'threadTitle',
    'name',
    'channel',
  ])
  if (title) return title
  return fallback.length > 80 ? `${fallback.slice(0, 77)}...` : (fallback || 'OpenClaw Session')
}

function stableId(...parts: Array<string | null | undefined>): string {
  return createHash('sha1').update(parts.filter(Boolean).join('|')).digest('hex').slice(0, 16)
}

function getSessionGroupKey(row: StoredRow): string {
  const payload = asObj(JSON.parse(row.payload_json || '{}'))
  return String(
    row.session_key ||
    payload.sessionKey ||
    payload.conversationId ||
    payload.threadId ||
    payload.channelId ||
    row.agent_id ||
    'openclaw'
  )
}

function getRowsForSession(sessionId: string): StoredRow[] {
  const stmt = db.prepare(`
    SELECT id, source, event_type, session_key, agent_id, ts, payload_json
    FROM openclaw_events
    ORDER BY ts ASC, id ASC
  `)

  const rows = stmt.all() as StoredRow[]
  return rows.filter(row => stableId(getSessionGroupKey(row)) === sessionId)
}

openclawRouter.post('/events', (req, res) => {
  const auth = req.header('authorization') || ''
  const expected = process.env.OPENCLAW_PUSH_TOKEN || ''

  if (expected && auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const body = (req.body ?? {}) as IncomingEvent
  if (!body.eventType?.trim()) {
    return res.status(400).json({ error: 'eventType is required' })
  }

  const stmt = db.prepare(`
    INSERT INTO openclaw_events (
      source, event_type, session_key, agent_id, ts, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    body.source ?? 'openclaw',
    body.eventType.trim(),
    body.sessionKey ?? null,
    body.agentId ?? null,
    toIso(body.ts),
    JSON.stringify(body.payload ?? {})
  )

  return res.status(201).json({ ok: true })
})

openclawRouter.get('/sessions', (_req, res) => {
  const stmt = db.prepare(`
    SELECT id, source, event_type, session_key, agent_id, ts, payload_json
    FROM openclaw_events
    ORDER BY ts ASC, id ASC
  `)

  const rows = stmt.all() as StoredRow[]
  const buckets = new Map<string, StoredRow[]>()

  for (const row of rows) {
    const id = stableId(getSessionGroupKey(row))
    const arr = buckets.get(id) ?? []
    arr.push(row)
    buckets.set(id, arr)
  }

  const sessions = Array.from(buckets.entries()).map(([id, items]) => {
    const firstRow = items[0]
    const lastRow = items[items.length - 1]
    const firstPayload = asObj(JSON.parse(firstRow.payload_json || '{}'))
    const firstContent = extractContent(firstPayload)

    const messageRows = items.filter(r =>
      r.event_type === 'message:received' || r.event_type === 'message:sent'
    )

    return {
      id,
      projectSlug: 'openclaw',
      title: extractTitle(firstPayload, firstContent),
      firstMessage: firstContent || 'OpenClaw activity',
      messages: [],
      messageCount: messageRows.length,
      startedAt: firstRow.ts,
      lastActiveAt: lastRow.ts,
      cwd: 'openclaw/live',
      inputTokens: 0,
      outputTokens: 0,
    }
  }).sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())

  res.json({
    sessions,
    fetchedAt: new Date().toISOString(),
  })
})

openclawRouter.get('/sessions/:id', (req, res) => {
  const rows = getRowsForSession(req.params.id)
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Session not found' })
  }

  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]
  const firstPayload = asObj(JSON.parse(firstRow.payload_json || '{}'))
  const firstContent = extractContent(firstPayload)

  const messages = rows
    .filter(r => r.event_type === 'message:received' || r.event_type === 'message:sent')
    .map(r => {
      const payload = JSON.parse(r.payload_json || '{}')
      return {
        role: r.event_type === 'message:sent' ? 'assistant' : 'user',
        content: extractContent(payload) || `[${r.event_type}]`,
        timestamp: r.ts,
      }
    })
    .filter(m => m.content.trim() && !m.content.startsWith('[message:'))

    res.json({
      session: {
        id: req.params.id,
        projectSlug: 'openclaw',
        title: extractTitle(firstPayload, firstContent),
        firstMessage: firstContent || 'OpenClaw activity',
        messages,
        messageCount: messages.length,
        startedAt: firstRow.ts,
        lastActiveAt: lastRow.ts,
        cwd: 'openclaw/live',
        inputTokens: 0,
        outputTokens: 0,
      },
      fetchedAt: new Date().toISOString(),
    })
})

// ─── Derive OpenClaw agents from events ──────────────────────────────────────

export function getOpenClawHealth(): { status: 'healthy' | 'warning' | 'offline'; lastEventAt: string | null; eventCount: number; latencyMs: number } {
  const start = Date.now()
  try {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM openclaw_events').get() as any
    const lastRow = db.prepare('SELECT ts FROM openclaw_events ORDER BY ts DESC LIMIT 1').get() as any
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

export function getOpenClawEventStats(cutoffMs: number): Array<{ date: string; events: number; messages: number }> {
  try {
    const rows = db.prepare(
      'SELECT ts, event_type FROM openclaw_events WHERE ts >= ? ORDER BY ts ASC'
    ).all(new Date(cutoffMs).toISOString()) as Array<{ ts: string; event_type: string }>

    const byDay = new Map<string, { events: number; messages: number }>()
    for (const r of rows) {
      const date = r.ts.slice(0, 10)
      const entry = byDay.get(date) ?? { events: 0, messages: 0 }
      entry.events++
      if (r.event_type === 'message:received' || r.event_type === 'message:sent') entry.messages++
      byDay.set(date, entry)
    }

    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stats]) => ({ date, ...stats }))
  } catch {
    return []
  }
}

type OpenClawAgentState =
  | 'thinking' | 'coding' | 'writing' | 'searching'
  | 'planning' | 'reading' | 'sleeping' | 'idle' | 'error'

function eventToState(eventType: string): OpenClawAgentState {
  if (eventType === 'message:sent') return 'writing'
  if (eventType === 'message:received') return 'reading'
  if (eventType === 'message:preprocessed') return 'thinking'
  return 'thinking'
}

function parseAgentName(sessionKey: string): string {
  // agent:main:discord:channel:... → OpenClaw Main
  // agent:main:cron:...            → OpenClaw Main
  const parts = sessionKey.split(':')
  if (parts[0] === 'agent' && parts[1]) {
    return `OpenClaw ${parts[1].charAt(0).toUpperCase() + parts[1].slice(1)}`
  }
  return 'OpenClaw'
}

function parseAgentId(sessionKey: string): string {
  const parts = sessionKey.split(':')
  if (parts[0] === 'agent' && parts[1]) return `openclaw-${parts[1]}`
  return `openclaw-${sessionKey}`
}

function parseChannelType(sessionKey: string): string {
  const parts = sessionKey.split(':')
  if (parts[0] === 'agent' && parts[2]) return parts[2]
  return 'unknown'
}

export function getOpenClawAgents() {
  const stmt = db.prepare(`
    SELECT id, source, event_type, session_key, agent_id, ts, payload_json
    FROM openclaw_events
    ORDER BY ts ASC, id ASC
  `)
  const rows = stmt.all() as StoredRow[]

  // Group by agent identifier (e.g. "agent:main")
  const agentBuckets = new Map<string, StoredRow[]>()
  for (const row of rows) {
    const key = row.session_key || row.agent_id || 'openclaw'
    const parts = key.split(':')
    const agentKey = parts[0] === 'agent' ? `${parts[0]}:${parts[1]}` : key
    const arr = agentBuckets.get(agentKey) ?? []
    arr.push(row)
    agentBuckets.set(agentKey, arr)
  }

  const agents = []
  for (const [agentKey, items] of agentBuckets) {
    if (items.length === 0) continue

    const firstRow = items[0]
    const lastRow = items[items.length - 1]

    // Derive state from recency + last event type
    const ageMs = Date.now() - new Date(lastRow.ts).getTime()
    const ageMin = ageMs / 60_000
    let state: OpenClawAgentState
    if (ageMin > 60) state = 'idle'
    else if (ageMin > 15) state = 'sleeping'
    else state = eventToState(lastRow.event_type)

    // Collect channels this agent operates on
    const channels = new Set<string>()
    for (const r of items) {
      if (r.session_key) channels.add(parseChannelType(r.session_key))
    }

    // Get last user message and last response
    const reversed = [...items].reverse()
    const lastReceived = reversed.find(r => r.event_type === 'message:received')
    const lastSent = reversed.find(r => r.event_type === 'message:sent')
    const lastTask = lastReceived
      ? extractContent(JSON.parse(lastReceived.payload_json || '{}')).slice(0, 120)
      : ''
    const lastToolInput = lastSent
      ? extractContent(JSON.parse(lastSent.payload_json || '{}')).slice(0, 80)
      : ''

    const messageCount = items.filter(r =>
      r.event_type === 'message:received' || r.event_type === 'message:sent'
    ).length

    // Unique session keys = sub-sessions
    const sessionKeys = new Set(items.map(r => r.session_key).filter(Boolean))

    const relAge = (iso: string) => {
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

    agents.push({
      id:            parseAgentId(agentKey),
      name:          parseAgentName(agentKey),
      cwd:           `openclaw/${agentKey}`,
      state,
      currentTask:   lastTask,
      lastTool:      channels.size > 0 ? `channels: ${[...channels].join(', ')}` : null,
      lastToolInput,
      model:         'openclaw-runtime',
      systemPrompt:  '',
      sessionCount:  sessionKeys.size,
      inputTokens:   0,
      outputTokens:  0,
      totalTokens:   0,
      cost:          0,
      lastActiveAt:  lastRow.ts,
      lastActiveAgo: relAge(lastRow.ts),
      startedAt:     firstRow.ts,
      source:        'openclaw' as const,
    })
  }

  agents.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
  return agents
}

openclawRouter.get('/agents', (_req, res) => {
  const agents = getOpenClawAgents()
  res.json({ agents, fetchedAt: new Date().toISOString() })
})

openclawRouter.get('/events', (_req, res) => {
  const stmt = db.prepare(`
    SELECT id, source, event_type, session_key, agent_id, ts, payload_json
    FROM openclaw_events
    ORDER BY ts DESC, id DESC
    LIMIT 500
  `)

  const rows = stmt.all() as StoredRow[]

  res.json({
    events: rows.map(row => ({
      id: row.id,
      source: row.source,
      eventType: row.event_type,
      sessionKey: row.session_key,
      agentId: row.agent_id,
      ts: row.ts,
      payload: JSON.parse(row.payload_json || '{}'),
    })),
    fetchedAt: new Date().toISOString(),
  })
})