// title: Tests for memory-run scoring and status determination
// path: server/lib/memoryEvalEngine.test.ts
// run:  npm test
//
// Covers the two memory-side fixes from this audit:
//   1. determineMemoryRunStatus marks negative-control fabrications as
//      'failure' even when composite > 0 (previous bug: any composite > 0
//      flowed through as 'success', so a fabrication kept by latency +
//      coverage points was logged green).
//   2. Refusal detection on negative-kind runs suppresses the false-recall
//      penalty when the agent quoted forbidden terms inside a refutation,
//      and `denialDetected` is surfaced as telemetry.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeRunScores, determineMemoryRunStatus, detectDenial,
} from './memoryEvalEngine.ts'
import type { MemoryBenchmarkTask } from './memoryEvalStore.ts'

const baseTask: Omit<MemoryBenchmarkTask, 'id' | 'createdAt' | 'updatedAt'> = {
  platform: 'openclaw',
  agent: '',
  title: 't',
  kind: 'negative',
  query: 'q',
  expectedFacts: [],
  forbiddenFacts: ['Marbles', 'octopus'],
  providers: [],
  newerHints: [],
  rubric: '',
  notes: '',
  builtIn: false,
  builtInSlug: '',
}

const task = (overrides: Partial<MemoryBenchmarkTask>): MemoryBenchmarkTask => ({
  ...baseTask, id: 't1', createdAt: '', updatedAt: '', ...overrides,
})

describe('detectDenial', () => {
  it('detects "I don\'t have"', () => {
    assert.equal(detectDenial("I don't have an octopus."), true)
  })
  it('detects "no record of"', () => {
    assert.equal(detectDenial('There is no record of Marbles.'), true)
  })
  it('detects "you literally put"', () => {
    assert.equal(detectDenial('You literally put Marbles in the question.'), true)
  })
  it('does NOT flag affirmative answers as denials', () => {
    assert.equal(detectDenial('Marbles likes tank decorations shaped like pirate ships.'), false)
  })
  it('handles empty input', () => {
    assert.equal(detectDenial(''), false)
    assert.equal(detectDenial(null), false)
  })
})

describe('computeRunScores / negative-control denial', () => {
  it('suppresses false-recall penalty when refusal detected', () => {
    const r = computeRunScores({
      task: task({ kind: 'negative' }),
      retrievals: [{ provider: 'p', latencyMs: 100, hits: [], error: null }],
      appliedAnswer: "I don't have an octopus named Marbles — you literally put her in the question.",
      totalLatencyMs: 500,
    })
    assert.equal(r.denialDetected, true)
    assert.ok(r.scoringNote.includes('refusal'), `expected refusal note, got "${r.scoringNote}"`)
    // Forbidden terms ARE in the answer but the penalty is suppressed.
    assert.ok(r.answerHasForbidden > 0, 'forbidden facts should be detected in the answer')
    assert.equal(r.falseRecallPenalty, 0, 'penalty should be zero when refusal detected')
    assert.equal(r.usageAccuracy, 100, 'correct refusal → usageAccuracy = 100')
  })

  it('applies full penalty when no refusal detected', () => {
    const r = computeRunScores({
      task: task({ kind: 'negative' }),
      retrievals: [{ provider: 'p', latencyMs: 100, hits: [], error: null }],
      appliedAnswer: 'Marbles the octopus prefers tank decorations shaped like pirate ships.',
      totalLatencyMs: 500,
    })
    assert.equal(r.denialDetected, false)
    assert.ok(r.answerHasForbidden > 0)
    assert.ok(r.falseRecallPenalty > 0, 'penalty should fire on fabrication')
    assert.equal(r.usageAccuracy, 0, 'fabrication → usageAccuracy = 0')
  })
})

describe('determineMemoryRunStatus', () => {
  it('marks negative fabrication as failure even when composite > 0', () => {
    // Latency + coverage alone can keep composite > 0; previous code logged
    // this as success.
    const status = determineMemoryRunStatus(
      task({ kind: 'negative' }),
      {
        composite: 30,
        denialDetected: false,
        answerHasForbidden: 2,
        usageAccuracy: 0,
        hits: [],
      },
      'Marbles the octopus likes pirate ships.',
    )
    assert.equal(status, 'failure')
  })

  it('marks negative refusal as success', () => {
    const status = determineMemoryRunStatus(
      task({ kind: 'negative' }),
      {
        composite: 85,
        denialDetected: true,
        answerHasForbidden: 2, // mentioned, but inside a refusal
        usageAccuracy: 100,
        hits: [],
      },
      "I don't have an octopus.",
    )
    assert.equal(status, 'success')
  })

  it('marks empty applied answer as unresolved (not success)', () => {
    const status = determineMemoryRunStatus(
      task({ kind: 'applied', forbiddenFacts: [] }),
      { composite: 50, denialDetected: false, answerHasForbidden: 0, usageAccuracy: null as any, hits: [{} as any] },
      '   ',
    )
    assert.equal(status, 'unresolved')
  })

  it('marks no-signal runs as failure', () => {
    const status = determineMemoryRunStatus(
      task({ kind: 'recall' }),
      { composite: 0, denialDetected: false, answerHasForbidden: 0, usageAccuracy: null as any, hits: [] },
      null,
    )
    assert.equal(status, 'failure')
  })

  it('marks pure-retrieval success when composite > 0 and hits exist', () => {
    const status = determineMemoryRunStatus(
      task({ kind: 'recall', forbiddenFacts: [] }),
      { composite: 70, denialDetected: false, answerHasForbidden: 0, usageAccuracy: null as any, hits: [{} as any] },
      null,
    )
    assert.equal(status, 'success')
  })
})
