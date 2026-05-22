// title: OpenClaw live event subscription
// path: server/lib/openclawLive.ts
// purpose: Maintain ONE persistent authenticated WebSocket to the OpenClaw
//          gateway, subscribe to its event stream (sessions.subscribe +
//          tool-events), normalize events, and fan them out to SSE listeners
//          so the dashboard shows a true live feed. Connects lazily when the
//          first listener attaches; reconnects with backoff.

import { randomUUID } from 'crypto'
import { getConnector, isLive } from './connectors.js'
import { toWsUrl, toHttpOrigin } from './openclawWs.js'
import { fetchSessions, fetchSessionMessages } from './gateway.js'

export interface LiveEventMeta {
  tool?:      string        // normalized lowercase tool name: "bash", "read", "webfetch", …
  toolInput?: string        // primary arg: command, file path, url, search query, …
  channel?:   string        // platform/channel: "discord", "slack", "#general", …
  direction?: 'in' | 'out' // for messages: received vs sent
}

export interface LiveEvent {
  seq: number
  ts: string
  event: string
  kind: 'message' | 'tool' | 'cron' | 'error' | 'health' | 'session' | 'system'
  title: string
  sub: string
  sessionKey?: string
  health?: any   // attached for kind==='health' so the UI can update live stats
  meta?: LiveEventMeta
}

type Listener = (e: LiveEvent) => void

const SCOPES = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing']
const BUFFER_MAX = 120

let ws: WebSocket | null = null
let connected = false
let stopped = true
let seq = 0
let backoff = 1000
let reconnectTimer: NodeJS.Timeout | null = null
let pollTimer: NodeJS.Timeout | null = null
let sessRefreshAt = 0
let activeSessionIds: string[] = []
const toolSeen = new Set<string>()
const listeners = new Set<Listener>()
const buffer: LiveEvent[] = []
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer: NodeJS.Timeout }>()

export function isConnected(): boolean { return connected && !!ws }

/** Run an RPC over the shared persistent socket (so we don't open a competing
 *  connection while the live stream is active). Rejects if not connected. */
export function request(method: string, params: any = {}, timeoutMs = 9000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!connected || !ws) return reject(new Error('live not connected'))
    const id = randomUUID()
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('rpc timeout')) }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    try { ws.send(JSON.stringify({ type: 'req', id, method, params })) }
    catch (e) { clearTimeout(timer); pending.delete(id); reject(e) }
  })
}

function rejectAllPending(reason: string) {
  for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)) }
  pending.clear()
}

function connectMsg(token: string) {
  return {
    type: 'req', id: randomUUID(), method: 'connect',
    params: {
      minProtocol: 4, maxProtocol: 4,
      client: { id: 'openclaw-control-ui', version: 'mission-control', platform: 'node', mode: 'webchat', instanceId: randomUUID() },
      role: 'operator', scopes: SCOPES, caps: ['tool-events'], auth: { token }, userAgent: 'mission-control', locale: 'en-US',
    },
  }
}

function deepText(p: any, keys: string[]): string {
  if (!p || typeof p !== 'object') return ''
  for (const k of keys) if (typeof p[k] === 'string' && p[k].trim()) return p[k].trim()
  for (const v of Object.values(p)) {
    const found = deepText(v, keys)
    if (found) return found
  }
  return ''
}

function normalize(raw: any): LiveEvent | null {
  const event = String(raw.event ?? '')
  if (!event || event === 'tick' || event === 'presence') return null
  const p = raw.payload ?? {}
  const ts = p.ts ? new Date(p.ts).toISOString() : new Date().toISOString()
  const sessionKey = p.sessionKey ?? p.key ?? p.session?.key ?? undefined
  const base: LiveEvent = { seq: ++seq, ts, event, kind: 'system', title: event, sub: '', sessionKey }

  if (event === 'health') {
    const ch = Object.keys(p.channels ?? {}).length
    return { ...base, kind: 'health', title: 'health check',
      sub: `event-loop ${Math.round(p.eventLoop?.delayP99Ms ?? 0)}ms · ${ch} channels · ${(p.sessions?.active ?? p.sessions?.length ?? '')}`.trim(),
      health: { eventLoop: p.eventLoop, channels: p.channels, channelLabels: p.channelLabels, agents: p.agents, sessions: p.sessions, ok: p.ok } }
  }
  if (/error|fail|exception/i.test(event)) return { ...base, kind: 'error', sub: deepText(p, ['message', 'error', 'reason', 'content']).slice(0, 160) }
  if (/message|chat/i.test(event)) {
    const channel   = String(p.channelId ?? p.channel ?? p.to ?? p.source ?? p.platform ?? '')
    const direction: 'in' | 'out' = /sent|send|outbound|reply/i.test(event) ? 'out' : 'in'
    return { ...base, kind: 'message',
      sub: deepText(p, ['content', 'body', 'bodyForAgent', 'text', 'message']).slice(0, 160),
      meta: { channel, direction } }
  }
  if (/tool/i.test(event)) {
    const toolName  = String(p.name ?? p.tool ?? '').toLowerCase()
    const rawInput  = p.input ?? p.arguments ?? p.params
    const toolInput = rawInput
      ? (typeof rawInput === 'string' ? rawInput
         : String(rawInput.command ?? rawInput.file_path ?? rawInput.path ?? rawInput.url ??
                  rawInput.query ?? rawInput.description ?? rawInput.content?.slice?.(0, 80) ??
                  Object.values(rawInput as object)[0] ?? ''))
      : deepText(p, ['command', 'file_path', 'url', 'query'])
    const sub = toolName
      ? `${toolName}${toolInput ? ': ' + String(toolInput).slice(0, 120) : ''}`
      : deepText(p, ['name', 'command', 'input']).slice(0, 160)
    return { ...base, kind: 'tool', sub,
      meta: { tool: toolName || sub.split(':')[0].trim(), toolInput: String(toolInput).slice(0, 200) } }
  }
  if (/cron|schedule|heartbeat/i.test(event)) return { ...base, kind: 'cron', sub: deepText(p, ['name', 'jobId', 'status', 'content']).slice(0, 160) }
  if (/session/i.test(event)) return { ...base, kind: 'session', sub: String(sessionKey ?? deepText(p, ['displayName', 'title'])).slice(0, 160) }
  return { ...base, sub: deepText(p, ['content', 'message', 'text', 'name', 'status']).slice(0, 160) }
}

function push(e: LiveEvent) {
  buffer.push(e)
  if (buffer.length > BUFFER_MAX) buffer.shift()
  for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
}

async function pollSessionActivity() {
  if (!isLive('openclaw')) return
  // Refresh active session list every 9 s.
  if (Date.now() - sessRefreshAt > 9_000) {
    sessRefreshAt = Date.now()
    try {
      const sr = await fetchSessions('openclaw')
      if (sr.ok && Array.isArray(sr.data)) {
        const live = sr.data
          .filter((s: any) => s.is_active || s.status === 'active' || s.active)
          .map((s: any) => s.id ?? s.key ?? s.sessionId)
          .filter(Boolean)
        const recent = [...sr.data]
          .sort((a: any, b: any) =>
            new Date(b.last_active ?? b.updated_at ?? b.updatedAt ?? 0).getTime() -
            new Date(a.last_active ?? a.updated_at ?? a.updatedAt ?? 0).getTime())
          .map((s: any) => s.id ?? s.key ?? s.sessionId)
          .filter(Boolean)
        activeSessionIds = (live.length ? live : recent).slice(0, 2)
      }
    } catch { /* ignore */ }
  }
  for (const sid of activeSessionIds) {
    try {
      const mr = await fetchSessionMessages('openclaw', sid, true)
      if (!mr.ok || !Array.isArray(mr.data)) continue
      for (const msg of mr.data.slice(-30)) {
        const calls: any[] = Array.isArray(msg.tool_calls) && msg.tool_calls.length
          ? msg.tool_calls
          : msg.tool_name ? [{ name: msg.tool_name }] : []
        for (let i = 0; i < calls.length; i++) {
          const name = String(calls[i]?.function?.name ?? calls[i]?.name ?? msg.tool_name ?? 'tool')
          const sig  = `${sid}:${msg.id ?? msg.timestamp}:${i}:${name}`
          if (toolSeen.has(sig)) continue
          toolSeen.add(sig)
          if (toolSeen.size > 800) toolSeen.clear()
          const rawInput  = calls[i]?.function?.arguments ?? calls[i]?.arguments ?? calls[i]?.input ?? {}
          const parsed    = typeof rawInput === 'string'
            ? (() => { try { return JSON.parse(rawInput) } catch { return { _raw: rawInput } } })()
            : (rawInput ?? {})
          const toolInput = String(
            parsed?.command ?? parsed?.file_path ?? parsed?.path ?? parsed?.url ??
            parsed?.query ?? parsed?.description ?? parsed?._raw ?? ''
          ).slice(0, 200)
          const ts = (() => {
            const d = new Date(msg.timestamp ?? msg.created_at ?? '')
            return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
          })()
          push({ seq: ++seq, ts, event: 'tool', kind: 'tool', title: 'tool call',
            sub: name, sessionKey: sid, meta: { tool: name.toLowerCase(), toolInput } })
        }
        // Also surface message events (inbound Discord/Slack messages, etc.)
        if (msg.role === 'user' || msg.role === 'human') {
          const channel   = String(msg.channel ?? msg.platform ?? msg.source ?? '')
          const direction: 'in' | 'out' = 'in'
          const sig = `${sid}:msg:${msg.id ?? msg.timestamp}:in`
          if (!toolSeen.has(sig)) {
            toolSeen.add(sig)
            const d = new Date(msg.timestamp ?? msg.created_at ?? '')
            push({ seq: ++seq, ts: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
              event: 'message', kind: 'message', title: 'incoming message',
              sub: String(msg.content ?? '').slice(0, 160), sessionKey: sid,
              meta: { channel, direction } })
          }
        }
        if (msg.role === 'assistant' && msg.content && !calls.length) {
          const channel   = String(msg.channel ?? msg.platform ?? msg.target ?? '')
          const direction: 'in' | 'out' = 'out'
          const sig = `${sid}:msg:${msg.id ?? msg.timestamp}:out`
          if (!toolSeen.has(sig)) {
            toolSeen.add(sig)
            const d = new Date(msg.timestamp ?? msg.created_at ?? '')
            push({ seq: ++seq, ts: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
              event: 'message.sent', kind: 'message', title: 'outgoing message',
              sub: String(msg.content ?? '').slice(0, 160), sessionKey: sid,
              meta: { channel, direction } })
          }
        }
      }
    } catch { /* ignore */ }
  }
}

function startPolling() {
  if (pollTimer) return
  pollSessionActivity()
  pollTimer = setInterval(pollSessionActivity, 3_000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  sessRefreshAt = 0
  activeSessionIds = []
}

function scheduleReconnect() {
  if (stopped || listeners.size === 0) return
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => { reconnectTimer = null; open() }, backoff)
  backoff = Math.min(backoff * 2, 30_000)
}

function open() {
  if (stopped || ws) return
  const cfg = getConnector('openclaw')
  if (!cfg || !cfg.baseUrl || !cfg.token) {
    push({ seq: ++seq, ts: new Date().toISOString(), event: 'not-configured', kind: 'error', title: 'not connected', sub: 'add a gateway URL + token in Settings' })
    return
  }
  const wsBase = toWsUrl(cfg.baseUrl)
  const url = `${wsBase}${wsBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(cfg.token)}`
  let sock: WebSocket
  try {
    sock = new WebSocket(url, { headers: { Origin: toHttpOrigin(cfg.baseUrl) } } as any)
  } catch (err: any) {
    push({ seq: ++seq, ts: new Date().toISOString(), event: 'ws-error', kind: 'error', title: 'connection failed', sub: err?.message ?? '' })
    return scheduleReconnect()
  }
  ws = sock
  connected = false

  sock.addEventListener('message', (ev: any) => {
    let m: any
    try { m = JSON.parse(String(ev.data)) } catch { return }
    if (m.type === 'event' && m.event === 'connect.challenge') { sock.send(JSON.stringify(connectMsg(cfg.token))); return }
    if (m.type === 'res') {
      // Resolve any in-flight RPC sent over the shared socket.
      const p = pending.get(m.id)
      if (p) { clearTimeout(p.timer); pending.delete(m.id); m.ok === false ? p.reject(new Error(m.error?.message ?? 'rpc failed')) : p.resolve(m.payload); return }
      if (!connected) {
        if (m.ok === false && m.error) {
          push({ seq: ++seq, ts: new Date().toISOString(), event: 'auth-error', kind: 'error', title: 'auth rejected', sub: m.error?.message ?? '' })
          return
        }
        connected = true
        backoff = 1000
        sock.send(JSON.stringify({ type: 'req', id: randomUUID(), method: 'sessions.subscribe', params: {} }))
        push({ seq: ++seq, ts: new Date().toISOString(), event: 'connected', kind: 'system', title: 'live stream connected', sub: 'subscribed to gateway events' })
      }
      return
    }
    if (m.type === 'event') {
      const n = normalize(m)
      if (n) push(n)
    }
  })
  sock.addEventListener('error', () => { /* close will follow */ })
  sock.addEventListener('close', () => {
    if (ws === sock) ws = null
    connected = false
    rejectAllPending('connection closed')
    if (!stopped && listeners.size > 0) {
      push({ seq: ++seq, ts: new Date().toISOString(), event: 'disconnected', kind: 'system', title: 'live stream dropped', sub: 'reconnecting…' })
      scheduleReconnect()
    }
  })
}

export function recent(): LiveEvent[] {
  return [...buffer]
}

export function addListener(fn: Listener): () => void {
  listeners.add(fn)
  if (listeners.size === 1) { stopped = false; open(); startPolling() }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0) {
      stopped = true
      stopPolling()
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      try { ws?.close() } catch { /* ignore */ }
      ws = null
      connected = false
    }
  }
}

export function restartLive() {
  if (listeners.size === 0) return
  try { ws?.close() } catch { /* ignore */ }
  ws = null; connected = false; backoff = 1000
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  open()
}
