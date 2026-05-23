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
const rawLog: { ts: string; event: string; payload: any }[] = []
const RAW_MAX = 60

/** Expose last N raw events for debugging — GET /api/watch/debug */
export function rawEvents(): typeof rawLog { return [...rawLog] }

let ws: WebSocket | null = null
let connected = false
let stopped = true
let seq = 0
let backoff = 1000
let reconnectTimer: NodeJS.Timeout | null = null
let pollTimer: NodeJS.Timeout | null = null
let sessRefreshAt = 0
let activeSessionIds: string[] = []
const sessionChannels: Record<string, string> = {}
// Track per-session state to detect new runs without requiring real-time tool events
const sessionStartedAt: Record<string, number> = {}  // last known startedAt per session
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
    // Extract active session keys from health payload for the polling loop.
    // Format: p.sessions is an array of { path, count, recent: [{key, updatedAt, age}] }
    const freshKeys: string[] = []
    const sessArr: any[] = Array.isArray(p.sessions) ? p.sessions : []
    for (const group of sessArr) {
      const recent: any[] = Array.isArray(group?.recent) ? group.recent : []
      for (const s of recent.slice(0, 3)) {
        const k = String(s?.key ?? '').trim()
        if (k && !freshKeys.includes(k)) freshKeys.push(k)
      }
    }
    // Also try flat format: p.sessions is an array of session objects.
    if (freshKeys.length === 0 && Array.isArray(p.sessions)) {
      for (const s of p.sessions.slice(0, 3)) {
        const k = String(s?.key ?? s?.id ?? s?.sessionKey ?? '').trim()
        if (k && !freshKeys.includes(k)) freshKeys.push(k)
      }
    }
    if (freshKeys.length > 0) {
      // Keep the most recently active sessions for polling.
      activeSessionIds = freshKeys.slice(0, 3)
      sessRefreshAt = Date.now() + 8_000 // defer RPC refresh since we just got fresh data
    }
    return { ...base, kind: 'health', title: 'health check',
      sub: `event-loop ${Math.round(p.eventLoop?.delayP99Ms ?? 0)}ms · ${ch} channels · ${(p.sessions?.active ?? p.sessions?.length ?? '')}`.trim(),
      health: { eventLoop: p.eventLoop, channels: p.channels, channelLabels: p.channelLabels, agents: p.agents, sessions: p.sessions, ok: p.ok } }
  }
  if (/error|fail|exception/i.test(event)) return { ...base, kind: 'error', sub: deepText(p, ['message', 'error', 'reason', 'content']).slice(0, 160) }
  // sessions.changed fires when a session completes — extract provider/surface for Watch status.
  if (event === 'sessions.changed') {
    const provider = String(p.provider ?? p.surface ?? p.channel ?? '').toLowerCase()
    const phase    = String(p.phase ?? '')
    const direction: 'in' | 'out' = phase === 'end' ? 'out' : 'in'
    const channel  = provider.includes('discord') ? 'Discord'
      : provider.includes('slack') ? 'Slack'
      : provider.includes('telegram') ? 'Telegram'
      : provider
    if (channel) {
      return { ...base, kind: 'message',
        sub: phase === 'end' ? 'response sent' : 'message received',
        meta: { channel, direction } }
    }
    return { ...base, kind: 'session', sub: String(p.phase ?? '').slice(0, 60) }
  }
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
  if (!connected) return

  // ── 1. Poll sessions.list every tick (3s) ─────────────────────────────────
  // This is our primary real-time signal — chat.history only commits after a
  // full tool turn, so we can't rely on it for in-progress activity.
  try {
    const list = await request('sessions.list', {}, 6000)
    const arr: any[] = Array.isArray(list) ? list
      : (list?.sessions ?? list?.data ?? list?.items ?? [])

    const live = arr.filter((s: any) => /running/i.test(String(s.status ?? '')))
      .map((s: any) => s.key ?? s.id ?? s.sessionKey).filter(Boolean)
    const byRecency = [...arr]
      .sort((a: any, b: any) =>
        new Date(b.updatedAt ?? b.startedAt ?? 0).getTime() -
        new Date(a.updatedAt ?? a.startedAt ?? 0).getTime())
      .map((s: any) => s.key ?? s.id ?? s.sessionKey).filter(Boolean)
    activeSessionIds = (live.length ? live : byRecency).slice(0, 3)

    for (const s of arr) {
      const k: string = s.key ?? s.id
      if (!k) continue

      // Cache channel label for this session.
      const raw = (s.origin?.provider ?? s.lastChannel ?? s.channel ?? '').toLowerCase()
      sessionChannels[k] = raw.includes('discord') ? 'Discord'
        : raw.includes('slack') ? 'Slack'
        : raw.includes('telegram') ? 'Telegram'
        : raw.includes('webchat') ? 'webchat'
        : raw || ''

      const startedAt = Number(s.startedAt ?? 0)
      const prevStartedAt = sessionStartedAt[k] ?? 0
      const channel = sessionChannels[k] || 'Discord'

      // ── New run detected: startedAt changed and is within last 5 min ──────
      if (startedAt && startedAt !== prevStartedAt) {
        sessionStartedAt[k] = startedAt
        const runAgeMs = Date.now() - startedAt
        if (runAgeMs < 300_000 && prevStartedAt > 0) {
          // A brand-new run just started on a session we've seen before.
          console.log(`[Watch] new run on ${k} — channel: ${channel}`)
          push({ seq: ++seq, ts: new Date().toISOString(), event: 'message', kind: 'message',
            title: 'incoming message', sub: 'message received',
            sessionKey: k, meta: { channel, direction: 'in' } })
        }
        if (prevStartedAt === 0) sessionStartedAt[k] = startedAt // just bootstrapping
      }

      // ── Session was active within last 60s: show it as working ───────────
      const updatedAt = Number(s.updatedAt ?? 0)
      const updatedAgeMs = updatedAt ? Date.now() - updatedAt : Infinity
      if (updatedAgeMs < 60_000 && startedAt) {
        const runAgeMs = Date.now() - startedAt
        if (runAgeMs < 60_000) {
          const activeSig = `${k}:active:${startedAt}`
          if (!toolSeen.has(activeSig)) {
            toolSeen.add(activeSig)
            console.log(`[Watch] active run on ${k} (${Math.round(runAgeMs / 1000)}s ago)`)
            push({ seq: ++seq, ts: new Date(startedAt).toISOString(), event: 'session.active',
              kind: 'session', title: 'active run', sub: 'running',
              sessionKey: k, meta: { channel, direction: 'in' } })
          }
        }
      }
    }

    // ── 2. After-run history scan ─────────────────────────────────────────────
    // Call chat.history for recently-updated sessions to capture the last tool
    // used AFTER a run completes. Throttled to once per session per 6s.
    if (Date.now() - sessRefreshAt > 6_000) {
      sessRefreshAt = Date.now()
      for (const sid of activeSessionIds.slice(0, 2)) {
        try {
          const hist = await request('chat.history', { sessionKey: sid, limit: 50, maxChars: 80_000 }, 8000)
          const messages: any[] = Array.isArray(hist) ? hist
            : (hist?.messages ?? hist?.history ?? hist?.entries ?? [])

          for (const msg of messages) {
            const msgTs = (() => {
              const d = new Date(msg.ts ?? msg.timestamp ?? msg.created_at ?? '')
              return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
            })()
            const msgId = msg.__openclaw?.id ?? msg.idempotencyKey ?? msg.id ?? msgTs
            const content = msg.content ?? msg.body ?? ''
            const blocks: any[] = Array.isArray(content) ? content : []
            const msgAgeMs = Date.now() - new Date(msgTs).getTime()
            const isRecent = msgAgeMs < 300_000 // within 5 minutes

            // Tool call blocks
            for (let bi = 0; bi < blocks.length; bi++) {
              const b = blocks[bi]
              if (b?.type !== 'toolCall' && b?.type !== 'tool_use' && b?.type !== 'toolUse') continue
              const name = String(b.name ?? b.tool ?? 'tool').toLowerCase()
              const sig = `${sid}:tool:${b.id ?? `${msgId}:${bi}`}`
              if (toolSeen.has(sig)) continue
              toolSeen.add(sig)
              if (toolSeen.size > 800) toolSeen.clear()
              if (!isRecent) continue
              const inp = b.input ?? b.arguments ?? {}
              const toolInput = String(
                inp?.command ?? inp?.file_path ?? inp?.path ?? inp?.url ??
                inp?.query ?? inp?.description ?? inp?.content?.slice?.(0, 80) ??
                (typeof inp === 'string' ? inp : '') ?? ''
              ).slice(0, 200)
              console.log(`[Watch] tool → ${name}: ${toolInput.slice(0, 60)}`)
              push({ seq: ++seq, ts: new Date(msgTs).toISOString(), event: 'tool', kind: 'tool',
                title: 'tool call', sub: name, sessionKey: sid, meta: { tool: name, toolInput } })
            }

            // Assistant text reply (completed turn)
            const isAssistant = /^(assistant|agent|bot)$/i.test(String(msg.role ?? ''))
            const hasText = blocks.some((b: any) => b?.type === 'text' && b?.text?.trim())
              || (blocks.length === 0 && typeof content === 'string' && content.trim())
            const hasToolCall = blocks.some((b: any) =>
              b?.type === 'toolCall' || b?.type === 'tool_use' || b?.type === 'toolUse')
            if (isAssistant && hasText && !hasToolCall) {
              const sig = `${sid}:msg-out:${msgId}`
              if (!toolSeen.has(sig)) {
                toolSeen.add(sig)
                if (isRecent) {
                  const ch = String(msg.channelId ?? msg.channel ?? '') || (sessionChannels[sid] ?? '')
                  const text = blocks.find((b: any) => b?.type === 'text')?.text
                    ?? (typeof content === 'string' ? content : '')
                  console.log(`[Watch] reply → ${String(text).slice(0, 60)}`)
                  push({ seq: ++seq, ts: new Date(msgTs).toISOString(), event: 'message.sent',
                    kind: 'message', title: 'outgoing message',
                    sub: String(text).slice(0, 160), sessionKey: sid, meta: { ch, direction: 'out' } as any })
                }
              }
            }
          }
        } catch { /* session unavailable */ }
      }
    }
  } catch { /* sessions.list rpc failed */ }
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
      // Log every raw event for debugging (/api/watch/debug)
      rawLog.push({ ts: new Date().toISOString(), event: String(m.event ?? ''), payload: m.payload ?? {} })
      if (rawLog.length > RAW_MAX) rawLog.shift()
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
