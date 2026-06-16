// title: Memory operations store (events, objects, vector stats, consolidation)
// path: server/lib/memoryStore.ts
// purpose: SQLite-backed persistence for the Memory operations view — the live
//          memory-event timeline, object/file snapshots, vector-DB stats over
//          time, and consolidation/dreaming runs. Separate from evaluations.db
//          (the memory *quality* layer) so the operational feed and the
//          benchmark scores evolve independently. Source-parameterized so
//          OpenClaw and Hermes are tracked identically.

import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DatabaseSync } from 'node:sqlite'

export type MemorySource = 'openclaw' | 'hermes'

// Lifecycle of a single memory operation. `created` = the agent decided to
// remember something; `retrieved` = a recall/search; `consolidated` = a
// dreaming/reflection/merge pass; `skipped` = a dedup/low-value rejection.
export type MemoryEventType =
  | 'created' | 'updated' | 'retrieved' | 'embedded'
  | 'consolidated' | 'skipped' | 'deleted' | 'error'

export interface MemoryEvent {
  id:         string
  source:     MemorySource
  type:       MemoryEventType
  trigger:    'auto' | 'manual' | 'cron'   // how it was initiated
  status:     'ok' | 'fail'
  objectId:   string | null                // link → memory_objects.id
  sessionKey: string | null                // provenance: which conversation
  tool:       string | null                // raw tool name if from a tool call
  title:      string
  summary:    string                       // human-readable, ≤ 200 chars
  latencyMs:  number | null
  origin:     'live' | 'push'              // detected from stream vs agent-pushed
  payload:    any                          // raw, for the Raw toggle
  ts:         string
}

export interface MemoryObject {
  id:         string                       // stable: `${source}:${path||name}`
  source:     MemorySource
  kind:       'file' | 'daily' | 'fact' | 'vector'
  name:       string
  path:       string | null
  type:       string | null                // user|feedback|project|reference|other
  wordCount:  number
  sizeBytes:  number
  protected:  boolean
  vectorId:   string | null
  createdAt:  string | null
  updatedAt:  string
  contentHash: string | null
}

export interface MemoryVectorStat {
  id:          string
  source:      MemorySource
  collection:  string
  recordCount: number
  dimensions:  number | null
  indexType:   string | null
  orphanCount: number
  health:      string
  ts:          string
}

export interface MemoryConsolidationRun {
  id:         string
  source:     MemorySource
  trigger:    string
  status:     string                       // running | done | error
  inputs:     number
  merged:     number
  pruned:     number
  summarized: number
  notes:      string
  durationMs: number
  startedAt:  string
  ts:         string
}

// ─── DB setup ─────────────────────────────────────────────────────────────────

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'memory.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_events (
    id         TEXT PRIMARY KEY,
    source     TEXT NOT NULL,
    type       TEXT NOT NULL,
    trigger    TEXT NOT NULL DEFAULT 'auto',
    status     TEXT NOT NULL DEFAULT 'ok',
    objectId   TEXT,
    sessionKey TEXT,
    tool       TEXT,
    title      TEXT NOT NULL DEFAULT '',
    summary    TEXT NOT NULL DEFAULT '',
    latencyMs  INTEGER,
    origin     TEXT NOT NULL DEFAULT 'live',
    payload    TEXT NOT NULL DEFAULT '{}',
    ts         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mem_ev_src  ON memory_events(source, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_mem_ev_type ON memory_events(type, ts DESC);

  CREATE TABLE IF NOT EXISTS memory_objects (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'file',
    name        TEXT NOT NULL,
    path        TEXT,
    type        TEXT,
    wordCount   INTEGER NOT NULL DEFAULT 0,
    sizeBytes   INTEGER NOT NULL DEFAULT 0,
    protected   INTEGER NOT NULL DEFAULT 0,
    vectorId    TEXT,
    createdAt   TEXT,
    updatedAt   TEXT NOT NULL,
    contentHash TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_mem_obj_src ON memory_objects(source, updatedAt DESC);

  CREATE TABLE IF NOT EXISTS memory_vector_stats (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    collection  TEXT NOT NULL DEFAULT 'default',
    recordCount INTEGER NOT NULL DEFAULT 0,
    dimensions  INTEGER,
    indexType   TEXT,
    orphanCount INTEGER NOT NULL DEFAULT 0,
    health      TEXT NOT NULL DEFAULT 'unknown',
    ts          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mem_vec ON memory_vector_stats(source, collection, ts DESC);

  CREATE TABLE IF NOT EXISTS memory_consolidation_runs (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    trigger     TEXT NOT NULL DEFAULT 'cron',
    status      TEXT NOT NULL DEFAULT 'done',
    inputs      INTEGER NOT NULL DEFAULT 0,
    merged      INTEGER NOT NULL DEFAULT 0,
    pruned      INTEGER NOT NULL DEFAULT 0,
    summarized  INTEGER NOT NULL DEFAULT 0,
    notes       TEXT NOT NULL DEFAULT '',
    durationMs  INTEGER NOT NULL DEFAULT 0,
    startedAt   TEXT NOT NULL,
    ts          TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mem_consol ON memory_consolidation_runs(source, ts DESC);
`)

const pj = <T,>(s: string, fb: T): T => { try { return JSON.parse(s) as T } catch { return fb } }

// ─── Events ───────────────────────────────────────────────────────────────────

function eventFromRow(r: any): MemoryEvent {
  return {
    id: String(r.id), source: r.source, type: r.type,
    trigger: r.trigger ?? 'auto', status: r.status ?? 'ok',
    objectId: r.objectId ?? null, sessionKey: r.sessionKey ?? null, tool: r.tool ?? null,
    title: String(r.title ?? ''), summary: String(r.summary ?? ''),
    latencyMs: r.latencyMs == null ? null : Number(r.latencyMs),
    origin: r.origin ?? 'live', payload: pj(String(r.payload ?? '{}'), {}),
    ts: String(r.ts),
  }
}

export function recordMemoryEvent(input: Omit<MemoryEvent, 'id' | 'ts'> & { id?: string; ts?: string }): MemoryEvent {
  const ev: MemoryEvent = {
    id: input.id ?? randomUUID(),
    ts: input.ts ?? new Date().toISOString(),
    ...input,
  }
  db.prepare(`INSERT INTO memory_events
    (id,source,type,trigger,status,objectId,sessionKey,tool,title,summary,latencyMs,origin,payload,ts)
    VALUES (@id,@source,@type,@trigger,@status,@objectId,@sessionKey,@tool,@title,@summary,@latencyMs,@origin,@payload,@ts)`)
    .run({ ...ev, payload: JSON.stringify(ev.payload ?? {}) } as any)
  return ev
}

export function listMemoryEvents(filter?: {
  source?: MemorySource; type?: string; limit?: number
}): MemoryEvent[] {
  const where: string[] = []
  const args: any[] = []
  if (filter?.source) { where.push('source = ?'); args.push(filter.source) }
  if (filter?.type && filter.type !== 'all') { where.push('type = ?'); args.push(filter.type) }
  const limit = Math.min(Math.max(Number(filter?.limit ?? 200), 1), 1000)
  const sql = `SELECT * FROM memory_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ${limit}`
  return (db.prepare(sql).all(...args) as any[]).map(eventFromRow)
}

/** Counters for the header KPIs. */
export function memoryEventCounts(source?: MemorySource): {
  total: number; today: number; errors24h: number; retrieved24h: number
} {
  const srcClause = source ? 'AND source = ?' : ''
  const srcArg = source ? [source] : []
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const startOfDay = new Date(new Date().toDateString()).toISOString()
  const one = (sql: string, args: any[]) => Number((db.prepare(sql).get(...args) as any)?.n ?? 0)
  return {
    total:        one(`SELECT COUNT(*) n FROM memory_events WHERE 1=1 ${srcClause}`, srcArg),
    today:        one(`SELECT COUNT(*) n FROM memory_events WHERE type='created' AND ts >= ? ${srcClause}`, [startOfDay, ...srcArg]),
    errors24h:    one(`SELECT COUNT(*) n FROM memory_events WHERE status='fail' AND ts >= ? ${srcClause}`, [dayAgo, ...srcArg]),
    retrieved24h: one(`SELECT COUNT(*) n FROM memory_events WHERE type='retrieved' AND ts >= ? ${srcClause}`, [dayAgo, ...srcArg]),
  }
}

/** Time-bucketed event metrics for the Metrics tab. Buckets the last `hours`
 *  hours into `buckets` slots and tallies per type. Latency p50 per bucket. */
export function memoryEventMetrics(opts: { source?: MemorySource; hours?: number; buckets?: number }): {
  buckets: Array<{ ts: string; created: number; retrieved: number; consolidated: number; errors: number; total: number; latencyP50: number | null }>
  byType: Record<string, number>
} {
  const hours = Math.min(Math.max(Number(opts.hours ?? 24), 1), 24 * 30)
  const slots = Math.min(Math.max(Number(opts.buckets ?? 24), 4), 96)
  const since = Date.now() - hours * 3_600_000
  const span = (hours * 3_600_000) / slots
  const rows = listMemoryEvents({ source: opts.source, limit: 1000 })
    .filter(e => new Date(e.ts).getTime() >= since)

  const buckets = Array.from({ length: slots }, (_, i) => ({
    ts: new Date(since + i * span).toISOString(),
    created: 0, retrieved: 0, consolidated: 0, errors: 0, total: 0,
    _lat: [] as number[], latencyP50: null as number | null,
  }))
  const byType: Record<string, number> = {}
  for (const e of rows) {
    byType[e.type] = (byType[e.type] ?? 0) + 1
    const idx = Math.min(slots - 1, Math.max(0, Math.floor((new Date(e.ts).getTime() - since) / span)))
    const b = buckets[idx]
    b.total++
    if (e.type === 'created') b.created++
    if (e.type === 'retrieved') b.retrieved++
    if (e.type === 'consolidated') b.consolidated++
    if (e.status === 'fail' || e.type === 'error') b.errors++
    if (typeof e.latencyMs === 'number') b._lat.push(e.latencyMs)
  }
  for (const b of buckets) {
    if (b._lat.length) {
      const s = [...b._lat].sort((a, z) => a - z)
      b.latencyP50 = s[Math.floor(s.length / 2)]
    }
  }
  return { buckets: buckets.map(({ _lat, ...b }) => b), byType }
}

// ─── Objects ──────────────────────────────────────────────────────────────────

function objectFromRow(r: any): MemoryObject {
  return {
    id: String(r.id), source: r.source, kind: r.kind ?? 'file',
    name: String(r.name ?? ''), path: r.path ?? null, type: r.type ?? null,
    wordCount: Number(r.wordCount ?? 0), sizeBytes: Number(r.sizeBytes ?? 0),
    protected: !!Number(r.protected ?? 0), vectorId: r.vectorId ?? null,
    createdAt: r.createdAt ?? null, updatedAt: String(r.updatedAt), contentHash: r.contentHash ?? null,
  }
}

export function upsertMemoryObject(o: Omit<MemoryObject, 'updatedAt'> & { updatedAt?: string }): MemoryObject {
  const obj: MemoryObject = { updatedAt: o.updatedAt ?? new Date().toISOString(), ...o }
  db.prepare(`INSERT INTO memory_objects
    (id,source,kind,name,path,type,wordCount,sizeBytes,protected,vectorId,createdAt,updatedAt,contentHash)
    VALUES (@id,@source,@kind,@name,@path,@type,@wordCount,@sizeBytes,@protected,@vectorId,@createdAt,@updatedAt,@contentHash)
    ON CONFLICT(id) DO UPDATE SET
      name=@name, path=@path, type=@type, wordCount=@wordCount, sizeBytes=@sizeBytes,
      vectorId=@vectorId, updatedAt=@updatedAt, contentHash=@contentHash`)
    .run({ ...obj, protected: obj.protected ? 1 : 0 } as any)
  return obj
}

export function setMemoryObjectProtected(id: string, prot: boolean): boolean {
  const r = db.prepare('UPDATE memory_objects SET protected=? WHERE id=?').run(prot ? 1 : 0, id)
  return Number(r.changes) > 0
}

export function listMemoryObjects(source?: MemorySource): MemoryObject[] {
  const rows = source
    ? db.prepare('SELECT * FROM memory_objects WHERE source=? ORDER BY updatedAt DESC').all(source)
    : db.prepare('SELECT * FROM memory_objects ORDER BY updatedAt DESC').all()
  return (rows as any[]).map(objectFromRow)
}

// ─── Vector stats ─────────────────────────────────────────────────────────────

function vecFromRow(r: any): MemoryVectorStat {
  return {
    id: String(r.id), source: r.source, collection: String(r.collection ?? 'default'),
    recordCount: Number(r.recordCount ?? 0), dimensions: r.dimensions == null ? null : Number(r.dimensions),
    indexType: r.indexType ?? null, orphanCount: Number(r.orphanCount ?? 0),
    health: String(r.health ?? 'unknown'), ts: String(r.ts),
  }
}

export function recordVectorStat(input: Omit<MemoryVectorStat, 'id' | 'ts'> & { id?: string; ts?: string }): MemoryVectorStat {
  const v: MemoryVectorStat = { id: input.id ?? randomUUID(), ts: input.ts ?? new Date().toISOString(), ...input }
  db.prepare(`INSERT INTO memory_vector_stats
    (id,source,collection,recordCount,dimensions,indexType,orphanCount,health,ts)
    VALUES (@id,@source,@collection,@recordCount,@dimensions,@indexType,@orphanCount,@health,@ts)`)
    .run(v as any)
  return v
}

export function listVectorStats(source: MemorySource, collection?: string): MemoryVectorStat[] {
  const rows = collection
    ? db.prepare('SELECT * FROM memory_vector_stats WHERE source=? AND collection=? ORDER BY ts ASC').all(source, collection)
    : db.prepare('SELECT * FROM memory_vector_stats WHERE source=? ORDER BY ts ASC').all(source)
  return (rows as any[]).map(vecFromRow)
}

// ─── Consolidation runs ─────────────────────────────────────────────────────────

function consolFromRow(r: any): MemoryConsolidationRun {
  return {
    id: String(r.id), source: r.source, trigger: String(r.trigger ?? 'cron'),
    status: String(r.status ?? 'done'), inputs: Number(r.inputs ?? 0), merged: Number(r.merged ?? 0),
    pruned: Number(r.pruned ?? 0), summarized: Number(r.summarized ?? 0), notes: String(r.notes ?? ''),
    durationMs: Number(r.durationMs ?? 0), startedAt: String(r.startedAt), ts: String(r.ts),
  }
}

export function recordConsolidationRun(input: Omit<MemoryConsolidationRun, 'id' | 'ts'> & { id?: string; ts?: string }): MemoryConsolidationRun {
  const run: MemoryConsolidationRun = { id: input.id ?? randomUUID(), ts: input.ts ?? new Date().toISOString(), ...input }
  db.prepare(`INSERT INTO memory_consolidation_runs
    (id,source,trigger,status,inputs,merged,pruned,summarized,notes,durationMs,startedAt,ts)
    VALUES (@id,@source,@trigger,@status,@inputs,@merged,@pruned,@summarized,@notes,@durationMs,@startedAt,@ts)`)
    .run(run as any)
  return run
}

export function listConsolidationRuns(source?: MemorySource, limit = 40): MemoryConsolidationRun[] {
  const rows = source
    ? db.prepare('SELECT * FROM memory_consolidation_runs WHERE source=? ORDER BY ts DESC LIMIT ?').all(source, limit)
    : db.prepare('SELECT * FROM memory_consolidation_runs ORDER BY ts DESC LIMIT ?').all(limit)
  return (rows as any[]).map(consolFromRow)
}

// ─── Daily-log full-text index (synced from the agent machine over SSH) ─────────
// Mirrors the remote daily logs locally so search spans all 100+ days instantly
// instead of opening files one-by-one. FTS5 when available; LIKE fallback.

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_logs (
    date      TEXT PRIMARY KEY,
    size      INTEGER NOT NULL DEFAULT 0,
    mtime     TEXT,
    content   TEXT NOT NULL DEFAULT '',
    preview   TEXT NOT NULL DEFAULT '',
    indexedAt TEXT NOT NULL
  );
`)
let dailyFts = true
try {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS daily_fts USING fts5(date UNINDEXED, content, tokenize='porter unicode61');`)
} catch { dailyFts = false }

export interface DailyLogRow { date: string; size: number; mtime: string | null; content: string; preview: string }
export interface DailySearchHit { date: string; size: number; snippet: string }
export interface DailyIndexMeta { count: number; lastSynced: string | null; oldest: string | null; newest: string | null; bytes: number; fts: boolean }

export function upsertDailyLog(d: { date: string; size: number; mtime: string | null; content: string; preview: string }) {
  const indexedAt = new Date().toISOString()
  db.prepare(`INSERT INTO daily_logs (date,size,mtime,content,preview,indexedAt)
    VALUES (@date,@size,@mtime,@content,@preview,@indexedAt)
    ON CONFLICT(date) DO UPDATE SET size=@size, mtime=@mtime, content=@content, preview=@preview, indexedAt=@indexedAt`)
    .run({ ...d, indexedAt } as any)
  if (dailyFts) {
    db.prepare('DELETE FROM daily_fts WHERE date=?').run(d.date)
    db.prepare('INSERT INTO daily_fts (date,content) VALUES (?,?)').run(d.date, d.content)
  }
}

export function dailyIndexMeta(): DailyIndexMeta {
  const r = db.prepare('SELECT COUNT(*) n, MAX(indexedAt) last, MIN(date) oldest, MAX(date) newest, SUM(size) bytes FROM daily_logs').get() as any
  return { count: Number(r?.n ?? 0), lastSynced: r?.last ?? null, oldest: r?.oldest ?? null, newest: r?.newest ?? null, bytes: Number(r?.bytes ?? 0), fts: dailyFts }
}

function snippetAround(content: string, q: string, width = 140): string {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const lc = content.toLowerCase()
  let idx = -1
  for (const t of terms) { const i = lc.indexOf(t); if (i >= 0 && (idx < 0 || i < idx)) idx = i }
  if (idx < 0) return content.slice(0, width).replace(/\s+/g, ' ').trim() + '…'
  const start = Math.max(0, idx - 50)
  return (start > 0 ? '…' : '') + content.slice(start, start + width).replace(/\s+/g, ' ').trim() + '…'
}

// Build a forgiving FTS5 MATCH expression: prefix-match each term, AND-joined.
function ftsExpr(q: string): string {
  return q.split(/\s+/).map(t => t.replace(/["*]/g, '')).filter(Boolean).map(t => `"${t}"*`).join(' ')
}

export function searchDailyLogs(q: string, limit = 60): DailySearchHit[] {
  const query = q.trim()
  if (query.length < 2) return []
  if (dailyFts) {
    try {
      const rows = db.prepare(
        `SELECT d.date AS date, d.size AS size, snippet(daily_fts, 1, '', '', '…', 14) AS sn
         FROM daily_fts f JOIN daily_logs d ON d.date = f.date
         WHERE daily_fts MATCH ? ORDER BY rank LIMIT ?`
      ).all(ftsExpr(query), limit) as any[]
      if (rows.length) return rows.map(r => ({ date: String(r.date), size: Number(r.size) || 0, snippet: String(r.sn ?? '').replace(/\s+/g, ' ').trim() }))
    } catch { /* fall back to LIKE */ }
  }
  // LIKE fallback (Node's bundled SQLite has no FTS5): every term must appear
  // (AND), case-insensitive, so multi-word queries work like a real search.
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 8)
  const where = terms.map(() => 'content LIKE ? ESCAPE \'\\\'').join(' AND ')
  const esc = (t: string) => '%' + t.replace(/[\\%_]/g, c => '\\' + c) + '%'
  const rows = db.prepare(
    `SELECT date, size, content FROM daily_logs WHERE ${where} ORDER BY date DESC LIMIT ?`
  ).all(...terms.map(esc), limit) as any[]
  return rows.map(r => ({ date: String(r.date), size: Number(r.size) || 0, snippet: snippetAround(String(r.content ?? ''), query) }))
}

export function getIndexedDailyLog(date: string): DailyLogRow | null {
  const r = db.prepare('SELECT * FROM daily_logs WHERE date=?').get(date) as any
  return r ? { date: r.date, size: Number(r.size) || 0, mtime: r.mtime ?? null, content: String(r.content ?? ''), preview: String(r.preview ?? '') } : null
}

export function indexedDailyMeta(): Map<string, { size: number; mtime: string | null }> {
  const rows = db.prepare('SELECT date, size, mtime FROM daily_logs').all() as any[]
  return new Map(rows.map(r => [String(r.date), { size: Number(r.size) || 0, mtime: r.mtime ?? null }]))
}
