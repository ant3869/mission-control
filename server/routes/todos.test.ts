import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'

const testDir = join(tmpdir(), `mc-todos-test-${randomUUID()}`)
const originalCwd = process.cwd()
let app: express.Express

before(async () => {
  mkdirSync(join(testDir, 'data'), { recursive: true })
  process.chdir(testDir)
  const { todosRouter } = await import('../routes/todos.js')
  app = express()
  app.use(express.json())
  app.use('/api/todos', todosRouter)
})

after(() => {
  process.chdir(originalCwd)
  rmSync(testDir, { recursive: true, force: true })
})

describe('GET /api/todos', () => {
  test('returns todos array', async () => {
    const res = await request(app).get('/api/todos')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.body.todos))
  })
})

describe('POST /api/todos', () => {
  test('creates a todo with defaults', async () => {
    const res = await request(app).post('/api/todos').send({ title: 'Buy milk' })
    assert.equal(res.status, 201)
    assert.equal(res.body.todo.title, 'Buy milk')
    assert.equal(res.body.todo.severity, 'medium')
    assert.equal(res.body.todo.done, false)
  })

  test('respects severity override', async () => {
    const res = await request(app).post('/api/todos').send({ title: 'Critical thing', severity: 'critical' })
    assert.equal(res.status, 201)
    assert.equal(res.body.todo.severity, 'critical')
  })

  test('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/todos').send({})
    assert.equal(res.status, 400)
  })

  test('invalid severity defaults to medium', async () => {
    const res = await request(app).post('/api/todos').send({ title: 'y', severity: 'catastrophic' })
    assert.equal(res.status, 201)
    assert.equal(res.body.todo.severity, 'medium')
  })
})

describe('PATCH /api/todos/:id', () => {
  test('marks a todo as done', async () => {
    const create = await request(app).post('/api/todos').send({ title: 'Finish plan' })
    const id = create.body.todo.id
    const res = await request(app).patch(`/api/todos/${id}`).send({ done: true })
    assert.equal(res.status, 200)
    assert.equal(res.body.todo.done, true)
    assert.ok(res.body.todo.completedAt)
  })

  test('returns 404 for unknown id', async () => {
    const res = await request(app).patch('/api/todos/not-a-real-id').send({ done: true })
    assert.equal(res.status, 404)
  })
})
