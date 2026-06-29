import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import {
  DashboardAuth,
  assertSafeBinding,
  createDashboardAuthMiddleware,
  isPublicApiPath,
  resolveApiHost,
  sessionCookie,
} from './dashboardAuth.js'

describe('dashboard authentication', () => {
  it('binds to loopback unless API_HOST is explicit', () => {
    assert.equal(resolveApiHost(undefined), '127.0.0.1')
    assert.equal(resolveApiHost(' 0.0.0.0 '), '0.0.0.0')
  })

  it('requires a dashboard token for non-loopback binding', () => {
    assert.doesNotThrow(() => assertSafeBinding('127.0.0.1', ''))
    assert.doesNotThrow(() => assertSafeBinding('::1', ''))
    assert.doesNotThrow(() => assertSafeBinding('0.0.0.0', 'secret'))
    assert.throws(() => assertSafeBinding('0.0.0.0', ''), /DASHBOARD_TOKEN/)
  })

  it('issues an opaque session only for the configured token', () => {
    const auth = new DashboardAuth('correct horse')
    assert.equal(auth.login('wrong horse'), null)
    const session = auth.login('correct horse')
    assert.match(session ?? '', /^[a-f0-9]{64}$/)
    assert.equal(auth.authenticateCookie(`other=x; mc_session=${session}`), true)
  })

  it('creates single-use pairing codes that expire after five minutes', () => {
    let now = 1_000
    const auth = new DashboardAuth('secret', { now: () => now })
    const owner = auth.login('secret')!
    const code = auth.createPairingCode(owner)
    assert.match(code ?? '', /^\d{6}$/)
    const paired = auth.exchangePairingCode(code!)
    assert.match(paired ?? '', /^[a-f0-9]{64}$/)
    assert.equal(auth.exchangePairingCode(code!), null)

    const second = auth.createPairingCode(owner)!
    now += 5 * 60_000 + 1
    assert.equal(auth.exchangePairingCode(second), null)
  })

  it('marks only bootstrap, callback, health, and push-auth routes public', () => {
    assert.equal(isPublicApiPath('GET', '/api/health'), true)
    assert.equal(isPublicApiPath('POST', '/api/session/login'), true)
    assert.equal(isPublicApiPath('POST', '/api/session/pair'), true)
    assert.equal(isPublicApiPath('GET', '/api/auth/google/callback'), true)
    assert.equal(isPublicApiPath('POST', '/api/openclaw/events'), true)
    assert.equal(isPublicApiPath('POST', '/api/hermes/events'), true)
    assert.equal(isPublicApiPath('GET', '/api/settings/connectors'), false)
  })

  it('protects private routes and permits the session cookie', async () => {
    const auth = new DashboardAuth('secret')
    const app = express()
    app.use(createDashboardAuthMiddleware(auth))
    app.get('/api/private', (_req, res) => res.json({ ok: true }))

    await request(app).get('/api/private').expect(401)
    const session = auth.login('secret')!
    await request(app).get('/api/private').set('Cookie', `mc_session=${session}`).expect(200, { ok: true })
  })

  it('allows local-only installs with no configured dashboard token', async () => {
    const app = express()
    app.use(createDashboardAuthMiddleware(new DashboardAuth('')))
    app.get('/api/private', (_req, res) => res.json({ ok: true }))
    await request(app).get('/api/private').expect(200, { ok: true })
  })

  it('uses an HttpOnly same-site cookie and adds Secure for HTTPS', () => {
    assert.equal(sessionCookie('abc', false).includes('HttpOnly'), true)
    assert.equal(sessionCookie('abc', false).includes('SameSite=Lax'), true)
    assert.equal(sessionCookie('abc', false).includes('Secure'), false)
    assert.equal(sessionCookie('abc', true).includes('Secure'), true)
  })
})
