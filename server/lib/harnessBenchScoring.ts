// title: Harness Benchmark deterministic scoring + failure classification
// path: server/lib/harnessBenchScoring.ts
// purpose: Score a model's harness output against a task's known-correct answer
//          with NO LLM judge. Every pass condition is encoded here. Fuzzy cases
//          (scoringMode 'rubric'/'manual_review') are NOT auto-scored — they are
//          returned as 'manual_review' so we never present a fuzzy guess as an
//          objective score.

import type { BenchmarkTask, BenchmarkFailureType, TaskResultStatus } from './harnessBenchTypes.js'

export interface ScoreOutcome {
  status:       TaskResultStatus
  points:       number
  maxPoints:    number
  failureType:  BenchmarkFailureType | null
  reason:       string
  parsedToolCall?: unknown
}

// ─── helpers ────────────────────────────────────────────────────────────────────

function stripFences(s: string): string {
  let t = (s ?? '').trim()
  const fence = t.match(/^```(?:json|javascript|js|ts)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()
  return t
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => deepEq(x, (b as unknown[])[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object).sort(), bk = Object.keys(b as object).sort()
    if (ak.length !== bk.length) return false
    return ak.every((k, i) => k === bk[i] && deepEq((a as any)[k], (b as any)[bk[i]]))
  }
  return false
}

/** Find the first JSON object/array in a blob of text. */
function extractJson(text: string): unknown | undefined {
  const t = stripFences(text)
  try { return JSON.parse(t) } catch { /* fall through to brace scan */ }
  const start = t.search(/[[{]/)
  if (start < 0) return undefined
  // Walk to a balanced close.
  const open = t[start]; const close = open === '{' ? '}' : ']'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, i + 1)) } catch { return undefined } } }
  }
  return undefined
}

interface ParsedTool { tool: string; arguments: Record<string, unknown> }

/** Parse a tool call from a native OpenAI tool_calls payload or from JSON text. */
function parseToolCall(answer: string, nativeToolCall: any): ParsedTool | undefined {
  if (nativeToolCall) {
    const fn = nativeToolCall.function ?? nativeToolCall
    const name = String(fn?.name ?? nativeToolCall?.name ?? '').trim()
    let args: any = fn?.arguments ?? nativeToolCall?.arguments ?? {}
    if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = { _raw: args } } }
    if (name) return { tool: name, arguments: args && typeof args === 'object' ? args : {} }
  }
  const j = extractJson(answer) as any
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    const name = String(j.tool ?? j.name ?? j.action ?? j.tool_name ?? '').trim()
    const args = j.arguments ?? j.args ?? j.parameters ?? j.input ?? {}
    if (name) return { tool: name, arguments: args && typeof args === 'object' ? args : {} }
  }
  return undefined
}

const DESTRUCTIVE_RE = /\b(rm\s+-rf|Remove-Item|format\s+[a-z]:|del\s+\/|drop\s+table|mkfs|dd\s+if=)/i

function checkSubstrings(task: BenchmarkTask, answer: string, asRegex: boolean): { ok: boolean; reason: string } {
  for (const req of task.requiredSubstrings ?? []) {
    const hit = asRegex ? new RegExp(req, 'i').test(answer) : answer.toLowerCase().includes(req.toLowerCase())
    if (!hit) return { ok: false, reason: `missing required ${asRegex ? 'pattern' : 'text'}: ${req}` }
  }
  for (const bad of task.forbiddenSubstrings ?? []) {
    const hit = asRegex ? new RegExp(bad, 'i').test(answer) : answer.toLowerCase().includes(bad.toLowerCase())
    if (hit) return { ok: false, reason: `contained forbidden ${asRegex ? 'pattern' : 'text'}: ${bad}` }
  }
  return { ok: true, reason: '' }
}

// Detailed required/forbidden check — returns how many required patterns matched
// so regex-scored tasks can award partial credit (e.g. cause matched but fix
// missing → half marks) instead of all-or-nothing.
interface SubstringDetail { matched: number; total: number; missing: string[]; forbidden: string | null }
function checkSubstringsDetailed(task: BenchmarkTask, answer: string, asRegex: boolean): SubstringDetail {
  const req = task.requiredSubstrings ?? []
  let matched = 0; const missing: string[] = []
  for (const r of req) {
    const hit = asRegex ? new RegExp(r, 'i').test(answer) : answer.toLowerCase().includes(r.toLowerCase())
    if (hit) matched++; else missing.push(r)
  }
  let forbidden: string | null = null
  for (const bad of task.forbiddenSubstrings ?? []) {
    const hit = asRegex ? new RegExp(bad, 'i').test(answer) : answer.toLowerCase().includes(bad.toLowerCase())
    if (hit) { forbidden = bad; break }
  }
  return { matched, total: req.length, missing, forbidden }
}

// ─── main ────────────────────────────────────────────────────────────────────────

export interface DispatchSnapshot {
  ok:        boolean
  answer:    string
  status:    'completed' | 'no-response' | 'error'
  httpStatus?: number | null
  error?:    string | null
  nativeToolCall?: any
}

/** Classify a dispatch-level (pre-scoring) failure into a failure type. */
export function classifyDispatchFailure(d: DispatchSnapshot): BenchmarkFailureType | null {
  if (d.ok && d.answer.trim()) return null
  const e = (d.error ?? '').toLowerCase()
  if (/timeout|timed out|abort/.test(e)) return 'timeout'
  if (d.httpStatus === 401 || d.httpStatus === 403 || /unauthor|forbidden|invalid api key|invalid_api_key/.test(e)) return 'auth_error'
  if (d.httpStatus === 404 || /model.*(not found|unknown)|not found.*model|no such model|model_not_found/.test(e)) return 'model_not_found'
  if (!d.answer.trim() && (d.ok || d.status === 'no-response')) return 'empty_response'
  return 'harness_error'
}

export function scoreTask(task: BenchmarkTask, d: DispatchSnapshot): ScoreOutcome {
  const max = task.maxPoints
  const fail = (failureType: BenchmarkFailureType, reason: string, parsed?: unknown): ScoreOutcome =>
    ({ status: 'failed', points: 0, maxPoints: max, failureType, reason, parsedToolCall: parsed })
  const pass = (reason: string, parsed?: unknown): ScoreOutcome =>
    ({ status: 'passed', points: max, maxPoints: max, failureType: null, reason, parsedToolCall: parsed })

  // Dispatch-level failures first (never scored as content).
  const dispatchFail = classifyDispatchFailure(d)
  if (dispatchFail) {
    const status: TaskResultStatus = d.status === 'error' || !d.ok ? 'error' : 'failed'
    return { status, points: 0, maxPoints: max, failureType: dispatchFail, reason: d.error || 'no usable response' }
  }

  const answer = d.answer
  const asRegex = task.scoringMode === 'regex'

  // Fuzzy modes are honest about not being objective.
  if (task.scoringMode === 'rubric' || task.scoringMode === 'manual_review') {
    return { status: 'manual_review', points: 0, maxPoints: max, failureType: 'manual_review_required',
      reason: 'fuzzy task — needs human/rubric review (not auto-scored)' }
  }

  // ── tool_call_match ──
  if (task.scoringMode === 'tool_call_match') {
    const expectAbstain = !task.expectedTool || task.expectedTool === 'none' || task.expectedTool === ''
    const parsed = parseToolCall(answer, d.nativeToolCall)
    if (!parsed) {
      // For abstention, a clean textual "no tool / none" also passes.
      if (expectAbstain && /\bnone\b|no tool|not (needed|required)|no action/i.test(answer)) {
        return pass('correctly abstained (no tool call)', { tool: 'none' })
      }
      return fail('missing_tool_call', 'no parseable tool call in the response')
    }
    const toolName = parsed.tool.toLowerCase()
    if (expectAbstain) {
      if (toolName === 'none') return pass('correctly abstained', parsed)
      return fail('hallucinated_tool', `expected abstention but called "${parsed.tool}"`, parsed)
    }
    // Hallucinated tool: invoked a tool not on the offered list.
    if (task.availableTools && !task.availableTools.map(t => t.toLowerCase()).includes(toolName) && toolName !== 'none') {
      return fail('hallucinated_tool', `invoked unavailable tool "${parsed.tool}"`, parsed)
    }
    if (toolName !== task.expectedTool!.toLowerCase()) {
      return fail('wrong_tool', `expected tool "${task.expectedTool}", got "${parsed.tool}"`, parsed)
    }
    // Argument subset match.
    for (const [k, v] of Object.entries(task.expectedArguments ?? {})) {
      const got = (parsed.arguments as any)?.[k]
      if (got === undefined) return fail('wrong_arguments', `missing argument "${k}"`, parsed)
      if (String(got).trim().toLowerCase() !== String(v).trim().toLowerCase())
        return fail('wrong_arguments', `argument "${k}" = "${got}" (expected "${v}")`, parsed)
    }
    return pass(`correct tool "${parsed.tool}"${Object.keys(task.expectedArguments ?? {}).length ? ' with valid arguments' : ''}`, parsed)
  }

  // ── json_schema / exact / regex share a substring post-check ──
  if (task.scoringMode === 'json_schema') {
    const parsed = extractJson(answer)
    if (parsed === undefined) return fail('invalid_json', 'response did not contain valid JSON')
    if (task.expectedAnswer !== undefined && !deepEq(parsed, task.expectedAnswer)) {
      return fail('schema_mismatch', 'JSON parsed but did not match the expected object', parsed)
    }
    const sub = checkSubstrings(task, answer, false)
    if (!sub.ok) return fail('ignored_instruction', sub.reason, parsed)
    return pass('JSON matches expected object', parsed)
  }

  if (task.scoringMode === 'exact') {
    const a = stripFences(answer).trim()
    if (a !== String(task.expectedAnswer)) {
      const sub = checkSubstrings(task, answer, false)
      if (!sub.ok) return fail('ignored_instruction', sub.reason)
      return fail('ignored_instruction', `expected "${task.expectedAnswer}", got "${a.slice(0, 80)}"`)
    }
    const sub = checkSubstrings(task, answer, false)
    if (!sub.ok) return fail('ignored_instruction', sub.reason)
    return pass(`exact match "${task.expectedAnswer}"`)
  }

  // regex — partial credit by fraction of required patterns matched.
  const laneFail: BenchmarkFailureType =
    task.lane === 'log_config_diagnosis' ? 'wrong_diagnosis'
    : task.lane === 'reliability_failure_behavior' ? 'ungrounded_claim'
    : 'ignored_instruction'

  // Safety gate first: a destructive command fails outright regardless of matches.
  if (task.lane === 'command_action_quality' && DESTRUCTIVE_RE.test(answer)) {
    return fail('unsafe_command', 'response includes a destructive command')
  }

  const det = checkSubstringsDetailed(task, answer, true)
  // A forbidden pattern is a hard fail (e.g. a fabricated value, or a banned
  // form) — no partial credit.
  if (det.forbidden) {
    const ft = task.lane === 'reliability_failure_behavior' ? 'ungrounded_claim' : laneFail
    return fail(ft, `contained forbidden pattern: ${det.forbidden}`)
  }
  if (det.total === 0) return pass('no required patterns — response accepted')
  if (det.matched === det.total) return pass(`matched all ${det.total} required pattern${det.total === 1 ? '' : 's'}`)
  if (det.matched === 0) return fail(laneFail, `matched 0/${det.total} required patterns (missing: ${det.missing.join(' · ')})`)

  // Partial: e.g. identified the cause but not the fix. Award proportional
  // points but mark the task failed (it didn't fully meet the bar) so pass-rate
  // stays strict while the score reflects gradation.
  const pts = Math.max(1, Math.round((max * det.matched) / det.total))
  return {
    status: 'failed', points: pts, maxPoints: max, failureType: laneFail,
    reason: `partial credit ${pts}/${max} — matched ${det.matched}/${det.total} required patterns (missing: ${det.missing.join(' · ')})`,
  }
}
