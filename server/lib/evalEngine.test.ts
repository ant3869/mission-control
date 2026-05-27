// title: Tests for transcript-derivation and outcome logic
// path: server/lib/evalEngine.test.ts
// run:  npm test
//
// Focuses on the two correctness fixes that landed in this audit:
//   1. Recovery detection no longer fires when the assistant message
//      preceded the last tool error (previous bug: any assistant message
//      anywhere in the transcript flipped recovered=true).
//   2. Assistant-text scanning uses a strict failure regex; legitimate
//      mentions of "exception" / "cannot" in normal prose do NOT mark
//      a run as having an error.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveFromTranscript } from './evalEngine.ts'

// Helpers — terse builders for the transcript shapes parseMessage understands.
const user = (text: string) => ({ role: 'user', content: text })
const assistantText = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })
const assistantTool = (name: string, args: any = {}) => ({
  role: 'assistant',
  content: [{ type: 'tool_use', name, input: args }],
})
const toolError = (name: string, errText = 'error: command failed') => ({
  role: 'tool',
  content: [{ type: 'tool_result', is_error: true, content: errText }],
})

describe('deriveFromTranscript / recovery position fix', () => {
  it('marks recovered when assistant text comes AFTER the tool error', () => {
    const q = deriveFromTranscript([
      user('do something'),
      assistantTool('shell', { cmd: 'ls' }),
      toolError('shell'),
      assistantText('I retried and got the listing.'),
    ], 'completed')
    assert.equal(q.outcome, 'recovered')
    assert.equal(q.hadError, true)
    assert.equal(q.recovered, true)
    assert.equal(q.noProgressTools, 1)
  })

  it('does NOT mark recovered when the only assistant text preceded the error', () => {
    const q = deriveFromTranscript([
      user('do something'),
      assistantText('starting now'),
      assistantTool('shell', { cmd: 'ls' }),
      toolError('shell'),
    ], 'completed')
    // Pre-fix this returned outcome='recovered' because seq.length was used
    // as a proxy for the assistant position, which is ≥ lastErrorIdx by
    // construction. Post-fix: stalled (assistant said something but never
    // produced a final reply after the error).
    assert.notEqual(q.outcome, 'recovered',
      `expected NOT recovered when assistant text precedes the error; got ${q.outcome}`)
  })

  it('marks success when no errors and clean assistant reply', () => {
    const q = deriveFromTranscript([
      user('hi'),
      assistantText('hello'),
    ], 'completed')
    assert.equal(q.outcome, 'success')
    assert.equal(q.hadError, false)
    assert.equal(q.recovered, false)
  })

  it('marks failure when error has no following assistant reply', () => {
    const q = deriveFromTranscript([
      user('do it'),
      assistantTool('shell'),
      toolError('shell'),
    ], 'completed')
    assert.equal(q.outcome, 'failure')
    assert.equal(q.recovered, false)
  })
})

describe('deriveFromTranscript / strict assistant-text scan', () => {
  it('does NOT flag assistant prose that merely mentions "exception"', () => {
    const q = deriveFromTranscript([
      user('explain'),
      assistantText('In Python, exceptions propagate up the call stack until caught.'),
    ], 'completed')
    assert.equal(q.hadError, false, 'word "exception" inside explanation should not mark hadError')
    assert.equal(q.outcome, 'success')
  })

  it('does NOT flag refusals containing "cannot"', () => {
    const q = deriveFromTranscript([
      user('what is X?'),
      assistantText("I cannot recall that fact."),
    ], 'completed')
    assert.equal(q.hadError, false)
    assert.equal(q.outcome, 'success')
  })

  it('DOES flag explicit self-reported failure', () => {
    const q = deriveFromTranscript([
      user('do task'),
      assistantText("I was unable to complete the request — aborting."),
    ], 'completed')
    assert.equal(q.hadError, true)
    // No tool errors, so it's not "failure", but hadError=true means it's
    // still recovery-checkable.
  })
})

describe('deriveFromTranscript / tool-quality counters', () => {
  it('counts consecutive identical tool calls as repeats', () => {
    const q = deriveFromTranscript([
      user('run'),
      assistantTool('shell', { command: 'ls' }),
      assistantTool('shell', { command: 'ls' }),
      assistantTool('shell', { command: 'ls' }),
      assistantText('done'),
    ], 'completed')
    assert.equal(q.toolCalls, 3)
    assert.equal(q.repeatedToolCalls, 2)
    assert.equal(q.outcome, 'success')
  })

  it('counts A,B,A oscillations', () => {
    const q = deriveFromTranscript([
      user('run'),
      assistantTool('a'),
      assistantTool('b'),
      assistantTool('a'),
      assistantTool('b'),
      assistantText('done'),
    ], 'completed')
    assert.ok(q.oscillations >= 2, `expected ≥ 2 oscillations, got ${q.oscillations}`)
  })

  it('counts tool errors as no-progress', () => {
    const q = deriveFromTranscript([
      user('run'),
      assistantTool('shell'),
      toolError('shell'),
      assistantTool('shell'),
      toolError('shell'),
      assistantText('giving up'),
    ], 'completed')
    assert.equal(q.noProgressTools, 2)
    assert.equal(q.hadError, true)
  })
})
