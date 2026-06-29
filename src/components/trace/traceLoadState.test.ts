import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { failedTraceState, initialTraceState, loadedTraceState } from './traceLoadState.js'
import type { TraceRun } from './types.js'

const run = { id: 'r1', name: 'Run', spans: [] } as unknown as TraceRun

describe('trace load state', () => {
  it('starts without invented data', () => {
    assert.deepEqual(initialTraceState(), { loading: true, run: null, error: null })
  })

  it('preserves a successful real trace', () => {
    assert.deepEqual(loadedTraceState(run), { loading: false, run, error: null })
  })

  it('preserves the real error and never creates a run', () => {
    assert.deepEqual(failedTraceState(new Error('HTTP 503')), { loading: false, run: null, error: 'HTTP 503' })
    assert.deepEqual(failedTraceState('offline'), { loading: false, run: null, error: 'offline' })
  })
})
