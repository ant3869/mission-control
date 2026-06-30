import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type express from 'express'
import request from 'supertest'

// Smoke coverage for the full app wiring. The point is to catch a router that
// regresses to a 500 (or fails to mount at all) — not to assert payload shapes,
// which the per-route tests own. Runs against the real local data layer in an
// isolated temp cwd, so only network-free routes are exercised here.
//
// Excluded on purpose: routes that make outbound calls (radar/news/modelops →
// AI APIs, chats/openclaw/hermes → gateways, calendar/bills → Google, memory →
// remote SSH/LanceDB). Those need their own integration tests with mocked
// transports; here they'd return a deliberate 503 (not-configured), not a crash.
const NETWORK_FREE_GETS = [
  '/api/tasks',
  '/api/todos',
  '/api/tobuy',
  '/api/notes',
  '/api/docs',
  '/api/links',
  '/api/projects',
  '/api/financials',
  '/api/inventory',
  '/api/budgets',
  '/api/alerts',
  '/api/approvals',
  '/api/incidents',
  '/api/journal',
  '/api/agents',
  '/api/evaluations',
  '/api/harness-bench',
  '/api/pipeline',
  '/api/inbox',
  '/api/settings/connectors',
  '/api/search?q=test',
]

const testDir = join(tmpdir(), `mc-app-smoke-${randomUUID()}`)
const originalCwd = process.cwd()
let app: express.Express

before(async () => {
  mkdirSync(join(testDir, 'data'), { recursive: true })
  process.chdir(testDir)
  // No DASHBOARD_TOKEN → auth gate is open, so routes are reachable.
  delete process.env.DASHBOARD_TOKEN
  const { createApp } = await import('./app.js')
  app = createApp()
})

after(() => {
  process.chdir(originalCwd)
  // Best-effort: the app opens process-lifetime SQLite singletons (evaluations,
  // inventory…) with no close() hook, so on Windows the file lock outlives the
  // test and rmSync would EBUSY. Leave the temp dir for the OS to reap.
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* locked DB file */ }
})

describe('GET /api/health', () => {
  test('returns 200 with ok flag and timestamp', async () => {
    const res = await request(app).get('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.body.ok, true)
    assert.ok(res.body.ts)
  })
})

describe('network-free GET routes never return a 5xx', () => {
  for (const path of NETWORK_FREE_GETS) {
    test(path, async () => {
      const res = await request(app).get(path)
      assert.ok(
        res.status < 500,
        `${path} returned ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`,
      )
    })
  }
})

describe('unknown API route', () => {
  test('does not 5xx on a missing endpoint', async () => {
    const res = await request(app).get('/api/definitely-not-a-route')
    assert.ok(res.status < 500)
  })
})

// The unit-level gate is covered in lib/dashboardAuth.test.ts; this verifies the
// real createApp() factory wires the session router + gate in the right order,
// i.e. that a configured token actually locks the app and a login cookie opens it.
describe('createApp enforces auth when a token is configured', () => {
  let secured: express.Express
  before(async () => {
    const { createApp } = await import('./app.js')
    secured = createApp({ dashboardToken: 'smoke-secret' })
  })

  test('gated route is 401 until a /session/login cookie is presented', async () => {
    assert.equal((await request(secured).get('/api/health')).status, 200) // public
    assert.equal((await request(secured).get('/api/tasks')).status, 401)  // gated

    const login = await request(secured).post('/api/session/login').send({ token: 'smoke-secret' })
    assert.equal(login.status, 200)
    const cookie = login.headers['set-cookie']
    assert.ok(cookie)

    const ok = await request(secured).get('/api/tasks').set('Cookie', cookie)
    assert.ok(ok.status < 500 && ok.status !== 401, `expected access, got ${ok.status}`)
  })

  test('wrong token stays locked out', async () => {
    assert.equal((await request(secured).post('/api/session/login').send({ token: 'nope' })).status, 401)
  })
})
