import test from 'node:test'
import assert from 'node:assert/strict'
import { popView, pushView } from './viewHistory.js'

test('pushView ignores same-view navigation', () => {
  assert.deepEqual(pushView([], 'home', 'home'), [])
  assert.deepEqual(pushView([], 'home', 'todos'), ['home'])
})

test('popView returns the latest view and remaining history', () => {
  assert.deepEqual(popView(['home', 'todos']), { history: ['home'], view: 'todos' })
  assert.deepEqual(popView([]), { history: [], view: null })
})
