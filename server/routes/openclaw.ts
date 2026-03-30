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