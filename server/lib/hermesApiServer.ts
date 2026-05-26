// title: Hermes API server client (OpenAI-compatible inference)
// path: server/lib/hermesApiServer.ts
// purpose: Talk to the Hermes API SERVER (not the operator dashboard). The
//          dashboard at e.g. http://127.0.0.1:9121 exposes /api/* for status,
//          sessions, logs and cron and protects them with an ephemeral session
//          token. It does NOT accept chat requests — POST /v1/chat/completions
//          there returns 405. The real chat surface is a separate process:
//
//             base URL: http://127.0.0.1:8642/v1   (configurable)
//             auth:     Authorization: Bearer <HERMES_API_KEY>
//
//          This module is the *only* place benchmark / research / memory-eval
//          code dispatches chat to Hermes. All three call sites were previously
//          hitting the dashboard and 4xx-ing — see the route fixes that wire
//          them through hermesChat() instead.

import { getConnector } from './connectors.js'

const DEFAULT_API_BASE = 'http://127.0.0.1:8642/v1'
const TIMEOUT_MS = 60_000

export interface HermesApiConfig {
  baseUrl: string
  token:   string
  source:  'connector' | 'env' | 'default'
}

export function getHermesApiConfig(): HermesApiConfig {
  const cfg = getConnector('hermes')
  const baseUrl = (cfg?.apiBaseUrl?.trim() || process.env.HERMES_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '')
  const token   = cfg?.apiToken?.trim() || process.env.HERMES_API_KEY || process.env.HERMES_API_SERVER_KEY || ''
  const source: HermesApiConfig['source'] = cfg?.apiBaseUrl ? 'connector' : process.env.HERMES_API_BASE_URL ? 'env' : 'default'
  return { baseUrl, token, source }
}

function headers(token: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
  if (token) h['Authorization'] = `Bearer ${token}`
  return h
}

export interface HermesChatResult {
  ok:        boolean
  status:    number | null
  answer:    string
  model:     string | null
  usage:     any | null
  latencyMs: number
  raw:       any
  error:     string | null
  triedUrl:  string
}

export interface HermesChatOptions {
  model?:       string         // defaults to 'auto' which Hermes resolves to the loaded model
  temperature?: number
  maxTokens?:   number
  timeoutMs?:   number
  // If true and the API server isn't reachable, return an honest error rather
  // than throwing — used by the benchmark async runners so they can write the
  // diagnostic into the run row instead of dying.
  silent?:      boolean
}

/**
 * POST /v1/chat/completions on the Hermes API server.
 * Returns a non-throwing result by default so callers can surface the real
 * diagnostic (HTTP status, body, latency).
 */
export async function hermesChat(prompt: string, opts: HermesChatOptions = {}): Promise<HermesChatResult> {
  const cfg = getHermesApiConfig()
  const url = `${cfg.baseUrl}/chat/completions`
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS)

  const body = {
    model: opts.model || 'auto',
    messages: [{ role: 'user', content: prompt }],
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    stream: false,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(cfg.token),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - start
    const text = await res.text()
    let raw: any = null
    try { raw = text ? JSON.parse(text) : null } catch { raw = { rawText: text.slice(0, 800) } }

    if (!res.ok) {
      const errText = (raw && (raw.error?.message ?? raw.message ?? raw.detail)) || text.slice(0, 400) || res.statusText
      return {
        ok: false, status: res.status, answer: '', model: null, usage: null,
        latencyMs, raw, error: `HTTP ${res.status} — ${errText}`, triedUrl: url,
      }
    }

    // OpenAI-compat: { id, model, choices: [{ message: { role, content } }], usage }
    const choice = raw?.choices?.[0]
    const answer = String(choice?.message?.content ?? choice?.text ?? '')
    return {
      ok: true, status: res.status, answer,
      model: raw?.model ?? null, usage: raw?.usage ?? null,
      latencyMs, raw, error: null, triedUrl: url,
    }
  } catch (err: any) {
    const error = err?.name === 'AbortError' ? `timeout after ${opts.timeoutMs ?? TIMEOUT_MS}ms` : (err?.message ?? 'fetch failed')
    return {
      ok: false, status: null, answer: '', model: null, usage: null,
      latencyMs: Date.now() - start, raw: null, error, triedUrl: url,
    }
  } finally {
    clearTimeout(timer)
  }
}

export interface HermesApiHealth {
  ok:        boolean
  baseUrl:   string
  hasToken:  boolean
  reachable: boolean
  latencyMs: number
  modelCount: number | null
  models:    string[]
  health:    any | null
  error:     string | null
  triedPaths: Array<{ path: string; status: number | null; ok: boolean; error?: string }>
}

/**
 * Verify the API server with a real request. Tries /v1/models then /health
 * (and /v1/health), since the user-facing canonical list is:
 *   GET /v1/models, GET /v1/capabilities, GET /health, GET /v1/health
 */
export async function hermesApiHealth(): Promise<HermesApiHealth> {
  const cfg = getHermesApiConfig()
  const tried: HermesApiHealth['triedPaths'] = []
  const out: HermesApiHealth = {
    ok: false, baseUrl: cfg.baseUrl, hasToken: !!cfg.token, reachable: false,
    latencyMs: 0, modelCount: null, models: [], health: null, error: null, triedPaths: tried,
  }

  // Models endpoint = strongest signal (auth + service alive + model loaded).
  // GET /v1/models — but cfg.baseUrl already ends in /v1, so request '/models'.
  const probe = async (path: string): Promise<{ status: number | null; ok: boolean; body: any; latency: number; error?: string }> => {
    const url = `${cfg.baseUrl}${path}`
    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(url, { headers: headers(cfg.token), signal: controller.signal })
      const text = await res.text()
      let body: any = null
      try { body = text ? JSON.parse(text) : null } catch { body = { rawText: text.slice(0, 240) } }
      return { status: res.status, ok: res.ok, body, latency: Date.now() - start }
    } catch (err: any) {
      const error = err?.name === 'AbortError' ? 'timeout after 8000ms' : (err?.message ?? 'fetch failed')
      return { status: null, ok: false, body: null, latency: Date.now() - start, error }
    } finally {
      clearTimeout(timer)
    }
  }

  const models = await probe('/models')
  tried.push({ path: '/models', status: models.status, ok: models.ok, error: models.error })
  out.latencyMs = models.latency
  if (models.ok) {
    out.reachable = true
    const list: any[] = Array.isArray(models.body?.data) ? models.body.data : Array.isArray(models.body?.models) ? models.body.models : []
    out.modelCount = list.length
    out.models = list.map(m => String(m?.id ?? m?.name ?? '')).filter(Boolean).slice(0, 24)
    out.ok = true
    return out
  }

  // Fall back to health probes to distinguish "service down" from "auth bad".
  const h1 = await probe('/health')
  tried.push({ path: '/health', status: h1.status, ok: h1.ok, error: h1.error })
  if (h1.ok) {
    out.reachable = true
    out.health = h1.body
    out.error = `Service reachable but /models returned ${models.status ?? 'error'} — check the API key.`
    return out
  }
  const h2 = await probe('/../health') // sibling /health (one level above /v1)
  tried.push({ path: '/../health', status: h2.status, ok: h2.ok, error: h2.error })
  if (h2.ok) {
    out.reachable = true
    out.health = h2.body
    out.error = `Service reachable but /v1/models returned ${models.status ?? 'error'} — check the API key or that v1 is exposed.`
    return out
  }

  out.error = models.error || (models.status != null ? `HTTP ${models.status}` : 'unreachable')
  return out
}
