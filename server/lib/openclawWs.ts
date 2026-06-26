// title: OpenClaw gateway WebSocket client
// path: server/lib/openclawWs.ts
// purpose: OpenClaw's gateway speaks a WebSocket RPC protocol (not REST), so we
//          pull sessions/agents/cron over /ws. Protocol (decoded from the
//          OpenClaw Control UI bundle):
//            • connect to ws://host:port/ws?token=<gatewayToken>
//            • server pushes {type:"event",event:"connect.challenge",payload:{nonce}}
//            • client sends {type:"req",id,method:"connect",params:{...auth:{token}}}
//            • requests:  {type:"req", id, method, params}
//              responses: {type:"res", id, ok, payload, error}
//          Shared-token auth needs only auth:{token} (the Ed25519 "device"
//          path is optional and omitted here). Read-only methods only.

import { randomUUID } from 'crypto'
import { getConnector } from './connectors.js'
import { isConnected as liveConnected, request as liveRequest } from './openclawLive.js'

const CACHE_TTL_MS = 20_000
const TIMEOUT_MS = 9_000
const OC_AGENT_ID = (process.env.OPENCLAW_AGENT_ID ?? 'main').trim()

// Default operator scopes (from the Control UI's `An` constant).
const SCOPES = ['operator.admin', 'operator.read', 'operator.write', 'operator.approvals', 'operator.pairing']

export interface OcSnapshot {
  reachable:      boolean
  version:        string | null
  error:          string | null
  latencyMs:      number
  activeSessions: number | null
  sessionsRaw:    any[]
  agentsRaw:      any[]
  cronRaw:        any[]
}

function emptySnapshot(error: string, latencyMs = 0): OcSnapshot {
  return { reachable: false, version: null, error, latencyMs, activeSessions: null, sessionsRaw: [], agentsRaw: [], cronRaw: [] }
}

let cache: { at: number; data: OcSnapshot } | null = null

/** Normalize any base URL form to a ws(s):// …/ws endpoint. */
export function toWsUrl(base: string): string {
  let u = base.trim()
  u = u.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
  if (!/^wss?:/i.test(u)) u = `ws://${u}`
  u = u.replace(/\/+$/, '')
  if (!/\/ws$/i.test(u)) u += '/ws'
  return u
}

/**
 * The gateway enforces a Control-UI Origin check, so we must send an Origin
 * header matching its served URL (scheme://host:port derived from the base URL).
 */
export function toHttpOrigin(base: string): string {
  let u = base.trim().replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:')
  if (!/^https?:/i.test(u)) u = `http://${u}`
  try { return new URL(u).origin } catch { return u.replace(/\/+$/, '') }
}

function asArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  return payload.sessions ?? payload.agents ?? payload.jobs ?? payload.crons ?? payload.items ?? payload.list ?? payload.data ?? []
}

function connectParams(token: string) {
  return {
    minProtocol: 4,
    maxProtocol: 4,
    client: {
      id: 'openclaw-control-ui',
      version: 'mission-control',
      platform: 'node',
      mode: 'webchat',
      instanceId: randomUUID(),
    },
    role: 'operator',
    scopes: SCOPES,
    caps: ['tool-events'],
    auth: { token },
    userAgent: 'mission-control',
    locale: 'en-US',
  }
}

export interface RpcCall { method: string; params?: any; key?: string }
export interface BatchResult {
  reachable: boolean
  version: string | null
  error: string | null
  latencyMs: number
  results: Record<string, any>
}

/** Open one authenticated WS, run a batch of read-only RPC calls, return their payloads. */
function rpcBatch(baseUrl: string, token: string, calls: RpcCall[]): Promise<BatchResult> {
  return new Promise(resolve => {
    const start = Date.now()
    const wsBase = toWsUrl(baseUrl)
    const url = `${wsBase}${wsBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    const fail = (error: string): BatchResult => ({ reachable: false, version: null, error, latencyMs: Date.now() - start, results: {} })

    let ws: WebSocket
    try {
      // Origin header is required by the gateway's Control-UI origin check.
      ws = new WebSocket(url, { headers: { Origin: toHttpOrigin(baseUrl) } } as any)
    } catch (err: any) {
      return resolve(fail(err?.message ?? 'failed to open websocket'))
    }

    const pending = new Map<string, string>()
    const results: Record<string, any> = {}
    let connected = false
    let serverInfo: any = null
    let settled = false

    const built = (): BatchResult => ({
      reachable: true,
      version: serverInfo?.runtimeVersion ?? serverInfo?.version ?? serverInfo?.serverVersion ?? serverInfo?.gatewayVersion ?? null,
      error: null,
      latencyMs: Date.now() - start,
      results,
    })
    const finish = (r: BatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* ignore */ }
      resolve(r)
    }
    const timer = setTimeout(() => finish(connected ? built() : fail(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)

    ws.addEventListener('message', (ev: any) => {
      let m: any
      try { m = JSON.parse(String(ev.data)) } catch { return }

      if (m.type === 'event' && m.event === 'connect.challenge') {
        ws.send(JSON.stringify({ type: 'req', id: randomUUID(), method: 'connect', params: connectParams(token) }))
        return
      }
      if (m.type !== 'res') return
      const key = pending.get(m.id)
      pending.delete(m.id)

      if (!connected) {
        if (!m.ok) return finish(fail(m.error?.message ?? m.error?.code ?? 'auth rejected'))
        connected = true
        serverInfo = m.payload ?? null
        for (const c of calls) {
          const id = randomUUID()
          pending.set(id, c.key ?? c.method)
          ws.send(JSON.stringify({ type: 'req', id, method: c.method, params: c.params ?? {} }))
        }
        if (calls.length === 0) finish(built())
        return
      }

      if (key) results[key] = m.ok ? m.payload : null
      if (pending.size === 0) finish(built())
    })
    ws.addEventListener('error', (e: any) => finish(connected ? built() : fail(e?.message ?? 'websocket error')))
    ws.addEventListener('close', () => { if (!settled) finish(connected ? built() : fail('connection closed before handshake')) })
  })
}

const SNAPSHOT_CALLS: RpcCall[] = [
  { method: 'sessions.list' },
  { method: 'agents.list' },
  { method: 'cron.list', params: { includeDisabled: true } },
]

const METRIC_CALLS: RpcCall[] = [
  { method: 'usage.cost' },
  { method: 'sessions.usage' },
  { method: 'sessions.list' },
  { method: 'cron.list', params: { includeDisabled: true } },
  { method: 'cron.status' },
  { method: 'cron.runs', params: { limit: 50 } },
  { method: 'channels.status' },
  { method: 'health' },
  { method: 'status' },
  { method: 'models.list' },
  { method: 'skills.status' },
  { method: 'doctor.memory.status' },
  { method: 'update.status' },
  { method: 'agents.files.list', params: { agentId: OC_AGENT_ID } },
]

let metricsCache: { at: number; data: BatchResult } | null = null

/** Run a batch over the shared live socket if it's open (avoids a competing
 *  connection); otherwise open a one-shot connection. */
async function runCalls(calls: RpcCall[]): Promise<BatchResult> {
  const cfg = getConnector('openclaw')
  if (!cfg || !cfg.baseUrl) return { reachable: false, version: null, error: 'not configured', latencyMs: 0, results: {} }
  if (!cfg.token) return { reachable: false, version: null, error: 'token required', latencyMs: 0, results: {} }

  if (liveConnected()) {
    const start = Date.now()
    const results: Record<string, any> = {}
    await Promise.all(calls.map(async c => {
      try { results[c.key ?? c.method] = await liveRequest(c.method, c.params ?? {}) }
      catch { results[c.key ?? c.method] = null }
    }))
    return { reachable: true, version: results['status']?.runtimeVersion ?? null, error: null, latencyMs: Date.now() - start, results }
  }
  return rpcBatch(cfg.baseUrl, cfg.token, calls)
}

export async function getSnapshot(force = false): Promise<OcSnapshot> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data
  const cfg = getConnector('openclaw')
  if (!cfg || !cfg.baseUrl) return emptySnapshot('not configured')
  if (!cfg.token) return emptySnapshot('token required')

  const b = await runCalls(SNAPSHOT_CALLS)
  const data: OcSnapshot = b.reachable
    ? {
        reachable: true, version: b.version, error: null, latencyMs: b.latencyMs,
        sessionsRaw: asArray(b.results['sessions.list']),
        agentsRaw: asArray(b.results['agents.list']),
        cronRaw: asArray(b.results['cron.list']),
        activeSessions: asArray(b.results['sessions.list']).length || null,
      }
    : emptySnapshot(b.error ?? 'unreachable', b.latencyMs)
  if (data.reachable) cache = { at: Date.now(), data }
  return data
}

/** Raw batch of metric RPC payloads (cached). Normalized in server/lib/metrics.ts. */
export async function getMetricsRaw(force = false): Promise<BatchResult> {
  if (!force && metricsCache && Date.now() - metricsCache.at < CACHE_TTL_MS) return metricsCache.data
  const b = await runCalls(METRIC_CALLS)
  if (b.reachable) metricsCache = { at: Date.now(), data: b }
  return b
}

export function clearSnapshotCache() {
  cache = null
  metricsCache = null
}

function historyMessages(payload: any): any[] {
  const p = payload ?? {}
  return Array.isArray(p) ? p : (p.messages ?? p.history ?? p.entries ?? [])
}

/** Fetch a single session's full message history (transcript) over WS. */
export async function getHistory(sessionKey: string, limit = 150): Promise<{ reachable: boolean; error: string | null; messages: any[] }> {
  const b = await runCalls([{ method: 'chat.history', params: { sessionKey, limit, maxChars: 200_000 } }])
  if (!b.reachable) return { reachable: false, error: b.error, messages: [] }
  return { reachable: true, error: null, messages: historyMessages(b.results['chat.history']) }
}

/** Fetch many sessions' transcripts in a single batched WS round-trip (one
 *  socket, not one per session). Returns a sessionKey → messages map. */
export async function getHistories(sessionKeys: string[], limit = 120): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {}
  if (sessionKeys.length === 0) return out
  const calls: RpcCall[] = sessionKeys.map((k, i) => ({
    method: 'chat.history', params: { sessionKey: k, limit, maxChars: 120_000 }, key: `h${i}`,
  }))
  const b = await runCalls(calls)
  if (!b.reachable) return out
  sessionKeys.forEach((k, i) => { out[k] = historyMessages(b.results[`h${i}`]) })
  return out
}

/** Read a single memory file's content via WS RPC (agents.files.get).
 *  The gateway returns { agentId, workspace, file: { name, path, content, … } }.
 *  Returns null if the gateway is unreachable or the file is not found. */
export async function readMemoryFileRpc(name: string): Promise<{ content: string; path: string } | null> {
  const b = await runCalls([
    { method: 'agents.files.get', params: { name, agentId: OC_AGENT_ID }, key: 'file' },
  ])
  if (!b.reachable) return null
  const r = b.results['file']
  const file = r?.file ?? r
  if (!file || typeof file.content !== 'string') return null
  return { content: file.content, path: String(file.path ?? `[gateway] ${name}`) }
}
