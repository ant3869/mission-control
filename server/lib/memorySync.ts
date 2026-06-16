// title: Daily-log index sync (remote → local memory.db)
// path: server/lib/memorySync.ts
// purpose: Pull the agent's daily logs over SSH and mirror them into the local
//          FTS index (memory.db) so search spans all days instantly. Incremental:
//          only re-indexes days whose size/mtime changed since the last sync.

import { listDailyLogs, pullAllDailyLogs } from './remoteMemoryFs.js'
import { upsertDailyLog, indexedDailyMeta, dailyIndexMeta, type DailyIndexMeta } from './memoryStore.js'

let syncing: Promise<{ indexed: number; total: number; error?: string }> | null = null

export async function syncDailyLogs(force = false): Promise<{ indexed: number; total: number; error?: string }> {
  // Coalesce concurrent sync requests into one run.
  if (syncing) return syncing
  syncing = (async () => {
    try {
      const metas = await listDailyLogs(true)
      if (metas.length === 0) return { indexed: 0, total: 0, error: 'no daily logs found (SSH unreachable?)' }
      const have = indexedDailyMeta()
      // Only days that are new or changed need a content pull decision; but the
      // bulk pull is one round-trip regardless, so pull once and upsert changed.
      const changed = metas.filter(m => {
        if (force) return true
        const prev = have.get(m.date)
        return !prev || prev.size !== m.size || prev.mtime !== m.mtime
      })
      if (changed.length === 0) return { indexed: 0, total: metas.length }

      const contents = await pullAllDailyLogs()
      const byDate = new Map(contents.map(c => [c.date, c.content]))
      let indexed = 0
      for (const m of changed) {
        const content = byDate.get(m.date)
        if (content == null) continue
        upsertDailyLog({ date: m.date, size: m.size, mtime: m.mtime, content, preview: m.preview })
        indexed++
      }
      return { indexed, total: metas.length }
    } catch (e: any) {
      return { indexed: 0, total: 0, error: String(e?.message ?? e) }
    } finally {
      syncing = null
    }
  })()
  return syncing
}

// Sync if the index is empty or older than `staleMs`. Used to lazily warm the
// index the first time the Daily tab / search is hit.
export async function ensureDailyIndex(staleMs = 10 * 60_000): Promise<DailyIndexMeta> {
  const meta = dailyIndexMeta()
  const stale = !meta.lastSynced || Date.now() - new Date(meta.lastSynced).getTime() > staleMs
  if (meta.count === 0 || stale) { await syncDailyLogs(false) }
  return dailyIndexMeta()
}
