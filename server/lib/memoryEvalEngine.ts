// title: Memory benchmarking engine — real providers + scoring
// path: server/lib/memoryEvalEngine.ts
// purpose: Detect real memory providers on each platform, query them with
//          benchmark probes, optionally dispatch applied-recall to the live
//          agent, and score the outcome with transparent weighted sub-scores.
//          Providers are derived from actual platform state — no placeholder
//          providers are surfaced. If a memory class isn't present in the
//          current Hermes / OpenClaw stack it stays absent (honest empty).

import { randomUUID } from 'crypto'
import { isLive } from './connectors.js'
import { getPlatformMetrics } from './metrics.js'
import { getSnapshot as ocSnapshot, getHistories as ocHistories, readMemoryFileRpc } from './openclawWs.js'
import { fetchMemoryFileContent, fetchSessions, fetchSessionMessages } from './gateway.js'
import { ensureConnected, request as ocRequest } from './openclawLive.js'
import { hermesChat } from './hermesApiServer.js'
import {
  type MemoryBenchmarkTask, type MemoryHit, type MemoryBenchmarkRun, type MemoryScoreSnapshot,
  listMemoryRuns, saveMemorySnapshot, updateMemoryRun, createMemoryRun, listMemorySnapshots,
} from './memoryEvalStore.js'
import type { EvalPlatform } from './evalStore.js'

// ─── Provider abstraction ─────────────────────────────────────────────────────

export type MemoryProviderType =
  | 'workspace-files'      // local/remote workspace memory files
  | 'session-history'      // prior conversation/transcript recall
  | 'vector-db'            // external vector store (not detected yet — present in model only)
  | 'mem0'
  | 'wiki'
  | 'obsidian'
  | 'other'

export interface MemoryProviderInfo {
  name:      string                       // unique id, e.g. "workspace-files-openclaw"
  label:     string
  type:      MemoryProviderType
  platform:  EvalPlatform
  baseline:  boolean                       // true = native/built-in; false = external/add-on
  configured: boolean                      // present + reachable
  itemCount: number | null                 // best-effort count of indexable items (null if unknown)
  notes:     string
}

export interface RetrievalQuery {
  query:         string
  expectedFacts: string[]
  forbiddenFacts: string[]
  newerHints:    string[]
  topK:          number
}

export interface ProviderRetrieval {
  provider: string
  latencyMs: number
  hits:     MemoryHit[]
  error:    string | null
}

// Detect providers from real platform state. Only providers backed by actual
// data sources in the live system are returned. The data model supports more
// (Mem0, vector DB, wiki, Obsidian, …) — they'll appear here as soon as a real
// integration exposes them.
export async function detectProviders(platform: EvalPlatform): Promise<MemoryProviderInfo[]> {
  const out: MemoryProviderInfo[] = []
  if (!isLive(platform)) return out
  try {
    const metrics = await getPlatformMetrics(platform)
    if (!metrics.reachable) return out

    // 1. Workspace memory files — present on both platforms via memoryFiles[].
    if ((metrics.memoryFiles?.length ?? 0) > 0) {
      out.push({
        name: `workspace-files-${platform}`,
        label: 'Workspace memory files',
        type: 'workspace-files',
        platform, baseline: true, configured: true,
        itemCount: metrics.memoryFiles.length,
        notes: 'Markdown / text memory files exposed by the agent workspace.',
      })
    }

    // 2. Session history — present whenever sessions exist.
    if ((metrics.sessionList?.length ?? 0) > 0) {
      out.push({
        name: `session-history-${platform}`,
        label: 'Session history (prior conversations)',
        type: 'session-history',
        platform, baseline: true, configured: true,
        itemCount: metrics.sessionList.length,
        notes: 'Recall from recent session transcripts (chat.history / messages API).',
      })
    }
  } catch { /* swallow — platform unreachable */ }

  return out
}

// ─── Retrieval ────────────────────────────────────────────────────────────────

// Case-insensitive substring scan. We don't have a real vector store here, so
// retrieval correctness is measured against ground-truth substrings declared
// in the task (expectedFacts). The scoring layer makes the methodology explicit.
function matchedSubstrings(haystack: string, needles: string[]): string[] {
  if (!haystack) return []
  const h = haystack.toLowerCase()
  const out: string[] = []
  for (const n of needles) {
    const lc = n.toLowerCase().trim()
    if (lc && h.includes(lc)) out.push(n)
  }
  return out
}

// Crude relevance score for a hit excerpt — number of distinct expected facts
// found, plus a small bonus per query-keyword match. Honest about being a
// heuristic via the methodology endpoint.
function rankScore(excerpt: string, q: RetrievalQuery): number {
  const expHits = matchedSubstrings(excerpt, q.expectedFacts).length
  const lc = excerpt.toLowerCase()
  const kw = (q.query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
  let kwHits = 0
  for (const k of new Set(kw)) if (lc.includes(k)) kwHits++
  return expHits * 5 + kwHits
}

function excerptAround(text: string, needles: string[], width = 320): string {
  const t = String(text ?? '')
  if (!t) return ''
  const lc = t.toLowerCase()
  for (const n of needles) {
    const idx = lc.indexOf(n.toLowerCase())
    if (idx >= 0) {
      const start = Math.max(0, idx - 60)
      const end   = Math.min(t.length, idx + n.length + width - 60)
      return (start > 0 ? '…' : '') + t.slice(start, end).trim() + (end < t.length ? '…' : '')
    }
  }
  return t.slice(0, width).trim() + (t.length > width ? '…' : '')
}

async function retrieveWorkspaceFiles(platform: EvalPlatform, q: RetrievalQuery): Promise<MemoryHit[]> {
  const metrics = await getPlatformMetrics(platform)
  const files = metrics.memoryFiles ?? []
  const probe = [...q.expectedFacts, ...q.forbiddenFacts, ...q.newerHints]
  const provName = `workspace-files-${platform}`

  // Limit the number of files we read per probe — workspaces can be large.
  const limit = Math.min(40, files.length)
  const out: MemoryHit[] = []
  for (let i = 0; i < limit; i++) {
    const f = files[i]
    let content = ''
    try {
      if (platform === 'openclaw') {
        const rpc = await readMemoryFileRpc(f.name).catch(() => null)
        content = rpc?.content ?? ''
      }
      if (!content) {
        const gw = await fetchMemoryFileContent(platform, f.name).catch(() => null)
        if (gw) content = gw.content
      }
    } catch { /* skip unreadable file */ }
    if (!content) continue
    const matched = matchedSubstrings(content, probe)
    const score = rankScore(content, q)
    if (matched.length === 0 && score === 0) continue
    out.push({
      provider: provName, source: f.path ?? f.name, score,
      ts: f.updatedAt ?? null,
      excerpt: excerptAround(content, probe, 320),
      matchedFacts: matched,
    })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, q.topK)
}

// Re-exported from evalEngine — see comment there. Used to filter the test's
// own dispatch sessions out of retrieval so memory benchmarks measure real
// memory, not the echo of their own past runs.
import { isSelfDispatchSession } from './evalEngine.js'

async function retrieveSessionHistory(platform: EvalPlatform, q: RetrievalQuery): Promise<MemoryHit[]> {
  const probe = [...q.expectedFacts, ...q.forbiddenFacts, ...q.newerHints]
  const provName = `session-history-${platform}`
  const out: MemoryHit[] = []

  if (platform === 'openclaw') {
    const snap = await ocSnapshot().catch(() => null)
    const sessions = (snap?.sessionsRaw ?? [])
      .filter((s: any) => !isSelfDispatchSession(String(s.key ?? s.id ?? '')))
      .slice(0, 30)
    const keys = sessions.map((s: any) => String(s.key ?? s.id ?? '')).filter(Boolean)
    const histories = keys.length ? await ocHistories(keys, 60).catch(() => ({} as Record<string, any[]>)) : {}
    for (const s of sessions) {
      const key = String(s.key ?? s.id ?? '')
      const msgs = histories[key] ?? []
      for (const m of msgs) {
        const text = extractText(m?.content)
        if (!text) continue
        const matched = matchedSubstrings(text, probe)
        const score = rankScore(text, q)
        if (matched.length === 0 && score === 0) continue
        out.push({
          provider: provName, source: key, score,
          ts: tsOf(m?.timestamp ?? m?.ts ?? null),
          excerpt: excerptAround(text, probe),
          matchedFacts: matched,
        })
      }
    }
  } else {
    const sr = await fetchSessions('hermes')
    const sessions = (sr.ok && sr.data ? sr.data : [])
      .filter((s: any) => !isSelfDispatchSession(String(s.id ?? '')))
      .slice(0, 20)
    for (const s of sessions) {
      const id = String(s.id ?? '')
      if (!id) continue
      const r = await fetchSessionMessages('hermes', id).catch(() => null)
      const msgs = r?.ok && r.data ? r.data : []
      for (const m of msgs) {
        const text = String(m?.content ?? m?.text ?? m?.body ?? m?.message ?? '')
        if (!text) continue
        const matched = matchedSubstrings(text, probe)
        const score = rankScore(text, q)
        if (matched.length === 0 && score === 0) continue
        out.push({
          provider: provName, source: id, score,
          ts: tsOf(m?.timestamp ?? m?.created_at ?? m?.ts ?? null),
          excerpt: excerptAround(text, probe),
          matchedFacts: matched,
        })
      }
    }
  }

  out.sort((a, b) => b.score - a.score)
  return out.slice(0, q.topK)
}

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => {
      if (!b || typeof b !== 'object') return typeof b === 'string' ? b : ''
      const t = String(b.type ?? '').toLowerCase()
      if (t === 'text') return String(b.text ?? '')
      if (t === 'tool_result' || t === 'toolresult') return typeof b.content === 'string' ? b.content : ''
      return String(b.text ?? '')
    }).filter(Boolean).join('\n')
  }
  return ''
}

function tsOf(v: any): string | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v))
  if (!Number.isFinite(n)) return null
  return new Date(n).toISOString()
}

// Run a retrieval query against one provider by name. Unknown provider names
// return an error result rather than silently succeeding.
export async function runProviderRetrieval(platform: EvalPlatform, providerName: string, q: RetrievalQuery): Promise<ProviderRetrieval> {
  const start = Date.now()
  try {
    if (providerName === `workspace-files-${platform}`) {
      const hits = await retrieveWorkspaceFiles(platform, q)
      return { provider: providerName, latencyMs: Date.now() - start, hits, error: null }
    }
    if (providerName === `session-history-${platform}`) {
      const hits = await retrieveSessionHistory(platform, q)
      return { provider: providerName, latencyMs: Date.now() - start, hits, error: null }
    }
    return { provider: providerName, latencyMs: Date.now() - start, hits: [],
      error: `Provider "${providerName}" is declared but not backed by a live integration on ${platform}. Add a real integration before benchmarking it.` }
  } catch (err: any) {
    return { provider: providerName, latencyMs: Date.now() - start, hits: [], error: String(err?.message ?? err).slice(0, 240) }
  }
}

// ─── Applied recall (dispatches the query to the live agent) ──────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function applyOnOpenClaw(query: string, sessionKey: string): Promise<{ answer: string; latencyMs: number; notes: string }> {
  const start = Date.now()
  await ensureConnected(12_000)
  await ocRequest('chat.send', { sessionKey, message: query, deliver: false, idempotencyKey: randomUUID() }, 12_000)
  let lastSig = ''; let stable = 0; let answer = ''
  for (let i = 0; i < 36; i++) {
    await sleep(5000)
    const h = await ocRequest('chat.history', { sessionKey, limit: 30, maxChars: 120_000 }, 10_000).catch(() => null)
    const msgs: any[] = h?.messages ?? []
    const lastAssistant = [...msgs].reverse().find(m => String(m.role) === 'assistant')
    const text = extractText(lastAssistant?.content)
    const sig = `${msgs.length}|${text.slice(-200)}`
    if (sig === lastSig && lastAssistant) { stable++; if (stable >= 2) { answer = text; break } } else { stable = 0; lastSig = sig }
  }
  return { answer, latencyMs: Date.now() - start, notes: answer ? '' : 'Agent returned no response within ~3 minutes.' }
}

async function applyOnHermes(query: string, _sessionId: string): Promise<{ answer: string; latencyMs: number; notes: string }> {
  // Hermes chat lives on the API SERVER (OpenAI-compat, Bearer key), NOT on
  // the operator dashboard. The previous dashboard-path probing was wrong by
  // design — it can only ever 4xx, since /v1 there returns 405.
  const r = await hermesChat(query, { timeoutMs: 180_000 })
  if (!r.ok) {
    throw new Error(
      `Hermes API server (${r.triedUrl}) rejected the applied-recall probe — ${r.error ?? 'unknown'}. ` +
      `Confirm Settings → Hermes → API server URL (default http://127.0.0.1:8642/v1) and the API key.`
    )
  }
  return { answer: r.answer, latencyMs: r.latencyMs, notes: r.answer ? '' : 'Hermes API server returned an empty answer.' }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export const MEMORY_SCORING = {
  weights: {
    retrievalAccuracy:  0.30,
    usageAccuracy:      0.25,
    freshnessScore:     0.10,
    conflictResolution: 0.10,
    latencyScore:       0.05,
    coverageScore:      0.10,
  } as Record<string, number>,
  falseRecallWeight: 0.20,    // penalty multiplier (subtracted from composite)
  latencyTargetMs:   1500,    // <= this → full latency score
  latencyDeadMs:     15000,   // >= this → zero
  confidenceK: 5,
  prior: 50,
}

export const MEMORY_SUBSCORE_LABELS: Record<string, string> = {
  retrievalAccuracy:  'Retrieval Accuracy',
  usageAccuracy:      'Memory Usage Accuracy',
  freshnessScore:     'Freshness Score',
  conflictResolution: 'Conflict Resolution',
  falseRecallPenalty: 'False Recall Penalty',
  latencyScore:       'Latency Score',
  coverageScore:      'Coverage Score',
  composite:          'Composite Memory Score',
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))
const r1 = (v: number) => Math.round(v * 10) / 10

function scoreLatency(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 100
  if (ms <= MEMORY_SCORING.latencyTargetMs) return 100
  if (ms >= MEMORY_SCORING.latencyDeadMs) return 0
  const span = MEMORY_SCORING.latencyDeadMs - MEMORY_SCORING.latencyTargetMs
  return clamp(100 * (1 - (ms - MEMORY_SCORING.latencyTargetMs) / span))
}

// ─── Denial / refusal-of-premise detector (for `negative`-kind tasks) ─────────
//
// Substring matching alone is too dumb for negative-control tasks: an answer
// that *mentions* forbidden facts in order to *reject* the premise (e.g.
// "you literally put her name in the question — you don't have an octopus")
// would be penalized identically to one that *affirms* them ("yes, Marbles
// prefers a pirate ship"). We scan the answer for explicit refusal phrasing
// and, when present, suppress the false-recall penalty for that run.
//
// The pattern list is intentionally conservative — false negatives (missing
// a real refusal) are recoverable by the user editing the rubric, while false
// positives (treating a fabrication as a refusal) would silently hide a real
// scoring failure.
const DENIAL_PATTERNS: RegExp[] = [
  /\bi (don'?t|do not) (have|recall|remember|know|see|find|own)\b/i,
  /\byou (don'?t|do not) (have|own|actually|really)\b/i,
  /\bi (don'?t|do not) have (that|any|the|a|an)\b/i,
  /\bdoesn'?t (have|own|exist|appear|seem)\b/i,
  /\b(is|are|was|were) (not|never) (real|true|a thing|something|stored|recorded)\b/i,
  /\b(never|haven'?t) (had|owned|mentioned|told|said|seen|heard)\b/i,
  /\bno (record|mention|knowledge|memory|information|note|trace|sign) of\b/i,
  /\bas far as i (know|recall|can tell|remember)\b/i,
  /\b(can|could)'?t (confirm|verify|recall|tell|find|locate)\b/i,
  /\b(are you|is this) (testing|joking|kidding|serious|making|sure|trying|trolling)\b/i,
  /\bliterally (put|told|gave|wrote|named|said|included)\b/i,
  /\b(your|the) only (pet|cat|dog|animal|project|task|thing|sprint) (is|was)\b/i,
  /\bin (your|the) (question|prompt|message|query|own words)\b/i,
  /\bno such (thing|pet|animal|record|project|sprint)\b/i,
  /\bthere'?s? no (record|mention|sign|trace|evidence|such)\b/i,
  /\bdid you (just )?(make|invent|put|fabricate)\b/i,
  /\bsecret (pet|cephalopod|cat|dog|project|sprint)\b/i,
  /\bif .{0,40}\*?is\*? (real|actually|a thing)\b/i,
  /\bnothing (about|in (my )?memory|in (the )?record)\b/i,
  /\bi'?m not (aware|sure|tracking|finding|seeing)\b/i,
]

export function detectDenial(answer: string | null | undefined): boolean {
  if (!answer) return false
  return DENIAL_PATTERNS.some(p => p.test(answer))
}

export interface ComputeInput {
  task:           MemoryBenchmarkTask
  retrievals:     ProviderRetrieval[]
  appliedAnswer:  string | null
  totalLatencyMs: number
}

export interface ComputeResult {
  hits: MemoryHit[]
  expectedFound: number
  forbiddenFound: number
  irrelevantHits: number
  answerHasExpected: number
  answerHasForbidden: number
  retrievalAccuracy: number | null
  usageAccuracy: number | null
  freshnessScore: number | null
  conflictResolution: number | null
  falseRecallPenalty: number
  latencyScore: number | null
  coverageScore: number | null
  composite: number
  /** For `negative`-kind runs: did the agent's answer refute the premise?
   *  Used to suppress the false-recall penalty for correct refusals. */
  denialDetected: boolean
  /** Short, human-readable note about the scoring decision (e.g. "refusal
   *  detected — false-recall penalty suppressed"). Appended to run notes. */
  scoringNote: string
}

export function computeRunScores({ task, retrievals, appliedAnswer, totalLatencyMs }: ComputeInput): ComputeResult {
  const allHits = retrievals.flatMap(r => r.hits)

  // Distinct expected facts retrieved across all providers.
  const expectedFound = new Set<string>()
  const forbiddenFoundSet = new Set<string>()
  for (const h of allHits) {
    for (const m of h.matchedFacts) {
      if (task.expectedFacts.includes(m)) expectedFound.add(m)
      if (task.forbiddenFacts.includes(m)) forbiddenFoundSet.add(m)
    }
  }
  const irrelevantHits = allHits.filter(h => h.matchedFacts.length === 0).length

  // Agent answer analysis (applied-recall path).
  const answerHasExpectedSet = appliedAnswer
    ? new Set(matchedSubstrings(appliedAnswer, task.expectedFacts)) : new Set<string>()
  const answerHasForbiddenSet = appliedAnswer
    ? new Set(matchedSubstrings(appliedAnswer, task.forbiddenFacts)) : new Set<string>()

  // For negative-control tasks, the agent's answer is judged on whether it
  // *refuses* the premise. We detect that with the DENIAL_PATTERNS heuristic
  // so a refutation that quotes the forbidden facts to reject them isn't
  // mistaken for a fabrication.
  const denialDetected = task.kind === 'negative' && detectDenial(appliedAnswer)
  const scoringNoteParts: string[] = []
  if (task.kind === 'negative' && appliedAnswer != null) {
    scoringNoteParts.push(denialDetected
      ? 'refusal detected — agent refuted the premise; false-recall penalty suppressed'
      : 'no explicit refusal detected — forbidden-fact mentions counted as fabrication')
  }

  // Retrieval accuracy = expectedFound / expectedTotal (null if no expectedFacts).
  const retrievalAccuracy = task.expectedFacts.length > 0
    ? r1((expectedFound.size / task.expectedFacts.length) * 100) : null

  // Usage accuracy:
  //  - For `negative` tasks the "usage" semantic is "did the agent correctly
  //    refuse?" — so 100 when denial detected, 0 when not (and an answer exists).
  //  - For other kinds, it's the standard expected-facts-in-answer ratio.
  let usageAccuracy: number | null = null
  if (appliedAnswer != null) {
    if (task.kind === 'negative') {
      usageAccuracy = denialDetected ? 100 : 0
    } else if (task.expectedFacts.length > 0) {
      usageAccuracy = r1((answerHasExpectedSet.size / task.expectedFacts.length) * 100)
    }
  }

  // Freshness: when newerHints are provided, reward top-ranked hits that
  // include them. Null when no newerHints declared.
  let freshnessScore: number | null = null
  if (task.newerHints.length > 0 && allHits.length > 0) {
    const topHits = allHits.slice(0, Math.min(5, allHits.length))
    let hitsWithNewer = 0
    for (const h of topHits) {
      for (const n of task.newerHints) if (h.excerpt.toLowerCase().includes(n.toLowerCase())) { hitsWithNewer++; break }
    }
    freshnessScore = r1((hitsWithNewer / topHits.length) * 100)
  }

  // Conflict resolution: applied-only — reward agent for using expected (canonical)
  // memory and not the forbidden (stale/conflicting) one. Null when kind != conflict
  // or when there's no answer to score.
  let conflictResolution: number | null = null
  if (task.kind === 'conflict' && appliedAnswer != null) {
    const usedExp = task.expectedFacts.length > 0 && answerHasExpectedSet.size > 0
    const usedFor = task.forbiddenFacts.length > 0 && answerHasForbiddenSet.size > 0
    conflictResolution = usedExp && !usedFor ? 100 : usedExp && usedFor ? 50 : usedFor ? 0 : 50
  }

  // False recall penalty:
  //  - For kind='negative' WITHOUT a detected denial: count expectedFacts the
  //    agent fabricated (rare since expectedFacts is usually empty here) +
  //    forbiddenFacts repeated in the answer.
  //  - For kind='negative' WITH a detected denial: skip both — quoting the
  //    forbidden terms inside a refutation is correct behavior.
  //  - For all other kinds: forbiddenFacts in the answer always incur penalty.
  let penalty = 0
  if (appliedAnswer != null) {
    const negativeWithoutDenial = task.kind === 'negative' && !denialDetected
    if (negativeWithoutDenial && task.expectedFacts.length > 0) {
      penalty += (answerHasExpectedSet.size / task.expectedFacts.length) * 100
    }
    const suppressForbiddenAnswerPenalty = task.kind === 'negative' && denialDetected
    if (task.forbiddenFacts.length > 0 && !suppressForbiddenAnswerPenalty) {
      penalty += (answerHasForbiddenSet.size / task.forbiddenFacts.length) * 100
    }
  }
  // Retrieval-layer false positives (forbidden facts surfaced as top hits)
  // still apply even when the agent denied — the memory layer itself
  // shouldn't be returning them.
  if (task.forbiddenFacts.length > 0 && forbiddenFoundSet.size > 0) {
    penalty += (forbiddenFoundSet.size / task.forbiddenFacts.length) * 25
  }
  const falseRecallPenalty = clamp(r1(penalty))

  // Latency score from the total elapsed time of the run.
  const latencyScore = r1(scoreLatency(totalLatencyMs))

  // Coverage = providers that returned at least one hit / providers attempted.
  const coverageScore = retrievals.length > 0
    ? r1((retrievals.filter(r => r.hits.length > 0).length / retrievals.length) * 100) : null

  // Composite: weighted average over available sub-scores, then subtract the
  // false-recall penalty (capped to keep the score in 0..100).
  const subDefs: Array<[string, number | null]> = [
    ['retrievalAccuracy', retrievalAccuracy],
    ['usageAccuracy', usageAccuracy],
    ['freshnessScore', freshnessScore],
    ['conflictResolution', conflictResolution],
    ['latencyScore', latencyScore],
    ['coverageScore', coverageScore],
  ]
  const avail = subDefs.filter(([, v]) => v != null) as Array<[string, number]>
  const wsum = avail.reduce((s, [k]) => s + (MEMORY_SCORING.weights[k] ?? 0), 0)
  const raw = wsum > 0 ? avail.reduce((s, [k, v]) => s + v * (MEMORY_SCORING.weights[k] ?? 0), 0) / wsum : MEMORY_SCORING.prior
  const composite = Math.round(clamp(raw - falseRecallPenalty * MEMORY_SCORING.falseRecallWeight))

  return {
    hits: allHits,
    expectedFound: expectedFound.size,
    forbiddenFound: forbiddenFoundSet.size,
    irrelevantHits,
    answerHasExpected: answerHasExpectedSet.size,
    answerHasForbidden: answerHasForbiddenSet.size,
    retrievalAccuracy, usageAccuracy, freshnessScore, conflictResolution,
    falseRecallPenalty, latencyScore, coverageScore, composite,
    denialDetected, scoringNote: scoringNoteParts.join(' · '),
  }
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const APPLIED_KINDS = new Set(['applied', 'conflict', 'multihop', 'negative'])

/**
 * Status rules for a completed memory run. Extracted from executeMemoryRun
 * so the predicate is testable in isolation without standing up a live
 * gateway. Returns the run.status value to persist:
 *  - 'failure':    negative-kind run where the agent answered without
 *                  refusing and either echoed forbidden facts or had usage=0;
 *                  also any run with no signal at all.
 *  - 'unresolved': applied-kind run where the agent returned an empty answer.
 *  - 'success':    composite > 0 and nothing in the failure/unresolved branches.
 */
export function determineMemoryRunStatus(
  task: Pick<MemoryBenchmarkTask, 'kind' | 'forbiddenFacts'>,
  scored: Pick<ComputeResult, 'composite' | 'denialDetected' | 'answerHasForbidden' | 'usageAccuracy' | 'hits'>,
  appliedAnswer: string | null,
): 'success' | 'failure' | 'unresolved' {
  const fabricatedNegative = task.kind === 'negative'
    && appliedAnswer != null
    && !scored.denialDetected
    && (scored.answerHasForbidden > 0 || (task.forbiddenFacts.length === 0 && scored.usageAccuracy === 0))
  const emptyApplied = APPLIED_KINDS.has(task.kind) && appliedAnswer != null && !appliedAnswer.trim()
  const noSignal = scored.composite === 0 && appliedAnswer == null && scored.hits.length === 0

  if (fabricatedNegative) return 'failure'
  if (emptyApplied)       return 'unresolved'
  if (noSignal)           return 'failure'
  return scored.composite > 0 ? 'success' : 'unresolved'
}

/**
 * Synchronously persist a "running" placeholder row for a memory benchmark
 * dispatch. Called by the route BEFORE returning 202 so the row exists in the
 * DB by the time the client polls — no race window where the UI shows nothing.
 */
export function prepareMemoryRun(task: MemoryBenchmarkTask, opts?: { model?: string; agent?: string }): MemoryBenchmarkRun {
  const platform = task.platform
  const agent = (opts?.agent ?? task.agent ?? '').trim() || (platform === 'openclaw' ? 'main' : 'hermes')
  const declaredModel = (opts?.model ?? '').trim() || 'unknown'
  return createMemoryRun({
    taskId: task.id, platform, agent, model: declaredModel, status: 'running',
    providersUsed: [], hits: [], expectedFound: 0, expectedTotal: task.expectedFacts.length,
    forbiddenFound: 0, irrelevantHits: 0, agentAnswer: null,
    answerHasExpected: 0, answerHasForbidden: 0,
    retrievalAccuracy: null, usageAccuracy: null, freshnessScore: null, conflictResolution: null,
    falseRecallPenalty: 0, latencyScore: null, coverageScore: null,
    composite: 0, latencyMs: 0, notes: 'Memory benchmark in progress…',
    denialDetected: false, scoringNote: '',
  })
}

/**
 * Execute the actual retrieval + applied-recall + scoring for a memory run and
 * patch the placeholder row with the final outcome. Safe to call after the
 * route has already returned 202 — errors are captured into the run's notes
 * so the UI surfaces them via the existing diagnostic toggle.
 */
export async function executeMemoryRun(
  task: MemoryBenchmarkTask, placeholder: MemoryBenchmarkRun,
  opts?: { model?: string; agent?: string },
): Promise<MemoryBenchmarkRun> {
  const start = Date.now()
  const platform = task.platform
  const agent = placeholder.agent
  const declaredModel = placeholder.model && placeholder.model !== 'unknown' ? placeholder.model
    : ((opts?.model ?? '').trim() || 'unknown')

  // Provider scope: task may pin specific providers; otherwise probe all detected.
  const detected = await detectProviders(platform)
  const providerNames = task.providers.length > 0 ? task.providers : detected.map(p => p.name)

  const q: RetrievalQuery = {
    query: task.query,
    expectedFacts: task.expectedFacts,
    forbiddenFacts: task.forbiddenFacts,
    newerHints: task.newerHints,
    topK: 5,
  }

  // Pure retrieval first — measure the memory layer itself.
  const retrievals: ProviderRetrieval[] = []
  for (const name of providerNames) {
    retrievals.push(await runProviderRetrieval(platform, name, q))
  }

  // Optionally dispatch applied-recall: ask the live agent the query and
  // capture its final answer to score memory *usage*, not just retrieval.
  let appliedAnswer: string | null = null
  let appliedNotes = ''
  if (APPLIED_KINDS.has(task.kind)) {
    if (!isLive(platform)) {
      appliedNotes = `Applied recall skipped: ${platform} not connected.`
    } else {
      const runStamp = Date.now().toString(36)
      const sessionKey = platform === 'openclaw'
        ? `agent:${agent}:dashboard-memory:${task.id.slice(0, 8)}-${runStamp}`
        : `dashboard-memory-${task.id.slice(0, 8)}-${runStamp}`
      try {
        const r = platform === 'openclaw'
          ? await applyOnOpenClaw(task.query, sessionKey)
          : await applyOnHermes(task.query, sessionKey)
        appliedAnswer = r.answer
        appliedNotes  = r.notes
        // Try to recover the model the gateway used for this session.
        try {
          const metrics = await getPlatformMetrics(platform)
          const row = metrics.sessionList.find(s => s.key === sessionKey)
          if (row?.model) opts = { ...opts, model: row.model }
        } catch { /* keep declared */ }
      } catch (err: any) {
        appliedNotes = `Applied-recall failed: ${String(err?.message ?? err).slice(0, 1000)}`
      }
    }
  }

  const totalLatencyMs = Date.now() - start
  const scored = computeRunScores({ task, retrievals, appliedAnswer, totalLatencyMs })

  const provErrs = retrievals.filter(r => r.error).map(r => `${r.provider}: ${r.error}`).join('; ')
  // scored.scoringNote captures kind-specific scoring decisions (e.g. refusal
  // detected on a negative-control task) so the drilldown explains why the
  // composite landed where it did instead of looking like an arbitrary number.
  const noteParts = [scored.scoringNote, appliedNotes, provErrs].filter(Boolean)

  const status = determineMemoryRunStatus(task, scored, appliedAnswer)

  const final: Partial<MemoryBenchmarkRun> = {
    model: (opts?.model && opts.model.trim()) || declaredModel,
    status,
    providersUsed: retrievals.map(r => r.provider),
    hits: scored.hits,
    expectedFound: scored.expectedFound, expectedTotal: task.expectedFacts.length,
    forbiddenFound: scored.forbiddenFound, irrelevantHits: scored.irrelevantHits,
    agentAnswer: appliedAnswer,
    answerHasExpected: scored.answerHasExpected,
    answerHasForbidden: scored.answerHasForbidden,
    retrievalAccuracy: scored.retrievalAccuracy,
    usageAccuracy: scored.usageAccuracy,
    freshnessScore: scored.freshnessScore,
    conflictResolution: scored.conflictResolution,
    falseRecallPenalty: scored.falseRecallPenalty,
    latencyScore: scored.latencyScore,
    coverageScore: scored.coverageScore,
    composite: scored.composite, latencyMs: totalLatencyMs,
    notes: noteParts.join(' | ').slice(0, 1500),
    // Persist negative-control telemetry separately from `notes` so the UI can
    // render a refusal badge + reason without parsing free-text diagnostics.
    denialDetected: scored.denialDetected,
    scoringNote: scored.scoringNote,
    ts: new Date().toISOString(),
  }
  const updated = updateMemoryRun(placeholder.id, final)
  return updated ?? { ...placeholder, ...final } as MemoryBenchmarkRun
}

// ─── Aggregations / overview ──────────────────────────────────────────────────

const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
}

function confidence(n: number): number {
  return r1((1 - Math.exp(-n / MEMORY_SCORING.confidenceK)) * 100)
}

export interface MemoryScorecard {
  scope:     string                // 'model:gpt-…' / 'provider:workspace-…' / 'agent:main'
  label:     string
  runCount:  number
  composite: number
  subScores: Record<string, number | null>
  falseRecallPenalty: number
  confidence: number
  consistency: number | null
  trend:      Array<{ ts: string; composite: number }>
}

function aggregate(runs: MemoryBenchmarkRun[], scope: string, label: string, snapshots: MemoryScoreSnapshot[]): MemoryScorecard {
  const keys: Array<keyof MemoryBenchmarkRun> = [
    'retrievalAccuracy', 'usageAccuracy', 'freshnessScore', 'conflictResolution', 'latencyScore', 'coverageScore',
  ]
  const sub: Record<string, number | null> = {}
  for (const k of keys) {
    const vals = runs.map(r => r[k] as number | null).filter(v => v != null) as number[]
    sub[k] = vals.length ? r1(vals.reduce((s, v) => s + v, 0) / vals.length) : null
  }
  const composites = runs.map(r => r.composite)
  const compositeAvg = composites.length ? Math.round(composites.reduce((s, v) => s + v, 0) / composites.length) : 0
  const falseRecall = runs.length ? r1(runs.reduce((s, r) => s + r.falseRecallPenalty, 0) / runs.length) : 0
  const conf = confidence(runs.length)
  // Confidence shrinkage toward neutral prior — sample size matters.
  const shrink = 0.35 + 0.65 * (conf / 100)
  const composite = Math.round(clamp(MEMORY_SCORING.prior + (compositeAvg - MEMORY_SCORING.prior) * shrink))
  const consistency = composites.length >= 2 ? Math.round(clamp(100 - stdev(composites))) : null
  const trend = snapshots.map(s => ({ ts: s.ts, composite: s.composite }))
  return { scope, label, runCount: runs.length, composite, subScores: sub, falseRecallPenalty: falseRecall, confidence: conf, consistency, trend }
}

export interface ProviderComparison {
  provider:   string
  type:       MemoryProviderType
  baseline:   boolean
  runs:       number
  retrievalAccuracy: number | null
  freshnessScore:    number | null
  falsePositives:    number | null
  avgLatencyMs:      number
}

export interface MemoryOverview {
  platform:   EvalPlatform
  reachable:  boolean
  error:      string | null
  fetchedAt:  string
  providers:  MemoryProviderInfo[]
  summary: {
    runCount: number
    avgComposite: number | null
    avgRetrieval: number | null
    avgUsage: number | null
    avgFalseRecall: number | null
    bestModel: { scope: string; composite: number } | null
    bestProvider: { scope: string; composite: number } | null
  }
  modelLeaderboard:    MemoryScorecard[]
  providerLeaderboard: MemoryScorecard[]
  agentLeaderboard:    MemoryScorecard[]
  providerComparison:  ProviderComparison[]
  recentRuns:          MemoryBenchmarkRun[]
}

export async function buildMemoryOverview(platform: EvalPlatform, opts?: { snapshot?: boolean }): Promise<MemoryOverview> {
  const fetchedAt = new Date().toISOString()
  const reachable = isLive(platform)
  if (!reachable) {
    return {
      platform, reachable: false, error: 'not connected — add a token in Settings', fetchedAt,
      providers: [],
      summary: { runCount: 0, avgComposite: null, avgRetrieval: null, avgUsage: null, avgFalseRecall: null, bestModel: null, bestProvider: null },
      modelLeaderboard: [], providerLeaderboard: [], agentLeaderboard: [], providerComparison: [], recentRuns: [],
    }
  }
  const providers = await detectProviders(platform)
  // Keep every row visible to the UI (so "running" placeholders surface and
  // the polling loop kicks in), but exclude in-flight rows from leaderboard
  // aggregation — their composite is 0 and would tank averages.
  const allRuns = listMemoryRuns({ platform })
  const runs = allRuns.filter(r => r.status !== 'running')

  // Per-model rollup.
  const byModel = new Map<string, MemoryBenchmarkRun[]>()
  for (const r of runs) { const a = byModel.get(r.model) ?? []; a.push(r); byModel.set(r.model, a) }
  const modelLeaderboard = [...byModel.entries()].map(([model, rs]) =>
    aggregate(rs, `model:${model}`, model, listMemorySnapshots(platform, `model:${model}`))
  ).sort((a, b) => b.composite - a.composite)

  // Per-provider rollup (a run is attributed to each provider it queried).
  const byProvider = new Map<string, MemoryBenchmarkRun[]>()
  for (const r of runs) for (const p of r.providersUsed) {
    const a = byProvider.get(p) ?? []; a.push(r); byProvider.set(p, a)
  }
  const providerLeaderboard = [...byProvider.entries()].map(([p, rs]) =>
    aggregate(rs, `provider:${p}`, providers.find(d => d.name === p)?.label ?? p, listMemorySnapshots(platform, `provider:${p}`))
  ).sort((a, b) => b.composite - a.composite)

  // Per-agent rollup.
  const byAgent = new Map<string, MemoryBenchmarkRun[]>()
  for (const r of runs) { const a = byAgent.get(r.agent) ?? []; a.push(r); byAgent.set(r.agent, a) }
  const agentLeaderboard = [...byAgent.entries()].map(([agent, rs]) =>
    aggregate(rs, `agent:${agent}`, agent, listMemorySnapshots(platform, `agent:${agent}`))
  ).sort((a, b) => b.composite - a.composite)

  // Provider comparison view: per-provider retrieval/freshness/latency/false-positives.
  const providerComparison: ProviderComparison[] = []
  for (const [p, rs] of byProvider) {
    const info = providers.find(d => d.name === p)
    const ret = rs.map(r => r.retrievalAccuracy).filter((v): v is number => v != null)
    const fresh = rs.map(r => r.freshnessScore).filter((v): v is number => v != null)
    const fp = rs.map(r => r.forbiddenFound + r.irrelevantHits)
    providerComparison.push({
      provider: p,
      type: info?.type ?? 'other',
      baseline: info?.baseline ?? false,
      runs: rs.length,
      retrievalAccuracy: ret.length ? r1(ret.reduce((s, v) => s + v, 0) / ret.length) : null,
      freshnessScore:    fresh.length ? r1(fresh.reduce((s, v) => s + v, 0) / fresh.length) : null,
      falsePositives:    rs.length ? r1(fp.reduce((s, v) => s + v, 0) / rs.length) : null,
      avgLatencyMs: rs.length ? Math.round(rs.reduce((s, r) => s + r.latencyMs, 0) / rs.length) : 0,
    })
  }
  providerComparison.sort((a, b) => (b.retrievalAccuracy ?? -1) - (a.retrievalAccuracy ?? -1))

  // Snapshot (throttled to once/day per scope) — feeds the trend.
  if (opts?.snapshot) {
    const dayMs = 86_400_000
    const persistIfStale = (scope: string, card: MemoryScorecard) => {
      const last = listMemorySnapshots(platform, scope).slice(-1)[0]
      if (!last || Date.now() - new Date(last.ts).getTime() > dayMs) {
        saveMemorySnapshot({ platform, scope, composite: card.composite, subScores: card.subScores, runCount: card.runCount })
      }
    }
    for (const c of modelLeaderboard)    persistIfStale(c.scope, c)
    for (const c of providerLeaderboard) persistIfStale(c.scope, c)
  }

  const composites = runs.map(r => r.composite)
  const retrievals = runs.map(r => r.retrievalAccuracy).filter((v): v is number => v != null)
  const usages     = runs.map(r => r.usageAccuracy).filter((v): v is number => v != null)
  const falses     = runs.map(r => r.falseRecallPenalty)

  return {
    platform, reachable: true, error: null, fetchedAt,
    providers,
    summary: {
      runCount: runs.length,
      avgComposite: composites.length ? Math.round(composites.reduce((s, v) => s + v, 0) / composites.length) : null,
      avgRetrieval: retrievals.length ? r1(retrievals.reduce((s, v) => s + v, 0) / retrievals.length) : null,
      avgUsage:     usages.length ? r1(usages.reduce((s, v) => s + v, 0) / usages.length) : null,
      avgFalseRecall: falses.length ? r1(falses.reduce((s, v) => s + v, 0) / falses.length) : null,
      bestModel:    modelLeaderboard[0] ? { scope: modelLeaderboard[0].label, composite: modelLeaderboard[0].composite } : null,
      bestProvider: providerLeaderboard[0] ? { scope: providerLeaderboard[0].label, composite: providerLeaderboard[0].composite } : null,
    },
    modelLeaderboard, providerLeaderboard, agentLeaderboard, providerComparison,
    // Running rows first so the in-flight placeholders are immediately visible
    // in the per-task drilldown — then most recent completed runs.
    recentRuns: [
      ...allRuns.filter(r => r.status === 'running'),
      ...runs,
    ].slice(0, 30),
  }
}

// ─── Methodology (transparent rules) ──────────────────────────────────────────

export function memoryMethodology() {
  return {
    overview: 'Memory benchmarking measures how well each platform / agent / model recalls, uses, and resists fabricating stored memory. Providers are detected from real platform state (workspace memory files + session-history transcripts on Hermes and OpenClaw). External providers (Mem0, vector DB, Obsidian, …) are supported in the data model but only appear once a real integration exposes them — no placeholder providers are seeded.',
    kinds: [
      { key: 'recall',    label: 'Direct fact recall',   detail: 'Probe providers for a known fact substring.' },
      { key: 'multihop',  label: 'Multi-hop recall',     detail: 'Combine two or more stored facts; agent must use both.' },
      { key: 'temporal',  label: 'Temporal recall',      detail: 'Prefer the newest matching fact via newerHints.' },
      { key: 'conflict',  label: 'Conflict resolution',  detail: 'Expected fact is canonical; forbidden fact is stale/conflicting — agent must pick the canonical one.' },
      { key: 'applied',   label: 'Applied memory usage', detail: 'Send the query to the live agent; score whether expected facts appear in the answer.' },
      { key: 'negative',  label: 'False-memory resistance', detail: 'Probe for facts NOT in memory. Scoring is refusal-aware: the engine detects denial / refutation language and, when present, suppresses the false-recall penalty for forbidden-fact mentions inside the refutation. Quoting the premise to reject it is correct behavior, not fabrication.' },
    ],
    subScores: Object.entries(MEMORY_SUBSCORE_LABELS).map(([key, label]) => ({
      key, label, weight: MEMORY_SCORING.weights[key] ?? (key === 'falseRecallPenalty' ? -MEMORY_SCORING.falseRecallWeight : 0),
    })),
    weights: MEMORY_SCORING.weights,
    composition: [
      'Each sub-score is 0–100; unavailable sub-scores are dropped and the remaining weights are re-normalized.',
      `False-recall penalty (forbidden facts in the answer / hallucinated memory in negative-control tasks) is subtracted from the composite at weight ${MEMORY_SCORING.falseRecallWeight}.`,
      `Latency: <= ${MEMORY_SCORING.latencyTargetMs}ms scores 100, >= ${MEMORY_SCORING.latencyDeadMs}ms scores 0.`,
      `Sample-size confidence: 1 − e^(−n/${MEMORY_SCORING.confidenceK}); composite is pulled toward the neutral prior of ${MEMORY_SCORING.prior} for low-volume scopes.`,
      'Retrieval is measured by case-insensitive substring matches of declared expectedFacts inside provider results — heuristic but verifiable and explicit.',
      'Negative-control refusal handling: a heuristic scans the agent answer for denial / refutation language ("I don\'t have", "you don\'t have an X", "no record of", "literally put it in the question", etc.). When a refusal is detected, forbidden-fact mentions inside the refutation are NOT counted as false recall, and "Memory Usage" is treated as 100 (correct refusal). Without a refusal, forbidden facts in the answer apply the standard penalty. Every negative-kind run records which branch fired in its notes.',
    ],
    config: MEMORY_SCORING,
  }
}
