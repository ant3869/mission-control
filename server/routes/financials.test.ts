import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'

const testDir = join(tmpdir(), `mc-financials-test-${randomUUID()}`)
const originalCwd = process.cwd()
let app: express.Express

before(async () => {
  mkdirSync(join(testDir, 'data'), { recursive: true })
  process.chdir(testDir)
  const { financialsRouter } = await import('../routes/financials.js')
  app = express()
  app.use(express.json())
  app.use('/api/financials', financialsRouter)
})

after(() => {
  process.chdir(originalCwd)
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /api/financials', () => {
  test('returns entries and summary', async () => {
    const res = await request(app).get('/api/financials')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.entries))
    assert.ok(typeof res.body.summary === 'object')
  })
})

describe('POST /api/financials', () => {
  test('creates an asset entry', async () => {
    const res = await request(app)
      .post('/api/financials')
      .send({ label: 'Savings', kind: 'asset', amount: 5000, category: 'cash' })
    assert.equal(res.status, 201)
    assert.equal(res.body.entry.label, 'Savings')
    assert.equal(res.body.entry.kind, 'asset')
    assert.equal(res.body.entry.amount, 5000)
  })

  test('returns 400 when label is missing', async () => {
    const res = await request(app).post('/api/financials').send({ amount: 100 })
    assert.equal(res.status, 400)
  })

  test('invalid kind defaults to asset', async () => {
    const res = await request(app)
      .post('/api/financials')
      .send({ label: 'Test', kind: 'banana', amount: 100 })
    assert.equal(res.status, 201)
    assert.equal(res.body.entry.kind, 'asset')
  })
})

describe('PATCH /api/financials/:id', () => {
  test('updates amount on existing entry', async () => {
    const create = await request(app)
      .post('/api/financials')
      .send({ label: 'Checking', kind: 'asset', amount: 1000, category: 'bank' })
    const id = create.body.entry.id
    const res = await request(app).patch(`/api/financials/${id}`).send({ amount: 2000 })
    assert.equal(res.status, 200)
    assert.equal(res.body.entry.amount, 2000)
  })
})

describe('DELETE /api/financials/:id', () => {
  test('removes an entry', async () => {
    const create = await request(app)
      .post('/api/financials')
      .send({ label: 'Old debt', kind: 'liability', amount: 500, category: 'other' })
    const id = create.body.entry.id
    const del = await request(app).delete(`/api/financials/${id}`)
    assert.equal(del.status, 200)
    assert.equal(del.body.ok, true)
  })
})
