// title: Pure transforms — synthesize model strengths/weaknesses + comparison hints
// path: src/components/evaluations/synthesis.ts
// purpose: Take the disconnected scorecard/benchmark/memory signals the API
//          already exposes and turn them into the narrative the dashboard
//          needs: what's this model good at, what's it bad at, why is it
//          winning/losing, and what should I run next. Kept dependency-free
//          so the same module is unit-tested without React.

import type {
  ModelScorecard, BenchmarkRun, BenchmarkTask, MemoryScorecard,
} from '../../lib/api'

export type Source = 'subscore' | 'benchmark' | 'memory'

export interface Finding {
  key:    string
  label:  string
  value:  number
  source: Source
  detail: string
}

export interface NextTest {
  taskId:    string
  taskTitle: string
  reason:    string
  builtIn:   boolean
  scoringSource: ScoringSource
}

export interface ModelSynthesis {
  model:        string
  modelLabel:   string
  overall:      number
  rank:         number | null
  totalModels:  number
  strengths:    Finding[]
  weaknesses:   Finding[]
  verdict:      string
  reasons:      string[]
  nextTests:    NextTest[]
  confidence:   number
  confidenceNote: string
  sampleSize:   { evaluatedRuns: number; benchmarkRuns: number; memoryRuns: number }
  bestBenchmark:  { taskTitle: string; score: number } | null
  worstBenchmark: { taskTitle: string; score: number } | null
  benchmarkAvg:   number | null
  benchmarkCoverage: { ran: number; total: number }
  memoryComposite: number | null
  memoryFalseRecall: number | null
  hasRealBenchmarkData: boolean
}

const STRENGTH = 75
const WEAKNESS = 50

/**
 * Build the unified synthesis for one model from the signals the API already
 * returns. All inputs are filtered upstream (per platform / per model) — this
 * function does not fetch anything; it shapes the narrative.
 */
export function synthesizeModel(args: {
  scorecard:    ModelScorecard
  leaderboard:  ModelScorecard[]
  tasks:        BenchmarkTask[]
  runs:         BenchmarkRun[]
  memory?:      MemoryScorecard | null
  autoGradedSlugs?: ReadonlySet<string>
}): ModelSynthesis {
  const { scorecard, leaderboard, tasks, runs, memory, autoGradedSlugs } = args
  const model = scorecard.model

  // Same dedupe rule as the comparison so verdict numbers match the table.
  const { canonical, aliasOf } = dedupeTasksBySlug(tasks)

  const myRuns = runs.filter(r => r.model === model && r.status !== 'running')
  const scoredRuns = myRuns.filter(r => r.rubricScore != null)

  // Latest-per-CANONICAL-task — same rule as BenchmarkComparison so the
  // narrative matches the table the user sees (built-ins installed on both
  // platforms collapse into one canonical task).
  const latestByCanonical = new Map<string, BenchmarkRun>()
  for (const r of [...myRuns].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())) {
    const cid = aliasOf.get(r.taskId) ?? r.taskId
    if (!latestByCanonical.has(cid)) latestByCanonical.set(cid, r)
  }
  const latestScoredEntries = [...latestByCanonical.values()].filter(r => r.rubricScore != null)
  const benchAvg = latestScoredEntries.length
    ? Math.round(latestScoredEntries.reduce((s, r) => s + (r.rubricScore as number), 0) / latestScoredEntries.length)
    : null

  // Best/worst across the latest-per-task snapshot.
  let best: { taskTitle: string; score: number } | null = null
  let worst: { taskTitle: string; score: number } | null = null
  for (const r of latestScoredEntries) {
    const cid = aliasOf.get(r.taskId) ?? r.taskId
    const t = canonical.find(x => x.id === cid)
    const title = t?.title ?? r.taskId
    const s = r.rubricScore as number
    if (best === null || s > best.score) best = { taskTitle: title, score: s }
    if (worst === null || s < worst.score) worst = { taskTitle: title, score: s }
  }

  // Strengths / weaknesses from sub-scores. Confidence is meta — exclude it.
  const subs = scorecard.subScores.filter(s => s.key !== 'confidence' && s.value != null)
  const strengths: Finding[] = subs
    .filter(s => (s.value as number) >= STRENGTH)
    .sort((a, b) => (b.value as number) - (a.value as number))
    .map(s => ({ key: s.key, label: s.label, value: s.value as number, source: 'subscore' as const, detail: s.detail }))
  const weaknesses: Finding[] = subs
    .filter(s => (s.value as number) <= WEAKNESS)
    .sort((a, b) => (a.value as number) - (b.value as number))
    .map(s => ({ key: s.key, label: s.label, value: s.value as number, source: 'subscore' as const, detail: s.detail }))

  // Promote benchmark + memory signals into the same finding lists so the UI
  // can show one combined "good at / bad at" without callers cross-referencing.
  if (benchAvg != null) {
    const cell: Finding = {
      key: 'benchmarkAvg',
      label: `Benchmark average (latest per task, ${latestScoredEntries.length} task${latestScoredEntries.length === 1 ? '' : 's'})`,
      value: benchAvg,
      source: 'benchmark',
      detail: best ? `best on "${best.taskTitle}" (${best.score})` : 'no top task',
    }
    if (benchAvg >= STRENGTH) strengths.unshift(cell)
    else if (benchAvg <= WEAKNESS) weaknesses.unshift(cell)
  }
  if (memory) {
    const composite = memory.composite
    const cell: Finding = {
      key: 'memoryComposite',
      label: `Memory composite (${memory.runCount} run${memory.runCount === 1 ? '' : 's'})`,
      value: composite,
      source: 'memory',
      detail: memory.falseRecallPenalty > 15
        ? `${memory.falseRecallPenalty.toFixed(0)} false-recall pts — investigate forbidden hits`
        : `false-recall ${memory.falseRecallPenalty.toFixed(0)} pts`,
    }
    if (composite >= STRENGTH) strengths.unshift(cell)
    else if (composite <= WEAKNESS) weaknesses.unshift(cell)
    // False recall as its own weakness signal even if composite looks OK.
    if (memory.falseRecallPenalty > 20) {
      weaknesses.unshift({
        key: 'memoryFalseRecall',
        label: 'Memory false-recall penalty',
        value: Math.max(0, 100 - memory.falseRecallPenalty * 3),
        source: 'memory',
        detail: `${memory.falseRecallPenalty.toFixed(0)} pts — model retrieves or restates forbidden facts`,
      })
    }
  }

  // Compare against leaderboard to explain win/loss.
  const sorted = [...leaderboard].sort((a, b) => b.overall - a.overall)
  const rank = sorted.findIndex(c => c.model === model)
  const rankPos = rank < 0 ? null : rank + 1
  const next = sorted[rank + 1]
  const prev = rank > 0 ? sorted[rank - 1] : null

  // Verdict — a real sentence: who they are vs. the field, plus the single
  // strongest driver or drag. Built before the reasons list so reasons can
  // skip the rank-gap line (it's already in the verdict).
  const driver = pickDriver({
    benchAvg, memoryComposite: memory?.composite ?? null, successRate: scorecard.successRate,
  })
  const drag = pickDrag({
    benchAvg, memoryComposite: memory?.composite ?? null, successRate: scorecard.successRate,
    wasteRate: scorecard.wasteRate, falseRecall: memory?.falseRecallPenalty ?? null,
  })
  const verdict = buildVerdict({
    rank: rankPos, total: sorted.length, overall: scorecard.overall,
    next, prev, driver, drag,
    hasRealBenchmarkData: latestScoredEntries.length > 0 || scorecard.benchmarkScore != null,
  })

  // Supporting reasons — skip the rank gap (it's in the verdict). Each entry
  // is one fact that anchors the verdict back to the data.
  const reasons: string[] = []
  if (benchAvg != null) {
    reasons.push(`Benchmarks: ${benchAvg} avg across ${latestScoredEntries.length} task${latestScoredEntries.length === 1 ? '' : 's'} (${scoredRuns.length} graded dispatch${scoredRuns.length === 1 ? '' : 'es'}).`)
  } else if (scorecard.benchmarkScore != null) {
    reasons.push(`Benchmarks: ${scorecard.benchmarkScore} from ${scorecard.benchmarkRuns} persisted run${scorecard.benchmarkRuns === 1 ? '' : 's'}.`)
  } else {
    reasons.push('Benchmarks: none graded yet — overall is heuristic only.')
  }
  if (scorecard.successRate != null && scorecard.evaluatedCount >= 3) {
    if (scorecard.successRate >= 75) {
      reasons.push(`Sessions: ${Math.round(scorecard.successRate)}% success, ${Math.round(scorecard.recoveryRate ?? 0)}% recovery over ${scorecard.evaluatedCount} runs.`)
    } else if (scorecard.successRate < 55) {
      reasons.push(`Sessions: only ${Math.round(scorecard.successRate)}% success across ${scorecard.evaluatedCount} runs — see failures below.`)
    }
  }
  if (scorecard.wasteRate != null && scorecard.wasteRate > 25) {
    reasons.push(`Tool waste ${Math.round(scorecard.wasteRate)}% — repeats and oscillation cost time and tokens.`)
  }
  if (memory && memory.falseRecallPenalty > 20) {
    reasons.push(`Memory: ${memory.falseRecallPenalty.toFixed(0)}-pt false-recall penalty — restating forbidden / stale facts.`)
  }
  if (worst && worst.score < 40) {
    reasons.push(`Worst task: "${worst.taskTitle}" (${worst.score}) — open the run for the rubric trace.`)
  }

  // What to test next — coverage gaps first, then re-runs of low scores.
  const nextTests: NextTest[] = []
  for (const t of canonical) {
    if (latestByCanonical.has(t.id)) continue
    nextTests.push({
      taskId: t.id, taskTitle: t.title, builtIn: t.builtIn,
      reason: t.builtIn ? 'Never dispatched · auto-grades on run' : 'Never dispatched',
      scoringSource: taskScoringSource(t, autoGradedSlugs),
    })
    if (nextTests.length >= 6) break
  }
  if (nextTests.length === 0) {
    for (const r of latestScoredEntries.sort((a, b) => (a.rubricScore as number) - (b.rubricScore as number))) {
      if ((r.rubricScore as number) >= 70) break
      const cid = aliasOf.get(r.taskId) ?? r.taskId
      const t = canonical.find(x => x.id === cid)
      if (!t) continue
      nextTests.push({ taskId: t.id, taskTitle: t.title, builtIn: t.builtIn, reason: `Last score ${r.rubricScore} · re-run to confirm`, scoringSource: taskScoringSource(t, autoGradedSlugs) })
      if (nextTests.length >= 4) break
    }
  }

  // Confidence narrative — translate the engine's 0-100 confidence into prose
  // a user can act on.
  const confidenceNote = buildConfidenceNote(scorecard, latestScoredEntries.length)

  return {
    model,
    modelLabel: scorecard.modelLabel,
    overall: scorecard.overall,
    rank: rankPos,
    totalModels: sorted.length,
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    verdict,
    reasons,
    nextTests,
    confidence: scorecard.confidence,
    confidenceNote,
    sampleSize: {
      evaluatedRuns: scorecard.evaluatedCount,
      benchmarkRuns: scoredRuns.length,
      memoryRuns: memory?.runCount ?? 0,
    },
    bestBenchmark: best,
    worstBenchmark: worst,
    benchmarkAvg: benchAvg,
    benchmarkCoverage: { ran: latestByCanonical.size, total: canonical.length },
    memoryComposite: memory?.composite ?? null,
    memoryFalseRecall: memory ? memory.falseRecallPenalty : null,
    hasRealBenchmarkData: latestScoredEntries.length > 0 || scorecard.benchmarkScore != null,
  }
}

function pickDriver(x: { benchAvg: number | null; memoryComposite: number | null; successRate: number | null }): string | null {
  const opts: Array<{ score: number; phrase: string }> = []
  if (x.benchAvg       != null && x.benchAvg       >= 70) opts.push({ score: x.benchAvg,       phrase: `strongest benchmark grades (${x.benchAvg})` })
  if (x.memoryComposite!= null && x.memoryComposite>= 70) opts.push({ score: x.memoryComposite,phrase: `memory composite ${x.memoryComposite}` })
  if (x.successRate    != null && x.successRate    >= 75) opts.push({ score: x.successRate,    phrase: `${Math.round(x.successRate)}% session success` })
  if (opts.length === 0) return null
  opts.sort((a, b) => b.score - a.score)
  return opts[0].phrase
}

function pickDrag(x: {
  benchAvg: number | null; memoryComposite: number | null; successRate: number | null
  wasteRate: number | null; falseRecall: number | null
}): string | null {
  const opts: Array<{ severity: number; phrase: string }> = []
  if (x.benchAvg        != null && x.benchAvg        <= 50) opts.push({ severity: 100 - x.benchAvg,         phrase: `benchmark avg only ${x.benchAvg}` })
  if (x.memoryComposite != null && x.memoryComposite <= 50) opts.push({ severity: 100 - x.memoryComposite,  phrase: `memory composite ${x.memoryComposite}` })
  if (x.successRate     != null && x.successRate     <= 55) opts.push({ severity: 100 - x.successRate,      phrase: `${Math.round(x.successRate)}% session success` })
  if (x.wasteRate       != null && x.wasteRate       >= 25) opts.push({ severity: x.wasteRate,              phrase: `${Math.round(x.wasteRate)}% tool waste` })
  if (x.falseRecall     != null && x.falseRecall     >= 20) opts.push({ severity: x.falseRecall + 30,       phrase: `${x.falseRecall.toFixed(0)}-pt false-recall in memory` })
  if (opts.length === 0) return null
  opts.sort((a, b) => b.severity - a.severity)
  return opts[0].phrase
}

function buildVerdict(x: {
  rank: number | null; total: number; overall: number
  next?: ModelScorecard; prev?: ModelScorecard | null
  driver: string | null; drag: string | null
  hasRealBenchmarkData: boolean
}): string {
  // Solo or unranked — describe the model on its own terms.
  if (x.rank == null || x.total <= 1) {
    const tail = x.driver ? ` — ${x.driver}.` : x.drag ? ` — held back by ${x.drag}.` : '.'
    if (!x.hasRealBenchmarkData) return `Only model with data — overall ${x.overall} (heuristic, no graded benchmarks yet)${tail.replace(/\.$/, '')}.`
    return `Only ranked model — overall ${x.overall}${tail}`
  }
  // Leading.
  if (x.rank === 1 && x.next) {
    const gap = x.overall - x.next.overall
    const tail = x.driver ? ` — ${x.driver}.` : x.drag ? ` — but ${x.drag} is the main risk.` : '.'
    if (gap >= 5)  return `Leads ${x.next.modelLabel} by ${gap} pts${tail}`
    if (gap >= 1)  return `Narrowly ahead of ${x.next.modelLabel} (+${gap})${tail}`
    return `Tied with ${x.next.modelLabel} at ${x.overall}${tail}`
  }
  // Trailing.
  if (x.prev) {
    const gap = x.prev.overall - x.overall
    const tail = x.drag ? ` — ${x.drag} is the main drag.` : x.driver ? ` — kept in the running by ${x.driver}.` : '.'
    return `Trails ${x.prev.modelLabel} by ${gap} pts${tail}`
  }
  return `#${x.rank} of ${x.total} · overall ${x.overall}.`
}

function buildConfidenceNote(sc: ModelScorecard, latestPerTask: number): string {
  const c = Math.round(sc.confidence)
  if (c >= 75) return `${c}% · solid sample (${sc.evaluatedCount} runs${latestPerTask ? `, ${latestPerTask} graded tasks` : ''})`
  if (c >= 50) return `${c}% · moderate sample · ${Math.max(3, 10 - sc.evaluatedCount)} more runs would tighten this`
  return `${c}% · low sample · treat as directional, dispatch more graded benchmarks before drawing conclusions`
}

// ─── Benchmark comparison helpers ────────────────────────────────────────────

export interface ComparisonCell {
  model:        string
  taskId:       string
  latestScore:  number | null
  latestStatus: string | null
  latestOutcome: string | null
  runCount:     number
  rubricScored: number
  bestScore:    number | null
  worstScore:   number | null
  spread:       number
  latestTs:     string | null
  notes:        string
  durationMs:   number | null
  /** True when every completed run for this (task, model) has rubricScore=null.
   *  Signals the task has no auto-grader, so the cell can show "needs grader"
   *  instead of just an outcome chip. */
  needsGrader:  boolean
}

export type ScoringSource =
  | 'auto-graded'    // built-in slug with a registered server-side grader
  | 'manual-rubric'  // rubric text exists; manual / heuristic scoring possible
  | 'unscored'       // no grader, no rubric — needs intervention before any run can produce a score

export interface ComparisonRow {
  task:    BenchmarkTask
  /** Other task IDs collapsed into this row by builtInSlug (cross-platform). */
  aliasTaskIds: string[]
  cells:   Map<string, ComparisonCell>
  bestModels: string[]        // can be multiple in a tie
  bestScore:  number | null
  spreadAcross: number        // max-min across cells with a graded latest score
  coverage: { graded: number; modelsTotal: number }
  /** True when no model has a rubric score for this task (any platform). */
  ungradeable: boolean
  /** Single source of truth for "how can this task be scored". Independent of
   *  whether runs have happened yet — answers the question "if I run this,
   *  will it grade?" */
  scoringSource: ScoringSource
  /** Human-readable explanation of exactly what is missing for scoring to
   *  work. Empty string when scoringSource is 'auto-graded' (nothing missing). */
  missingForScoring: string
}

const SCORED_STATUSES = new Set(['success', 'failure', 'unresolved'])

/**
 * Build the rows × models matrix the BenchmarkComparison table renders. Each
 * cell is the latest non-running run per (task, model). Best-score-per-row is
 * exposed so the UI can highlight winners and call out tasks that need work.
 */
/**
 * The single source of truth answering: "if I dispatch this task now, will
 * it produce a rubricScore on its own?" Used by every UI surface that wants
 * to render an auto-graded / needs-grader pill — they must NOT key off
 * `task.builtIn` alone, because built-in tasks can ship without a registered
 * server-side grader.
 */
export function taskScoringSource(task: BenchmarkTask, autoGradedSlugs?: ReadonlySet<string>): ScoringSource {
  if (task.builtIn && task.builtInSlug && autoGradedSlugs?.has(task.builtInSlug)) return 'auto-graded'
  if (task.rubric && task.rubric.trim().length > 0) return 'manual-rubric'
  return 'unscored'
}

/** Human-readable "what's missing" copy that matches taskScoringSource(). */
export function missingForScoring(task: BenchmarkTask, source: ScoringSource): string {
  if (source === 'auto-graded') return ''
  if (task.builtIn) {
    return task.builtInSlug
      ? `Built-in slug "${task.builtInSlug}" has no server-side grader registered — wire one in server/lib/benchmarkGraders.ts.`
      : 'Built-in task is missing a builtInSlug — cannot map to an auto-grader.'
  }
  if (source === 'manual-rubric') {
    return 'Has a rubric but no auto-grader — runs need a manual rubric pass to receive a score.'
  }
  return 'No rubric and no auto-grader — add a rubric or wire a grader before scores will populate.'
}

/**
 * Collapse built-in tasks that share a `builtInSlug` (installed once per
 * platform) into one canonical row. Custom tasks stay distinct by id. Returns
 * the canonical task list plus a Map<originalId, canonicalId> so runs can be
 * merged across the aliases.
 */
export function dedupeTasksBySlug(tasks: BenchmarkTask[]): { canonical: BenchmarkTask[]; aliasOf: Map<string, string>; aliasesOf: Map<string, string[]> } {
  const canonical: BenchmarkTask[] = []
  const seenSlug  = new Map<string, string>()   // slug -> canonicalId
  const aliasOf   = new Map<string, string>()   // anyId -> canonicalId
  const aliasesOf = new Map<string, string[]>() // canonicalId -> [otherIds…]
  for (const t of tasks) {
    if (t.builtIn && t.builtInSlug) {
      const existing = seenSlug.get(t.builtInSlug)
      if (existing) {
        aliasOf.set(t.id, existing)
        const list = aliasesOf.get(existing) ?? []
        list.push(t.id); aliasesOf.set(existing, list)
        continue
      }
      seenSlug.set(t.builtInSlug, t.id)
    }
    canonical.push(t)
    aliasOf.set(t.id, t.id)
    aliasesOf.set(t.id, [])
  }
  return { canonical, aliasOf, aliasesOf }
}

export function buildComparisonMatrix(args: {
  tasks: BenchmarkTask[]
  runs:  BenchmarkRun[]
  /** Slugs that have an auto-grader on the server. When omitted, no task is
   *  considered auto-graded — every row reports 'manual-rubric' or 'unscored'. */
  autoGradedSlugs?: ReadonlySet<string>
}): { models: string[]; rows: ComparisonRow[]; modelColumnSummary: Map<string, { avg: number | null; tasksGraded: number }> } {
  const { tasks, runs, autoGradedSlugs } = args
  const { canonical, aliasOf, aliasesOf } = dedupeTasksBySlug(tasks)
  const modelSet = new Set<string>()
  for (const r of runs) {
    if (!r.model || r.model === 'unknown') continue
    if (!SCORED_STATUSES.has(r.status)) continue
    modelSet.add(r.model)
  }
  const models = [...modelSet].sort()

  const rows: ComparisonRow[] = []
  for (const t of canonical) {
    const canonicalIds = new Set<string>([t.id, ...(aliasesOf.get(t.id) ?? [])])
    const cells = new Map<string, ComparisonCell>()
    const taskRuns = runs.filter(r =>
      canonicalIds.has(r.taskId)
      && r.model && r.model !== 'unknown'
      && SCORED_STATUSES.has(r.status),
    )
    for (const m of models) {
      const mine = taskRuns
        .filter(r => r.model === m)
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      if (mine.length === 0) {
        cells.set(m, {
          model: m, taskId: t.id, latestScore: null, latestStatus: null, latestOutcome: null,
          runCount: 0, rubricScored: 0, bestScore: null, worstScore: null,
          spread: 0, latestTs: null, notes: '', durationMs: null, needsGrader: false,
        })
        continue
      }
      const scored = mine.filter(r => r.rubricScore != null)
      const latest = mine[0]
      cells.set(m, {
        model: m, taskId: t.id,
        latestScore:  latest.rubricScore,
        latestStatus: latest.status,
        latestOutcome: latest.outcome,
        runCount:     mine.length,
        rubricScored: scored.length,
        bestScore:    scored.length ? Math.max(...scored.map(r => r.rubricScore as number)) : null,
        worstScore:   scored.length ? Math.min(...scored.map(r => r.rubricScore as number)) : null,
        spread:       scored.length ? Math.max(...scored.map(r => r.rubricScore as number)) - Math.min(...scored.map(r => r.rubricScore as number)) : 0,
        latestTs:     latest.ts,
        notes:        latest.notes ?? '',
        durationMs:   latest.durationMs ?? null,
        // Every run for this (task, model) completed without a rubricScore →
        // the task has no auto-grader; chip should say "needs grader" rather
        // than just an outcome word.
        needsGrader:  mine.length > 0 && scored.length === 0,
      })
    }
    let bestScore: number | null = null
    const bestModels: string[] = []
    let graded = 0
    const gradedScores: number[] = []
    for (const c of cells.values()) {
      if (c.latestScore == null) continue
      graded++
      gradedScores.push(c.latestScore)
      if (bestScore == null || c.latestScore > bestScore) {
        bestScore = c.latestScore; bestModels.length = 0; bestModels.push(c.model)
      } else if (c.latestScore === bestScore) {
        bestModels.push(c.model)
      }
    }
    const spreadAcross = gradedScores.length > 1 ? Math.max(...gradedScores) - Math.min(...gradedScores) : 0
    // A row is ungradeable when at least one model ran it but nobody got a
    // rubric score — usually a custom task with no manual rubric assigned.
    const anyRunsAcross = [...cells.values()].some(c => c.runCount > 0)
    const anyScored     = [...cells.values()].some(c => c.rubricScored > 0)
    const ungradeable   = anyRunsAcross && !anyScored
    const scoringSource = taskScoringSource(t, autoGradedSlugs)
    rows.push({
      task: t,
      aliasTaskIds: aliasesOf.get(t.id) ?? [],
      cells, bestModels, bestScore, spreadAcross,
      coverage: { graded, modelsTotal: models.length },
      ungradeable,
      scoringSource,
      missingForScoring: missingForScoring(t, scoringSource),
    })
  }
  // Suppress unused-var lint for aliasOf — exposed via the dedupeTasksBySlug
  // return shape; not directly consumed here.
  void aliasOf

  // Per-model column avg of latest-per-task scores.
  const modelColumnSummary = new Map<string, { avg: number | null; tasksGraded: number }>()
  for (const m of models) {
    const vals: number[] = []
    for (const row of rows) {
      const c = row.cells.get(m)
      if (c?.latestScore != null) vals.push(c.latestScore)
    }
    modelColumnSummary.set(m, {
      avg: vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
      tasksGraded: vals.length,
    })
  }
  return { models, rows, modelColumnSummary }
}

/**
 * Tasks where no model has scored yet — surfaced as empty-state guidance so
 * the comparison view actively tells you what to run rather than just
 * showing dashes.
 */
export function gapsInComparison(rows: ComparisonRow[]): { neverRun: BenchmarkTask[]; lowestCoverage: BenchmarkTask[] } {
  const neverRun: BenchmarkTask[] = []
  const lowestCoverage: BenchmarkTask[] = []
  for (const row of rows) {
    if (row.coverage.graded === 0) neverRun.push(row.task)
    else if (row.coverage.modelsTotal > 1 && row.coverage.graded < row.coverage.modelsTotal) lowestCoverage.push(row.task)
  }
  return { neverRun, lowestCoverage }
}

// ─── Task queue grouping ─────────────────────────────────────────────────────

export type QueueBucket = 'needsCoverage' | 'failed' | 'needsRerun' | 'decisive' | 'ungradeable'

export interface QueueEntry {
  row:        ComparisonRow
  bestModel:  string | null
  bestScore:  number | null
  modelsRan:  number
  totalRuns:  number
  /** Latest timestamp of any run on this task (across models). */
  lastTouchedAt: string | null
}

export interface TaskQueues {
  needsCoverage: QueueEntry[]   // no graded run from any model
  failed:        QueueEntry[]   // best graded ≤ 40
  needsRerun:    QueueEntry[]   // only one graded score, OR top score 40–70
  decisive:      QueueEntry[]   // ≥10 pt spread or ≥80 best score
  ungradeable:   QueueEntry[]   // ran but never graded (no auto-grader)
}

export function groupTasksByStatus(rows: ComparisonRow[]): TaskQueues {
  const out: TaskQueues = {
    needsCoverage: [], failed: [], needsRerun: [], decisive: [], ungradeable: [],
  }
  for (const row of rows) {
    let modelsRan = 0
    let totalRuns = 0
    let lastTouchedAt: string | null = null
    let bestModel: string | null = null
    const allScores: number[] = []
    let singleScoreCount = 0
    for (const c of row.cells.values()) {
      if (c.runCount > 0) modelsRan++
      totalRuns += c.runCount
      if (c.latestTs && (!lastTouchedAt || c.latestTs > lastTouchedAt)) lastTouchedAt = c.latestTs
      if (c.latestScore != null) {
        allScores.push(c.latestScore)
        if (c.rubricScored === 1) singleScoreCount++
        if (row.bestScore != null && c.latestScore === row.bestScore && bestModel === null) bestModel = c.model
      }
    }
    const entry: QueueEntry = {
      row, bestModel, bestScore: row.bestScore, modelsRan, totalRuns, lastTouchedAt,
    }
    if (row.ungradeable)                        out.ungradeable.push(entry)
    else if (row.coverage.graded === 0)         out.needsCoverage.push(entry)
    else if ((row.bestScore ?? 0) <= 40)        out.failed.push(entry)
    else if (row.spreadAcross >= 10 || (row.bestScore ?? 0) >= 80) out.decisive.push(entry)
    else if (singleScoreCount === allScores.length || (row.bestScore ?? 100) < 70) out.needsRerun.push(entry)
    else                                        out.decisive.push(entry)
  }
  for (const k of Object.keys(out) as QueueBucket[]) {
    out[k].sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1))
  }
  return out
}

// ─── Memory section synthesis ────────────────────────────────────────────────

export interface MemoryVerdict {
  bestModel:        MemoryScorecard | null
  worstFalseRecall: MemoryScorecard | null
  totalRuns:        number
  modelCount:       number
  /** Plain-English headline answer to "who wins on memory and why". */
  headline:         string
  /** What to dispatch next on the memory side. */
  nextSuggestions:  string[]
}

export function synthesizeMemoryArea(args: {
  cards:    MemoryScorecard[]
  totalRuns: number
  bestProvider?: { scope: string; composite: number } | null
}): MemoryVerdict {
  const cards = args.cards.filter(c => c.scope && c.scope !== 'unknown')
  const sorted = [...cards].sort((a, b) => b.composite - a.composite)
  const bestModel = sorted[0] ?? null
  const worstFalseRecall = [...cards].sort((a, b) => b.falseRecallPenalty - a.falseRecallPenalty)[0] ?? null

  const headline = (() => {
    if (!bestModel) return 'No memory runs attributed to a model yet. Dispatch a memory task with a model selected to populate this view.'
    const tail = args.bestProvider ? `; baseline/external provider winner: ${args.bestProvider.scope} (${args.bestProvider.composite}).` : '.'
    if (worstFalseRecall && worstFalseRecall.falseRecallPenalty > 20 && worstFalseRecall.scope !== bestModel.scope) {
      return `${bestModel.label} leads memory composite (${bestModel.composite}), but ${worstFalseRecall.label} has a ${worstFalseRecall.falseRecallPenalty.toFixed(0)}-pt false-recall penalty — investigate forbidden hits${tail}`
    }
    return `${bestModel.label} leads memory composite (${bestModel.composite}) across ${bestModel.runCount} run${bestModel.runCount === 1 ? '' : 's'}${tail}`
  })()

  const nextSuggestions: string[] = []
  if (cards.length === 0) {
    nextSuggestions.push('Run any memory task with a model selected — the leaderboard groups by (provider, model).')
  } else {
    if (worstFalseRecall && worstFalseRecall.falseRecallPenalty > 15) {
      nextSuggestions.push(`Re-run a "negative" task on ${worstFalseRecall.label} to confirm whether forbidden facts keep appearing.`)
    }
    if (sorted.length >= 2 && (sorted[0].composite - sorted[1].composite) < 5) {
      nextSuggestions.push(`Composite gap between ${sorted[0].label} and ${sorted[1].label} is only ${sorted[0].composite - sorted[1].composite} pts — dispatch a multi-hop or temporal task to break the tie.`)
    }
    if (sorted.some(c => c.runCount < 3)) {
      nextSuggestions.push('Some models have under 3 memory runs — dispatch more to raise confidence.')
    }
  }
  return {
    bestModel, worstFalseRecall,
    totalRuns: args.totalRuns,
    modelCount: cards.length,
    headline, nextSuggestions,
  }
}
