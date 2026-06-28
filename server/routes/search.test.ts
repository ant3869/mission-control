import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'

const testDir = join(tmpdir(), `mc-search-test-${randomUUID()}`)
const originalCwd = process.cwd()
let app: express.Express

before(async () => {
  mkdirSync(join(testDir, 'data'), { recursive: true })
  process.chdir(testDir)

  // Seed minimal test data
  writeFileSync(join(testDir, 'data', 'tasks.json'), JSON.stringify([
    { id: 't1', title: 'Deploy the app', description: 'ship it', status: 'queued', project: 'nexus' },
    { id: 't2', title: 'Unrelated item',  description: '',        status: 'queued', project: '' },
  ]))
  writeFileSync(join(testDir, 'data', 'todos.json'), JSON.stringify([
    { id: 'td1', title: 'Buy groceries', notes: 'milk and eggs', done: false, severity: 'low' },
    { id: 'td2', title: 'Done task',     notes: '',              done: true,  severity: 'low' },
  ]))
  writeFileSync(join(testDir, 'data', 'links.json'), JSON.stringify([
    { id: 'l1', title: 'Nexus Dashboard', url: 'http://localhost:5173', note: '', tags: ['dev'], archived: false, domain: 'localhost' },
  ]))
  writeFileSync(join(testDir, 'data', 'tobuy.json'), JSON.stringify([
    { id: 'b1', title: 'Keyboard', notes: 'mechanical', priority: 'high', purchased: false },
  ]))
  writeFileSync(join(testDir, 'data', 'projects.json'), JSON.stringify({
    p1: { id: 'p1', name: 'Nexus Command', description: 'dashboard', status: 'active' },
  }))

  const { searchRouter } = await import('../routes/search.js')
  app = express()
  app.use(express.json())
  app.use('/api/search', searchRouter)
})

after(() => {
  process.chdir(originalCwd)
  try { rmSync(testDir, { recursive: true, force: true }) } catch { /* ignore EBUSY from SQLite singleton */ }
})

describe('GET /api/search', () => {
  test('returns empty results for short query', async () => {
    const res = await request(app).get('/api/search?q=a')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.results, {})
  })

  test('returns empty results for blank query', async () => {
    const res = await request(app).get('/api/search?q=')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.results, {})
  })

  test('finds tasks by title', async () => {
    const res = await request(app).get('/api/search?q=deploy')
    assert.equal(res.status, 200)
    const tasks = res.body.results.tasks as any[]
    assert.ok(tasks.length >= 1)
    assert.ok(tasks.some((t: any) => t.id === 't1'))
  })

  test('finds todos by title, excludes done', async () => {
    const res = await request(app).get('/api/search?q=groceries')
    assert.equal(res.status, 200)
    const todos = res.body.results.todos as any[]
    assert.ok(todos.some((t: any) => t.id === 'td1'))
    assert.ok(!todos.some((t: any) => t.id === 'td2'))
  })

  test('finds links by title', async () => {
    const res = await request(app).get('/api/search?q=nexus')
    assert.equal(res.status, 200)
    const links = res.body.results.links as any[]
    assert.ok(links.some((l: any) => l.id === 'l1'))
  })

  test('finds tobuy items', async () => {
    const res = await request(app).get('/api/search?q=keyboard')
    assert.equal(res.status, 200)
    const tobuy = res.body.results.tobuy as any[]
    assert.ok(tobuy.some((b: any) => b.id === 'b1'))
  })

  test('finds projects', async () => {
    const res = await request(app).get('/api/search?q=nexus')
    assert.equal(res.status, 200)
    const projects = res.body.results.projects as any[]
    assert.ok(projects.some((p: any) => p.id === 'p1'))
  })

  test('result rows have kind field', async () => {
    const res = await request(app).get('/api/search?q=nexus')
    assert.equal(res.status, 200)
    const { tasks, links, projects } = res.body.results
    ;[...tasks, ...links, ...projects].forEach((r: any) => {
      assert.ok(r.kind, `missing kind on result: ${JSON.stringify(r)}`)
    })
  })
})
