import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'

const testDir = join(tmpdir(), `mc-links-test-${randomUUID()}`)
const originalCwd = process.cwd()
let app: express.Express

before(async () => {
  mkdirSync(join(testDir, 'data'), { recursive: true })
  process.chdir(testDir)
  const { linksRouter } = await import('../routes/links.js')
  app = express()
  app.use(express.json())
  app.use('/api/links', linksRouter)
})

after(() => {
  process.chdir(originalCwd)
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /api/links', () => {
  test('returns empty links array on fresh store', async () => {
    const res = await request(app).get('/api/links')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.links))
    assert.equal(res.body.links.length, 0)
  })
})

describe('POST /api/links', () => {
  test('creates a link with required url', async () => {
    const res = await request(app).post('/api/links').send({ url: 'https://example.com', title: 'Example' })
    assert.equal(res.status, 201)
    assert.ok(res.body.link.id)
    assert.ok(res.body.link.url.startsWith('https://example.com'))
    assert.equal(res.body.link.title, 'Example')
  })

  test('returns 400 when url is missing', async () => {
    const res = await request(app).post('/api/links').send({ title: 'No URL' })
    assert.equal(res.status, 400)
    assert.ok(res.body.error)
  })

  test('created link appears in GET', async () => {
    await request(app).post('/api/links').send({ url: 'https://test.dev', title: 'Test' })
    const res = await request(app).get('/api/links')
    assert.ok(res.body.links.some((l: any) => l.url.startsWith('https://test.dev')))
  })
})

describe('PATCH /api/links/:id', () => {
  test('updates title of an existing link', async () => {
    const create = await request(app).post('/api/links').send({ url: 'https://patch.test', title: 'Old title' })
    const id = create.body.link.id
    const res = await request(app).patch(`/api/links/${id}`).send({ title: 'New title' })
    assert.equal(res.status, 200)
    assert.equal(res.body.link.title, 'New title')
  })

  test('returns 404 for unknown id', async () => {
    const res = await request(app).patch('/api/links/nonexistent-xyz').send({ title: 'x' })
    assert.equal(res.status, 404)
  })
})

describe('DELETE /api/links/:id', () => {
  test('deletes an existing link', async () => {
    const create = await request(app).post('/api/links').send({ url: 'https://delete.me', title: 'Delete me' })
    const id = create.body.link.id
    const del = await request(app).delete(`/api/links/${id}`)
    assert.equal(del.status, 200)
    const list = await request(app).get('/api/links')
    assert.ok(!list.body.links.some((l: any) => l.id === id))
  })

  test('returns 404 for unknown id', async () => {
    const res = await request(app).delete('/api/links/nonexistent-xyz')
    assert.equal(res.status, 404)
  })
})
