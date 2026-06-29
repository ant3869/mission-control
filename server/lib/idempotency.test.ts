import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import { IdempotencyStore, createIdempotencyMiddleware } from './idempotency.js'

const resources: Array<{ dir: string; store: IdempotencyStore }> = []
afterEach(() => { for (const item of resources.splice(0)) { item.store.close(); rmSync(item.dir, { recursive: true, force: true }) } })

describe('idempotency middleware', () => {
  it('returns the first successful response for a repeated key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexus-idempotency-')); const store = new IdempotencyStore(join(dir, 'keys.sqlite')); resources.push({ dir, store })
    let calls = 0
    const app = express(); app.use(express.json()); app.use(createIdempotencyMiddleware(store)); app.post('/api/todos', (_req, res) => res.status(201).json({ id: ++calls }))
    const first = await request(app).post('/api/todos').set('Idempotency-Key', 'same-key').send({ title: 'one' }).expect(201)
    const second = await request(app).post('/api/todos').set('Idempotency-Key', 'same-key').send({ title: 'one' }).expect(201)
    assert.deepEqual(second.body, first.body)
    assert.equal(calls, 1)
  })
})
