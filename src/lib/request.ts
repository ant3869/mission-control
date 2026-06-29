import { enqueueOffline, isOfflineCapture } from './offlineQueue'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions {
  baseUrl: string
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  params?: Record<string, string | number>
  fetcher?: typeof fetch
}

export async function request<T>({ baseUrl, path, method = 'GET', body, params, fetcher = fetch }: RequestOptions): Promise<T> {
  const url = new URL(path, baseUrl)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value))

  const offlineCapable = method === 'POST' && isOfflineCapture(path)
  const idempotencyKey: string = offlineCapable ? crypto.randomUUID() : ''
  const init: RequestInit = { method, credentials: 'include' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }
    init.body = JSON.stringify(body)
  }

  const storage = typeof localStorage === 'undefined' ? null : localStorage
  if (offlineCapable && storage && typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueOffline(storage, path, body, idempotencyKey)
    return { queued: true, offline: true, id: idempotencyKey } as T
  }
  let response: Response
  try { response = await fetcher(url.toString(), init) }
  catch (error) {
    if (!offlineCapable || !storage) throw error
    enqueueOffline(storage, path, body, idempotencyKey)
    return { queued: true, offline: true, id: idempotencyKey } as T
  }
  const json = await response.json().catch(() => ({ error: response.statusText })) as { error?: string }
  if (!response.ok) throw new ApiError(response.status, json.error ?? response.statusText)
  return json as T
}
