import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import { DashboardAuth, createDashboardAuthMiddleware } from '../lib/dashboardAuth.js'
import { createSessionRouter } from './session.js'

function appFor(auth: DashboardAuth) {
  const app = express()
  app.use(express.json())
  app.use('/api/session', createSessionRouter(auth))
  app.use(createDashboardAuthMiddleware(auth))
  app.get('/api/private', (_req, res) => res.json({ ok: true }))
  return app
}

describe('session routes', () => {
  it('reports whether authentication is required', async () => {
    const response = await request(appFor(new DashboardAuth('secret'))).get('/api/session/status').expect(200)
    assert.deepEqual(response.body, { required: true, authenticated: false })
  })

  it('rejects a bad dashboard token', async () => {
    await request(appFor(new DashboardAuth('secret'))).post('/api/session/login').send({ token: 'wrong' }).expect(401)
  })

  it('logs in, creates a pairing code, and pairs another client', async () => {
    const app = appFor(new DashboardAuth('secret'))
    const login = await request(app).post('/api/session/login').send({ token: 'secret' }).expect(200)
    const cookie = login.headers['set-cookie'][0].split(';')[0]
    await request(app).get('/api/private').set('Cookie', cookie).expect(200)

    const pairing = await request(app).post('/api/session/pairing-code').set('Cookie', cookie).expect(201)
    assert.match(pairing.body.code, /^\d{6}$/)

    const paired = await request(app).post('/api/session/pair').send({ code: pairing.body.code }).expect(200)
    assert.match(paired.headers['set-cookie'][0], /^mc_session=/)
    await request(app).post('/api/session/pair').send({ code: pairing.body.code }).expect(401)
  })

  it('clears the session cookie on logout', async () => {
    const app = appFor(new DashboardAuth('secret'))
    const login = await request(app).post('/api/session/login').send({ token: 'secret' }).expect(200)
    const cookie = login.headers['set-cookie'][0].split(';')[0]
    const response = await request(app).post('/api/session/logout').set('Cookie', cookie).expect(200)
    assert.match(response.headers['set-cookie'][0], /Max-Age=0/)
    await request(app).get('/api/private').set('Cookie', cookie).expect(401)
  })
})
