import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError, request } from './request.js'

describe('request', () => {
  it('adds query parameters and includes credentials', async () => {
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    const value = await request<{ ok: boolean }>({
      baseUrl: 'https://example.test', path: '/api/items', params: { page: 2 },
      fetcher: async (url, init) => {
        seenUrl = String(url); seenInit = init
        return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    assert.deepEqual(value, { ok: true })
    assert.equal(seenUrl, 'https://example.test/api/items?page=2')
    assert.equal(seenInit?.credentials, 'include')
  })

  it('serializes JSON bodies for mutations', async () => {
    let seenInit: RequestInit | undefined
    await request({ baseUrl: 'https://example.test', path: '/api/items', method: 'POST', body: { title: 'one' }, fetcher: async (_url, init) => {
      seenInit = init
      return new Response('{}', { status: 200 })
    } })
    assert.equal(seenInit?.body, '{"title":"one"}')
    assert.equal(new Headers(seenInit?.headers).get('content-type'), 'application/json')
  })

  it('throws a typed API error with the server message', async () => {
    await assert.rejects(
      request({ baseUrl: 'https://example.test', path: '/api/items', fetcher: async () => new Response('{"error":"denied"}', { status: 403 }) }),
      (error: unknown) => error instanceof ApiError && error.status === 403 && error.message === 'denied',
    )
  })
})
