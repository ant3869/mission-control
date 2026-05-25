// title: Model Ops analytics route
// path: server/routes/modelops.ts
// purpose: Operational model analytics (Helicone-style) → /api/modelops
//
//   Unifies model usage across every place models actually run:
//     • Claude Code   — parsed from local JSONL sessions (per-API-call cost,
//                       tokens, real latency from inter-message timing, errors)
//     • OpenClaw      — pulled from the gateway metrics (byModel / sessions /
//                       daily / platform latency)  — this is where GPT-5.x lives
//     • Hermes        — same, over REST
//
//   Every model/session row is tagged with its `source` so the dashboard can show
//   "what OpenClaw and Hermes are using" alongside local Claude usage. Gateway
//   model breakdowns are windowed to the selected period using the daily series
//   so spend stays consistent with the trend chart. When latency can't be sampled
//   it falls back to the platform average (real) or a per-tier estimate (flagged).
//   When nothing is reachable, deterministic mock data keeps the view populated.

import { Router } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { getPlatformMetrics, type PlatformMetrics } from '../lib/metrics.js'
import type { AgentSource } from '../lib/agentEvents.js'

export const modelOpsRouter = Router()

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// ─── Pricing (USD per 1M tokens) — used for Claude JSONL only ─────────────────────

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4':     { input: 15.00, output: 75.00 },
  'claude-opus-4-5':   { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input:  3.00, output: 15.00 },
  'claude-sonnet-4-5': { input:  3.00, output: 15.00 },
  'claude-sonnet-4':   { input:  3.00, output: 15.00 },
  'claude-3-5-sonnet': { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, output:  4.00 },
  'claude-haiku-4':    { input:  0.80, output:  4.00 },
  'claude-3-5-haiku':  { input:  0.80, output:  4.00 },
  'claude-3-haiku':    { input:  0.25, output:  1.25 },
  'claude-3-opus':     { input: 15.00, output: 75.00 },
  'default':           { input:  3.00, output: 15.00 },
}

const CACHE_WRITE_MULT = 1.25
const CACHE_READ_MULT  = 0.10

function priceFor(model: string) {
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (key !== 'default' && model.includes(key)) return val
  }
  return MODEL_PRICING['default']
}

interface TokenSplit { input: number; output: number; cacheWrite: number; cacheRead: number }

function calcCost(model: string, t: TokenSplit): number {
  const p = priceFor(model)
  return (t.input      / 1_000_000) * p.input
       + (t.cacheWrite / 1_000_000) * p.input * CACHE_WRITE_MULT
       + (t.cacheRead  / 1_000_000) * p.input * CACHE_READ_MULT
       + (t.output     / 1_000_000) * p.output
}

// ─── Model / provider labelling ─────────────────────────────────────────────────

// Claude Code writes a `<synthetic>` placeholder model on locally-generated
// messages (API-error notices, interrupts, compact summaries). Treat those as
// "no model" so they don't pollute the model/provider breakdown.
function cleanModel(model: unknown): string {
  const m = typeof model === 'string' ? model.trim() : ''
  if (!m || m === '<synthetic>' || m.startsWith('<')) return ''
  return m
}

const PROVIDER_PREFIX: Record<string, string> = {
  openai: 'OpenAI', azure: 'OpenAI', anthropic: 'Anthropic', google: 'Google',
  'google-vertex': 'Google', vertex: 'Google', gemini: 'Google', meta: 'Meta',
  mistral: 'Mistral', mistralai: 'Mistral', deepseek: 'DeepSeek', xai: 'xAI',
  groq: 'Groq', openrouter: 'OpenRouter', cohere: 'Cohere', perplexity: 'Perplexity',
}

function providerFor(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('claude'))                           return 'Anthropic'
  if (m.includes('gpt') || /\bo[1345]\b/.test(m))     return 'OpenAI'
  if (m.includes('gemini'))                           return 'Google'
  if (m.includes('llama'))                            return 'Meta'
  if (m.includes('mistral') || m.includes('mixtral')) return 'Mistral'
  if (m.includes('deepseek'))                         return 'DeepSeek'
  if (m.includes('grok'))                             return 'xAI'
  return 'Other'
}

// Some gateway breakdown buckets aren't real models (injected system turns,
// unattributed usage). Drop them so the comparison stays meaningful.
function isJunkModel(model: string): boolean {
  return /inject|^unknown$|^system$|^gateway|^synthetic$|^none$/i.test(model.trim())
}

// Gateway model names may arrive as "provider/model" (e.g. "openai/gpt-5.5").
function splitProviderModel(name: string): { provider: string; model: string } {
  const raw = (name ?? '').trim()
  if (!raw) return { provider: 'Other', model: '' }
  if (raw.includes('/')) {
    const [p, ...rest] = raw.split('/')
    const model = rest.join('/')
    const fromPrefix = PROVIDER_PREFIX[p.toLowerCase()]
    const provider = fromPrefix ?? (providerFor(model) !== 'Other' ? providerFor(model) : p.charAt(0).toUpperCase() + p.slice(1))
    return { provider, model }
  }
  return { provider: providerFor(raw), model: raw }
}

function modelLabel(model: string): string {
  if (!model || model === 'unknown') return 'Unknown'
  const m = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  const tier = /opus/.test(m) ? 'Opus' : /sonnet/.test(m) ? 'Sonnet' : /haiku/.test(m) ? 'Haiku' : ''
  if (tier) {
    const ver = m.replace(/^(claude-)?\d?-?(opus|sonnet|haiku)-?/, '').replace(/-/g, '.').replace(/\.$/, '')
    return ver ? `${tier} ${ver}` : tier
  }
  let label = m
  if (/^gpt/i.test(label))      label = label.replace(/^gpt/i, 'GPT')
  else if (/^o\d/i.test(label)) label = label.toUpperCase()
  else                          label = label.charAt(0).toUpperCase() + label.slice(1)
  return label.length > 24 ? label.slice(0, 24) + '…' : label
}

// Per-tier latency baselines (ms) used only when no real samples are available.
function estimateLatencyMs(model: string, avgTokensPerRun: number): number {
  const m = model.toLowerCase()
  const base = m.includes('opus') ? 4200
    : m.includes('haiku') ? 900
    : m.includes('sonnet') ? 1800
    : m.includes('gpt') || m.includes('o3') ? 2200
    : 1600
  return Math.round(base + Math.min(avgTokensPerRun * 0.04, 6000))
}

const SOURCE_LABEL: Record<string, string> = {
  claude: 'Claude Code', openclaw: 'OpenClaw', hermes: 'Hermes', mock: 'Sample data',
}

// ─── Aggregation primitives ─────────────────────────────────────────────────────

interface ModelAgg {
  source:         string
  model:          string
  provider:       string
  runs:           number
  cost:           number
  tokens:         number
  inputTokens:    number
  outputTokens:   number
  cacheTokens:    number
  latencySamples: number[]
  estLatencyMs:   number   // platform-reported avg latency (real) when no per-call samples
  failures:       number
}

function getAgg(map: Record<string, ModelAgg>, source: string, model: string, provider: string): ModelAgg {
  const key = `${source}::${model}`
  return (map[key] ??= {
    source, model, provider, runs: 0, cost: 0, tokens: 0,
    inputTokens: 0, outputTokens: 0, cacheTokens: 0, latencySamples: [], estLatencyMs: 0, failures: 0,
  })
}

interface SessionAgg {
  source:         string
  sessionId:      string
  date:           string
  model:          string
  provider:       string
  runs:           number
  cost:           number
  tokens:         number
  latencySamples: number[]
  estLatencyMs:   number
  failures:       number
}

interface DayAgg { requests: number; cost: number; tokens: number; latencySamples: number[]; failures: number }
function getDay(map: Record<string, DayAgg>, date: string): DayAgg {
  return (map[date] ??= { requests: 0, cost: 0, tokens: 0, latencySamples: [], failures: 0 })
}

const LATENCY_FLOOR_MS = 50
const LATENCY_CEIL_MS  = 120_000 // ignore deltas above 2min — that's idle time, not generation

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])
}
function avg(samples: number[]): number {
  if (samples.length === 0) return 0
  return Math.round(samples.reduce((s, n) => s + n, 0) / samples.length)
}

// ─── Claude JSONL discovery + scan ───────────────────────────────────────────────

function findClaudeProjectsDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
    join(process.cwd(), '.claude', 'projects'),
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude', 'projects') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'projects') : '',
  ].filter(Boolean)
  return candidates.find(p => {
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

function scanFile(
  filePath: string, cutoffMs: number, endIso: string, startIso: string,
  byModel: Record<string, ModelAgg>, byDay: Record<string, DayAgg>, sessions: SessionAgg[],
) {
  let raw: string
  try { raw = readFileSync(filePath, 'utf8') } catch { return }

  const sid = basename(filePath, '.jsonl').slice(0, 8)
  const session: SessionAgg = {
    source: 'claude', sessionId: sid, date: '', model: '', provider: 'Anthropic',
    runs: 0, cost: 0, tokens: 0, latencySamples: [], estLatencyMs: 0, failures: 0,
  }
  const sessionModelTokens: Record<string, number> = {}
  let prevMs = 0

  for (const line of raw.split('\n')) {
    if (!line.trim() || !line.includes('"timestamp"')) continue
    let e: any
    try { e = JSON.parse(line) } catch { continue }

    const ts: string = e.timestamp ?? ''
    if (!ts) continue
    const ms = new Date(ts).getTime()
    if (!Number.isFinite(ms)) continue

    const date = ts.slice(0, 10)
    const inWindow = ms >= cutoffMs && date >= startIso && date <= endIso
    const turnStart = prevMs
    prevMs = ms
    if (!inWindow) continue

    const isError = e.isApiErrorMessage === true || e.type === 'error' || e.level === 'error'
    const model   = cleanModel(e.message?.model ?? e.model)
    const usage   = e.usage ?? e.message?.usage

    if (!session.date) session.date = date

    if (isError) {
      session.failures++
      getDay(byDay, date).failures++
      if (model) getAgg(byModel, 'claude', model, providerFor(model)).failures++
    }

    const cw = usage?.cache_creation_input_tokens ?? 0
    const cr = usage?.cache_read_input_tokens ?? 0
    if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0 || cw > 0 || cr > 0)) {
      const split: TokenSplit = { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheWrite: cw, cacheRead: cr }
      const total = split.input + split.output + split.cacheWrite + split.cacheRead
      const cost  = calcCost(model || 'default', split)

      const m = getAgg(byModel, 'claude', model || 'unknown', providerFor(model || 'unknown'))
      m.runs++; m.cost += cost; m.tokens += total
      m.inputTokens += split.input; m.outputTokens += split.output; m.cacheTokens += split.cacheWrite + split.cacheRead

      const d = getDay(byDay, date)
      d.requests++; d.cost += cost; d.tokens += total

      session.runs++; session.cost += cost; session.tokens += total
      if (model) sessionModelTokens[model] = (sessionModelTokens[model] ?? 0) + total

      if (turnStart > 0) {
        const delta = ms - turnStart
        if (delta >= LATENCY_FLOOR_MS && delta <= LATENCY_CEIL_MS) {
          session.latencySamples.push(delta); d.latencySamples.push(delta); m.latencySamples.push(delta)
        }
      }
    }
  }

  session.model = Object.entries(sessionModelTokens).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'unknown'
  session.provider = providerFor(session.model)
  if (session.runs > 0 && session.date) sessions.push(session)
}

function collectClaude(cutoffMs: number, startIso: string, endIso: string,
  byModel: Record<string, ModelAgg>, byDay: Record<string, DayAgg>, sessions: SessionAgg[]): boolean {
  const dir = findClaudeProjectsDir()
  if (!dir) return false
  let found = false
  try {
    for (const entry of readdirSync(dir)) {
      const projectDir = join(dir, entry)
      try {
        if (!statSync(projectDir).isDirectory()) continue
        for (const child of readdirSync(projectDir)) {
          if (!child.endsWith('.jsonl')) continue
          const fp = join(projectDir, child)
          try {
            if (statSync(fp).mtimeMs < cutoffMs - 86_400_000) continue
            const before = sessions.length
            scanFile(fp, cutoffMs, endIso, startIso, byModel, byDay, sessions)
            if (sessions.length > before) found = true
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return found || Object.keys(byModel).some(k => k.startsWith('claude::'))
}

// ─── Gateway ingestion (OpenClaw / Hermes) ───────────────────────────────────────

function ingestGateway(
  metrics: PlatformMetrics, source: AgentSource, startIso: string,
  byModel: Record<string, ModelAgg>, byDay: Record<string, DayAgg>, sessions: SessionAgg[],
): boolean {
  if (!metrics.reachable) return false

  // Window the daily series so gateway spend respects the selected period.
  const daily = (metrics.daily ?? [])
    .map(d => ({ iso: String(d.date ?? '').slice(0, 10), cost: num(d.cost), tokens: num(d.tokens) }))
    .filter(d => d.iso)
  const inWin = daily.filter(d => d.iso >= startIso)
  const winCost   = inWin.reduce((s, d) => s + d.cost, 0)
  const winTokens = inWin.reduce((s, d) => s + d.tokens, 0)

  const modelTotalCost   = metrics.byModel.reduce((s, b) => s + num(b.cost), 0)
  const modelTotalTokens = metrics.byModel.reduce((s, b) => s + num(b.tokens), 0)
  const platLat   = num(metrics.latency?.avgMs)
  const platErr   = num(metrics.messages?.errors)
  const windowFrac = modelTotalCost > 0 && winCost > 0 ? winCost / modelTotalCost : 1

  let any = false
  for (const b of metrics.byModel) {
    const { provider, model } = splitProviderModel(b.name)
    if (!model || isJunkModel(model)) continue
    const costFrac = modelTotalCost   > 0 ? num(b.cost)   / modelTotalCost   : 1 / metrics.byModel.length
    const tokFrac  = modelTotalTokens > 0 ? num(b.tokens) / modelTotalTokens : 1 / metrics.byModel.length
    const cost   = winCost   > 0 ? winCost   * costFrac : num(b.cost)
    const tokens = winTokens > 0 ? winTokens * tokFrac  : num(b.tokens)
    const runs   = Math.max(0, Math.round(num(b.count) * windowFrac))

    const m = getAgg(byModel, source, model, provider)
    m.runs += runs; m.cost += cost; m.tokens += tokens
    m.inputTokens += tokens; m.outputTokens += 0; m.cacheTokens += 0
    if (platLat > 0) m.estLatencyMs = platLat
    m.failures += Math.round(platErr * costFrac)
    any = true
  }

  // Trend contribution (windowed daily).
  for (const d of inWin) {
    const day = getDay(byDay, d.iso)
    day.cost += d.cost; day.tokens += d.tokens
    if (platLat > 0) day.latencySamples.push(platLat)
  }

  // Sessions → scatter / expensive / slow runs (windowed by start/updated date).
  for (const s of metrics.sessionList) {
    if (s.isHeartbeat) continue
    const iso = String(s.startedAt ?? s.updatedAt ?? '').slice(0, 10)
    if (iso && iso < startIso) continue
    if (num(s.cost) <= 0) continue
    const { provider, model } = splitProviderModel(s.model)
    if (!model || isJunkModel(model)) continue
    const failed = /error|fail|timeout/i.test(s.status)
    sessions.push({
      source, sessionId: (s.key || 'session').slice(0, 16), date: iso || startIso,
      model, provider, runs: 1, cost: num(s.cost), tokens: num(s.tokens),
      latencySamples: [], estLatencyMs: platLat > 0 ? platLat : 0, failures: failed ? 1 : 0,
    })
    any = true
  }

  return any
}

// ─── Mock fallback ──────────────────────────────────────────────────────────────

const MOCK_MODELS = [
  { source: 'claude',   model: 'claude-opus-4-5',   weight: 0.24, fail: 0.018 },
  { source: 'claude',   model: 'claude-sonnet-4-6', weight: 0.30, fail: 0.009 },
  { source: 'claude',   model: 'claude-haiku-4-5',  weight: 0.12, fail: 0.004 },
  { source: 'openclaw', model: 'openai/gpt-5.5',    weight: 0.18, fail: 0.020 },
  { source: 'openclaw', model: 'openai/gpt-5.4',    weight: 0.08, fail: 0.016 },
  { source: 'hermes',   model: 'openai/gpt-5.5',    weight: 0.05, fail: 0.022 },
  { source: 'hermes',   model: 'google/gemini-2.0-flash', weight: 0.03, fail: 0.011 },
]

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildMock(days: number, startIso: string, endIso: string) {
  const rng = mulberry(20260525)
  const byModel: Record<string, ModelAgg> = {}
  const byDay:   Record<string, DayAgg> = {}
  const sessions: SessionAgg[] = []
  const total = 70 + Math.floor(rng() * 40)
  const now = new Date(endIso + 'T12:00:00Z')

  for (let i = 0; i < total; i++) {
    const r = rng(); let acc = 0
    const pick = MOCK_MODELS.find(m => (acc += m.weight) >= r) ?? MOCK_MODELS[0]
    const { provider, model } = splitProviderModel(pick.model)
    const d = new Date(now); d.setUTCDate(d.getUTCDate() - Math.floor(rng() * days))
    const date = d.toISOString().slice(0, 10)

    const reqs = 1 + Math.floor(rng() * 6)
    const isClaude = pick.source === 'claude'
    const input  = Math.floor((400 + rng() * 1600) * reqs)
    const output = Math.floor((200 + rng() * 900)  * reqs)
    const cacheRead  = isClaude ? Math.floor((2000 + rng() * 20000) * reqs) : 0
    const cacheWrite = isClaude ? Math.floor((300 + rng() * 2000) * reqs) : 0
    const tokens = input + output + cacheRead + cacheWrite
    const cost = isClaude
      ? calcCost(model, { input, output, cacheWrite, cacheRead })
      : (tokens / 1_000_000) * (model.includes('gpt-5.5') ? 6 : 4)
    const base = model.includes('opus') ? 4200 : model.includes('haiku') ? 900 : model.includes('gpt') ? 2200 : 1800
    const lat = Math.round(base + rng() * base)
    const failed = rng() < pick.fail * reqs ? 1 : 0

    const m = getAgg(byModel, pick.source, model, provider)
    m.runs += reqs; m.cost += cost; m.tokens += tokens
    m.inputTokens += input; m.outputTokens += output; m.cacheTokens += cacheRead + cacheWrite
    for (let k = 0; k < reqs; k++) m.latencySamples.push(Math.round(lat * (0.6 + rng() * 0.8)))
    m.failures += failed

    const day = getDay(byDay, date)
    day.requests += reqs; day.cost += cost; day.tokens += tokens
    day.latencySamples.push(lat); day.failures += failed

    sessions.push({
      source: pick.source, sessionId: `mock${i.toString(36).padStart(4, '0')}`.slice(0, 8), date,
      model, provider, runs: reqs, cost, tokens,
      latencySamples: Array.from({ length: reqs }, () => Math.round(lat * (0.6 + rng() * 0.8))),
      estLatencyMs: 0, failures: failed,
    })
  }
  return { byModel, byDay, sessions }
}

// ─── Response assembly ──────────────────────────────────────────────────────────

interface SourceMeta { source: string; reachable: boolean; error: string | null }

function assemble(
  byModel: Record<string, ModelAgg>, byDay: Record<string, DayAgg>, sessions: SessionAgg[],
  meta: { days: number; startIso: string; endIso: string; source: 'jsonl' | 'mock' | 'mixed'; sourceMeta: SourceMeta[] },
) {
  const estimatedDimensions = new Set<string>()

  const models = Object.values(byModel)
    .filter(a => a.runs > 0 || a.cost > 0 || a.tokens > 0)
    .map(a => {
      const avgTokensPerRun = a.runs > 0 ? a.tokens / a.runs : 0
      let avgLatencyMs: number, p95LatencyMs: number, estimated: boolean
      if (a.latencySamples.length > 0) {
        avgLatencyMs = avg(a.latencySamples); p95LatencyMs = percentile(a.latencySamples, 95); estimated = false
      } else if (a.estLatencyMs > 0) {
        avgLatencyMs = Math.round(a.estLatencyMs); p95LatencyMs = Math.round(a.estLatencyMs * 1.6); estimated = false
      } else {
        avgLatencyMs = estimateLatencyMs(a.model, avgTokensPerRun); p95LatencyMs = Math.round(avgLatencyMs * 1.6)
        estimated = true; estimatedDimensions.add('latency')
      }
      return {
        source: a.source, sourceLabel: SOURCE_LABEL[a.source] ?? a.source,
        model: a.model, modelLabel: modelLabel(a.model), provider: a.provider,
        runs: Math.round(a.runs), tokens: Math.round(a.tokens),
        inputTokens: Math.round(a.inputTokens), outputTokens: Math.round(a.outputTokens), cacheTokens: Math.round(a.cacheTokens),
        cost: Math.round(a.cost * 10000) / 10000,
        avgLatencyMs, p95LatencyMs,
        failures: a.failures, failureRate: a.runs > 0 ? a.failures / a.runs : 0,
        estimated,
      }
    })
    .sort((x, y) => y.cost - x.cost)

  // Provider rollup
  const provMap: Record<string, { runs: number; tokens: number; cost: number; lat: number[]; failures: number }> = {}
  for (const m of models) {
    const p = (provMap[m.provider] ??= { runs: 0, tokens: 0, cost: 0, lat: [], failures: 0 })
    p.runs += m.runs; p.tokens += m.tokens; p.cost += m.cost; p.failures += m.failures
    for (let i = 0; i < Math.max(1, m.runs); i++) p.lat.push(m.avgLatencyMs)
  }
  const providers = Object.entries(provMap).map(([provider, p]) => ({
    provider, runs: p.runs, tokens: p.tokens, cost: Math.round(p.cost * 10000) / 10000,
    avgLatencyMs: avg(p.lat), failureRate: p.runs > 0 ? p.failures / p.runs : 0,
  })).sort((a, b) => b.cost - a.cost)

  // Per-platform rollup (answers "what is OpenClaw / Hermes using")
  const srcMap: Record<string, { models: number; runs: number; tokens: number; cost: number; lat: number[]; failures: number }> = {}
  for (const m of models) {
    const sgrp = (srcMap[m.source] ??= { models: 0, runs: 0, tokens: 0, cost: 0, lat: [], failures: 0 })
    sgrp.models++; sgrp.runs += m.runs; sgrp.tokens += m.tokens; sgrp.cost += m.cost; sgrp.failures += m.failures
    for (let i = 0; i < Math.max(1, m.runs); i++) sgrp.lat.push(m.avgLatencyMs)
  }
  const bySource = Object.entries(srcMap).map(([source, g]) => {
    const sm = meta.sourceMeta.find(x => x.source === source)
    return {
      source, label: SOURCE_LABEL[source] ?? source,
      reachable: sm ? sm.reachable : true, error: sm?.error ?? null,
      models: g.models, runs: g.runs, tokens: g.tokens,
      cost: Math.round(g.cost * 10000) / 10000,
      avgLatencyMs: avg(g.lat), failureRate: g.runs > 0 ? g.failures / g.runs : 0,
      topModels: models.filter(m => m.source === source).slice(0, 4).map(m => ({ modelLabel: m.modelLabel, cost: m.cost })),
    }
  }).sort((a, b) => b.cost - a.cost)

  // Include unreachable/configured sources with no data so the UI can show status.
  for (const sm of meta.sourceMeta) {
    if (!bySource.some(b => b.source === sm.source)) {
      bySource.push({ source: sm.source, label: SOURCE_LABEL[sm.source] ?? sm.source, reachable: sm.reachable, error: sm.error, models: 0, runs: 0, tokens: 0, cost: 0, avgLatencyMs: 0, failureRate: 0, topModels: [] })
    }
  }

  const sessionLatency = (s: SessionAgg) =>
    s.latencySamples.length > 0 ? avg(s.latencySamples)
      : s.estLatencyMs > 0 ? s.estLatencyMs
      : estimateLatencyMs(s.model, s.runs > 0 ? s.tokens / s.runs : 0)

  const scatter = sessions
    .filter(s => s.cost > 0)
    .map(s => ({
      id: s.sessionId, source: s.source, model: s.model, modelLabel: modelLabel(s.model), provider: s.provider,
      cost: Math.round(s.cost * 10000) / 10000, tokens: Math.round(s.tokens), runs: s.runs,
      avgLatencyMs: sessionLatency(s), failureRate: s.runs > 0 ? s.failures / s.runs : 0, date: s.date,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 140)

  const trend = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date: new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      dateIso: date, requests: d.requests, cost: Math.round(d.cost * 10000) / 10000,
      tokens: d.tokens, avgLatencyMs: avg(d.latencySamples), failures: d.failures,
    }))

  const runRows = sessions.map(s => ({
    id: s.sessionId, source: s.source, sourceLabel: SOURCE_LABEL[s.source] ?? s.source,
    model: s.model, modelLabel: modelLabel(s.model), provider: s.provider, date: s.date,
    tokens: Math.round(s.tokens), cost: Math.round(s.cost * 10000) / 10000,
    avgLatencyMs: sessionLatency(s), failures: s.failures, failureRate: s.runs > 0 ? s.failures / s.runs : 0,
  }))
  const expensiveRuns = [...runRows].sort((a, b) => b.cost - a.cost).slice(0, 8)
  const slowRuns      = [...runRows].sort((a, b) => b.avgLatencyMs - a.avgLatencyMs).slice(0, 8)

  // Summary from the model rows so the cards tie out with the comparison table.
  const totalSpend    = models.reduce((s, m) => s + m.cost, 0)
  const totalRequests = models.reduce((s, m) => s + m.runs, 0)
  const failures      = models.reduce((s, m) => s + m.failures, 0)
  const allLatency: number[] = []
  for (const m of models) for (let i = 0; i < Math.max(1, m.runs); i++) allLatency.push(m.avgLatencyMs)

  // Spend trend: first third vs last third. Require a meaningful base in the
  // early window (>1% of total spend) so a near-zero start can't produce an
  // absurd percentage, and clamp to a sane display range.
  const third = Math.max(1, Math.floor(trend.length / 3))
  const firstAvg = trend.slice(0, third).reduce((s, d) => s + d.cost, 0) / third
  const lastAvg  = trend.slice(-third).reduce((s, d) => s + d.cost, 0) / third
  const trendBaseFloor = (totalSpend / Math.max(trend.length, 1)) * 0.01
  const spendTrendPct = firstAvg > Math.max(0.00001, trendBaseFloor)
    ? Math.max(-999, Math.min(999, Math.round(((lastAvg - firstAvg) / firstAvg) * 100)))
    : 0

  return {
    days: meta.days, startDate: meta.startIso, endDate: meta.endIso, source: meta.source,
    estimatedDimensions: [...estimatedDimensions],
    summary: {
      totalSpend: Math.round(totalSpend * 10000) / 10000,
      avgLatencyMs: avg(allLatency), totalRequests, failures,
      failureRate: totalRequests > 0 ? failures / totalRequests : 0,
      modelCount: models.length, providerCount: providers.length, spendTrendPct,
    },
    models, providers, bySource, scatter, trend, expensiveRuns, slowRuns,
    fetchedAt: new Date().toISOString(),
  }
}

// ─── Route ──────────────────────────────────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>(res => setTimeout(() => res(fallback), ms))])
}

type Scope = 'all' | 'claude' | 'agents'

modelOpsRouter.get('/summary', async (req, res) => {
  const days     = Math.min(Math.max(Number(req.query.days ?? 7), 1), 30)
  const scopeRaw = String(req.query.scope ?? 'all').toLowerCase()
  // Claude Code (subscription) and the agents (per-token API billing via the
  // gateways) have radically different economics, so they're viewed separately.
  const scope: Scope = scopeRaw === 'claude' ? 'claude' : scopeRaw === 'agents' ? 'agents' : 'all'
  const wantClaude = scope === 'all' || scope === 'claude'
  const wantAgents = scope === 'all' || scope === 'agents'

  const now      = new Date()
  const cutoff   = new Date(now); cutoff.setDate(cutoff.getDate() - days)
  const cutoffMs = cutoff.getTime()
  const startIso = cutoff.toISOString().slice(0, 10)
  const endIso   = now.toISOString().slice(0, 10)

  const byModel: Record<string, ModelAgg> = {}
  const byDay:   Record<string, DayAgg> = {}
  const sessions: SessionAgg[] = []
  const sourceMeta: SourceMeta[] = []

  // 1) Local Claude Code usage
  if (wantClaude) {
    const hasClaude = collectClaude(cutoffMs, startIso, endIso, byModel, byDay, sessions)
    sourceMeta.push({ source: 'claude', reachable: hasClaude, error: hasClaude ? null : 'No local Claude Code sessions found' })
  }

  // 2) Gateway platforms (OpenClaw + Hermes) — this is where GPT-5.x usage lives
  if (wantAgents) {
    const [ocRes, hrRes] = await Promise.allSettled([
      withTimeout(getPlatformMetrics('openclaw'), 9000, null),
      withTimeout(getPlatformMetrics('hermes'),   9000, null),
    ])
    for (const [src, settled] of [['openclaw', ocRes], ['hermes', hrRes]] as const) {
      const m = settled.status === 'fulfilled' ? settled.value : null
      if (!m) { sourceMeta.push({ source: src, reachable: false, error: 'timed out' }); continue }
      if (m.reachable) ingestGateway(m, src as AgentSource, startIso, byModel, byDay, sessions)
      sourceMeta.push({ source: src, reachable: m.reachable, error: m.error })
    }
  }

  const hasAny = Object.keys(byModel).length > 0
  if (!hasAny) {
    // Only fall back to mock for the default "all" view, so a deliberately
    // scoped (and genuinely empty) view stays honestly empty.
    if (scope === 'all') {
      const mock = buildMock(days, startIso, endIso)
      return res.json({ scope, ...assemble(mock.byModel, mock.byDay, mock.sessions, {
        days, startIso, endIso, source: 'mock',
        sourceMeta: [{ source: 'mock', reachable: true, error: null }],
      }) })
    }
    return res.json({ scope, ...assemble(byModel, byDay, sessions, { days, startIso, endIso, source: 'jsonl', sourceMeta }) })
  }

  const reachedGateways = sourceMeta.some(s => (s.source === 'openclaw' || s.source === 'hermes') && s.reachable)
  res.json({ scope, ...assemble(byModel, byDay, sessions, {
    days, startIso, endIso, source: reachedGateways ? 'mixed' : 'jsonl', sourceMeta,
  }) })
})
