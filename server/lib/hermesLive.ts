// title: Hermes live event stream (log + status polling)
// path: server/lib/hermesLive.ts
// purpose: Hermes' REST dashboard has no global event socket, so we synthesize a
//          live feed by polling /api/logs (and /api/status for a periodic health
//          line) and emitting new entries to SSE listeners — same interface as
//          openclawLive so the frontend treats both identically.

import { isLive } from './connectors.js'
import { fetchLogs, fetchStatus, fetchSessions, fetchSessionMessages } from './gateway.js'
import type { LiveEvent } from './openclawLive.js'

type Listener = (e: LiveEvent) => void

const BUFFER_MAX = 120
const POLL_MS = 3000
const HEALTH_EVERY_MS = 12_000

let timer: NodeJS.Timeout | null = null
let seq = 0
let lastHealthAt = 0
let sessRefreshAt = 0
type SessMeta = { id: string; source: string; lastActive: number; isActive: boolean }
let sessions: SessMeta[] = []
const seen = new Set<string>()
const toolSeen = new Set<string>()
const listeners = new Set<Listener>()
const buffer: LiveEvent[] = []

function push(e: LiveEvent) {
  buffer.push(e)
  if (buffer.length > BUFFER_MAX) buffer.shift()
  for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
}

// Robust timestamp parse. Hermes v0.14.0 logs carry numeric timestamps in Unix
// SECONDS; passing those straight to `new Date()` (which expects ms) yields
// 1970-era dates, which made every event look ~56 years old → the Watch card
// fell to "idle". Detect seconds vs ms by magnitude and normalize; fall back to
// now for missing/unparseable values.
function parseTs(rawTs: any): string {
  if (rawTs == null || rawTs === '') return new Date().toISOString()
  const asNum = typeof rawTs === 'number' ? rawTs
    : /^\d+(\.\d+)?$/.test(String(rawTs).trim()) ? Number(rawTs)
    : NaN
  const d = Number.isNaN(asNum) ? new Date(rawTs) : new Date(asNum < 1e12 ? asNum * 1000 : asNum)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

function logToEvent(l: any): LiveEvent | null {
  const isObj = l !== null && typeof l === 'object'
  const raw = (isObj ? String(l.message ?? l.msg ?? l.text ?? l.line ?? JSON.stringify(l)) : String(l)).trim()
  if (!raw) return null
  const rawTs = isObj ? (l.ts ?? l.timestamp ?? l.time) : null
  const ts = parseTs(rawTs)
  const sig = `${ts}|${raw}`.slice(0, 200)
  if (seen.has(sig)) return null
  seen.add(sig)
  if (seen.size > 600) seen.clear()

  // ── Hermes-specific log pattern detection ──────────────────────────────
  // Inbound message: "gateway.run: inbound message: platform=X user=Y chat=Z msg='...'"
  const inboundM = raw.match(/gateway\.run: inbound message:.*?platform=(\S+).*?user=(\S+).*?msg='(.*?)'\s*$/)
  if (inboundM) {
    return {
      seq: ++seq, ts, event: 'message.received', kind: 'message', title: 'message',
      sub: inboundM[3].slice(0, 200),
      meta: { channel: inboundM[1], direction: 'in' },
    }
  }

  // Outbound flush: "[Platform] Flushing text batch agent:...:dm:ID (N chars)"
  const outboundM = raw.match(/Flushing text batch\s+\S+\s+\((\d+)\s+chars?\)/i)
  if (outboundM) {
    const chanM = raw.match(/\[(\w+)\]/)
    return {
      seq: ++seq, ts, event: 'message.sent', kind: 'message', title: 'response',
      sub: `${outboundM[1]} chars`,
      meta: { channel: (chanM?.[1] ?? 'discord').toLowerCase(), direction: 'out' },
    }
  }

  // Tool execution: "agent.tool_executor: tool NAME completed/started (Xs, N chars)"
  const toolM = raw.match(/tool_executor: tool\s+(\S+)\s+(completed|started|running)/i)
  if (toolM) {
    const done = toolM[2].toLowerCase() === 'completed'
    return {
      seq: ++seq, ts, event: 'tool', kind: 'tool',
      title: done ? 'tool result' : 'tool call', sub: toolM[1],
      meta: { tool: toolM[1].toLowerCase(), toolInput: '' },
    }
  }

  // Active conversation turn: "conversation_loop: conversation turn: session=ID ..."
  const turnM = raw.match(/conversation(?:_loop)?:.*?(?:conversation turn|API call[^:]*):.*?session=(\S+)/i)
  if (turnM) {
    return {
      seq: ++seq, ts, event: 'active', kind: 'session', title: 'working',
      sub: 'discord session', sessionKey: turnM[1],
      meta: { channel: 'discord' },
    }
  }
  // ── End Hermes pattern detection ───────────────────────────────────────

  // Level: explicit field, else parse from the line text (e.g. "... INFO ...").
  const explicit = isObj ? String(l.level ?? l.severity ?? '') : ''
  const parsed = raw.match(/\b(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL|CRITICAL)\b/)?.[1] ?? ''
  const level = (explicit || parsed || 'log').toLowerCase()
  // Only genuine errors are red — don't flag INFO lines that merely mention "error".
  const isErr = ['error', 'fatal', 'critical'].includes(level) || /\btraceback\b/i.test(raw)

  // Trim the leading timestamp/level prefix from the displayed message.
  const sub = raw.replace(/^\d{4}-\d{2}-\d{2}[ T][\d:,.]+\s*/, '').replace(/^(ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE|FATAL|CRITICAL)\s*/i, '').trim() || raw
  return { seq: ++seq, ts, event: 'log', kind: isErr ? 'error' : 'system', title: level === 'log' ? 'log' : level, sub: sub.slice(0, 200) }
}

// Hermes' REST dashboard has no global event socket, so we synthesize "is the
// agent working" from its sessions: new conversation turns and tool calls become
// live activity events (so the Watch card lights up for an ordinary Discord
// chat, not just tool use), plus a lightweight heartbeat for a recently-active
// session so the card stays "working" mid-response (between messages).
const ACTIVE_WINDOW_MS = 45_000

function msgText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => (b && typeof b === 'object' ? String(b.text ?? '') : typeof b === 'string' ? b : '')).filter(Boolean).join(' ')
  }
  return ''
}

function msgTs(msg: any): string {
  return parseTs(msg.timestamp ?? msg.created_at ?? msg.ts ?? '')
}

async function refreshSessions() {
  const sr = await fetchSessions('hermes')
  if (!sr.ok || !Array.isArray(sr.data)) return
  sessions = sr.data
    .map((s: any): SessMeta => {
      // Hermes v0.14.0 renamed session fields to camelCase (lastActiveAt /
      // startedAt) and dropped the `is_active` flag entirely. Read both shapes
      // and infer "currently active" from recency (the chatting session's
      // lastActiveAt updates in near-real-time) so we poll the right session
      // instead of falling back to stale cron sessions.
      const lastActive = new Date(s.lastActiveAt ?? s.last_active ?? s.startedAt ?? s.started_at ?? 0).getTime()
      return {
        id: String(s.id ?? ''),
        source: String(s.source ?? ''),
        lastActive,
        isActive: Boolean(s.is_active ?? s.isActive ?? (Date.now() - lastActive < 180_000)),
      }
    })
    .filter(s => s.id)
    .sort((a, b) => b.lastActive - a.lastActive)
}

async function pollSessions() {
  if (Date.now() - sessRefreshAt > 6000) {
    sessRefreshAt = Date.now()
    try { await refreshSessions() } catch { /* ignore */ }
  }
  const active = sessions.filter(s => s.isActive)
  const targets = (active.length ? active : sessions).slice(0, 2)
  const emitted = new Set<string>()

  for (const sess of targets) {
    const sid = sess.id
    try {
      const mr = await fetchSessionMessages('hermes', sid, true)
      if (!mr.ok || !Array.isArray(mr.data)) continue
      for (const msg of mr.data.slice(-25)) {
        const ts = msgTs(msg)
        // Tool calls (Hermes records them inside session messages).
        const rawCalls = msg.tool_calls ?? msg.toolCalls
        const toolName = msg.tool_name ?? msg.toolName
        const calls: any[] = Array.isArray(rawCalls) && rawCalls.length ? rawCalls
          : toolName ? [{ function: { name: toolName } }] : []
        for (let i = 0; i < calls.length; i++) {
          const name = String(calls[i]?.function?.name ?? calls[i]?.name ?? toolName ?? 'tool')
          const sig = `${sid}:${msg.id ?? msg.timestamp}:${i}:${name}`
          if (toolSeen.has(sig)) continue
          toolSeen.add(sig)
          const isResult = String(msg.role ?? '') === 'tool'
          push({
            seq: ++seq, ts, event: 'tool', kind: 'tool',
            title: isResult ? 'tool result' : 'tool call', sub: name, sessionKey: sid,
            meta: { tool: name.toLowerCase(), toolInput: '' },
          })
          emitted.add(sid)
        }
        // Conversation turns → "reading a message" / "writing a response".
        const role = String(msg.role ?? '')
        if (role === 'user' || role === 'assistant') {
          const sig = `msg:${sid}:${msg.id ?? msg.timestamp}`
          if (!toolSeen.has(sig)) {
            toolSeen.add(sig)
            const out = role === 'assistant'
            push({
              seq: ++seq, ts, event: out ? 'message.sent' : 'message.received',
              kind: 'message', title: out ? 'response' : 'message',
              sub: msgText(msg.content).slice(0, 140), sessionKey: sid,
              meta: { channel: sess.source, direction: out ? 'out' : 'in' },
            })
            emitted.add(sid)
          }
        }
      }
    } catch { /* ignore */ }
    if (toolSeen.size > 1200) toolSeen.clear()
  }

  // Keep the Watch card "working" during an active window even when no new
  // message surfaced this cycle (e.g. the agent is mid-response).
  for (const sess of targets) {
    if (emitted.has(sess.id)) continue
    const recent = (sess.isActive && Date.now() - sess.lastActive < 300_000) || Date.now() - sess.lastActive < ACTIVE_WINDOW_MS
    if (!recent) continue
    push({
      seq: ++seq, ts: new Date().toISOString(), event: 'active', kind: 'session',
      title: 'working', sub: sess.source ? `${sess.source} session` : 'active session',
      sessionKey: sess.id, meta: { channel: sess.source },
    })
  }
}

async function poll() {
  if (!isLive('hermes')) return
  try {
    const r = await fetchLogs('hermes')
    if (r.ok && Array.isArray(r.data)) {
      // Oldest-first so the tail ends with the newest.
      for (const l of r.data.slice(-40)) { const e = logToEvent(l); if (e) push(e) }
    }
  } catch { /* ignore */ }
  await pollSessions()

  if (Date.now() - lastHealthAt > HEALTH_EVERY_MS) {
    lastHealthAt = Date.now()
    try {
      const s = await fetchStatus('hermes')
      push({
        seq: ++seq, ts: new Date().toISOString(), event: 'health', kind: 'health', title: 'health check',
        sub: s.reachable ? `${s.platforms.length} channels · ${s.activeSessions ?? '?'} sessions` : 'unreachable',
        health: { channels: Object.fromEntries(s.platforms.map(p => [p.name, { running: /run|online|ok|connect/i.test(p.status), configured: true, enabled: true }])), channelLabels: Object.fromEntries(s.platforms.map(p => [p.name, p.name])), ok: s.reachable },
      })
    } catch { /* ignore */ }
  }
}

function start() {
  if (timer) return
  push({ seq: ++seq, ts: new Date().toISOString(), event: 'connected', kind: 'system', title: 'live log stream started', sub: 'polling Hermes /api/logs' })
  poll()
  timer = setInterval(poll, POLL_MS)
}

export function recent(): LiveEvent[] { return [...buffer] }

export function addListener(fn: Listener): () => void {
  listeners.add(fn)
  if (listeners.size === 1) start()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null }
  }
}

export function restartLive() {
  // Switching the connector (e.g. a new base URL/token) invalidates everything
  // we cached about the old instance's sessions.
  seen.clear(); toolSeen.clear(); sessions = []; sessRefreshAt = 0; lastHealthAt = 0
  if (listeners.size > 0 && !timer) start()
}
