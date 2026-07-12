import test from 'node:test'
import assert from 'node:assert/strict'
import {
  closeTopOverlay,
  registerOverlay,
  resetOverlayStackForTests,
} from './overlayStack.js'

test('closeTopOverlay closes only the most recently registered overlay', () => {
  resetOverlayStackForTests()
  const closed: string[] = []

  registerOverlay(() => closed.push('first'))
  registerOverlay(() => closed.push('second'))

  assert.equal(closeTopOverlay(), true)
  assert.deepEqual(closed, ['second'])
  assert.equal(closeTopOverlay(), true)
  assert.deepEqual(closed, ['second', 'first'])
  assert.equal(closeTopOverlay(), false)
})

test('overlay unregister cleanup is idempotent', () => {
  resetOverlayStackForTests()
  const closed: string[] = []
  const unregister = registerOverlay(() => closed.push('overlay'))

  unregister()
  unregister()

  assert.equal(closeTopOverlay(), false)
  assert.deepEqual(closed, [])
})

test('closeTopOverlay removes the entry before invoking onClose', () => {
  resetOverlayStackForTests()
  let closeCount = 0

  registerOverlay(() => {
    closeCount += 1
    assert.equal(closeTopOverlay(), false)
  })

  assert.equal(closeTopOverlay(), true)
  assert.equal(closeCount, 1)
  assert.equal(closeTopOverlay(), false)
})
