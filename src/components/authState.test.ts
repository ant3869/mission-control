import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { authScreen } from './authState.js'

describe('authScreen', () => {
  it('waits while status is unknown', () => assert.equal(authScreen(null), 'loading'))
  it('shows login when authentication is required', () => assert.equal(authScreen({ required: true, authenticated: false }), 'login'))
  it('shows the app for authenticated and local-only installs', () => {
    assert.equal(authScreen({ required: true, authenticated: true }), 'ready')
    assert.equal(authScreen({ required: false, authenticated: true }), 'ready')
  })
})
