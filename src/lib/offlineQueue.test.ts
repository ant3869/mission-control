import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { enqueueOffline, flushOffline, listOffline } from './offlineQueue.js'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('offline capture queue', () => {
  it('flushes additive captures FIFO with stable idempotency keys', async () => {
    const storage = new MemoryStorage()
    enqueueOffline(storage, '/api/todos', { title: 'first' }, 'key-1')
    enqueueOffline(storage, '/api/tobuy', { title: 'second' }, 'key-2')
    const seen: Array<{ url: string; key: string | null }> = []
    await flushOffline(storage, 'https://example.test', async (url, init) => { seen.push({ url: String(url), key: new Headers(init?.headers).get('idempotency-key') }); return new Response('{}', { status: 201 }) })
    assert.deepEqual(seen, [{ url: 'https://example.test/api/todos', key: 'key-1' }, { url: 'https://example.test/api/tobuy', key: 'key-2' }])
    assert.equal(listOffline(storage).length, 0)
  })

  it('keeps the failed item and everything after it', async () => {
    const storage = new MemoryStorage(); enqueueOffline(storage, '/api/todos', {}, 'key-1'); enqueueOffline(storage, '/api/tobuy', {}, 'key-2')
    await flushOffline(storage, 'https://example.test', async () => new Response('{}', { status: 503 }))
    assert.deepEqual(listOffline(storage).map((item) => item.id), ['key-1', 'key-2'])
  })
})
