// title: Evaluations derivation + scoring engine
// path: server/lib/evalEngine.ts
// purpose: Build a real, derived evaluation layer for Hermes + OpenClaw from
//          actual historical sessions, transcripts (tool calls / results), and
//          platform metrics — then compute a transparent composite score per
//          model and agent/model pair. NO Claude Code / editor telemetry. NO
//          fabricated rows: every run maps to a real session; when a metric
//          can't be derived it is reported null and flagged heuristic.

import { getPlatformMetrics, type PlatformMetrics } from './metrics.js'
import { getHistories } from './openclawWs.js'
import { fetchSessionMessages } from './gateway.js'
import { isLive } from './connectors.js'
import {
  type EvalPlatform, listBenchmarkRuns, listManualScores, listSnapshots, latestSnapshotTs,
  type BenchmarkRun, type ManualScore,
} from './evalStore.js'

// ─── Outcome vocabulary ───────────────────────────────────────────────────────

export type RunOutcome = 'success' | 'recovered' | 'partial' | 'stalled' | 'failure' | 'unresolved'

const OUTCOME_SCORE: Record<RunOutcome, number> = {
  success: 100, recovered: 80, partial: 50, stalled: 25, failure: 0, unresolved: NaN,
}

export interface EvaluationRun {
  id:              string         // session key / id (real)
  platform:        EvalPlatform
  agent:           string
  model:           string
  modelLabel:      string
  startedAt:       string | null
  lastActiveAt:    string | null
  durationMs:      number
  tokens:          number
  cost:            number
  outcome:         RunOutcome
  hadError:        boolean
  recovered:       boolean
  toolCalls:       number
  repeatedToolCalls: number       // consecutive identical (name+arg) calls
  oscillations:    number         // A,B,A,B ping-pong between two tools
  noProgressTools: number         // tool calls whose result was an error
  wastedToolCalls: number         // repeated + oscillation + no-progress (bounded)
  toolSequence:    string[]       // ordered tool names (for pattern drilldown)
  transcriptAvailable: boolean    // false → outcome inferred from status only
  heuristic:       true           // every derived run is heuristic
}

// ─── Scoring config (exposed verbatim in the methodology endpoint) ─────────────

export const SCORING = {
  sampleK: 6,                     // confidence curve constant
  ewmaAlpha: 0.7,                 // weight of the freshly-computed score vs. prior snapshot
  prior: 50,                      // neutral prior low-sample models are pulled toward
  benchmarkWeight: 0.18,          // benchmark contribution (capped so it can't override history)
  manualWeight: 0.10,             // manual rubric contribution
  loopRepeatThreshold: 3,         // repeated calls in a run that flag a loop
  weights: {
    success:           0.30,
    reliability:       0.22,
    toolEffectiveness: 0.16,
    efficiency:        0.16,
    recovery:          0.10,
    consistency:       0.06,
  } as Record<string, number>,
}

export const SUBSCORE_LABELS: Record<string, string> = {
  success:           'Success Score',
  reliability:       'Reliability Score',
  toolEffectiveness: 'Tool Effectiveness Score',
  efficiency:        'Efficiency Score',
  recovery:          'Recovery Score',
  consistency:       'Consistency Score',
  benchmark:         'Benchmark Score',
  confidence:        'Confidence Score',
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const r1 = (v: number) => Math.round(v * 10) / 10
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)

function cleanModel(model: unknown): string {
  const m = typeof model === 'string' ? model.trim() : ''
  if (!m || m === 'unknown' || m.startsWith('<')) return ''
  return m
}

export function modelLabel(model: string): string {
  if (!model) return 'Unknown'
  const m = model.includes('/') ? model.split('/').slice(1).join('/') : model
  const tidy = m.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  if (/opus|sonnet|haiku/i.test(tidy)) {
    const tier = /opus/i.test(tidy) ? 'Opus' : /sonnet/i.test(tidy) ? 'Sonnet' : 'Haiku'
    const ver = tidy.replace(/^(claude-)?\d?-?(opus|sonnet|haiku)-?/i, '').replace(/-/g, '.').replace(/\.$/, '')
    return ver ? `${tier} ${ver}` : tier
  }
  if (/^gpt/i.test(tidy)) return tidy.replace(/^gpt/i, 'GPT')
  if (/^o\d/i.test(tidy)) return tidy.toUpperCase()
  return tidy.charAt(0).toUpperCase() + tidy.slice(1)
}

// Parse the agent name out of a session key. OpenClaw keys look like
// "agent:main:discord:123"; Hermes keys are opaque, so the platform itself is
// the single agent bucket. Never invents an agent — falls back honestly.
function agentFromKey(platform: EvalPlatform, key: string): string {
  const parts = String(key ?? '').split(':')
  if (parts[0] === 'agent' && parts[1]) return parts[1]
  return platform === 'openclaw' ? 'main' : 'hermes'
}

// Sessions created by this dashboard's own benchmark / memory-eval / research
// dispatches. Their transcripts echo the test prompt back into session history;
// counting them as "real memory" or as "real agent activity" would let tests
// score themselves and inflate organic leaderboards with self-traffic. Excluded
// from both retrieval (memoryEvalEngine) and run derivation (above).
const SELF_DISPATCH_KEY_RE = /(dashboard-(memory|benchmark|research)|:dashboard-(memory|benchmark|research):)/i
export function isSelfDispatchSession(key: string | null | undefined): boolean {
  if (!key) return false
  return SELF_DISPATCH_KEY_RE.test(key)
}

const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
}

// ─── Transcript parsing ───────────────────────────────────────────────────────

const TOOL_CALL_TYPES = new Set(['tool_use', 'tooluse', 'toolcall', 'tool_call'])
const TOOL_RESULT_TYPES = new Set(['tool_result', 'toolresult'])

function argSig(input: any): string {
  if (input == null) return ''
  if (typeof input === 'string') return input.slice(0, 60)
  if (typeof input === 'object') {
    const v = input.command ?? input.file_path ?? input.path ?? input.url ?? input.query ??
      input.pattern ?? input.description ?? Object.values(input)[0]
    return String(v ?? '').slice(0, 60)
  }
  return String(input).slice(0, 60)
}

interface ParsedMsg {
  role:          string
  text:          string
  toolCalls:     Array<{ name: string; sig: string }>
  isToolResult:  boolean
  resultError:   boolean
  ts:            number
}

// Tool-result error scan: keep broad — these strings appear inside structural
// tool_result content where they reliably indicate something went wrong.
const TOOL_ERR_RE = /\b(error|failed|failure|exception|traceback|cannot|could not|unable to|timed out|timeout)\b/i
const NEG_ERR_RE  = /\bno (errors?|failures?|issues?)\b/i

// Assistant-text error scan: deliberately STRICT. The previous regex
// (`/\b(error|failed|cannot|exception|…)\b/i`) generated heavy false
// positives — an assistant explaining "Python exceptions" or saying "I cannot
// recall that fact" got flagged as having an error, which inflated failure
// and reliability sub-scores. The structural signal is the tool_result error
// flag; the assistant's prose only adds noise. We now only flag explicit
// self-reports of failure ("I was unable to complete", "the operation
// failed", "I could not finish").
const ASSISTANT_FAILURE_RE = /\b(i (was|am) unable to (complete|finish|do)|i (could not|couldn'?t) (complete|finish|fulfill)|the (request|operation|task) (failed|could not be completed)|aborting (this )?(task|request)|i (have to|must) (give up|stop))\b/i

function parseMessage(m: any): ParsedMsg {
  const role = String(m?.role ?? '').toLowerCase()
  const toolCalls: ParsedMsg['toolCalls'] = []
  let resultError = false
  let isToolResult = role === 'tool' || TOOL_RESULT_TYPES.has(role)
  let text = ''

  if (Array.isArray(m?.content)) {
    for (const b of m.content) {
      if (!b || typeof b !== 'object') { if (typeof b === 'string') text += b; continue }
      const t = String(b.type ?? '').toLowerCase()
      if (TOOL_CALL_TYPES.has(t)) {
        toolCalls.push({ name: String(b.name ?? b.tool ?? b.toolName ?? 'tool').toLowerCase(), sig: argSig(b.arguments ?? b.input) })
      } else if (TOOL_RESULT_TYPES.has(t)) {
        isToolResult = true
        if (b.is_error || b.isError) resultError = true
        const rc = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x: any) => x?.text ?? '').join(' ') : ''
        if (rc && TOOL_ERR_RE.test(rc) && !NEG_ERR_RE.test(rc)) resultError = true
      } else if (t === 'text') {
        text += String(b.text ?? '')
      }
    }
  } else if (typeof m?.content === 'string') {
    text = m.content
  } else if (typeof m?.text === 'string') {
    text = m.text
  }

  // OpenAI-style message-level tool calls (Hermes).
  const rawCalls = m?.tool_calls ?? m?.toolCalls
  if (Array.isArray(rawCalls)) {
    for (const c of rawCalls) toolCalls.push({ name: String(c?.function?.name ?? c?.name ?? 'tool').toLowerCase(), sig: argSig(c?.function?.arguments ?? c?.arguments ?? c?.input) })
  } else if ((m?.tool_name ?? m?.toolName) && !isToolResult) {
    toolCalls.push({ name: String(m.tool_name ?? m.toolName).toLowerCase(), sig: '' })
  }

  const tsRaw = m?.timestamp ?? m?.ts ?? m?.created_at ?? m?.time
  const ts = typeof tsRaw === 'number' ? (tsRaw < 1e12 ? tsRaw * 1000 : tsRaw) : Date.parse(String(tsRaw ?? '')) || 0

  return { role, text: text.trim(), toolCalls, isToolResult, resultError, ts }
}

interface DerivedQuality {
  outcome: RunOutcome
  hadError: boolean
  recovered: boolean
  toolCalls: number
  repeatedToolCalls: number
  oscillations: number
  noProgressTools: number
  wastedToolCalls: number
  toolSequence: string[]
}

// Derive run quality from an ordered transcript. Conservative: anything we
// cannot positively classify is left 'unresolved' (won't count as evaluated).
export function deriveFromTranscript(messages: any[], statusHint: string): DerivedQuality {
  const parsed = messages.map(parseMessage).filter(p => p.role || p.toolCalls.length || p.text || p.isToolResult)
  const seq: Array<{ name: string; sig: string }> = []
  let noProgress = 0
  let hadError = false
  let lastErrorIdx = -1            // position in `seq` (tool-call timeline) when the last error happened
  let lastAssistantTextIdx = -1    // position in `seq` when the most recent assistant final-text turn ended

  parsed.forEach((p) => {
    for (const c of p.toolCalls) seq.push(c)
    if (p.resultError) { noProgress++; hadError = true; lastErrorIdx = seq.length }
    // Only assistant text counts toward "the agent produced a clean reply
    // here". User / tool messages don't. We restrict the error-text scan to
    // explicit self-reported failures (see ASSISTANT_FAILURE_RE comment).
    if (p.role === 'assistant' && !p.isToolResult && p.text) {
      lastAssistantTextIdx = seq.length
      if (ASSISTANT_FAILURE_RE.test(p.text)) hadError = true
    }
  })

  // Repeats: consecutive identical (name+sig).
  let repeats = 0
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].name === seq[i - 1].name && seq[i].sig === seq[i - 1].sig) repeats++
  }
  // Oscillations: A,B,A pattern (returning to a tool after one detour).
  let oscillations = 0
  for (let i = 2; i < seq.length; i++) {
    if (seq[i].name === seq[i - 2].name && seq[i].name !== seq[i - 1].name) oscillations++
  }

  const statusErr = /error|fail|timeout|abort/i.test(statusHint)
  if (statusErr) hadError = true
  const statusRunning = /running|active|in[-_ ]?progress/i.test(statusHint)

  // Recovery requires an assistant final reply AFTER the last error position
  // — not just an assistant message that happens to exist somewhere in the
  // transcript. (The previous implementation set
  // `lastAssistantIdxInSeqTerms = seq.length` unconditionally whenever any
  // assistant message existed, which silently turned every error-followed-by-
  // a-stale-reply into a "recovered" run and inflated recovery rate.)
  const endedClean = lastAssistantTextIdx >= 0
  const recovered = hadError && endedClean && (lastErrorIdx === -1 || lastAssistantTextIdx >= lastErrorIdx)

  let outcome: RunOutcome
  if (parsed.length === 0) {
    outcome = statusErr ? 'failure' : 'unresolved'
  } else if (statusRunning) {
    outcome = 'stalled'
  } else if (!endedClean) {
    outcome = hadError ? 'failure' : 'stalled'
  } else if (hadError) {
    outcome = recovered ? 'recovered' : 'failure'
  } else {
    outcome = 'success'
  }

  const toolCalls = seq.length
  const wasted = Math.min(toolCalls, repeats + Math.floor(oscillations / 2) + noProgress)

  return {
    outcome, hadError, recovered,
    toolCalls, repeatedToolCalls: repeats, oscillations, noProgressTools: noProgress,
    wastedToolCalls: wasted, toolSequence: seq.map(s => s.name).slice(0, 40),
  }
}

function outcomeFromStatusOnly(status: string): RunOutcome {
  if (/error|fail|timeout|abort/i.test(status)) return 'failure'
  return 'unresolved'
}

// ─── Run derivation (cached) ──────────────────────────────────────────────────

const RUN_CAP = 30
const CACHE_TTL_MS = 60_000

export interface RunSet {
  platform:  EvalPlatform
  reachable: boolean
  error:     string | null
  runs:      EvaluationRun[]
  fetchedAt: string
}

const runCache = new Map<EvalPlatform, { at: number; data: RunSet }>()

export async function getEvalRuns(platform: EvalPlatform, force = false): Promise<RunSet> {
  const hit = runCache.get(platform)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data

  if (!isLive(platform)) {
    const data: RunSet = { platform, reachable: false, error: 'not connected — add a token in Settings', runs: [], fetchedAt: new Date().toISOString() }
    return data
  }

  let metrics: PlatformMetrics
  try { metrics = await getPlatformMetrics(platform) }
  catch (e: any) {
    const data: RunSet = { platform, reachable: false, error: e?.message ?? 'metrics unavailable', runs: [], fetchedAt: new Date().toISOString() }
    return data
  }
  if (!metrics.reachable) {
    const data: RunSet = { platform, reachable: false, error: metrics.error ?? 'unreachable', runs: [], fetchedAt: new Date().toISOString() }
    return data
  }

  const candidates = metrics.sessionList
    // Exclude this dashboard's own dispatch sessions (benchmark/memory/research).
    // They're artifacts of evaluation, not real agent activity; counting them
    // as evaluable runs would inflate leaderboards with self-traffic.
    .filter(s => !s.isHeartbeat && cleanModel(s.model) && !isSelfDispatchSession(s.key))
    .slice(0, RUN_CAP)

  // Pull transcripts (one batched WS round-trip for OpenClaw; REST per session for Hermes).
  const transcripts = new Map<string, any[]>()
  try {
    if (platform === 'openclaw') {
      const map = await getHistories(candidates.map(s => s.key))
      for (const [k, v] of Object.entries(map)) transcripts.set(k, Array.isArray(v) ? v : [])
    } else {
      const results = await Promise.all(candidates.map(async s => {
        const r = await fetchSessionMessages('hermes', s.key).catch(() => null)
        return { key: s.key, msgs: r?.ok && r.data ? r.data : [] }
      }))
      for (const { key, msgs } of results) transcripts.set(key, msgs)
    }
  } catch { /* leave transcripts partial — runs fall back to status-only */ }

  const runs: EvaluationRun[] = candidates.map(s => {
    const model = cleanModel(s.model)
    const msgs = transcripts.get(s.key) ?? []
    const transcriptAvailable = msgs.length > 0
    const q = transcriptAvailable
      ? deriveFromTranscript(msgs, s.status)
      : { outcome: outcomeFromStatusOnly(s.status), hadError: /error|fail|timeout/i.test(s.status), recovered: false,
          toolCalls: 0, repeatedToolCalls: 0, oscillations: 0, noProgressTools: 0, wastedToolCalls: 0, toolSequence: [] as string[] }
    const durationMs = num(s.runtimeMs) || (s.startedAt && s.updatedAt ? Math.max(0, new Date(s.updatedAt).getTime() - new Date(s.startedAt).getTime()) : 0)
    return {
      id: s.key, platform, agent: agentFromKey(platform, s.key),
      model, modelLabel: modelLabel(model),
      startedAt: s.startedAt, lastActiveAt: s.updatedAt,
      durationMs, tokens: num(s.tokens), cost: num(s.cost),
      outcome: q.outcome, hadError: q.hadError, recovered: q.recovered,
      toolCalls: q.toolCalls, repeatedToolCalls: q.repeatedToolCalls, oscillations: q.oscillations,
      noProgressTools: q.noProgressTools, wastedToolCalls: q.wastedToolCalls, toolSequence: q.toolSequence,
      transcriptAvailable, heuristic: true,
    }
  })

  const data: RunSet = { platform, reachable: true, error: null, runs, fetchedAt: new Date().toISOString() }
  runCache.set(platform, { at: Date.now(), data })
  return data
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export interface SubScore { key: string; label: string; value: number | null; weight: number; detail: string }

export interface ModelScorecard {
  platform:       EvalPlatform
  model:          string
  modelLabel:     string
  runCount:       number
  evaluatedCount: number
  outcomes:       Record<RunOutcome, number>
  successRate:    number | null
  failureRate:    number | null
  partialRate:    number | null
  stalledRate:    number | null
  repeatRate:     number | null
  loopRuns:       number
  toolCalls:      number
  wastedToolCalls: number
  wasteRate:      number | null
  avgToolsPerSuccess: number | null
  avgToolsPerFailure: number | null
  recoveryRate:   number | null
  avgDurationMs:  number
  avgTokens:      number
  avgCost:        number
  historicalScore: number | null
  benchmarkScore:  number | null
  benchmarkRuns:   number
  manualScore:     number | null
  manualScores:    number
  consistencyScore: number | null
  confidence:     number
  previousOverall: number | null
  overall:        number
  subScores:      SubScore[]
}

function pct(n: number, d: number): number | null { return d > 0 ? r1((n / d) * 100) : null }

export function scoreModel(
  platform: EvalPlatform, model: string, runs: EvaluationRun[],
  benchRuns: BenchmarkRun[], manuals: ManualScore[], previousOverall: number | null,
): ModelScorecard {
  const outcomes: Record<RunOutcome, number> = { success: 0, recovered: 0, partial: 0, stalled: 0, failure: 0, unresolved: 0 }
  for (const r of runs) outcomes[r.outcome]++
  const evaluated = runs.filter(r => r.outcome !== 'unresolved')
  const ev = evaluated.length
  const successN = outcomes.success + outcomes.recovered
  const errorRuns = outcomes.failure + outcomes.recovered

  const toolCalls = runs.reduce((s, r) => s + r.toolCalls, 0)
  const wasted = runs.reduce((s, r) => s + r.wastedToolCalls, 0)
  const repeated = runs.reduce((s, r) => s + r.repeatedToolCalls, 0)
  const loopRuns = runs.filter(r => r.repeatedToolCalls >= SCORING.loopRepeatThreshold || r.oscillations >= 4).length

  const successRuns = runs.filter(r => r.outcome === 'success' || r.outcome === 'recovered')
  const failRuns = runs.filter(r => r.outcome === 'failure')
  const avgToolsPerSuccess = successRuns.length ? r1(successRuns.reduce((s, r) => s + r.toolCalls, 0) / successRuns.length) : null
  const avgToolsPerFailure = failRuns.length ? r1(failRuns.reduce((s, r) => s + r.toolCalls, 0) / failRuns.length) : null

  const successRate = pct(successN, ev)
  const failureRate = pct(outcomes.failure, ev)
  const partialRate = pct(outcomes.partial, ev)
  const stalledRate = pct(outcomes.stalled, ev)
  const repeatRate = toolCalls > 0 ? r1((repeated / toolCalls) * 100) : null
  const wasteRate = toolCalls > 0 ? r1((wasted / toolCalls) * 100) : null
  const recoveryRate = errorRuns > 0 ? r1((outcomes.recovered / errorRuns) * 100) : null

  // Benchmark + manual aggregates (real persisted records).
  const benchScored = benchRuns.filter(b => b.rubricScore != null)
  const benchmarkScore = benchScored.length ? r1(benchScored.reduce((s, b) => s + (b.rubricScore as number), 0) / benchScored.length) : null
  const manualScore = manuals.length ? r1(manuals.reduce((s, m) => s + m.score, 0) / manuals.length) : null

  // Per-run outcome scores → consistency.
  const outcomeScores = evaluated.map(r => OUTCOME_SCORE[r.outcome]).filter(n => !Number.isNaN(n))
  const consistencyScore = outcomeScores.length >= 2 ? clamp(100 - stdev(outcomeScores)) : null

  // ── Derived sub-scores (null when their inputs are unavailable) ──
  const sSuccess = successRate
  const sReliability = ev > 0 ? clamp(100 - ((failureRate ?? 0) + 0.5 * (stalledRate ?? 0) + 0.25 * (partialRate ?? 0))) : null
  const sToolEff = toolCalls > 0 ? clamp(100 - (wasteRate ?? 0)) : null
  const sEfficiency = toolCalls > 0 ? clamp(100 - (repeatRate ?? 0) - (loopRuns / Math.max(1, runs.length)) * 40) : null
  const sRecovery = errorRuns > 0 ? recoveryRate : null

  const confSamples = ev + benchScored.length
  const confidence = r1((1 - Math.exp(-confSamples / SCORING.sampleK)) * 100)

  const subDefs: SubScore[] = [
    { key: 'success', label: SUBSCORE_LABELS.success, value: sSuccess, weight: SCORING.weights.success, detail: `${successN}/${ev} evaluated runs ended successfully` },
    { key: 'reliability', label: SUBSCORE_LABELS.reliability, value: sReliability, weight: SCORING.weights.reliability, detail: `penalizes failures, stalls and partial runs` },
    { key: 'toolEffectiveness', label: SUBSCORE_LABELS.toolEffectiveness, value: sToolEff, weight: SCORING.weights.toolEffectiveness, detail: `${wasted}/${toolCalls} tool calls looked wasted` },
    { key: 'efficiency', label: SUBSCORE_LABELS.efficiency, value: sEfficiency, weight: SCORING.weights.efficiency, detail: `${loopRuns} loop-prone run${loopRuns === 1 ? '' : 's'}, ${repeatRate ?? 0}% repeats` },
    { key: 'recovery', label: SUBSCORE_LABELS.recovery, value: sRecovery, weight: SCORING.weights.recovery, detail: `${outcomes.recovered}/${errorRuns} error runs recovered` },
    { key: 'consistency', label: SUBSCORE_LABELS.consistency, value: consistencyScore, weight: SCORING.weights.consistency, detail: `spread of per-run outcomes` },
  ]

  // Weighted historical average over available sub-scores (re-normalized).
  const avail = subDefs.filter(s => s.value != null)
  const wsum = avail.reduce((s, x) => s + x.weight, 0)
  const historicalScore = wsum > 0 ? r1(avail.reduce((s, x) => s + (x.value as number) * x.weight, 0) / wsum) : null

  // Compose: benchmark + manual contribute, capped so they can't override history.
  let overallRaw = historicalScore ?? SCORING.prior
  if (benchmarkScore != null && historicalScore != null) overallRaw = (1 - SCORING.benchmarkWeight) * overallRaw + SCORING.benchmarkWeight * benchmarkScore
  else if (benchmarkScore != null && historicalScore == null) overallRaw = SCORING.prior * 0.5 + benchmarkScore * 0.5
  if (manualScore != null) overallRaw = (1 - SCORING.manualWeight) * overallRaw + SCORING.manualWeight * manualScore

  // Confidence shrinkage toward the neutral prior — sample size matters.
  const shrink = 0.35 + 0.65 * (confidence / 100)
  let overall = SCORING.prior + (overallRaw - SCORING.prior) * shrink
  // Compounding: blend with the previous persisted snapshot (EWMA).
  if (previousOverall != null) overall = SCORING.ewmaAlpha * overall + (1 - SCORING.ewmaAlpha) * previousOverall

  const subScores: SubScore[] = [
    ...subDefs,
    { key: 'benchmark', label: SUBSCORE_LABELS.benchmark, value: benchmarkScore, weight: SCORING.benchmarkWeight, detail: `${benchScored.length} scored benchmark run${benchScored.length === 1 ? '' : 's'}` },
    { key: 'confidence', label: SUBSCORE_LABELS.confidence, value: confidence, weight: 0, detail: `${confSamples} evaluated sample${confSamples === 1 ? '' : 's'}` },
  ]

  return {
    platform, model, modelLabel: modelLabel(model),
    runCount: runs.length, evaluatedCount: ev, outcomes,
    successRate, failureRate, partialRate, stalledRate, repeatRate, loopRuns,
    toolCalls, wastedToolCalls: wasted, wasteRate,
    avgToolsPerSuccess, avgToolsPerFailure, recoveryRate,
    avgDurationMs: runs.length ? Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / runs.length) : 0,
    avgTokens: runs.length ? Math.round(runs.reduce((s, r) => s + r.tokens, 0) / runs.length) : 0,
    avgCost: runs.length ? r1(runs.reduce((s, r) => s + r.cost, 0) / runs.length * 10000) / 10000 : 0,
    historicalScore, benchmarkScore, benchmarkRuns: benchRuns.length,
    manualScore, manualScores: manuals.length, consistencyScore, confidence,
    previousOverall, overall: Math.round(clamp(overall)),
    subScores,
  }
}

// ─── Aggregations ─────────────────────────────────────────────────────────────

export interface AgentModelCell {
  agent: string; model: string; modelLabel: string
  runCount: number; evaluatedCount: number; successRate: number | null
  wasteRate: number | null; recoveryRate: number | null; overall: number | null
}

export interface TrendPoint { date: string; runs: number; evaluated: number; successRate: number | null; wasteRate: number | null }

export interface FactorBreakdown { key: string; label: string; value: number | null }

export interface PlatformOverview {
  platform:   EvalPlatform
  reachable:  boolean
  error:      string | null
  fetchedAt:  string
  summary: {
    runCount: number; evaluatedCount: number; modelCount: number; agentCount: number
    successRate: number | null; failureRate: number | null; wasteRate: number | null
    recoveryRate: number | null; topModel: string | null; topModelScore: number | null
  }
  leaderboard:    ModelScorecard[]
  agentModelMatrix: { agents: string[]; models: string[]; cells: AgentModelCell[] }
  trend:          TrendPoint[]
  factorBreakdown: FactorBreakdown[]
  representativeFailures: EvaluationRun[]
  loopRuns:       EvaluationRun[]
  wastefulRuns:   EvaluationRun[]
  recentRuns:     EvaluationRun[]
}

function buildTrend(runs: EvaluationRun[]): TrendPoint[] {
  const byDay = new Map<string, { runs: number; ev: number; success: number; tool: number; wasted: number }>()
  for (const r of runs) {
    const day = String(r.startedAt ?? r.lastActiveAt ?? '').slice(0, 10)
    if (!day) continue
    const e = byDay.get(day) ?? { runs: 0, ev: 0, success: 0, tool: 0, wasted: 0 }
    e.runs++
    if (r.outcome !== 'unresolved') e.ev++
    if (r.outcome === 'success' || r.outcome === 'recovered') e.success++
    e.tool += r.toolCalls; e.wasted += r.wastedToolCalls
    byDay.set(day, e)
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, e]) => ({
    date, runs: e.runs, evaluated: e.ev,
    successRate: e.ev > 0 ? r1((e.success / e.ev) * 100) : null,
    wasteRate: e.tool > 0 ? r1((e.wasted / e.tool) * 100) : null,
  }))
}

export async function buildPlatformOverview(platform: EvalPlatform, opts?: { snapshot?: boolean }): Promise<PlatformOverview> {
  const rs = await getEvalRuns(platform)
  const fetchedAt = rs.fetchedAt
  if (!rs.reachable) {
    return {
      platform, reachable: false, error: rs.error, fetchedAt,
      summary: { runCount: 0, evaluatedCount: 0, modelCount: 0, agentCount: 0, successRate: null, failureRate: null, wasteRate: null, recoveryRate: null, topModel: null, topModelScore: null },
      leaderboard: [], agentModelMatrix: { agents: [], models: [], cells: [] }, trend: [],
      factorBreakdown: [], representativeFailures: [], loopRuns: [], wastefulRuns: [], recentRuns: [],
    }
  }

  const runs = rs.runs
  const benchRuns = listBenchmarkRuns({ platform })
  const manuals = listManualScores({ platform })

  // Group runs by model.
  const byModel = new Map<string, EvaluationRun[]>()
  for (const r of runs) {
    const arr = byModel.get(r.model) ?? []
    arr.push(r); byModel.set(r.model, arr)
  }

  const leaderboard: ModelScorecard[] = []
  for (const [model, mruns] of byModel) {
    const prevTs = latestSnapshotTs(platform, model)
    const prevSnap = prevTs ? listSnapshots(platform, model).slice(-1)[0] : null
    const card = scoreModel(platform, model, mruns,
      benchRuns.filter(b => b.model === model), manuals.filter(m => m.model === model),
      prevSnap ? prevSnap.overall : null)
    leaderboard.push(card)
  }
  leaderboard.sort((a, b) => b.overall - a.overall || b.evaluatedCount - a.evaluatedCount)

  // Agent/model matrix.
  const agents = [...new Set(runs.map(r => r.agent))].sort()
  const models = leaderboard.map(c => c.model)
  const cells: AgentModelCell[] = []
  for (const agent of agents) {
    for (const model of models) {
      const cr = runs.filter(r => r.agent === agent && r.model === model)
      if (cr.length === 0) continue
      const ev = cr.filter(r => r.outcome !== 'unresolved')
      const successN = cr.filter(r => r.outcome === 'success' || r.outcome === 'recovered').length
      const errorRuns = cr.filter(r => r.outcome === 'failure' || r.outcome === 'recovered').length
      const recoveredN = cr.filter(r => r.outcome === 'recovered').length
      const tool = cr.reduce((s, r) => s + r.toolCalls, 0)
      const wasted = cr.reduce((s, r) => s + r.wastedToolCalls, 0)
      const sub = scoreModel(platform, model, cr, benchRuns.filter(b => b.model === model && (!b.agent || b.agent === agent)), manuals.filter(m => m.model === model && (!m.agent || m.agent === agent)), null)
      cells.push({
        agent, model, modelLabel: modelLabel(model),
        runCount: cr.length, evaluatedCount: ev.length,
        successRate: ev.length ? r1((successN / ev.length) * 100) : null,
        wasteRate: tool ? r1((wasted / tool) * 100) : null,
        recoveryRate: errorRuns ? r1((recoveredN / errorRuns) * 100) : null,
        overall: cr.length ? sub.overall : null,
      })
    }
  }

  // Platform factor breakdown = run-weighted average of each sub-score.
  const factorKeys = ['success', 'reliability', 'toolEffectiveness', 'efficiency', 'recovery', 'consistency']
  const factorBreakdown: FactorBreakdown[] = factorKeys.map(key => {
    let wsum = 0, vsum = 0
    for (const c of leaderboard) {
      const s = c.subScores.find(x => x.key === key)
      if (s && s.value != null) { wsum += c.evaluatedCount || 1; vsum += s.value * (c.evaluatedCount || 1) }
    }
    return { key, label: SUBSCORE_LABELS[key], value: wsum > 0 ? r1(vsum / wsum) : null }
  })

  // Summary.
  const evAll = runs.filter(r => r.outcome !== 'unresolved')
  const successAll = runs.filter(r => r.outcome === 'success' || r.outcome === 'recovered').length
  const failAll = runs.filter(r => r.outcome === 'failure').length
  const errAll = runs.filter(r => r.outcome === 'failure' || r.outcome === 'recovered').length
  const recAll = runs.filter(r => r.outcome === 'recovered').length
  const toolAll = runs.reduce((s, r) => s + r.toolCalls, 0)
  const wastedAll = runs.reduce((s, r) => s + r.wastedToolCalls, 0)
  const top = leaderboard[0]

  // Drilldowns.
  const byTime = (a: EvaluationRun, b: EvaluationRun) => new Date(b.lastActiveAt ?? 0).getTime() - new Date(a.lastActiveAt ?? 0).getTime()
  const representativeFailures = runs.filter(r => r.outcome === 'failure').sort(byTime).slice(0, 12)
  const loopRunsList = runs.filter(r => r.repeatedToolCalls >= SCORING.loopRepeatThreshold || r.oscillations >= 4).sort((a, b) => b.repeatedToolCalls - a.repeatedToolCalls).slice(0, 12)
  const wastefulRuns = runs.filter(r => r.wastedToolCalls > 0).sort((a, b) => b.wastedToolCalls - a.wastedToolCalls).slice(0, 12)
  const recentRuns = [...runs].sort(byTime).slice(0, 30)

  // Optionally persist a snapshot per model (throttled to once/day) so historical
  // scores compound over time into a real trend.
  if (opts?.snapshot) {
    const dayMs = 86_400_000
    for (const c of leaderboard) {
      const last = latestSnapshotTs(platform, c.model)
      if (!last || Date.now() - new Date(last).getTime() > dayMs) {
        const { saveSnapshot } = await import('./evalStore.js')
        saveSnapshot({
          platform, model: c.model, windowDays: 0, overall: c.overall,
          subScores: Object.fromEntries(c.subScores.map(s => [s.key, s.value])),
          runCount: c.runCount, evaluatedCount: c.evaluatedCount,
        })
      }
    }
  }

  return {
    platform, reachable: true, error: null, fetchedAt,
    summary: {
      runCount: runs.length, evaluatedCount: evAll.length,
      modelCount: byModel.size, agentCount: agents.length,
      successRate: evAll.length ? r1((successAll / evAll.length) * 100) : null,
      failureRate: evAll.length ? r1((failAll / evAll.length) * 100) : null,
      wasteRate: toolAll ? r1((wastedAll / toolAll) * 100) : null,
      recoveryRate: errAll ? r1((recAll / errAll) * 100) : null,
      topModel: top ? top.modelLabel : null, topModelScore: top ? top.overall : null,
    },
    leaderboard,
    agentModelMatrix: { agents, models, cells },
    trend: buildTrend(runs),
    factorBreakdown,
    representativeFailures, loopRuns: loopRunsList, wastefulRuns, recentRuns,
  }
}

// ─── Methodology (transparent scoring description) ─────────────────────────────

export function methodology() {
  return {
    overview: 'Scores are derived from real Hermes/OpenClaw session history (transcripts, tool calls, tool results, status) plus any persisted benchmark runs and manual rubric scores. No Claude Code / editor telemetry is included. Every per-run metric is heuristic and inferred conservatively — runs that cannot be classified are left "unresolved" and excluded from rates.',
    outcomes: [
      { key: 'success', label: 'Success', detail: 'Ended with a final assistant reply and no errors.', score: OUTCOME_SCORE.success },
      { key: 'recovered', label: 'Recovered', detail: 'Hit a tool/result error but still produced a clean final reply.', score: OUTCOME_SCORE.recovered },
      { key: 'partial', label: 'Partial', detail: 'Completed but flagged as incomplete.', score: OUTCOME_SCORE.partial },
      { key: 'stalled', label: 'Stalled / abandoned', detail: 'No final reply, or still running past its window.', score: OUTCOME_SCORE.stalled },
      { key: 'failure', label: 'Failure', detail: 'Error with no recovery, or an error status.', score: OUTCOME_SCORE.failure },
      { key: 'unresolved', label: 'Unresolved', detail: 'Not enough signal to classify — excluded from rates.', score: null },
    ],
    subScores: Object.entries(SUBSCORE_LABELS).map(([key, label]) => ({
      key, label, weight: SCORING.weights[key] ?? (key === 'benchmark' ? SCORING.benchmarkWeight : 0),
    })),
    weights: SCORING.weights,
    composition: [
      'Each sub-score is 0–100; unavailable sub-scores are dropped and the remaining weights re-normalized.',
      'Historical score = weighted average of available sub-scores.',
      `Benchmark score contributes at most ${Math.round(SCORING.benchmarkWeight * 100)}% so it can never override poor real-world history.`,
      `Manual rubric scores contribute ${Math.round(SCORING.manualWeight * 100)}%.`,
      `Low sample sizes are pulled toward a neutral prior of ${SCORING.prior} (confidence shrinkage), so a model with one good run cannot rank #1.`,
      `Confidence = 1 − e^(−n / ${SCORING.sampleK}) over evaluated + benchmark samples.`,
      `Scores compound over time via an EWMA (α=${SCORING.ewmaAlpha}) against the previous daily snapshot.`,
    ],
    config: SCORING,
  }
}
