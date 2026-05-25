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
let lastMsgAt = 0  // last time ANY ws frame arrived — drives the stale watchdog
let activeSessionIds: string[] = []
const sessionChannels: Record<string, string> = {}
// Track per-session state to detect new runs without requiring real-time tool events
const sessionStartedAt: Record<string, number> = {}  // last known startedAt per session
const toolSeen = new Set<string>()
// Tool calls / replies already surfaced from chat.history polling, deduped by
// the gateway's block id (it no longer pushes real-time session.message events,
// so history polling is our live source of tool activity).
const emittedBlocks = new Set<string>()
let polling = false
// Timestamp of the last real tool/message/thinking activity pushed. The poll's
// generic "working" filler is suppressed for a few seconds after real activity
// so live tool events (from session.message) aren't immediately overwritten.
let lastActivityTs = 0
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
  // sessions.changed fires on run start ("start") and finish ("end"). The
  // provider/channel lives in NESTED fields (origin, deliveryContext,
  // lastChannel), never at the top level — the old top-level lookup always
  // came back empty, so the channel showed as a generic "session" instead of
  // "from Discord".
  if (event === 'sessions.changed') {
    const provider = String(
      p.origin?.provider ?? p.origin?.surface ??
      p.deliveryContext?.channel ?? p.lastChannel ??
      p.session?.origin?.provider ?? p.session?.lastChannel ??
      p.provider ?? p.surface ?? p.channel ??
      deepText(p, ['provider', 'surface', 'lastChannel', 'channel'])
    ).toLowerCase()
    const phase    = String(p.phase ?? '')
    const direction: 'in' | 'out' = phase === 'end' ? 'out' : 'in'
    const channel  = provider.includes('discord') ? 'Discord'
      : provider.includes('slack') ? 'Slack'
      : provider.includes('telegram') ? 'Telegram'
      : provider.includes('webchat') ? 'webchat'
      : provider
    if (channel) {
      return { ...base, kind: 'message',
        sub: phase === 'end' ? 'response sent' : 'message received',
        meta: { channel, direction } }
    }
    return { ...base, kind: 'session', sub: phase.slice(0, 60) }
  }
  // session.message is the gateway's REAL-TIME per-message stream. Its
  // message.content carries the live block list — including toolCall blocks
  // mid-run — which is the only real-time source of tool activity (there are
  // no separate "tool" events). Parse the blocks so the card shows the actual
  // tool live, instead of a stale label from the after-run history scan.
  if (event === 'session.message') {
    const msg = p.message ?? {}
    const role = String(msg.role ?? '').toLowerCase()
    const blocks: any[] = Array.isArray(msg.content) ? msg.content : []
    const provider = String(
      p.origin?.provider ?? p.deliveryContext?.channel ?? p.lastChannel ??
      p.session?.origin?.provider ?? ''
    ).toLowerCase()
    const channel = provider.includes('discord') ? 'Discord'
      : provider.includes('slack') ? 'Slack'
      : provider.includes('telegram') ? 'Telegram'
      : provider.includes('webchat') ? 'webchat'
      : provider
    const msgTs = Number(msg.timestamp ?? p.updatedAt ?? 0)
    const ts2 = msgTs > 0 ? new Date(msgTs).toISOString() : base.ts

    // Tool call mid-run — the signal we actually want surfaced live.
    const toolBlock = blocks.find((b: any) => b?.type === 'toolCall' || b?.type === 'tool_use' || b?.type === 'toolUse')
    if (toolBlock) {
      const sig = `tool:${toolBlock.id ?? base.seq}`
      if (emittedBlocks.has(sig)) return null  // already surfaced via history poll
      rememberEmitted(sig)
      const toolName = String(toolBlock.name ?? toolBlock.tool ?? 'tool').toLowerCase()
      const toolInput = toolInputOf(toolBlock)
      return { ...base, ts: ts2, kind: 'tool', title: 'tool call', sub: toolName,
        meta: { tool: toolName, toolInput } }
    }

    // Assistant final text reply → outgoing message.
    const textBlock = blocks.find((b: any) => b?.type === 'text' && typeof b?.text === 'string' && b.text.trim())
    if (role === 'assistant' && textBlock) {
      return { ...base, ts: ts2, kind: 'message', title: 'outgoing message',
        sub: textBlock.text.trim().slice(0, 160), meta: { channel, direction: 'out' } }
    }

    // Incoming user message.
    if (role === 'user') {
      const text = typeof msg.content === 'string' ? msg.content : (textBlock?.text ?? '')
      return { ...base, ts: ts2, kind: 'message', title: 'incoming message',
        sub: String(text).slice(0, 160), meta: { channel, direction: 'in' } }
    }

    // Assistant reasoning only — soft "thinking" status keeps the card alive
    // and informative during long model turns that haven't emitted a tool yet.
    if (blocks.some((b: any) => b?.type === 'thinking')) {
      return { ...base, ts: ts2, kind: 'session', event: 'session.thinking',
        sub: 'thinking', meta: { channel, direction: 'in' } }
    }
    return null
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
  if (e.kind === 'tool' || e.kind === 'message' || e.kind === 'cron' || e.event === 'session.thinking') {
    lastActivityTs = Date.now()
  }
  buffer.push(e)
  if (buffer.length > BUFFER_MAX) buffer.shift()
  for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
}

const EMITTED_MAX = 600
function rememberEmitted(sig: string) {
  emittedBlocks.add(sig)
  if (emittedBlocks.size > EMITTED_MAX) {
    const keep = [...emittedBlocks].slice(-Math.floor(EMITTED_MAX / 2))
    emittedBlocks.clear()
    for (const s of keep) emittedBlocks.add(s)
  }
}

function toolInputOf(block: any): string {
  const inp = block?.arguments ?? block?.input ?? {}
  if (typeof inp === 'string') return inp.slice(0, 200)
  if (inp && typeof inp === 'object') {
    const v = inp.command ?? inp.file_path ?? inp.path ?? inp.url ?? inp.query ??
      inp.pattern ?? inp.description ??
      (typeof inp.content === 'string' ? inp.content.slice(0, 80) : undefined) ??
      Object.values(inp)[0]
    return String(v ?? '').slice(0, 200)
  }
  return ''
}

// Pull the latest unseen tool call / assistant reply out of a running session's
// chat.history and emit it as a fresh live event. This replaces the gateway's
// (now-silent) real-time session.message stream as the source of tool activity.
async function pollSessionMessages(sessionKey: string, channel: string) {
  let hist: any
  try { hist = await request('chat.history', { sessionKey, limit: 12, maxChars: 12000 }, 8000) }
  catch { return }
  const msgs: any[] = Array.isArray(hist?.messages) ? hist.messages : []
  // Surface tools from any turn committed in the last ~15 min. chat.history only
  // commits AFTER a turn finishes (the gateway exposes NO live mid-turn data and
  // no real-time tool events), so a long turn's tools land all at once when it
  // ends — the window must be wide enough to not drop them. Dedup (emittedBlocks)
  // makes this safe to re-scan every tick.
  const FRESH_MS = 15 * 60_000
  const now = Date.now()
  // Walk oldest → newest, emitting every tool call / assistant reply we haven't
  // shown yet (deduped by gateway block id). The event tail gets the full
  // sequence in order; the Watch card lands on the newest. Fresh ts so the card
  // reads "is" not "was".
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const role = String(msg.role ?? '').toLowerCase()
    const blocks: any[] = Array.isArray(msg.content) ? msg.content : []
    const tsMs = Number(msg.timestamp ?? 0)
    if (tsMs && now - tsMs > FRESH_MS) continue

    const toolBlock = blocks.find((b: any) => b?.type === 'toolCall' || b?.type === 'tool_use' || b?.type === 'toolUse')
    if (toolBlock) {
      const sig = `tool:${toolBlock.id ?? msg.__openclaw?.id ?? `${sessionKey}:${tsMs || i}`}`
      if (emittedBlocks.has(sig)) continue
      rememberEmitted(sig)
      const toolName = String(toolBlock.name ?? toolBlock.tool ?? 'tool').toLowerCase()
      push({ seq: ++seq, ts: new Date().toISOString(), event: 'tool', kind: 'tool',
        title: 'tool call', sub: toolName, sessionKey,
        meta: { tool: toolName, toolInput: toolInputOf(toolBlock), channel } })
      continue
    }

    if (role === 'assistant') {
      const textBlock = blocks.find((b: any) => b?.type === 'text' && typeof b?.text === 'string' && b.text.trim())
      if (textBlock) {
        const sig = `msg:${msg.__openclaw?.id ?? `${sessionKey}:${tsMs || i}`}`
        if (emittedBlocks.has(sig)) continue
        rememberEmitted(sig)
        push({ seq: ++seq, ts: new Date().toISOString(), event: 'message', kind: 'message',
          title: 'outgoing message', sub: textBlock.text.trim().slice(0, 160), sessionKey,
          meta: { channel, direction: 'out' } })
      }
    }
    // toolResult / user / thinking-only → skip; nothing to surface.
  }
}

async function pollSessionActivity() {
  // Watchdog: the gateway pushes health every ~10-15s. If we've heard nothing
  // for 45s while still "connected", the socket is half-open (e.g. the gateway
  // restarted without a clean close, so no 'close' fired) — force a reconnect.
  if (connected && lastMsgAt && Date.now() - lastMsgAt > 45_000) {
    console.log('[Watch] openclaw stream stale (no frames 45s) — forcing reconnect')
    connected = false
    rejectAllPending('stale — reconnecting')
    try { ws?.close() } catch { /* ignore */ }
    ws = null; backoff = 1000
    scheduleReconnect()
    return
  }
  if (!connected || polling) return
  polling = true

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

    const running: Array<{ k: string; rec: number }> = []
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

      // ── Run is in progress right now: keep the card "live" ───────────────
      // The gateway tells us directly via status:"running" / hasActiveRun —
      // far more reliable than reverse-engineering activity from timestamp
      // deltas. Runs routinely last minutes, so the old "started <60s ago"
      // window silently missed almost every active run.
      const isRunning = /running/i.test(String(s.status ?? '')) || s.hasActiveRun === true
      if (isRunning) {
        running.push({ k, rec: new Date(s.updatedAt ?? s.startedAt ?? 0).getTime() })
        const activeSig = `${k}:active:${startedAt}`
        if (!toolSeen.has(activeSig)) {
          toolSeen.add(activeSig)
          if (toolSeen.size > 800) toolSeen.clear()
          console.log(`[Watch] active run on ${k} — channel: ${channel}`)
        }
      }
    }

    // ── Surface live tool calls / replies from the running session(s). ──────
    // The gateway no longer emits real-time `session.message` events, so
    // chat.history is now the only live source of tool activity. Poll the most
    // recently-active running sessions and emit any tool call / assistant reply
    // we haven't shown yet, stamped with a fresh ts so the card reads "is" not
    // "was". Deduped by the gateway block id in pollSessionMessages().
    running.sort((a, b) => b.rec - a.rec)
    for (const { k } of running.slice(0, 2)) {
      await pollSessionMessages(k, sessionChannels[k] || 'Discord')
    }

    // ── Generic "working" filler — only when no real tool/message/thinking
    // activity has streamed in the last 5s, so live tool events win the card.
    // Fresh ts each tick (3s < the UI's 8s "live" window) keeps it live. ─────
    if (running.length && Date.now() - lastActivityTs > 5_000) {
      const k = running[0].k
      push({ seq: ++seq, ts: new Date().toISOString(), event: 'session.active',
        kind: 'session', title: 'active run', sub: 'running',
        sessionKey: k, meta: { channel: sessionChannels[k] || 'Discord', direction: 'in' } })
    }
  } catch { /* sessions.list rpc failed */ }
  finally { polling = false }
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
  if (stopped) return
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
    lastMsgAt = Date.now()
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
    if (!stopped) {
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
      // Stop the live-event polling feed but keep the WebSocket alive so
      // research and other background RPCs can still use it without needing
      // the Watch tab to be open.
      stopPolling()
    }
  }
}

export function restartLive() {
  stopped = false
  try { ws?.close() } catch { /* ignore */ }
  ws = null; connected = false; backoff = 1000
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  open()
}

/**
 * Ensure the persistent WebSocket is connected before making an RPC call.
 * Starts the connection if not already running and waits up to `timeoutMs`.
 * Used by research so it doesn't require the Watch tab to be open.
 */
export function ensureConnected(timeoutMs = 12_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (connected && ws) return resolve()
    // Start or resume the connection.
    stopped = false
    if (!ws) open()
    const deadline = Date.now() + timeoutMs
    const poll = setInterval(() => {
      if (connected && ws) { clearInterval(poll); resolve() }
      else if (Date.now() >= deadline) {
        clearInterval(poll)
        reject(new Error('OpenClaw not connected — open Settings and verify the gateway URL and token'))
      }
    }, 300)
  })
}
