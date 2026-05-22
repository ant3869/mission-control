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
let activeIds: string[] = []
const seen = new Set<string>()
const toolSeen = new Set<string>()
const listeners = new Set<Listener>()
const buffer: LiveEvent[] = []

function push(e: LiveEvent) {
  buffer.push(e)
  if (buffer.length > BUFFER_MAX) buffer.shift()
  for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
}

function logToEvent(l: any): LiveEvent | null {
  const isObj = l !== null && typeof l === 'object'
  const raw = (isObj ? String(l.message ?? l.msg ?? l.text ?? l.line ?? JSON.stringify(l)) : String(l)).trim()
  if (!raw) return null
  const rawTs = isObj ? (l.ts ?? l.timestamp ?? l.time) : null
  const ts = rawTs ? new Date(rawTs).toISOString() : new Date().toISOString()
  const sig = `${ts}|${raw}`.slice(0, 200)
  if (seen.has(sig)) return null
  seen.add(sig)
  if (seen.size > 600) seen.clear()

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

// Hermes records tool calls in session messages (tool_calls / tool_name), not logs —
// poll the most-recently-active sessions and emit their tool calls live.
async function pollTools() {
  if (Date.now() - sessRefreshAt > 9000) {
    sessRefreshAt = Date.now()
    try {
      const sr = await fetchSessions('hermes')
      if (sr.ok && Array.isArray(sr.data)) {
        const live = sr.data.filter((s: any) => s.is_active).map((s: any) => s.id)
        activeIds = (live.length ? live : [...sr.data].sort((a: any, b: any) => new Date(b.last_active ?? 0).getTime() - new Date(a.last_active ?? 0).getTime()).map((s: any) => s.id)).slice(0, 2)
      }
    } catch { /* ignore */ }
  }
  for (const sid of activeIds) {
    try {
      const mr = await fetchSessionMessages('hermes', sid, true)
      if (!mr.ok || !Array.isArray(mr.data)) continue
      for (const msg of mr.data.slice(-25)) {
        const calls: any[] = Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls
          : msg.tool_name ? [{ function: { name: msg.tool_name } }] : []
        for (let i = 0; i < calls.length; i++) {
          const name = String(calls[i]?.function?.name ?? calls[i]?.name ?? msg.tool_name ?? 'tool')
          const sig = `${sid}:${msg.id ?? msg.timestamp}:${i}:${name}`
          if (toolSeen.has(sig)) continue
          toolSeen.add(sig)
          if (toolSeen.size > 800) toolSeen.clear()
          const isResult = String(msg.role ?? '') === 'tool'
          push({
            seq: ++seq, ts: (() => { const d = new Date(msg.timestamp ?? ''); return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString() })(),
            event: 'tool', kind: 'tool', title: isResult ? 'tool result' : 'tool call',
            sub: `${name}`, sessionKey: sid,
          })
        }
      }
    } catch { /* ignore */ }
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
  await pollTools()

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
  seen.clear(); lastHealthAt = 0
  if (listeners.size > 0 && !timer) start()
}
