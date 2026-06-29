import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldRenderView } from './viewLifecycle.js'

describe('view lifecycle', () => {
  it('renders only the active view', () => {
    assert.equal(shouldRenderView('home', 'home'), true)
    assert.equal(shouldRenderView('home', 'todos'), false)
    assert.equal(shouldRenderView('todos', 'home'), false)
  })
})
