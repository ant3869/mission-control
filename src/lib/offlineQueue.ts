export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface OfflineItem { id: string; path: string; body: unknown; createdAt: string }

const KEY = 'mc:offline-captures'
export const OFFLINE_QUEUE_EVENT = 'mc:offline-queue'
const ALLOWED = new Set(['/api/todos', '/api/tobuy', '/api/notes/pages'])

export function isOfflineCapture(path: string): boolean { return ALLOWED.has(path) }
export function listOffline(storage: StorageLike): OfflineItem[] {
  try { const value = JSON.parse(storage.getItem(KEY) ?? '[]'); return Array.isArray(value) ? value : [] } catch { return [] }
}
function save(storage: StorageLike, items: OfflineItem[]): void { storage.setItem(KEY, JSON.stringify(items)); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFLINE_QUEUE_EVENT, { detail: { count: items.length } })) }
export function enqueueOffline(storage: StorageLike, path: string, body: unknown, id: string = crypto.randomUUID()): OfflineItem {
  if (!isOfflineCapture(path)) throw new Error('This request cannot be queued offline')
  const item = { id, path, body, createdAt: new Date().toISOString() }
  save(storage, [...listOffline(storage), item]); return item
}
export async function flushOffline(storage: StorageLike, baseUrl: string, fetcher: typeof fetch = fetch): Promise<number> {
  const queue = listOffline(storage); let sent = 0
  while (queue.length) {
    const item = queue[0]
    try {
      const response = await fetcher(new URL(item.path, baseUrl).toString(), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': item.id }, body: JSON.stringify(item.body) })
      if (!response.ok) break
    } catch { break }
    queue.shift(); sent++; save(storage, queue)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('mc:data', { detail: { domain: item.path.split('/').filter(Boolean).pop(), ts: new Date().toISOString() } }))
  }
  return sent
}
export function startOfflineSync(baseUrl: string): () => void {
  if (typeof window === 'undefined') return () => undefined
  const flush = () => { if (navigator.onLine) void flushOffline(localStorage, baseUrl) }
  window.addEventListener('online', flush); const timer = window.setInterval(flush, 30_000); flush()
  return () => { window.removeEventListener('online', flush); window.clearInterval(timer) }
}
