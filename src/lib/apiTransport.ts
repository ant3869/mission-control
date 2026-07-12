const STORAGE_KEY = 'mc:server-base-url'
export const API_BASE_CHANGED_EVENT = 'mc:api-base-changed'

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'parse' | 'configuration'

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiFetchOptions {
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 127
}

export function validateApiBase(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const normalized = normalizeApiBase(value)
  if (!normalized) return { ok: false, error: 'Enter the Mission Control server URL.' }
  let url: URL
  try { url = new URL(normalized) }
  catch { return { ok: false, error: 'Enter a complete URL including https:// or http://.' } }
  if (url.pathname !== '/' || url.search || url.hash) return { ok: false, error: 'Use only the server origin, without a path, query, or fragment.' }
  if (url.protocol === 'https:') return { ok: true, value: normalized }
  const localName = url.hostname === 'localhost' || url.hostname.endsWith('.local')
  if (url.protocol === 'http:' && (localName || isPrivateIpv4(url.hostname))) return { ok: true, value: normalized }
  return { ok: false, error: 'Use HTTPS, or HTTP only for a private home-network address.' }
}

function readRuntimeBase(): string {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(STORAGE_KEY) ?? '' }
  catch { return '' }
}

function readBuildBase(): string {
  const meta = import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  return meta.env?.VITE_API_BASE_URL ?? ''
}

export function resolveApiBase(runtimeBase = readRuntimeBase(), buildBase = readBuildBase()): string {
  return normalizeApiBase(runtimeBase || buildBase)
}

export function getApiBaseUrl(): string {
  return resolveApiBase()
}

export function setApiBaseUrl(value: string): void {
  const result = validateApiBase(value)
  if (!result.ok) throw new ApiError('configuration', result.error)
  window.localStorage.setItem(STORAGE_KEY, result.value)
  window.dispatchEvent(new CustomEvent(API_BASE_CHANGED_EVENT, { detail: { baseUrl: result.value } }))
}

export function clearApiBaseUrl(): void {
  window.localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent(API_BASE_CHANGED_EVENT, { detail: { baseUrl: '' } }))
}

export function apiUrl(path: string, baseUrl = getApiBaseUrl()): string {
  if (!path.startsWith('/api/')) throw new ApiError('configuration', `API path must begin with /api/: ${path}`)
  const base = normalizeApiBase(baseUrl)
  return base ? new URL(path, `${base}/`).toString() : path
}

export function apiDownloadUrl(path: string): string {
  return apiUrl(path)
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, options: ApiFetchOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(apiUrl(path, options.baseUrl), { ...init, signal: controller.signal })
    const raw = await response.text()
    let payload: unknown = {}
    if (raw) {
      try { payload = JSON.parse(raw) }
      catch { throw new ApiError('parse', `Server returned invalid JSON for ${path}.`, response.status) }
    }
    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : response.statusText || `Request failed with ${response.status}`
      throw new ApiError('http', message, response.status)
    }
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new ApiError('timeout', `Request timed out after ${timeoutMs}ms.`)
    throw new ApiError('network', error instanceof Error ? error.message : 'Unable to reach the Mission Control server.')
  } finally {
    clearTimeout(timeout)
  }
}
