// title: OpenClaw / Hermes gateway REST client
// path: server/lib/gateway.ts
// purpose: Pull live data (status, sessions, analytics, cron jobs) from an
//          OpenClaw or Hermes gateway's dashboard REST API using a bearer
//          token. Both products expose the same /api surface, so one client
//          serves both. All calls fail soft and are briefly cached so the
//          3s frontend poll never hammers the remote gateway.

import { getConnector, isLive, type ConnectorId } from './connectors.js'

const TIMEOUT_MS = 5_000
const CACHE_TTL_MS = 20_000

type CacheEntry = { at: number; data: unknown }
const cache = new Map<string, CacheEntry>()

export interface GatewayResult<T> {
  ok:        boolean
  data:      T | null
  error?:    string
  latencyMs: number
}

export interface GatewayStatus {
  reachable:      boolean
  version:        string | null
  gatewayStatus:  string | null
  platforms:      Array<{ name: string; status: string }>
  activeSessions: number | null
  latencyMs:      number
  error:          string | null
}

function headers(token: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' }
  if (token) {
    h['Authorization'] = `Bearer ${token}`
    // Hermes' web dashboard authenticates with this header specifically.
    h['X-Hermes-Session-Token'] = token
  }
  return h
}

async function rawGet<T>(id: ConnectorId, path: string, useCache = true): Promise<GatewayResult<T>> {
  const start = Date.now()
  const cfg = getConnector(id)
  if (!cfg || !cfg.baseUrl) {
    return { ok: false, data: null, error: 'not configured', latencyMs: 0 }
  }

  const cacheKey = `${id}:${path}`
  if (useCache) {
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ok: true, data: hit.data as T, latencyMs: 0 }
    }
  }

  const url = `${cfg.baseUrl}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, { headers: headers(cfg.token), signal: controller.signal })
    const latencyMs = Date.now() - start
    if (!res.ok) {
      return { ok: false, data: null, error: `HTTP ${res.status}`, latencyMs }
    }
    const data = (await res.json().catch(() => null)) as T
    if (useCache) cache.set(cacheKey, { at: Date.now(), data })
    return { ok: true, data, latencyMs }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    const error = err?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : (err?.message ?? 'fetch failed')
    return { ok: false, data: null, error, latencyMs }
  } finally {
    clearTimeout(timer)
  }
}

/** Try several candidate paths, returning the first that succeeds. */
async function getFirst<T>(id: ConnectorId, paths: string[]): Promise<GatewayResult<T>> {
  let last: GatewayResult<T> = { ok: false, data: null, error: 'no paths', latencyMs: 0 }
  for (const p of paths) {
    const r = await rawGet<T>(id, p)
    if (r.ok) return r
    last = r
  }
  return last
}

async function rawPost(id: ConnectorId, path: string): Promise<GatewayResult<any>> {
  const start = Date.now()
  const cfg = getConnector(id)
  if (!cfg || !cfg.baseUrl) return { ok: false, data: null, error: 'not configured', latencyMs: 0 }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST', headers: { ...headers(cfg.token), 'Content-Type': 'application/json' },
      body: '{}', signal: controller.signal,
    })
    const latencyMs = Date.now() - start
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status}`, latencyMs }
    const data = await res.json().catch(() => ({}))
    return { ok: true, data, latencyMs }
  } catch (err: any) {
    const error = err?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : (err?.message ?? 'fetch failed')
    return { ok: false, data: null, error, latencyMs: Date.now() - start }
  } finally {
    clearTimeout(timer)
  }
}

async function postFirst(id: ConnectorId, paths: string[]): Promise<GatewayResult<any>> {
  let last: GatewayResult<any> = { ok: false, data: null, error: 'no paths', latencyMs: 0 }
  for (const p of paths) {
    const r = await rawPost(id, p)
    if (r.ok) return r
    last = r
  }
  return last
}

export type CronAction = 'pause' | 'resume' | 'trigger'

export async function cronAction(id: ConnectorId, jobId: string, action: CronAction): Promise<GatewayResult<any>> {
  const j = encodeURIComponent(jobId)
  const paths = action === 'trigger'
    ? [`/api/cron/jobs/${j}/trigger`, `/api/jobs/${j}/run`, `/api/cron/jobs/${j}/run`]
    : [`/api/cron/jobs/${j}/${action}`, `/api/jobs/${j}/${action}`]
  // Bust the cached cron list so the next read reflects the change.
  cache.delete(`${id}:/api/cron/jobs`)
  cache.delete(`${id}:/api/jobs`)
  return postFirst(id, paths)
}

// ─── High-level calls ──────────────────────────────────────────────────────

export async function fetchStatus(id: ConnectorId): Promise<GatewayStatus> {
  const r = await rawGet<any>(id, '/api/status', false)
  if (!r.ok || !r.data) {
    return {
      reachable: false, version: null, gatewayStatus: null, platforms: [],
      activeSessions: null, latencyMs: r.latencyMs, error: r.error ?? 'unreachable',
    }
  }
  const d = r.data
  const platformsRaw = d.platforms ?? d.channels ?? {}
  const platforms = Array.isArray(platformsRaw)
    ? platformsRaw.map((p: any) => ({ name: String(p.name ?? p.id ?? '?'), status: String(p.status ?? p.state ?? 'unknown') }))
    : Object.entries(platformsRaw).map(([name, v]: [string, any]) => ({
        name,
        status: String(typeof v === 'object' ? (v.status ?? v.state ?? (v.enabled ? 'enabled' : 'disabled')) : v),
      }))
  return {
    reachable:      true,
    version:        d.version ?? d.agentVersion ?? d.app_version ?? null,
    gatewayStatus:  d.gateway ?? d.gateway_status ?? d.status ?? null,
    platforms,
    activeSessions: d.activeSessions ?? d.active_sessions ?? d.session_count ?? null,
    latencyMs:      r.latencyMs,
    error:          null,
  }
}

export async function fetchSessions(id: ConnectorId): Promise<GatewayResult<any[]>> {
  const r = await getFirst<any>(id, ['/api/sessions', '/api/v1/sessions'])
  if (!r.ok) return { ...r, data: null }
  const list = Array.isArray(r.data) ? r.data : (r.data?.sessions ?? r.data?.data ?? [])
  return { ok: true, data: list, latencyMs: r.latencyMs }
}

export async function fetchSessionMessages(id: ConnectorId, sessionId: string, fresh = false): Promise<GatewayResult<any[]>> {
  const enc = encodeURIComponent(sessionId)
  for (const p of [`/api/sessions/${enc}/messages`, `/api/sessions/${enc}`]) {
    const r = await rawGet<any>(id, p, !fresh)
    if (r.ok) {
      const list = Array.isArray(r.data) ? r.data : (r.data?.messages ?? r.data?.history ?? [])
      return { ok: true, data: list, latencyMs: r.latencyMs }
    }
  }
  return { ok: false, data: null, error: 'no messages', latencyMs: 0 }
}

export async function fetchAnalyticsUsage(id: ConnectorId, days = 7): Promise<GatewayResult<any>> {
  return getFirst<any>(id, [
    `/api/analytics/usage?days=${days}`,
    `/api/analytics/usage`,
    `/api/usage?days=${days}`,
  ])
}

export async function fetchCronJobs(id: ConnectorId): Promise<GatewayResult<any[]>> {
  const r = await getFirst<any>(id, ['/api/cron/jobs', '/api/jobs', '/api/cron'])
  if (!r.ok) return { ...r, data: null }
  const list = Array.isArray(r.data) ? r.data : (r.data?.jobs ?? r.data?.data ?? [])
  return { ok: true, data: list, latencyMs: r.latencyMs }
}

export async function fetchToolsets(id: ConnectorId): Promise<GatewayResult<any[]>> {
  const r = await getFirst<any>(id, ['/api/tools/toolsets', '/api/toolsets'])
  if (!r.ok) return { ...r, data: null }
  const list = Array.isArray(r.data) ? r.data : (r.data?.toolsets ?? r.data?.tools ?? r.data?.data ?? [])
  return { ok: true, data: list, latencyMs: r.latencyMs }
}

export async function fetchSkills(id: ConnectorId): Promise<GatewayResult<any[]>> {
  const r = await getFirst<any>(id, ['/api/skills'])
  if (!r.ok) return { ...r, data: null }
  const list = Array.isArray(r.data) ? r.data : (r.data?.skills ?? r.data?.data ?? [])
  return { ok: true, data: list, latencyMs: r.latencyMs }
}

export async function fetchLogs(id: ConnectorId, limit = 100): Promise<GatewayResult<any[]>> {
  for (const p of [`/api/logs?limit=${limit}`, '/api/logs', '/api/log']) {
    const r = await rawGet<any>(id, p, false)
    if (r.ok) {
      const list = Array.isArray(r.data) ? r.data : (r.data?.logs ?? r.data?.lines ?? r.data?.entries ?? r.data?.data ?? [])
      return { ok: true, data: list, latencyMs: r.latencyMs }
    }
  }
  return { ok: false, data: null, error: 'logs unavailable', latencyMs: 0 }
}

export function liveConnectorIds(): ConnectorId[] {
  return (['openclaw', 'hermes'] as ConnectorId[]).filter(isLive)
}
