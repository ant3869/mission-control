// title: Memory subsystem health (doctor.memory.status normalizer)
// path: server/lib/memoryDoctor.ts
// purpose: Turn OpenClaw's `doctor.memory.status` RPC payload + the workspace
//          file listing into a typed MemoryHealth the dashboard can render. The
//          exact shape of doctor.memory.status is not fully known (see
//          docs/memory-redesign.md §H) — so we surface the raw payload verbatim
//          AND best-effort-extract a few common fields (embedding model/dims,
//          vector record counts). Honest about what's unknown.

import { isLive } from './connectors.js'
import { getMetricsRaw } from './openclawWs.js'
import { getPlatformMetrics } from './metrics.js'
import type { MemorySource } from './memoryStore.js'

export interface MemoryVectorView {
  recordCount: number | null
  collections: Array<{ name: string; count: number | null }>
  dimensions:  number | null
  indexType:   string | null
  status:      string
}

export interface MemoryHealth {
  source:    MemorySource
  reachable: boolean
  embedding: any | null          // doctor.memory.status.embedding (provider/model/ok/dims)
  vector:    MemoryVectorView | null
  store:     { files: number; bytes: number } | null
  doctorRaw: any | null          // the full doctor.memory.status payload, for the Raw view
  error:     string | null
  fetchedAt: string
}

// Walk an object for the first numeric value under any of `keys` (depth-limited).
function deepNum(obj: any, keys: string[], depth = 4): number | null {
  if (!obj || typeof obj !== 'object' || depth < 0) return null
  for (const k of Object.keys(obj)) {
    if (keys.includes(k) && typeof obj[k] === 'number') return obj[k]
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const n = deepNum(v, keys, depth - 1); if (n != null) return n }
  }
  return null
}

function deepStr(obj: any, keys: string[], depth = 4): string | null {
  if (!obj || typeof obj !== 'object' || depth < 0) return null
  for (const k of Object.keys(obj)) {
    if (keys.includes(k) && typeof obj[k] === 'string' && obj[k].trim()) return obj[k]
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') { const s = deepStr(v, keys, depth - 1); if (s) return s }
  }
  return null
}

function viewVector(doctor: any): MemoryVectorView | null {
  if (!doctor || typeof doctor !== 'object') return null
  const recordCount = deepNum(doctor, ['count', 'records', 'recordCount', 'total', 'vectors', 'size', 'numEntries', 'documents'])
  const dimensions  = deepNum(doctor, ['dimensions', 'dims', 'dimension', 'dim'])
  const indexType   = deepStr(doctor, ['index', 'indexType', 'metric', 'distance', 'backend', 'store'])
  const status      = deepStr(doctor, ['status', 'state', 'health']) ?? (doctor.ok === false ? 'error' : doctor.ok === true ? 'ok' : 'unknown')
  // Collections / namespaces, if present in a recognizable array shape.
  const collections: MemoryVectorView['collections'] = []
  const collArr = doctor.collections ?? doctor.namespaces ?? doctor.partitions
  if (Array.isArray(collArr)) {
    for (const c of collArr) {
      if (typeof c === 'string') collections.push({ name: c, count: null })
      else if (c && typeof c === 'object') collections.push({ name: String(c.name ?? c.id ?? 'collection'), count: deepNum(c, ['count', 'records', 'total', 'size']) })
    }
  }
  if (recordCount == null && dimensions == null && collections.length === 0 && indexType == null) return null
  return { recordCount, collections, dimensions, indexType, status }
}

export async function getMemoryHealth(source: MemorySource, force = false): Promise<MemoryHealth> {
  const fetchedAt = new Date().toISOString()
  if (!isLive(source)) {
    return { source, reachable: false, embedding: null, vector: null, store: null, doctorRaw: null,
      error: 'not connected — add a token in Settings', fetchedAt }
  }

  // Workspace store size from the normalized platform metrics (memoryFiles[]).
  let store: MemoryHealth['store'] = null
  try {
    const m = await getPlatformMetrics(source, force)
    const files = m.memoryFiles ?? []
    store = { files: files.length, bytes: files.reduce((s, f) => s + (f.size ?? 0), 0) }
  } catch { /* leave null */ }

  // OpenClaw exposes doctor.memory.status over WS RPC. Hermes (REST) does not.
  if (source === 'openclaw') {
    try {
      const b = await getMetricsRaw(force)
      if (!b.reachable) return { source, reachable: false, embedding: null, vector: null, store, doctorRaw: null, error: b.error ?? 'unreachable', fetchedAt }
      const doctor = b.results['doctor.memory.status'] ?? null
      return {
        source, reachable: true,
        embedding: doctor?.embedding ?? null,
        vector: viewVector(doctor),
        store, doctorRaw: doctor, error: null, fetchedAt,
      }
    } catch (e: any) {
      return { source, reachable: false, embedding: null, vector: null, store, doctorRaw: null, error: String(e?.message ?? e), fetchedAt }
    }
  }

  // Hermes: no memory doctor RPC yet — report what the workspace files tell us.
  return { source, reachable: true, embedding: null, vector: null, store, doctorRaw: null,
    error: 'Hermes exposes no memory-doctor RPC; showing workspace files only.', fetchedAt }
}
