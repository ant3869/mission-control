// title: Tests for evaluation viewmodel synthesis helpers
// path: server/lib/evalSynthesis.test.ts
// run:  npm test
//
// Covers the pure transforms behind the Evaluations UI: model synthesis
// (strengths/weaknesses/why-winning/next-tests) and the benchmark comparison
// matrix (dedupe of latest-per-task, per-row winners, coverage gaps).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  synthesizeModel, buildComparisonMatrix, gapsInComparison,
  dedupeTasksBySlug, groupTasksByStatus, synthesizeMemoryArea,
} from '../../src/components/evaluations/synthesis.ts'
import type {
  ModelScorecard, BenchmarkTask, BenchmarkRun, MemoryScorecard,
} from '../../src/lib/api.ts'

const baseSc = (over: Partial<ModelScorecard>): ModelScorecard => ({
  platform: 'openclaw',
  model: 'm1',
  modelLabel: 'Model One',
  runCount: 10,
  evaluatedCount: 8,
  outcomes: { success: 6, recovered: 1, partial: 0, stalled: 0, failure: 1, unresolved: 2 } as any,
  successRate: 75,
  failureRate: 12,
  partialRate: 0,
  stalledRate: 0,
  repeatRate: 5,
  loopRuns: 0,
  toolCalls: 30,
  wastedToolCalls: 2,
  wasteRate: 6,
  avgToolsPerSuccess: 3,
  avgToolsPerFailure: 5,
  recoveryRate: 50,
  avgDurationMs: 1000,
  avgTokens: 500,
  avgCost: 0.001,
  historicalScore: 70,
  benchmarkScore: null,
  benchmarkRuns: 0,
  manualScore: null,
  manualScores: 0,
  consistencyScore: null,
  confidence: 70,
  previousOverall: null,
  overall: 72,
  subScores: [
    { key: 'success',     label: 'Success rate',    value: 82, weight: 0.30, detail: 'wins' },
    { key: 'recovery',    label: 'Recovery',        value: 50, weight: 0.10, detail: 'mid' },
    { key: 'toolWaste',   label: 'Tool waste',      value: 92, weight: 0.15, detail: 'clean' },
    { key: 'adherence',   label: 'Adherence',       value: 40, weight: 0.15, detail: 'drifts' },
    { key: 'confidence',  label: 'Confidence',      value: 70, weight: 0,    detail: 'meta' },
  ],
  ...over,
})

const task = (id: string, over: Partial<BenchmarkTask> = {}): BenchmarkTask => ({
  id, platform: 'openclaw', agent: 'main',
  title: `Task ${id}`, prompt: `prompt ${id}`, rubric: '',
  expectedTools: [], notes: '',
  builtIn: true, builtInSlug: id,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
  ...over,
})

const run = (over: Partial<BenchmarkRun>): BenchmarkRun => ({
  id: Math.random().toString(36).slice(2),
  taskId: 't1', platform: 'openclaw', agent: 'main', model: 'm1',
  status: 'success', outcome: 'success',
  toolCalls: 2, wastedToolCalls: 0, retries: 0,
  durationMs: 1000, tokens: 100, cost: 0,
  rubricScore: 80, notes: '',
  answer: '', toolSequence: [],
  repeatedToolCalls: 0, oscillations: 0, noProgressTools: 0,
  ts: '2026-05-26T10:00:00Z',
  ...over,
})

describe('synthesizeModel', () => {
  it('classifies strong sub-scores as strengths and weak as weaknesses', () => {
    const sc = baseSc({})
    const s = synthesizeModel({ scorecard: sc, leaderboard: [sc], tasks: [], runs: [] })
    const strengthKeys = s.strengths.map(f => f.key)
    const weaknessKeys = s.weaknesses.map(f => f.key)
    assert.ok(strengthKeys.includes('success'),   'success ≥75 is a strength')
    assert.ok(strengthKeys.includes('toolWaste'), 'toolWaste ≥75 is a strength')
    assert.ok(weaknessKeys.includes('adherence'),'adherence ≤50 is a weakness')
    // confidence sub-score is meta and must never appear as a finding.
    assert.equal(strengthKeys.includes('confidence'), false)
  })

  it('uses latest-per-task benchmark scores and surfaces best/worst', () => {
    const tasks = [task('t1', { title: 'Sum two ints' }), task('t2', { title: 'Format JSON' })]
    const runs = [
      run({ taskId: 't1', rubricScore: 50, ts: '2026-05-20T10:00:00Z' }),
      run({ taskId: 't1', rubricScore: 90, ts: '2026-05-26T10:00:00Z' }), // latest wins
      run({ taskId: 't2', rubricScore: 30, ts: '2026-05-26T10:00:00Z' }),
    ]
    const sc = baseSc({})
    const s = synthesizeModel({ scorecard: sc, leaderboard: [sc], tasks, runs })
    assert.equal(s.benchmarkAvg, 60, 'avg over latest-per-task: (90 + 30) / 2 = 60')
    assert.equal(s.bestBenchmark?.taskTitle, 'Sum two ints')
    assert.equal(s.bestBenchmark?.score, 90)
    assert.equal(s.worstBenchmark?.taskTitle, 'Format JSON')
    assert.equal(s.worstBenchmark?.score, 30)
    assert.equal(s.hasRealBenchmarkData, true)
  })

  it('next-test suggestions surface tasks this model has never run', () => {
    const tasks = [task('t1'), task('t2'), task('t3')]
    const runs = [run({ taskId: 't1', rubricScore: 90 })]
    const sc = baseSc({})
    const s = synthesizeModel({ scorecard: sc, leaderboard: [sc], tasks, runs })
    const ids = s.nextTests.map(n => n.taskId)
    assert.deepEqual(ids.sort(), ['t2', 't3'])
  })

  it('explains the rank gap against the leaderboard in the verdict', () => {
    const top  = baseSc({ model: 'top', modelLabel: 'Top', overall: 88 })
    const me   = baseSc({ overall: 70 })
    const s = synthesizeModel({ scorecard: me, leaderboard: [top, me], tasks: [], runs: [] })
    assert.equal(s.rank, 2)
    // Rank gap lives in the verdict so the supporting reasons can stay focused
    // on the data behind it (benchmarks, sessions, waste, etc).
    assert.ok(s.verdict.includes('Trails Top') && s.verdict.includes('18 pts'),
      `verdict should call out the trailing gap — got: ${s.verdict}`)
  })

  it('folds memory composite + false-recall into strengths/weaknesses', () => {
    const sc = baseSc({})
    const mem: MemoryScorecard = {
      scope: 'm1', label: 'm1', runCount: 5,
      composite: 35, subScores: {}, falseRecallPenalty: 25,
      confidence: 60, consistency: null, trend: [],
    }
    const s = synthesizeModel({ scorecard: sc, leaderboard: [sc], tasks: [], runs: [], memory: mem })
    const wkKeys = s.weaknesses.map(f => f.key)
    assert.ok(wkKeys.includes('memoryComposite'),   'low memory composite → weakness')
    assert.ok(wkKeys.includes('memoryFalseRecall'), 'high false-recall → its own weakness')
    assert.equal(s.memoryFalseRecall, 25)
  })

  it('marks heuristic-only models when no benchmark data exists', () => {
    const sc = baseSc({ benchmarkScore: null, benchmarkRuns: 0 })
    const s = synthesizeModel({ scorecard: sc, leaderboard: [sc], tasks: [task('t1')], runs: [] })
    assert.equal(s.hasRealBenchmarkData, false)
    assert.ok(s.reasons.some(r => /none graded yet|heuristic only/i.test(r)),
      `reasons should call out heuristic-only state — got: ${s.reasons.join(' | ')}`)
  })
})

describe('buildComparisonMatrix', () => {
  it('dedupes to latest-per-(task,model) and emits one row per task', () => {
    const tasks = [task('t1'), task('t2')]
    const runs = [
      run({ taskId: 't1', model: 'a', rubricScore: 60, ts: '2026-05-20T00:00:00Z' }),
      run({ taskId: 't1', model: 'a', rubricScore: 90, ts: '2026-05-26T00:00:00Z' }), // latest
      run({ taskId: 't1', model: 'b', rubricScore: 70, ts: '2026-05-26T00:00:00Z' }),
      run({ taskId: 't2', model: 'a', rubricScore: 50, ts: '2026-05-26T00:00:00Z' }),
    ]
    const { models, rows } = buildComparisonMatrix({ tasks, runs })
    assert.deepEqual(models, ['a', 'b'])
    assert.equal(rows.length, 2)
    const r1 = rows.find(r => r.task.id === 't1')!
    assert.equal(r1.cells.get('a')?.latestScore, 90)
    assert.equal(r1.cells.get('a')?.runCount, 2)
    assert.equal(r1.cells.get('b')?.latestScore, 70)
  })

  it('marks the highest-score model per row as the winner', () => {
    const tasks = [task('t1')]
    const runs = [
      run({ taskId: 't1', model: 'a', rubricScore: 60 }),
      run({ taskId: 't1', model: 'b', rubricScore: 95 }),
      run({ taskId: 't1', model: 'c', rubricScore: 80 }),
    ]
    const { rows } = buildComparisonMatrix({ tasks, runs })
    assert.deepEqual(rows[0].bestModels, ['b'])
    assert.equal(rows[0].bestScore, 95)
    assert.equal(rows[0].spreadAcross, 35)
  })

  it('handles ties without picking an arbitrary winner', () => {
    const tasks = [task('t1')]
    const runs = [
      run({ taskId: 't1', model: 'a', rubricScore: 90 }),
      run({ taskId: 't1', model: 'b', rubricScore: 90 }),
    ]
    const { rows } = buildComparisonMatrix({ tasks, runs })
    assert.deepEqual(rows[0].bestModels.sort(), ['a', 'b'])
  })

  it('excludes running and unknown-model rows from the matrix', () => {
    const tasks = [task('t1')]
    const runs = [
      run({ taskId: 't1', model: 'a', rubricScore: 80 }),
      run({ taskId: 't1', model: 'unknown', rubricScore: 50 }),
      run({ taskId: 't1', model: '', status: 'running', rubricScore: null as any }),
    ]
    const { models } = buildComparisonMatrix({ tasks, runs })
    assert.deepEqual(models, ['a'])
  })

  it('computes per-model column average over latest-per-task only', () => {
    const tasks = [task('t1'), task('t2')]
    const runs = [
      run({ taskId: 't1', model: 'a', rubricScore: 60, ts: '2026-05-20T00:00:00Z' }),
      run({ taskId: 't1', model: 'a', rubricScore: 100, ts: '2026-05-26T00:00:00Z' }),
      run({ taskId: 't2', model: 'a', rubricScore: 50 }),
    ]
    const { modelColumnSummary } = buildComparisonMatrix({ tasks, runs })
    assert.equal(modelColumnSummary.get('a')?.avg, 75)   // (100 + 50) / 2
    assert.equal(modelColumnSummary.get('a')?.tasksGraded, 2)
  })
})

describe('gapsInComparison', () => {
  it('lists tasks no model has graded as never-run', () => {
    const tasks = [task('t1', { title: 'Has a score' }), task('t2', { title: 'No scores yet' })]
    const runs  = [run({ taskId: 't1', model: 'a', rubricScore: 80 })]
    const { rows } = buildComparisonMatrix({ tasks, runs })
    const { neverRun } = gapsInComparison(rows)
    assert.equal(neverRun.length, 1)
    assert.equal(neverRun[0].title, 'No scores yet')
  })

  it('lists tasks graded for only a subset of models as lowestCoverage', () => {
    const tasks = [task('t1'), task('t2')]
    const runs = [
      run({ taskId: 't1', model: 'a', rubricScore: 80 }),
      run({ taskId: 't1', model: 'b', rubricScore: 70 }),
      run({ taskId: 't2', model: 'a', rubricScore: 90 }), // b missing on t2
    ]
    const { rows } = buildComparisonMatrix({ tasks, runs })
    const { lowestCoverage } = gapsInComparison(rows)
    assert.equal(lowestCoverage.length, 1)
    assert.equal(lowestCoverage[0].id, 't2')
  })
})

describe('dedupeTasksBySlug', () => {
  it('collapses built-ins that share a slug across platforms into one canonical row', () => {
    const t1 = task('oc-echo', { builtIn: true, builtInSlug: 'echo',  platform: 'openclaw', title: 'Echo' })
    const t2 = task('hr-echo', { builtIn: true, builtInSlug: 'echo',  platform: 'hermes',   title: 'Echo' })
    const t3 = task('custom1', { builtIn: false, builtInSlug: '',     platform: 'openclaw', title: 'Custom' })
    const { canonical, aliasesOf, aliasOf } = dedupeTasksBySlug([t1, t2, t3])
    assert.equal(canonical.length, 2)                               // echo + custom
    assert.equal(canonical[0].id, 'oc-echo')                        // first wins as canonical
    assert.deepEqual(aliasesOf.get('oc-echo'), ['hr-echo'])
    assert.equal(aliasOf.get('hr-echo'), 'oc-echo')
    assert.equal(aliasOf.get('custom1'), 'custom1')                 // non-built-ins stay distinct
  })

  it('merges runs across aliases when building the comparison matrix', () => {
    const tasks = [
      task('oc-sum', { builtIn: true, builtInSlug: 'sum', platform: 'openclaw', title: 'Sum' }),
      task('hr-sum', { builtIn: true, builtInSlug: 'sum', platform: 'hermes',   title: 'Sum' }),
    ]
    const runs = [
      run({ taskId: 'oc-sum', model: 'a', rubricScore: 80, ts: '2026-05-26T00:00:00Z' }),
      run({ taskId: 'hr-sum', model: 'a', rubricScore: 60, ts: '2026-05-20T00:00:00Z' }),
    ]
    const { rows } = buildComparisonMatrix({ tasks, runs })
    assert.equal(rows.length, 1, 'merged into one canonical row')
    const cell = rows[0].cells.get('a')!
    assert.equal(cell.runCount, 2,  'both platforms\' runs counted')
    assert.equal(cell.latestScore, 80, 'latest by ts wins')
    assert.equal(rows[0].aliasTaskIds.length, 1)
  })
})

describe('groupTasksByStatus', () => {
  const tasks = [
    task('t-cover',  { title: 'Uncovered' }),
    task('t-fail',   { title: 'All failing' }),
    task('t-rerun',  { title: 'Single low score' }),
    task('t-decide', { title: 'Decisive' }),
    task('t-ungrade',{ title: 'No grader' }),
  ]
  const runs = [
    run({ taskId: 't-fail',    model: 'a', rubricScore: 20 }),
    run({ taskId: 't-fail',    model: 'b', rubricScore: 30 }),
    run({ taskId: 't-rerun',   model: 'a', rubricScore: 55 }),
    run({ taskId: 't-decide',  model: 'a', rubricScore: 90 }),
    run({ taskId: 't-decide',  model: 'b', rubricScore: 60 }),
    run({ taskId: 't-ungrade', model: 'a', rubricScore: null as any, status: 'success' }),
  ]
  const { rows } = buildComparisonMatrix({ tasks, runs })
  const queues = groupTasksByStatus(rows)

  it('routes uncovered tasks to needsCoverage', () => {
    assert.equal(queues.needsCoverage.length, 1)
    assert.equal(queues.needsCoverage[0].row.task.id, 't-cover')
  })

  it('routes all-low-score tasks to failed', () => {
    assert.equal(queues.failed.length, 1)
    assert.equal(queues.failed[0].row.task.id, 't-fail')
  })

  it('routes mid-score / low-coverage tasks to needsRerun', () => {
    assert.equal(queues.needsRerun.length, 1)
    assert.equal(queues.needsRerun[0].row.task.id, 't-rerun')
  })

  it('routes high-spread + high-top-score tasks to decisive', () => {
    assert.equal(queues.decisive.length, 1)
    assert.equal(queues.decisive[0].row.task.id, 't-decide')
    assert.equal(queues.decisive[0].bestModel, 'a')
  })

  it('routes tasks with runs but no rubric scores to ungradeable', () => {
    assert.equal(queues.ungradeable.length, 1)
    assert.equal(queues.ungradeable[0].row.task.id, 't-ungrade')
  })
})

describe('synthesizeMemoryArea', () => {
  const mem = (over: Partial<MemoryScorecard>): MemoryScorecard => ({
    scope: 'a', label: 'a', runCount: 5,
    composite: 70, subScores: {},
    falseRecallPenalty: 0,
    confidence: 70, consistency: null, trend: [],
    ...over,
  })

  it('produces a real headline when at least one model has a memory composite', () => {
    const cards = [mem({ scope: 'b', label: 'B', composite: 80 }), mem({ scope: 'a', label: 'A', composite: 60 })]
    const v = synthesizeMemoryArea({ cards, totalRuns: 10 })
    assert.equal(v.bestModel?.scope, 'b')
    assert.ok(v.headline.startsWith('B leads memory composite'))
  })

  it('calls out the false-recall risk when a model has heavy forbidden hits', () => {
    const cards = [
      mem({ scope: 'top', label: 'Top', composite: 80 }),
      mem({ scope: 'leaky', label: 'Leaky', composite: 65, falseRecallPenalty: 30 }),
    ]
    const v = synthesizeMemoryArea({ cards, totalRuns: 10 })
    assert.ok(v.headline.includes('Leaky') && v.headline.includes('30-pt false-recall'),
      `headline should call out Leaky\'s false-recall — got: ${v.headline}`)
  })

  it('falls back to an empty-state headline when no model has runs', () => {
    const v = synthesizeMemoryArea({ cards: [], totalRuns: 0 })
    assert.equal(v.bestModel, null)
    assert.ok(v.headline.startsWith('No memory runs'))
  })
})
