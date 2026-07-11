# Mission Control Mobile Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an installable Google Pixel 9 Android app that preserves Mission Control's existing design, uses the existing Express backend, works through Tailscale away from home, and provides deliberate mobile layouts for Home, To-Do, Tasks, Approvals, Inbox, To-Buy, Calendar, Settings, search, and quick capture.

**Architecture:** Keep the current React/Vite frontend and package it with Capacitor 8. Add a runtime-selectable API origin, route every request through one transport layer, retain the current desktop shell at widths of 768px and above, and render a mobile shell with fixed top/bottom navigation below 768px. Keep Express bound to loopback for Tailscale Serve, with an explicit trusted-LAN binding fallback.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, Vite 5, Express 5, Node test runner through `tsx`, Capacitor 8, Android Gradle project, Tailscale Serve.

## Global Constraints

- Target device: Google Pixel 9; primary responsive reference viewport is 412px wide.
- Phone shell breakpoint: `< 768px`; tablet/desktop keeps the existing sidebar shell.
- Preserve all existing Mission Control design tokens and semantic accent meanings.
- Do not run the Express backend inside Android.
- Do not expose Express directly to the public internet.
- Primary remote access is Tailscale Serve over HTTPS; LAN HTTP is trusted-network fallback only.
- No full offline mutation queue in Milestone 1.
- Minimum mobile interactive target is 44px; bottom navigation targets are at least 48px high.
- Mobile inputs use a minimum 16px font size.
- No page-level horizontal scrolling; wide charts/grids may pan only inside bounded containers.
- Existing desktop behavior is a regression requirement.
- Keep implementation focused; do not refactor unrelated systems.

---

## File Structure

### New files

- `src/lib/apiTransport.ts` — runtime API origin, validation, URL construction, timeout/error handling.
- `src/lib/apiTransport.test.ts` — transport precedence, validation, URL, timeout, HTTP, parse, and network tests.
- `server/lib/serverConfig.ts` — API host and CORS configuration.
- `server/lib/serverConfig.test.ts` — host and CORS tests.
- `src/lib/native.ts` — Capacitor detection, system-bar setup, external browser, resume, and Android back helpers.
- `src/lib/overlayStack.ts` — LIFO overlay dismissal for Escape and Android back.
- `src/lib/overlayStack.test.ts` — overlay ordering tests.
- `src/lib/viewHistory.ts` — pure navigation history operations.
- `src/lib/viewHistory.test.ts` — navigation history tests.
- `src/hooks/useMediaQuery.ts` — reactive phone-breakpoint hook.
- `src/contexts/ServerConnectionContext.tsx` — global health and configured-server state.
- `src/components/mobile/ServerSetupScreen.tsx` — first-launch server configuration.
- `src/components/mobile/MobileBottomNav.tsx` — Home, To-Do, Calendar, Activity, More.
- `src/components/mobile/MobileMoreSheet.tsx` — full navigation grouped by existing sections.
- `src/components/layout/ConnectionBanner.tsx` — persistent offline/degraded recovery controls.
- `src/components/layout/navConfig.ts` — shared view titles and navigation metadata.
- `src/hooks/useNavBadges.ts` — shared desktop/mobile badge loading.
- `docs/mobile/PIXEL9_SETUP.md` — build, APK, Tailscale, LAN, and troubleshooting runbook.

### Modified foundation files

- `package.json`
- `package-lock.json`
- `.env.example`
- `capacitor.config.ts`
- `android/app/src/main/AndroidManifest.xml`
- `src/main.tsx`
- `src/App.tsx`
- `src/index.css`
- `src/lib/api.ts`
- `src/lib/dataRefresh.ts`
- `src/hooks/useEscapeKey.ts`
- `server/index.ts`

### Modified layout and daily-use files

- `src/components/layout/Sidebar.tsx`
- `src/components/layout/TopBar.tsx`
- `src/components/layout/TabHub.tsx`
- `src/views/Home.tsx`
- `src/views/TodoTasks.tsx`
- `src/views/Todos.tsx`
- `src/views/Tasks.tsx`
- `src/views/Approvals.tsx`
- `src/views/Inbox.tsx`
- `src/views/ToBuy.tsx`
- `src/views/ScheduledTasks.tsx`
- `src/views/Settings.tsx`

### Request migration files

- `src/components/ThoughtFlow.tsx`
- `src/views/Alerts.tsx`
- `src/views/Brain.tsx`
- `src/views/Flow.tsx`
- `src/views/FlowMap.tsx`
- `src/views/Memory.tsx`
- `src/views/PlatformMetrics.tsx`
- `src/views/Security.tsx`
- `src/views/Watch.tsx`

---

### Task 1: Centralize API origin and transport

**Files:**
- Create: `src/lib/apiTransport.ts`
- Create: `src/lib/apiTransport.test.ts`
- Modify: `src/lib/api.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizeApiBase(value: string): string`
- Produces: `validateApiBase(value: string): { ok: true; value: string } | { ok: false; error: string }`
- Produces: `resolveApiBase(runtimeBase?: string, buildBase?: string): string`
- Produces: `getApiBaseUrl(): string`
- Produces: `setApiBaseUrl(value: string): void`
- Produces: `clearApiBaseUrl(): void`
- Produces: `apiUrl(path: string, baseUrl?: string): string`
- Produces: `apiDownloadUrl(path: string): string`
- Produces: `apiFetch<T>(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<T>`
- Produces: `API_BASE_CHANGED_EVENT = 'mc:api-base-changed'`

- [ ] **Step 1: Add a focused frontend test command**

Update `package.json` scripts to retain the existing full test command and add a narrow command:

```json
{
  "scripts": {
    "test": "node --import tsx --test \"server/**/*.test.ts\" \"src/**/*.test.ts\"",
    "test:mobile": "node --import tsx --test \"src/**/*.test.ts\""
  }
}
```

- [ ] **Step 2: Write transport tests before implementation**

Create `src/lib/apiTransport.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests and confirm the intended failure**

Run:

```powershell
npm run test:mobile
```

Expected: failure because `src/lib/apiTransport.ts` does not exist.

- [ ] **Step 4: Implement the transport module**

Create `src/lib/apiTransport.ts` with these behaviors:

```ts
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
```

- [ ] **Step 5: Refactor `src/lib/api.ts` helpers to use `apiFetch`**

Replace the module-level `API_BASE` constant and all five private request helpers with:

```ts
import { apiFetch, apiUrl, ApiError } from './apiTransport.js'
export { apiUrl, ApiError }

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) query.set(key, String(value))
  const suffix = query.size ? `?${query.toString()}` : ''
  return apiFetch<T>(`/api${path}${suffix}`)
}

function post<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function put<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function del<T>(path: string): Promise<T> {
  return apiFetch<T>(`/api${path}`, { method: 'DELETE' })
}
```

Change `auth.googleAuthUrl` to:

```ts
googleAuthUrl: () => apiUrl('/api/auth/google'),
```

- [ ] **Step 6: Run transport and full tests**

Run:

```powershell
npm run test:mobile
npm test
npm run build
```

Expected: all tests pass and Vite builds successfully.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json src/lib/apiTransport.ts src/lib/apiTransport.test.ts src/lib/api.ts
git commit -m "feat(mobile): centralize runtime API transport"
```

---

### Task 2: Migrate every direct API and SSE call

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/ThoughtFlow.tsx`
- Modify: `src/lib/dataRefresh.ts`
- Modify: `src/views/Alerts.tsx`
- Modify: `src/views/Brain.tsx`
- Modify: `src/views/Flow.tsx`
- Modify: `src/views/FlowMap.tsx`
- Modify: `src/views/Home.tsx`
- Modify: `src/views/Memory.tsx`
- Modify: `src/views/PlatformMetrics.tsx`
- Modify: `src/views/Security.tsx`
- Modify: `src/views/Settings.tsx`
- Modify: `src/views/ToBuy.tsx`
- Modify: `src/views/Todos.tsx`
- Modify: `src/views/Watch.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `apiUrl`, `apiDownloadUrl`, `API_BASE_CHANGED_EVENT` from Task 1.
- Produces: no direct relative `/api` fetch, EventSource, OAuth, or download URL in frontend code.

- [ ] **Step 1: Replace local CRUD wrappers in To-Do and To-Buy**

In `Todos.tsx` and `ToBuy.tsx`, import `apiFetch` and replace each `fetch` wrapper with direct typed calls. Example for To-Do:

```ts
import { apiFetch } from '../lib/apiTransport'

const fetchTodos = () => apiFetch<{ todos: Todo[] }>('/api/todos')
const createTodo = (body: { title: string; severity: Severity; horizon: Horizon; dueDate?: string; details?: TodoDetails; rawInput?: string }) =>
  apiFetch<{ todo: Todo }>('/api/todos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
const patchTodo = (id: string, body: TodoPatch) =>
  apiFetch<{ todo: Todo }>(`/api/todos/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
const deleteTodo = (id: string) => apiFetch<Record<string, never>>(`/api/todos/${encodeURIComponent(id)}`, { method: 'DELETE' })
const clearDone = () => apiFetch<{ removed: number }>('/api/todos/clear-done', { method: 'POST' })
```

Apply the equivalent implementation to `/api/tobuy`.

- [ ] **Step 2: Replace dashboard and shell fetches**

Use `apiFetch` in `App.tsx`, `Sidebar.tsx`, `TopBar.tsx`, and `Home.tsx`. Preserve existing `Promise.allSettled` concurrency. Example:

```ts
apiFetch<{ todos: HomeTodo[] }>('/api/todos')
apiFetch<{ alerts: FiredAlert[] }>('/api/alerts/active')
apiFetch<{ files: Array<{ id: string; filename: string; preview?: string; updatedAgo?: string }> }>('/api/docs/files')
```

Do not convert parallel reads into sequential awaits.

- [ ] **Step 3: Replace monitoring-view fetches**

Use `apiFetch` in every listed monitoring file. Encode dynamic path segments with `encodeURIComponent`. Do not change response mapping or view behavior.

- [ ] **Step 4: Make SSE runtime-origin aware and restartable**

Update `src/lib/dataRefresh.ts`:

```ts
import { API_BASE_CHANGED_EVENT, apiUrl } from './apiTransport.js'

// inside connect()
es = new EventSource(apiUrl('/api/watch/stream'))

// after connect()
const restart = () => {
  es?.close()
  es = null
  if (retryTimer) clearTimeout(retryTimer)
  retryDelay = 5_000
  connect()
}
window.addEventListener(API_BASE_CHANGED_EVENT, restart)

// cleanup
window.removeEventListener(API_BASE_CHANGED_EVENT, restart)
```

Apply `apiUrl` to all other EventSource constructors in `PlatformMetrics.tsx`, `ThoughtFlow.tsx`, `Watch.tsx`, and `Memory.tsx`.

- [ ] **Step 5: Convert Settings export URL**

Replace `href="/api/export"` with `href={apiDownloadUrl('/api/export')}`. Native browser behavior is completed in Task 12.

- [ ] **Step 6: Verify no direct API origins remain**

Run:

```powershell
git grep -nE "fetch\((['\x60])/api" -- src
git grep -nE "new EventSource\((['\x60])/api" -- src
git grep -n 'href="/api' -- src
```

Expected: no output.

- [ ] **Step 7: Run verification and commit**

```powershell
npm test
npm run build
git add src
git commit -m "fix(mobile): route all frontend traffic through API transport"
```

---

### Task 3: Bind Express safely and make CORS testable

**Files:**
- Create: `server/lib/serverConfig.ts`
- Create: `server/lib/serverConfig.test.ts`
- Modify: `server/index.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `resolveApiHost(env?: NodeJS.ProcessEnv): string`
- Produces: `buildAllowedOrigins(env?: NodeJS.ProcessEnv): Set<string>`
- Produces: `isOriginAllowed(origin: string | undefined, allowed: Set<string>): boolean`
- Produces: `/api/health` response `{ ok, ts, hostname, version }`.

- [ ] **Step 1: Write server configuration tests**

Create `server/lib/serverConfig.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAllowedOrigins, isOriginAllowed, resolveApiHost } from './serverConfig.js'

test('API host defaults to loopback and accepts explicit LAN binding', () => {
  assert.equal(resolveApiHost({}), '127.0.0.1')
  assert.equal(resolveApiHost({ API_HOST: '0.0.0.0' }), '0.0.0.0')
})

test('Capacitor HTTPS origin and configured origins are accepted', () => {
  const allowed = buildAllowedOrigins({ CORS_ORIGINS: 'https://hp-nexco.example.ts.net, https://other.example' })
  assert.equal(allowed.has('https://localhost'), true)
  assert.equal(allowed.has('https://hp-nexco.example.ts.net'), true)
  assert.equal(isOriginAllowed(undefined, allowed), true)
  assert.equal(isOriginAllowed('https://unknown.example', allowed), false)
})
```

- [ ] **Step 2: Run the failing test**

```powershell
node --import tsx --test server/lib/serverConfig.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement server configuration**

Create `server/lib/serverConfig.ts`:

```ts
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
]

export function resolveApiHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.API_HOST?.trim() || '127.0.0.1'
}

export function buildAllowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = (env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return new Set([...DEFAULT_ORIGINS, ...configured])
}

export function isOriginAllowed(origin: string | undefined, allowed: Set<string>): boolean {
  return !origin || allowed.has(origin)
}
```

- [ ] **Step 4: Wire host, CORS, and health metadata**

In `server/index.ts`:

```ts
import os from 'node:os'
import { buildAllowedOrigins, isOriginAllowed, resolveApiHost } from './lib/serverConfig.js'

const PORT = Number(process.env.API_PORT ?? 3001)
const HOST = resolveApiHost()
const allowedOrigins = buildAllowedOrigins()

app.use(cors({
  origin(origin, callback) {
    callback(isOriginAllowed(origin, allowedOrigins) ? null : new Error(`Origin not allowed: ${origin}`), isOriginAllowed(origin, allowedOrigins))
  },
  credentials: true,
}))

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  ts: new Date().toISOString(),
  hostname: os.hostname(),
  version: process.env.npm_package_version ?? 'unknown',
}))

app.listen(PORT, HOST, () => {
  console.log(`Mission Control API → http://${HOST}:${PORT}`)
  // retain current collector and Discord startup
})
```

Calculate `const allowed = isOriginAllowed(...)` once inside the CORS callback rather than calling it twice in final code.

- [ ] **Step 5: Document environment values**

Add to `.env.example`:

```env
# Loopback is safest and is the default for Tailscale Serve.
API_HOST=127.0.0.1
API_PORT=3001

# Optional comma-separated browser origins. Capacitor origins are built in.
CORS_ORIGINS=
```

Keep `VITE_API_BASE_URL` as an optional build-time fallback, but state that Android normally saves the server URL at runtime.

- [ ] **Step 6: Test and commit**

```powershell
npm test
npm run build
git add server/index.ts server/lib/serverConfig.ts server/lib/serverConfig.test.ts .env.example
git commit -m "feat(server): add loopback binding and mobile CORS policy"
```

---

### Task 4: Add native platform services and overlay dismissal

**Files:**
- Create: `src/lib/native.ts`
- Create: `src/lib/overlayStack.ts`
- Create: `src/lib/overlayStack.test.ts`
- Modify: `src/hooks/useEscapeKey.ts`
- Modify: `src/main.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Produces: `isNativeApp(): boolean`
- Produces: `initializeNativeUi(): Promise<void>`
- Produces: `openExternal(url: string): Promise<void>`
- Produces: `onAppResume(callback: () => void): () => void`
- Produces: `onAndroidBack(callback: () => void): () => void`
- Produces: `exitAndroidApp(): Promise<void>`
- Produces: `registerOverlay(onClose: () => void): () => void`
- Produces: `closeTopOverlay(): boolean`

- [ ] **Step 1: Install matching Capacitor 8 plugins**

```powershell
npm install @capacitor/app@^8.0.0 @capacitor/browser@^8.0.0 @capacitor/status-bar@^8.0.0
```

- [ ] **Step 2: Write overlay-stack tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { closeTopOverlay, registerOverlay, resetOverlayStackForTests } from './overlayStack.js'

test('closes only the most recently registered overlay', () => {
  const closed: string[] = []
  const removeFirst = registerOverlay(() => closed.push('first'))
  const removeSecond = registerOverlay(() => closed.push('second'))
  assert.equal(closeTopOverlay(), true)
  assert.deepEqual(closed, ['second'])
  removeSecond()
  assert.equal(closeTopOverlay(), true)
  assert.deepEqual(closed, ['second', 'first'])
  removeFirst()
  resetOverlayStackForTests()
})
```

- [ ] **Step 3: Implement overlay stack**

```ts
type Entry = { id: number; onClose: () => void }
let nextId = 1
let stack: Entry[] = []

export function registerOverlay(onClose: () => void): () => void {
  const entry = { id: nextId++, onClose }
  stack = [...stack, entry]
  return () => { stack = stack.filter(item => item.id !== entry.id) }
}

export function closeTopOverlay(): boolean {
  const top = stack.at(-1)
  if (!top) return false
  top.onClose()
  return true
}

export function resetOverlayStackForTests(): void {
  stack = []
  nextId = 1
}
```

- [ ] **Step 4: Extend `useEscapeKey` to register overlays**

```ts
import { useEffect } from 'react'
import { registerOverlay } from '../lib/overlayStack.js'

export function useEscapeKey(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return
    const unregister = registerOverlay(onEscape)
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscape()
      }
    }
    window.addEventListener('keydown', handler)
    return () => {
      unregister()
      window.removeEventListener('keydown', handler)
    }
  }, [onEscape, active])
}
```

- [ ] **Step 5: Implement native helpers**

`src/lib/native.ts` must use Capacitor's plugin APIs and no-op in browsers. Use `App as CapacitorApp`, `Browser`, `StatusBar`, and `Style.Dark`. `openExternal` uses `Browser.open({ url })` natively and `window.open(url, '_blank', 'noopener,noreferrer')` on web. Listener helpers return a synchronous cleanup closure that removes the plugin listener after its promise resolves.

- [ ] **Step 6: Initialize dark system UI before rendering**

In `src/main.tsx`:

```ts
import { initializeNativeUi } from './lib/native'

void initializeNativeUi()
```

Keep the existing StrictMode render.

- [ ] **Step 7: Keep cleartext permission only for validated LAN origins**

Retain `android:usesCleartextTraffic="true"` because arbitrary private LAN IPs cannot be enumerated in a static Android network-security file. Add an XML comment in the manifest noting that `validateApiBase` rejects public HTTP origins; HTTPS remains required for non-private hosts.

- [ ] **Step 8: Test, sync, and commit**

```powershell
npm run test:mobile
npm run build
npx cap sync android
git add package.json package-lock.json src/lib/native.ts src/lib/overlayStack.ts src/lib/overlayStack.test.ts src/hooks/useEscapeKey.ts src/main.tsx android
git commit -m "feat(mobile): add Capacitor lifecycle and overlay services"
```

---

### Task 5: Add server setup and global connection state

**Files:**
- Create: `src/contexts/ServerConnectionContext.tsx`
- Create: `src/components/mobile/ServerSetupScreen.tsx`
- Create: `src/components/layout/ConnectionBanner.tsx`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces context type:

```ts
export type ConnectionStatus = 'checking' | 'online' | 'degraded' | 'offline' | 'misconfigured'
export interface HealthPayload { ok: boolean; ts: string; hostname: string; version: string }
export interface ServerProbe { health: HealthPayload; latencyMs: number; baseUrl: string }
export interface ServerConnectionValue {
  status: ConnectionStatus
  baseUrl: string
  health: HealthPayload | null
  latencyMs: number | null
  error: string
  retry(): Promise<void>
  test(candidate: string): Promise<ServerProbe>
  save(candidate: string): Promise<ServerProbe>
  reset(): void
}
```

- [ ] **Step 1: Implement provider health probing**

Use `apiFetch<HealthPayload>('/api/health', {}, { baseUrl, timeoutMs: 8_000 })`. On native with no runtime/build URL, set `misconfigured`. Poll every 30 seconds while visible. Listen to `online`, `offline`, `visibilitychange`, `API_BASE_CHANGED_EVENT`, and Capacitor resume. Preserve the last successful health payload when a later check fails.

- [ ] **Step 2: Build the first-launch setup screen**

`ServerSetupScreen` contains:

- Mission Control icon and existing dark palette.
- 16px URL input.
- `Test connection` button.
- Success card showing hostname, version, and latency.
- Error card showing the typed transport message.
- `Save and open Mission Control` enabled only when the current input exactly matches the last successful probe.
- Example text: `https://hp-nexco.<your-tailnet>.ts.net` and `http://192.168.x.x:3001`.

The component calls `connection.test(input)` and `connection.save(input)`; it does not access localStorage directly.

- [ ] **Step 3: Build the recovery banner**

`ConnectionBanner` renders only for `offline` or `degraded` and includes:

```tsx
<button onClick={() => void retry()} className="min-h-11 px-3 ...">Retry</button>
<button onClick={onOpenSettings} className="min-h-11 px-3 ...">Server settings</button>
```

Use amber for degraded and red for offline. Do not obscure the fixed mobile bottom bar.

- [ ] **Step 4: Wrap the app**

In `main.tsx`:

```tsx
<StrictMode>
  <ServerConnectionProvider>
    <App />
  </ServerConnectionProvider>
</StrictMode>
```

In `App.tsx`, before the normal shell:

```tsx
const connection = useServerConnection()
if (connection.status === 'misconfigured') return <ServerSetupScreen />
```

Render `ConnectionBanner` immediately below `TopBar`; its Settings action navigates to `settings`.

- [ ] **Step 5: Test failure and recovery manually in browser**

Run:

```powershell
npm run dev
```

Browser checks:

1. Set `mc:server-base-url` to `http://192.168.255.254:3001` in devtools.
2. Reload and confirm the persistent recovery banner.
3. Clear the key and confirm normal same-origin web behavior.
4. Use device emulation and `Capacitor.isNativePlatform` test override only in a temporary local debug; do not commit the override.

- [ ] **Step 6: Verify and commit**

```powershell
npm test
npm run build
git add src/main.tsx src/App.tsx src/contexts/ServerConnectionContext.tsx src/components/mobile/ServerSetupScreen.tsx src/components/layout/ConnectionBanner.tsx
git commit -m "feat(mobile): add runtime server setup and connection recovery"
```

---

### Task 6: Build shared navigation, mobile shell, history, and Android back

**Files:**
- Create: `src/components/layout/navConfig.ts`
- Create: `src/hooks/useNavBadges.ts`
- Create: `src/hooks/useMediaQuery.ts`
- Create: `src/lib/viewHistory.ts`
- Create: `src/lib/viewHistory.test.ts`
- Create: `src/components/mobile/MobileBottomNav.tsx`
- Create: `src/components/mobile/MobileMoreSheet.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `NAV_SECTIONS`, `BOTTOM_NAV`, `VIEW_TITLES`.
- Produces: `useNavBadges(): { getBadge(view: View): number | undefined; healthWarning: boolean }`.
- Produces: `pushView(history: View[], current: View, next: View): View[]`.
- Produces: `popView(history: View[]): { history: View[]; view: View | null }`.

- [ ] **Step 1: Write view-history tests**

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { popView, pushView } from './viewHistory.js'

test('pushView ignores same-view navigation', () => {
  assert.deepEqual(pushView([], 'home', 'home'), [])
  assert.deepEqual(pushView([], 'home', 'todos'), ['home'])
})

test('popView returns the latest view and remaining history', () => {
  assert.deepEqual(popView(['home', 'todos']), { history: ['home'], view: 'todos' })
  assert.deepEqual(popView([]), { history: [], view: null })
})
```

- [ ] **Step 2: Extract navigation metadata**

Move the current Sidebar section definitions and App view titles to `navConfig.ts`. Store Lucide icon components rather than rendered nodes:

```ts
export type NavItem = { id: View; label: string; Icon: LucideIcon }
export type NavSection = { label: string; items: NavItem[] }
export const BOTTOM_NAV: View[] = ['home', 'todos', 'calendar', 'activity']
```

Keep every current label and grouping unchanged.

- [ ] **Step 3: Extract badge loading**

Move Sidebar's 30-second count loading to `useNavBadges`. Use `apiFetch` or existing typed API clients. Return the combined To-Do badge, To-Buy badge, Health badge, and `healthWarning`.

- [ ] **Step 4: Implement reactive breakpoint hook**

```ts
import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}
```

- [ ] **Step 5: Build More sheet and bottom navigation**

`MobileBottomNav` is fixed at the bottom, uses `env(safe-area-inset-bottom)`, renders four direct destinations plus More, and uses 48px minimum targets. `MobileMoreSheet` uses all `NAV_SECTIONS`, registers through `useEscapeKey`, closes after selection, and displays badges from `useNavBadges`.

- [ ] **Step 6: Refactor Sidebar to shared configuration**

Remove its local `NAV` and badge effects. Render `NAV_SECTIONS` and `useNavBadges`; preserve expanded/collapsed desktop markup.

- [ ] **Step 7: Add view history and mobile mounted-view policy to App**

Use `useMediaQuery('(max-width: 767px)')`. Keep `historyRef` and call `pushView` only when the target differs. Desktop continues to render all previously visited panes; mobile passes a set containing only `activeView` to `ViewPane`.

- [ ] **Step 8: Implement Android back order**

Register `onAndroidBack` in `App.tsx`:

```ts
return onAndroidBack(() => {
  if (closeTopOverlay()) return
  const popped = popView(historyRef.current)
  historyRef.current = popped.history
  if (popped.view) { replaceView(popped.view); return }
  if (activeViewRef.current !== 'home') { replaceView('home'); return }
  void exitAndroidApp()
})
```

Use refs for the current active view so the listener is not repeatedly recreated.

- [ ] **Step 9: Render desktop or mobile shell**

- Desktop: existing Sidebar + TopBar.
- Mobile: no Sidebar, compact TopBar from Task 7, content, fixed MobileBottomNav.
- Main content bottom padding equals bottom navigation height plus safe-area inset.
- Move mobile critical-alert toast above bottom navigation.

- [ ] **Step 10: Verify and commit**

```powershell
npm run test:mobile
npm test
npm run build
git add src/App.tsx src/components/layout/Sidebar.tsx src/components/layout/navConfig.ts src/components/mobile src/hooks/useMediaQuery.ts src/hooks/useNavBadges.ts src/lib/viewHistory.ts src/lib/viewHistory.test.ts
git commit -m "feat(mobile): add responsive shell and Android navigation"
```

---

### Task 7: Make shared top bar, search, tabs, and global CSS phone-native

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/TabHub.tsx`
- Modify: `src/index.css`
- Modify: `src/App.tsx`

**Interfaces:**
- `TopBar` gains `mobile?: boolean`.
- Existing search and quick-capture behavior stays available to both shells.

- [ ] **Step 1: Add mobile-safe root sizing and safe-area utilities**

Add to `src/index.css`:

```css
html, body, #root { height: 100%; min-height: 100%; overflow: hidden; }
body { overscroll-behavior: none; }

.app-shell { height: 100vh; height: 100dvh; }
.safe-top { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
.mobile-content-bottom { padding-bottom: calc(4rem + env(safe-area-inset-bottom)); }

@media (max-width: 767px) {
  input, select, textarea { font-size: 16px; }
  button, a { -webkit-tap-highlight-color: transparent; }
  .touch-target { min-height: 44px; min-width: 44px; }
}
```

Honor `prefers-reduced-motion` by disabling nonessential rise, drawer, radar, and ticker animations.

- [ ] **Step 2: Add `mobile` rendering to TopBar**

Mobile header:

- Height 56px plus top safe area.
- Title truncates.
- Connectivity, quick add, and search are icon buttons with 44px targets.
- Pause button is hidden and appears in More sheet.
- Desktop markup and shortcut labels remain unchanged.

- [ ] **Step 3: Convert connectivity popover from hover-only to click-capable**

The button toggles `open` on click. Use `useEscapeKey(() => setOpen(false), open)`. Desktop hover may still open it, but click must work independently.

- [ ] **Step 4: Make global search full-screen on mobile**

Change the overlay and panel classes to:

```tsx
<div className="fixed inset-0 z-50 bg-base sm:flex sm:items-start sm:justify-center sm:pt-[12vh] sm:bg-black/60" onClick={onClose}>
  <div className="h-[100dvh] w-full overflow-hidden bg-surface safe-top safe-bottom sm:h-auto sm:max-w-2xl sm:rounded-xl sm:border sm:border-border" onClick={event => event.stopPropagation()}>
```

Make results fill remaining height on mobile, hide keyboard-help footer below `sm`, and call `useEscapeKey(onClose)`.

- [ ] **Step 5: Make quick capture a keyboard-safe bottom sheet**

On mobile align the panel to the bottom, use `rounded-t-xl`, `safe-bottom`, 16px input text, and a visible Save button rather than Enter-only behavior. Preserve the existing compact desktop overlay at `sm` and above.

- [ ] **Step 6: Increase TabHub touch targets**

Use `px-4 min-h-11` below `sm`, retain current desktop spacing at `sm`, and add `scrollbar-none` behavior without disabling horizontal touch scrolling.

- [ ] **Step 7: Verify responsive shell**

At 360, 393, and 412 widths confirm:

- No body-level horizontal scroll.
- Search occupies the full viewport.
- Quick capture remains above the software keyboard.
- TabHub tabs scroll horizontally.
- Critical alert toast clears bottom navigation.

- [ ] **Step 8: Commit**

```powershell
npm run build
git add src/components/layout/TopBar.tsx src/components/layout/TabHub.tsx src/index.css src/App.tsx
git commit -m "feat(mobile): adapt shared controls for touch layouts"
```

---

### Task 8: Adapt Home for Pixel 9

**Files:**
- Modify: `src/views/Home.tsx`

**Interfaces:**
- Consumes shared API transport and mobile shell.
- Produces no page-level horizontal overflow at 360px.

- [ ] **Step 1: Make hero spacing and typography responsive**

Use:

```tsx
<div className="relative max-w-[1400px] mx-auto px-4 sm:px-5 lg:px-8 pt-5 sm:pt-8 pb-4 sm:pb-6">
<div className="flex flex-col sm:flex-row sm:flex-wrap items-start justify-between gap-5 sm:gap-x-10 sm:gap-y-6">
<h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight text-text-primary">
```

Change the status/date copy to wrap instead of truncate.

- [ ] **Step 2: Make radar/event/spend block fit 360px**

Change `RadarSweep` wrapper to `w-[92px] h-[92px] sm:w-[116px] sm:h-[116px]`. Render the right block as `w-full justify-between gap-3 sm:w-auto sm:gap-6`. Reduce spend value to `text-2xl sm:text-3xl`.

- [ ] **Step 3: Make metric cards compact and heartbeat full-width on phone**

Add optional `className` to `HeartbeatWidget` and merge it with `clsx`. Call it with `className="col-span-2 xl:col-span-1"`. Use mobile padding `px-3 py-3 sm:px-5 sm:py-4` in both `StatTile` and `HeartbeatWidget`.

- [ ] **Step 4: Remove hover-only information**

Keep arrows decorative on desktop, but do not hide required actions on mobile. In the priority lead item, hide only the `Act first` label below 393px; the entire row remains tappable.

- [ ] **Step 5: Tighten stacked sections**

- Keep priority items one column until `md`.
- Keep Capture & Triage one column until `xl`.
- Keep quick-view panels one column until `xl`.
- In three-stat mini-grids use `px-2 py-2 sm:px-3`.
- External links use `openExternal` rather than `window.open`.

- [ ] **Step 6: Browser verification**

At 360×800 and 412×915, inspect the hero, all five metrics, priority queue, today's schedule, Capture & Triage, and quick-view cards. Expected: no clipped badge, no horizontal scrollbar, and every card remains tappable.

- [ ] **Step 7: Commit**

```powershell
npm run build
git add src/views/Home.tsx
git commit -m "feat(mobile): create Pixel-first Home layout"
```

---

### Task 9: Adapt To-Do, Tasks, Approvals, and Inbox

**Files:**
- Modify: `src/views/TodoTasks.tsx`
- Modify: `src/views/Todos.tsx`
- Modify: `src/views/Tasks.tsx`
- Modify: `src/views/Approvals.tsx`
- Modify: `src/views/Inbox.tsx`

**Interfaces:**
- All four tabs remain reachable through `TabHub`.
- Mobile task status changes use visible controls instead of hover-only actions.

- [ ] **Step 1: Adapt To-Do quick-add controls**

At phone widths render the input full-width, then severity/horizon in a two-column row, then a full-width 44px Add button. Use Tailwind grid classes below `sm` and current flex layout at `sm`:

```tsx
<div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
  <input className="col-span-2 flex-1 min-w-0 ... text-base sm:text-sm" />
  <select className="min-h-11 ... text-base sm:text-xs" />
  <select className="min-h-11 ... text-base sm:text-xs" />
  <button className="col-span-2 min-h-11 sm:col-span-1 ...">...</button>
</div>
```

- [ ] **Step 2: Make filters and bulk actions touch-safe**

Filters use `overflow-x-auto whitespace-nowrap -mx-4 px-4 sm:mx-0 sm:px-0`. Filter buttons use `min-h-11 sm:min-h-0`. The bulk bar becomes sticky above mobile bottom navigation:

```tsx
className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 px-3 py-2 border ... sm:static"
```

- [ ] **Step 3: Make To-Do rows wrap cleanly**

Below `sm`, move badges to a second line with `w-full pl-8 justify-between`; remove fixed `min-w-[68px]` on the severity badge below `sm`. Checkbox and row body retain 44px minimum height.

- [ ] **Step 4: Make To-Do drawer a real full-screen mobile panel**

Change the drawer base classes to:

```tsx
'fixed inset-0 z-[70] w-full max-w-none border-l-0 bg-surface safe-top safe-bottom',
'lg:static lg:h-full lg:w-[380px] lg:min-w-[380px] lg:border-l lg:z-auto'
```

Use `px-4 py-3 sm:px-5 sm:py-4`, 44px footer buttons, and `text-base sm:text-xs` inputs. The backdrop remains desktop/narrow-web support but is not required behind the full-screen native panel.

- [ ] **Step 5: Convert Tasks board into status-filtered mobile list**

Add `mobileStatus` state defaulting to `active`. Below `md`, render four segmented status buttons with counts, followed by one `Column` using `min-w-0 w-full`. At `md` and above retain the existing horizontal board.

Task-card action controls use:

```tsx
className="flex flex-wrap items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100"
```

Every status action has at least 44px height on mobile.

- [ ] **Step 6: Make task and approval modals full-screen on phone**

For `AddTaskModal`, `NoteModal`, and `NewRequestModal`:

- Outer shell: `items-stretch p-0 sm:items-center sm:p-4`.
- Panel: `h-[100dvh] max-w-none rounded-none overflow-y-auto safe-top safe-bottom sm:h-auto sm:max-w-md sm:rounded-xl` (use `sm:max-w-lg` for New Request).
- Footer: `sticky bottom-0 bg-card safe-bottom` on mobile.
- All inputs: `text-base sm:text-sm`.

- [ ] **Step 7: Make approval and inbox row actions persistent on touch**

Change hover-only action groups to `opacity-100 md:opacity-0 md:group-hover:opacity-100`. Stack metadata below the title at phone widths. Any side drawer in Inbox uses the same full-screen mobile classes as To-Do.

- [ ] **Step 8: Verify all four tabs**

At 360px:

- Add a To-Do.
- Select and bulk-complete it.
- Open/close its full-screen details.
- Create a Task and move it across statuses.
- Open an Approval and its note dialog.
- Open an Inbox item and close it with browser Escape and Android back after APK installation.

- [ ] **Step 9: Commit**

```powershell
npm run build
git add src/views/TodoTasks.tsx src/views/Todos.tsx src/views/Tasks.tsx src/views/Approvals.tsx src/views/Inbox.tsx
git commit -m "feat(mobile): adapt work queue and detail flows"
```

---

### Task 10: Adapt To-Buy

**Files:**
- Modify: `src/views/ToBuy.tsx`

- [ ] **Step 1: Reflow header and estimated total**

Below `sm`, stack title/count above a second row containing estimated total and icon-only Refresh. Keep the estimated total visible while scrolling by placing it in the existing non-scroll header region.

- [ ] **Step 2: Reflow quick add**

Use a two-column mobile grid: input spans both columns, priority is one column, Add is the other. Inputs/buttons are 44px and use 16px mobile text.

- [ ] **Step 3: Adapt rows and drawer**

Allow quantity, unit price, priority, and research state to wrap. Use the same fixed full-screen mobile drawer classes and safe-area padding defined for To-Do. Research links wrap and never force horizontal page scrolling.

- [ ] **Step 4: Verify purchasing flow**

At 360px, add `USB-C cable !high x2 $12`, open it, edit quantity and price, run the research UI without dispatching an external agent during layout testing, mark purchased, switch filters, and clear purchased.

- [ ] **Step 5: Commit**

```powershell
npm run build
git add src/views/ToBuy.tsx
git commit -m "feat(mobile): adapt shopping workflow for touch"
```

---

### Task 11: Make Calendar agenda-first and phone-safe

**Files:**
- Modify: `src/views/ScheduledTasks.tsx`

- [ ] **Step 1: Default phones to Agenda**

Initialize view mode with:

```ts
const [viewMode, setViewMode] = useState<ViewMode>(() =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'agenda' : 'week'
)
```

Do not force Agenda after the user explicitly changes modes.

- [ ] **Step 2: Reflow calendar controls**

Below `sm`, stack title/status, navigation, New Event, and view selector. Previous/Today/Next and New Event use 44px heights. View buttons horizontally scroll if required.

- [ ] **Step 3: Make recurring-jobs strip horizontally bounded**

Use a fixed label row followed by an `overflow-x-auto` pill row on mobile. Do not let pills wrap into an unbounded header height.

- [ ] **Step 4: Make event actions visible on touch**

EventCard external/Meet actions use `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`. Agenda Add buttons use `opacity-100 sm:opacity-0 sm:group-hover/agenda:opacity-100` and 44px tap areas.

- [ ] **Step 5: Keep wide views internally pannable**

Retain minimum widths for Week and Month inside their `overflow-auto` containers. Confirm the app shell itself remains width 100% and does not scroll horizontally.

- [ ] **Step 6: Make EventComposer full-screen on mobile**

Use the full-screen modal pattern from Task 9. Form content scrolls, header and footer remain reachable, date/time grid becomes one column below 393px, and inputs use 16px text.

- [ ] **Step 7: Verify calendar CRUD**

At 360px and on the Pixel 9: create, edit, and delete an event; switch Agenda/Day/Month/Week; pan Week/Month internally; open a Meet link; verify Google reconnect banner remains readable.

- [ ] **Step 8: Commit**

```powershell
npm run build
git add src/views/ScheduledTasks.tsx
git commit -m "feat(mobile): make calendar agenda-first on phones"
```

---

### Task 12: Add server controls, native OAuth, and export to Settings

**Files:**
- Modify: `src/views/Settings.tsx`
- Modify: `src/lib/native.ts`

- [ ] **Step 1: Add Server Connection as the first Settings section**

Use `useServerConnection`. The card displays status, current base URL, hostname/version/latency when available, and buttons for Test, Change, and Reset. Change expands a 16px URL input. Save requires a successful probe of the current input.

Reset behavior:

- Web: clears runtime override and returns to same-origin.
- Native: clears runtime override and immediately returns to `ServerSetupScreen` through provider state.

- [ ] **Step 2: Open Google OAuth through Capacitor Browser**

Replace:

```ts
window.location.href = authApi.googleAuthUrl()
```

with:

```ts
const connect = () => { void openExternal(authApi.googleAuthUrl()) }
```

Use `onAppResume(load)` so returning from OAuth refreshes Google status. Keep tokens and client secrets server-side.

- [ ] **Step 3: Make export work in native and web contexts**

Replace the anchor with a button whose handler is:

```ts
const exportUrl = apiDownloadUrl('/api/export')
if (isNativeApp()) void openExternal(exportUrl)
else window.location.assign(exportUrl)
```

- [ ] **Step 4: Reflow Settings cards**

Use `px-4 py-4 sm:px-6 sm:py-5`. Connector actions wrap, message text gets its own full-width line on mobile, integrations use one column until `lg`, and Export stacks text above a full-width 44px button below `sm`.

- [ ] **Step 5: Verify Settings**

Test changing between an invalid URL, the Tailscale URL, and a LAN URL. Verify Google Browser opens and the app refreshes status on resume. Verify export opens the backend download endpoint.

- [ ] **Step 6: Commit**

```powershell
npm run build
git add src/views/Settings.tsx src/lib/native.ts
git commit -m "feat(mobile): add native server OAuth and export settings"
```

---

### Task 13: Build APK, document Tailscale/LAN setup, and run final verification

**Files:**
- Create: `docs/mobile/PIXEL9_SETUP.md`
- Modify: `README.md`
- Modify: `capacitor.config.ts`
- Modify: `android/app/build.gradle`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Finalize Capacitor identity and Android version**

Keep:

```ts
appId: 'com.missioncontrol.app'
appName: 'Mission Control'
webDir: 'dist'
server: { androidScheme: 'https' }
```

Set Android `versionCode` to `2` and `versionName` to the package version being released. Do not embed a server URL in Capacitor config.

- [ ] **Step 2: Write Tailscale Serve runbook**

Document this primary host configuration:

```powershell
# .env
API_HOST=127.0.0.1
API_PORT=3001

npm run server
tailscale serve --bg 127.0.0.1:3001
tailscale serve status
```

The `tailscale serve status` output supplies the `https://<node>.<tailnet>.ts.net` URL entered into the Android app. Explicitly state: do not use Funnel and do not forward router port 3001.

- [ ] **Step 3: Write LAN fallback runbook**

Document:

```powershell
# .env
API_HOST=0.0.0.0
API_PORT=3001
```

Add a Windows Defender Firewall private-profile-only TCP 3001 example:

```powershell
New-NetFirewallRule -DisplayName "Mission Control API (Private LAN)" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private
```

Use `http://<PC-private-IP>:3001` in the app. State that this address works only on the trusted home network.

- [ ] **Step 4: Document Android prerequisites and build**

```powershell
npm install
npm test
npm run build
npx cap sync android
npx cap open android
```

CLI debug APK:

```powershell
Set-Location .\android
.\gradlew.bat assembleDebug
adb install -r .\app\build\outputs\apk\debug\app-debug.apk
```

The APK path is `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 5: Run complete automated verification**

```powershell
npm test
npm run build
npx cap sync android
Set-Location .\android
.\gradlew.bat testDebugUnitTest assembleDebug
```

Expected: Node tests pass, Vite build passes, Gradle unit tests pass, and debug APK is generated.

- [ ] **Step 6: Run browser responsive matrix**

Verify 360×800, 393×852, 412×915, 768×1024, and desktop widths. For every Milestone 1 view confirm no page-level horizontal scrollbar, all controls are reachable, and dialogs clear the mobile bars.

- [ ] **Step 7: Run physical Pixel 9 matrix**

1. Fresh install and first-launch server setup.
2. Tailscale over home Wi-Fi.
3. Tailscale over cellular.
4. Wi-Fi-to-cellular switch while open.
5. Tailscale disconnect/reconnect.
6. LAN fallback on home Wi-Fi.
7. Background/resume.
8. Android back through dialog, drawer, More sheet, view history, Home exit.
9. Google OAuth return.
10. Portrait and landscape.
11. Visit Home, To-Do, Tasks, Calendar, Activity, and Settings; inspect Android Studio memory for unbounded growth.

- [ ] **Step 8: Update README and changelog**

README receives a concise Android section pointing to `docs/mobile/PIXEL9_SETUP.md`. Changelog lists runtime server configuration, mobile shell, daily-view adaptations, Tailscale guidance, and Android build output.

- [ ] **Step 9: Commit final documentation and Android metadata**

```powershell
git add README.md CHANGELOG.md capacitor.config.ts android/app/build.gradle docs/mobile/PIXEL9_SETUP.md
git commit -m "docs(mobile): add Pixel 9 build and secure access runbook"
```

---

## Final Acceptance Gate

Do not mark Milestone 1 complete until all statements below are true:

- `npm test` passes.
- `npm run build` passes.
- `gradlew.bat testDebugUnitTest assembleDebug` passes.
- The debug APK installs on the Pixel 9.
- Runtime server setup accepts the Tailscale HTTPS URL and private-LAN HTTP URL while rejecting public HTTP.
- Home, To-Do, Tasks, Approvals, Inbox, To-Buy, Calendar, Settings, search, and quick capture work at 360px without page-level horizontal scrolling.
- Tailscale access works on Wi-Fi and cellular.
- LAN fallback works only while connected to the home network.
- Android back closes the top overlay, then navigates history, then Home, then exits.
- Google OAuth opens externally and Settings refreshes after returning.
- Existing desktop sidebar and views still function.
- No public tunnel, Funnel, or router port forwarding is configured.
