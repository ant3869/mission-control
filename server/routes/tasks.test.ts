import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'

const testDir = join(tmpdir(), `mc-tasks-test-${randomUUID()}`)
const originalCwd = process.cwd()
let app: express.Express

before(async () => {
  mkdirSync(join(testDir, 'data'), { recursive: true })
  process.chdir(testDir)
  const { tasksRouter } = await import('../routes/tasks.js')
  app = express()
  app.use(express.json())
  app.use('/api/tasks', tasksRouter)
})

after(() => {
  process.chdir(originalCwd)
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /api/tasks', () => {
  test('returns tasks array with fetchedAt', async () => {
    const res = await request(app).get('/api/tasks')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.tasks))
    assert.ok(res.body.fetchedAt)
  })
})

describe('POST /api/tasks', () => {
  test('creates a task with required title', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'Test task' })
    assert.equal(res.status, 201)
    assert.ok(res.body.task.id)
    assert.equal(res.body.task.title, 'Test task')
    assert.equal(res.body.task.status, 'queued')
    assert.equal(res.body.task.priority, 'medium')
  })

  test('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/tasks').send({})
    assert.equal(res.status, 400)
    assert.ok(res.body.error)
  })

  test('returns 400 when title is blank string', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '   ' })
    assert.equal(res.status, 400)
  })

  test('invalid priority defaults to medium', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'x', priority: 'ultra-urgent' })
    assert.equal(res.status, 201)
    assert.equal(res.body.task.priority, 'medium')
  })
})

describe('PATCH /api/tasks/:id', () => {
  test('updates status of an existing task', async () => {
    const create = await request(app).post('/api/tasks').send({ title: 'Patch me' })
    const id = create.body.task.id
    const res = await request(app).patch(`/api/tasks/${id}`).send({ status: 'completed' })
    assert.equal(res.status, 200)
    assert.equal(res.body.task.status, 'completed')
  })

  test('returns 404 for unknown id', async () => {
    const res = await request(app).patch('/api/tasks/nonexistent-id-xyz').send({ status: 'completed' })
    assert.equal(res.status, 404)
  })
})

describe('DELETE /api/tasks/:id', () => {
  test('removes a task and confirms it is gone', async () => {
    const create = await request(app).post('/api/tasks').send({ title: 'Delete me' })
    const id = create.body.task.id
    const del = await request(app).delete(`/api/tasks/${id}`)
    assert.equal(del.status, 200)
    assert.equal(del.body.ok, true)
    const list = await request(app).get('/api/tasks')
    assert.equal(list.body.tasks.find((t: any) => t.id === id), undefined)
  })
})
