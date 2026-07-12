import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiError,
  apiFetch,
  apiUrl,
  normalizeApiBase,
  resolveApiBase,
  validateApiBase,
} from './apiTransport.js'

test('normalizeApiBase trims and removes trailing slashes', () => {
  assert.equal(normalizeApiBase('  https://hp-nexco.tailnet.ts.net/// '), 'https://hp-nexco.tailnet.ts.net')
})

test('resolveApiBase prefers runtime over build-time value', () => {
  assert.equal(resolveApiBase('https://runtime.example', 'https://build.example'), 'https://runtime.example')
  assert.equal(resolveApiBase('', 'https://build.example/'), 'https://build.example')
  assert.equal(resolveApiBase('', ''), '')
})

test('validateApiBase permits HTTPS and private-LAN HTTP only', () => {
  assert.deepEqual(validateApiBase('https://hp-nexco.example.ts.net'), { ok: true, value: 'https://hp-nexco.example.ts.net' })
  assert.deepEqual(validateApiBase('http://192.168.1.20:3001'), { ok: true, value: 'http://192.168.1.20:3001' })
  assert.equal(validateApiBase('http://example.com:3001').ok, false)
  assert.equal(validateApiBase('ftp://192.168.1.20').ok, false)
})

test('apiUrl preserves same-origin paths and builds absolute mobile URLs', () => {
  assert.equal(apiUrl('/api/health', ''), '/api/health')
  assert.equal(apiUrl('/api/health', 'https://hp-nexco.example.ts.net'), 'https://hp-nexco.example.ts.net/api/health')
  assert.throws(() => apiUrl('/health', ''), /must begin with \/api\//)
})

test('apiFetch returns parsed JSON', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
  const result = await apiFetch<{ ok: boolean }>('/api/health', {}, { fetchImpl: fetchImpl as typeof fetch })
  assert.deepEqual(result, { ok: true })
})

test('apiFetch returns typed HTTP and parse errors', async () => {
  const httpFetch = async () => new Response(JSON.stringify({ error: 'denied' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
  await assert.rejects(
    () => apiFetch('/api/health', {}, { fetchImpl: httpFetch as typeof fetch }),
    (error: unknown) => error instanceof ApiError && error.kind === 'http' && error.status === 403,
  )

  const parseFetch = async () => new Response('not-json', { status: 200 })
  await assert.rejects(
    () => apiFetch('/api/health', {}, { fetchImpl: parseFetch as typeof fetch }),
    (error: unknown) => error instanceof ApiError && error.kind === 'parse',
  )
})

test('apiFetch distinguishes timeout from network failure', async () => {
  const timeoutFetch = async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })
  await assert.rejects(
    () => apiFetch('/api/health', {}, { timeoutMs: 5, fetchImpl: timeoutFetch as typeof fetch }),
    (error: unknown) => error instanceof ApiError && error.kind === 'timeout',
  )

  const networkFetch = async () => { throw new TypeError('Failed to fetch') }
  await assert.rejects(
    () => apiFetch('/api/health', {}, { fetchImpl: networkFetch as typeof fetch }),
    (error: unknown) => error instanceof ApiError && error.kind === 'network',
  )
})
