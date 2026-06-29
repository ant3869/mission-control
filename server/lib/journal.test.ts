import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import { JournalStore, createJournalMiddleware } from './journal.js'
import { saveJson } from './jsonStore.js'

const resources: Array<{ dir: string; store: JournalStore }> = []
afterEach(() => {
  for (const { dir, store } of resources.splice(0)) {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-journal-'))
  const store = new JournalStore(join(dir, 'journal.sqlite'))
  resources.push({ dir, store })
  return { dir, store }
}

describe('operations journal', () => {
  it('records successful mutations and redacts secrets from its public feed', async () => {
    const { dir, store } = setup()
    const target = join(dir, 'settings.json')
    const app = express(); app.use(express.json()); app.use(createJournalMiddleware(store))
    app.post('/api/settings', (_req, res) => { saveJson(target, { token: 'top-secret', enabled: true }); res.status(201).json({ ok: true }) })

    await request(app).post('/api/settings').send({}).expect(201)
    const [entry] = store.list()
    assert.equal(entry.method, 'POST')
    assert.equal(entry.path, '/api/settings')
    assert.equal(entry.undoable, true)
    assert.equal(JSON.stringify(entry.changes).includes('top-secret'), false)
    assert.equal(JSON.stringify(entry.changes).includes('[REDACTED]'), true)
  })

  it('restores the previous JSON snapshot exactly once', () => {
    const { dir, store } = setup()
    const target = join(dir, 'state.json')
    writeFileSync(target, '{"value":1}', 'utf8')
    const id = store.record({ method: 'PATCH', path: '/api/state', status: 200, changes: [{ path: target, existed: true, before: { value: 1 }, after: { value: 2 } }] })
    writeFileSync(target, '{"value":2}', 'utf8')

    store.undo(id)
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { value: 1 })
    assert.throws(() => store.undo(id), /already undone/)
  })
})
