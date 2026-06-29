// title: Memory benchmarking persistence store
// path: server/lib/memoryEvalStore.ts
// purpose: SQLite-backed storage for the Memory Benchmarking layer of the
//          Evaluations feature. Scoped to Hermes + OpenClaw. Persists memory
//          benchmark tasks, runs, per-hit detail, and score snapshots. The
//          provider abstraction is real — providers are derived at runtime from
//          actual platform capabilities (see memoryEvalEngine.detectProviders).
//          No placeholder/fake providers are seeded here.

import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DatabaseSync } from 'node:sqlite'
import type { EvalPlatform } from './evalStore.js'

export type MemoryKind = 'recall' | 'multihop' | 'temporal' | 'conflict' | 'applied' | 'negative'

export interface MemoryBenchmarkTask {
  id:             string
  platform:       EvalPlatform
  agent:          string         // '' = any agent
  title:          string
  kind:           MemoryKind
  query:          string         // the question / probe sent to the system
  expectedFacts:  string[]       // substrings that should be retrieved / used
  forbiddenFacts: string[]       // strings that must NOT appear (negative control / staleness)
  providers:      string[]       // provider names to query; [] = every detected provider
  newerHints:     string[]       // strings whose match should be preferred (temporal)
  rubric:         string
  notes:          string
  builtIn:        boolean        // true = ships with the dashboard; UI protects from delete
  builtInSlug:    string         // catalog slug; '' for user-created tasks
  createdAt:      string
  updatedAt:      string
}

export interface MemoryHit {
  provider: string               // provider name (e.g. workspace-files-openclaw)
  source:   string               // file path / session key
  score:    number               // provider-local match score (raw)
  ts:       string | null        // mtime / message time if known (freshness)
  excerpt:  string               // up to 400 char snippet of the matched content
  matchedFacts: string[]         // which expectedFacts substrings appeared
}

export interface MemoryBenchmarkRun {
  id:             string
  taskId:         string
  platform:       EvalPlatform
  agent:          string
  model:          string
  status:         string         // running | success | failure | error | unresolved
  providersUsed:  string[]
  hits:           MemoryHit[]
  expectedFound:  number
  expectedTotal:  number
  forbiddenFound: number
  irrelevantHits: number
  // Applied-recall (agent involved). null when the run was pure-retrieval only.
  agentAnswer:    string | null
  answerHasExpected: number
  answerHasForbidden: number
  // Sub-scores (0..100; null when not derivable).
  retrievalAccuracy:  number | null
  usageAccuracy:      number | null
  freshnessScore:     number | null
  conflictResolution: number | null
  falseRecallPenalty: number      // 0..100 deducted from composite
  latencyScore:       number | null
  coverageScore:      number | null
  composite:          number      // final 0..100
  latencyMs:          number
  notes:              string
  // Negative-control diagnostics — surfaced so the UI can show *why* a run
  // passed or failed the false-recall rubric instead of just the composite.
  denialDetected:     boolean     // true when the agent explicitly refused/refuted on a negative-kind run
  scoringNote:        string      // short, kind-specific explanation (e.g. "refusal detected — penalty suppressed")
  ts:                 string
}

export interface MemoryScoreSnapshot {
  id:        string
  platform:  EvalPlatform
  scope:     string              // 'model:<name>' | 'provider:<name>' | 'agent:<name>'
  composite: number
  subScores: Record<string, number | null>
  runCount:  number
  ts:        string
}

// ─── DB setup ─────────────────────────────────────────────────────────────────

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'evaluations.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_benchmark_tasks (
    id             TEXT PRIMARY KEY,
    platform       TEXT NOT NULL,
    agent          TEXT NOT NULL DEFAULT '',
    title          TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'recall',
    query          TEXT NOT NULL DEFAULT '',
    expectedFacts  TEXT NOT NULL DEFAULT '[]',
    forbiddenFacts TEXT NOT NULL DEFAULT '[]',
    providers      TEXT NOT NULL DEFAULT '[]',
    newerHints     TEXT NOT NULL DEFAULT '[]',
    rubric         TEXT NOT NULL DEFAULT '',
    notes          TEXT NOT NULL DEFAULT '',
    createdAt      TEXT NOT NULL,
    updatedAt      TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memory_benchmark_runs (
    id                 TEXT PRIMARY KEY,
    taskId             TEXT NOT NULL,
    platform           TEXT NOT NULL,
    agent              TEXT NOT NULL DEFAULT '',
    model              TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'unresolved',
    providersUsed      TEXT NOT NULL DEFAULT '[]',
    hits               TEXT NOT NULL DEFAULT '[]',
    expectedFound      INTEGER NOT NULL DEFAULT 0,
    expectedTotal      INTEGER NOT NULL DEFAULT 0,
    forbiddenFound     INTEGER NOT NULL DEFAULT 0,
    irrelevantHits     INTEGER NOT NULL DEFAULT 0,
    agentAnswer        TEXT,
    answerHasExpected  INTEGER NOT NULL DEFAULT 0,
    answerHasForbidden INTEGER NOT NULL DEFAULT 0,
    retrievalAccuracy  REAL,
    usageAccuracy      REAL,
    freshnessScore     REAL,
    conflictResolution REAL,
    falseRecallPenalty REAL NOT NULL DEFAULT 0,
    latencyScore       REAL,
    coverageScore      REAL,
    composite          REAL NOT NULL DEFAULT 0,
    latencyMs          INTEGER NOT NULL DEFAULT 0,
    notes              TEXT NOT NULL DEFAULT '',
    denialDetected     INTEGER NOT NULL DEFAULT 0,
    scoringNote        TEXT NOT NULL DEFAULT '',
    ts                 TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memory_score_snapshots (
    id        TEXT PRIMARY KEY,
    platform  TEXT NOT NULL,
    scope     TEXT NOT NULL,
    composite REAL NOT NULL DEFAULT 0,
    subScores TEXT NOT NULL DEFAULT '{}',
    runCount  INTEGER NOT NULL DEFAULT 0,
    ts        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mem_runs_task     ON memory_benchmark_runs(taskId);
  CREATE INDEX IF NOT EXISTS idx_mem_runs_platform ON memory_benchmark_runs(platform, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_mem_snap_scope    ON memory_score_snapshots(platform, scope, ts DESC);
`)

// Orphaned "running" runs from a prior server process — mark error.
db.exec(`UPDATE memory_benchmark_runs SET status = 'error',
  notes = 'Server restarted while this memory benchmark was in flight — dispatch the task again.'
  WHERE status = 'running'`)

// Idempotent migrations for the built-in catalog columns.
function tryAddMemColumn(table: string, column: string, decl: string) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`) } catch { /* exists */ }
}
tryAddMemColumn('memory_benchmark_tasks', 'builtIn',     'INTEGER NOT NULL DEFAULT 0')
tryAddMemColumn('memory_benchmark_tasks', 'builtInSlug', "TEXT NOT NULL DEFAULT ''")
// Negative-control telemetry columns — added for runs persisted by older
// engine versions which didn't capture denial detection / scoring notes.
tryAddMemColumn('memory_benchmark_runs',  'denialDetected', 'INTEGER NOT NULL DEFAULT 0')
tryAddMemColumn('memory_benchmark_runs',  'scoringNote',    "TEXT NOT NULL DEFAULT ''")

const pj = <T,>(s: string, fb: T): T => { try { return JSON.parse(s) as T } catch { return fb } }

// ─── Tasks ────────────────────────────────────────────────────────────────────

function taskFromRow(r: any): MemoryBenchmarkTask {
  return {
    id: String(r.id), platform: r.platform, agent: String(r.agent ?? ''),
    title: String(r.title ?? ''), kind: String(r.kind ?? 'recall') as MemoryKind,
    query: String(r.query ?? ''),
    expectedFacts: pj(String(r.expectedFacts ?? '[]'), []),
    forbiddenFacts: pj(String(r.forbiddenFacts ?? '[]'), []),
    providers: pj(String(r.providers ?? '[]'), []),
    newerHints: pj(String(r.newerHints ?? '[]'), []),
    rubric: String(r.rubric ?? ''), notes: String(r.notes ?? ''),
    builtIn: Boolean(r.builtIn), builtInSlug: String(r.builtInSlug ?? ''),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  }
}

export function listMemoryTasks(platform?: EvalPlatform): MemoryBenchmarkTask[] {
  const rows = platform
    ? db.prepare('SELECT * FROM memory_benchmark_tasks WHERE platform = ? ORDER BY createdAt DESC').all(platform)
    : db.prepare('SELECT * FROM memory_benchmark_tasks ORDER BY createdAt DESC').all()
  return (rows as any[]).map(taskFromRow)
}

export function getMemoryTask(id: string): MemoryBenchmarkTask | null {
  const r = db.prepare('SELECT * FROM memory_benchmark_tasks WHERE id = ?').get(id)
  return r ? taskFromRow(r) : null
}

export function createMemoryTask(input: {
  id?: string; platform: EvalPlatform; agent?: string; title: string; kind?: MemoryKind
  query: string; expectedFacts?: string[]; forbiddenFacts?: string[]
  providers?: string[]; newerHints?: string[]; rubric?: string; notes?: string
  builtIn?: boolean; builtInSlug?: string
}): MemoryBenchmarkTask {
  const now = new Date().toISOString()
  const task: MemoryBenchmarkTask = {
    id: input.id ?? randomUUID(),
    platform: input.platform, agent: (input.agent ?? '').trim(),
    title: input.title.trim(), kind: input.kind ?? 'recall',
    query: input.query.trim(),
    expectedFacts: (input.expectedFacts ?? []).map(String).map(s => s.trim()).filter(Boolean),
    forbiddenFacts: (input.forbiddenFacts ?? []).map(String).map(s => s.trim()).filter(Boolean),
    providers: (input.providers ?? []).map(String).map(s => s.trim()).filter(Boolean),
    newerHints: (input.newerHints ?? []).map(String).map(s => s.trim()).filter(Boolean),
    rubric: (input.rubric ?? '').trim(), notes: (input.notes ?? '').trim(),
    builtIn: !!input.builtIn, builtInSlug: (input.builtInSlug ?? '').trim(),
    createdAt: now, updatedAt: now,
  }
  db.prepare(`INSERT INTO memory_benchmark_tasks
    (id,platform,agent,title,kind,query,expectedFacts,forbiddenFacts,providers,newerHints,rubric,notes,builtIn,builtInSlug,createdAt,updatedAt)
    VALUES (@id,@platform,@agent,@title,@kind,@query,@expectedFacts,@forbiddenFacts,@providers,@newerHints,@rubric,@notes,@builtIn,@builtInSlug,@createdAt,@updatedAt)`)
    .run({
      ...task,
      expectedFacts: JSON.stringify(task.expectedFacts),
      forbiddenFacts: JSON.stringify(task.forbiddenFacts),
      providers: JSON.stringify(task.providers),
      newerHints: JSON.stringify(task.newerHints),
      builtIn: task.builtIn ? 1 : 0,
    })
  return task
}

export function deleteMemoryTask(id: string): { ok: boolean; reason?: string } {
  const row = db.prepare('SELECT builtIn FROM memory_benchmark_tasks WHERE id = ?').get(id) as any
  if (!row) return { ok: false, reason: 'not-found' }
  if (Number(row.builtIn) === 1) return { ok: false, reason: 'builtin' }
  db.prepare('DELETE FROM memory_benchmark_tasks WHERE id = ?').run(id)
  db.prepare('DELETE FROM memory_benchmark_runs WHERE taskId = ?').run(id)
  return { ok: true }
}

/** Install (insert if missing) every built-in memory task for every platform.
 *  Same idempotent semantics as the benchmark catalog. */
export function installBuiltinMemoryTasks(
  catalog: ReadonlyArray<{
    slug: string; title: string; kind: MemoryKind; query: string
    expectedFacts: string[]; forbiddenFacts: string[]; newerHints: string[]
    rubric: string; notes: string
  }>,
  platforms: ReadonlyArray<EvalPlatform>,
  idFor: (slug: string, platform: EvalPlatform) => string,
): { installed: number; skipped: number } {
  if (process.env.SKIP_EVAL_SEEDS) return { installed: 0, skipped: 0 }
  let installed = 0, skipped = 0
  const exists = db.prepare('SELECT 1 FROM memory_benchmark_tasks WHERE id = ?')
  for (const platform of platforms) {
    for (const entry of catalog) {
      const id = idFor(entry.slug, platform)
      if (exists.get(id)) { skipped++; continue }
      createMemoryTask({
        id, platform, title: entry.title, kind: entry.kind, query: entry.query,
        expectedFacts: entry.expectedFacts, forbiddenFacts: entry.forbiddenFacts,
        newerHints: entry.newerHints, rubric: entry.rubric, notes: entry.notes,
        builtIn: true, builtInSlug: entry.slug,
      })
      installed++
    }
  }
  return { installed, skipped }
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

function runFromRow(r: any): MemoryBenchmarkRun {
  return {
    id: String(r.id), taskId: String(r.taskId), platform: r.platform,
    agent: String(r.agent ?? ''), model: String(r.model ?? ''),
    status: String(r.status ?? 'unresolved'),
    providersUsed: pj(String(r.providersUsed ?? '[]'), []),
    hits: pj(String(r.hits ?? '[]'), []),
    expectedFound: Number(r.expectedFound ?? 0),
    expectedTotal: Number(r.expectedTotal ?? 0),
    forbiddenFound: Number(r.forbiddenFound ?? 0),
    irrelevantHits: Number(r.irrelevantHits ?? 0),
    agentAnswer: r.agentAnswer ?? null,
    answerHasExpected: Number(r.answerHasExpected ?? 0),
    answerHasForbidden: Number(r.answerHasForbidden ?? 0),
    retrievalAccuracy:  r.retrievalAccuracy  == null ? null : Number(r.retrievalAccuracy),
    usageAccuracy:      r.usageAccuracy      == null ? null : Number(r.usageAccuracy),
    freshnessScore:     r.freshnessScore     == null ? null : Number(r.freshnessScore),
    conflictResolution: r.conflictResolution == null ? null : Number(r.conflictResolution),
    falseRecallPenalty: Number(r.falseRecallPenalty ?? 0),
    latencyScore:       r.latencyScore       == null ? null : Number(r.latencyScore),
    coverageScore:      r.coverageScore      == null ? null : Number(r.coverageScore),
    composite: Number(r.composite ?? 0), latencyMs: Number(r.latencyMs ?? 0),
    notes: String(r.notes ?? ''),
    denialDetected: Boolean(Number(r.denialDetected ?? 0)),
    scoringNote: String(r.scoringNote ?? ''),
    ts: String(r.ts),
  }
}

export function listMemoryRuns(filter?: { platform?: EvalPlatform; taskId?: string; model?: string; provider?: string }): MemoryBenchmarkRun[] {
  const where: string[] = []
  const args: any[] = []
  if (filter?.platform) { where.push('platform = ?'); args.push(filter.platform) }
  if (filter?.taskId)   { where.push('taskId = ?');   args.push(filter.taskId) }
  if (filter?.model)    { where.push('model = ?');    args.push(filter.model) }
  const sql = `SELECT * FROM memory_benchmark_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC`
  let rows = (db.prepare(sql).all(...args) as any[]).map(runFromRow)
  if (filter?.provider) rows = rows.filter(r => r.providersUsed.includes(filter.provider!))
  return rows
}

type MemoryRunDefaults = 'denialDetected' | 'scoringNote'
type MemoryRunInput = Omit<MemoryBenchmarkRun, 'id' | 'ts' | MemoryRunDefaults>
  & Partial<Pick<MemoryBenchmarkRun, MemoryRunDefaults>>
  & { id?: string; ts?: string }

export function createMemoryRun(input: MemoryRunInput): MemoryBenchmarkRun {
  const run: MemoryBenchmarkRun = {
    ...input,
    id: input.id ?? randomUUID(),
    ts: input.ts ?? new Date().toISOString(),
    denialDetected: input.denialDetected ?? false,
    scoringNote: input.scoringNote ?? '',
  } as MemoryBenchmarkRun
  db.prepare(`INSERT INTO memory_benchmark_runs
    (id,taskId,platform,agent,model,status,providersUsed,hits,expectedFound,expectedTotal,forbiddenFound,irrelevantHits,
     agentAnswer,answerHasExpected,answerHasForbidden,
     retrievalAccuracy,usageAccuracy,freshnessScore,conflictResolution,falseRecallPenalty,latencyScore,coverageScore,
     composite,latencyMs,notes,denialDetected,scoringNote,ts)
    VALUES
    (@id,@taskId,@platform,@agent,@model,@status,@providersUsed,@hits,@expectedFound,@expectedTotal,@forbiddenFound,@irrelevantHits,
     @agentAnswer,@answerHasExpected,@answerHasForbidden,
     @retrievalAccuracy,@usageAccuracy,@freshnessScore,@conflictResolution,@falseRecallPenalty,@latencyScore,@coverageScore,
     @composite,@latencyMs,@notes,@denialDetected,@scoringNote,@ts)`)
    .run({
      ...run,
      providersUsed: JSON.stringify(run.providersUsed),
      hits: JSON.stringify(run.hits),
      denialDetected: run.denialDetected ? 1 : 0,
    } as any)
  return run
}

export function updateMemoryRun(id: string, patch: Partial<Omit<MemoryBenchmarkRun, 'id'>>): MemoryBenchmarkRun | null {
  const cur = db.prepare('SELECT * FROM memory_benchmark_runs WHERE id = ?').get(id) as any
  if (!cur) return null
  const merged = {
    ...runFromRow(cur),
    ...patch,
    id,
  }
  db.prepare(`UPDATE memory_benchmark_runs SET
    taskId=@taskId, platform=@platform, agent=@agent, model=@model, status=@status,
    providersUsed=@providersUsed, hits=@hits,
    expectedFound=@expectedFound, expectedTotal=@expectedTotal, forbiddenFound=@forbiddenFound, irrelevantHits=@irrelevantHits,
    agentAnswer=@agentAnswer, answerHasExpected=@answerHasExpected, answerHasForbidden=@answerHasForbidden,
    retrievalAccuracy=@retrievalAccuracy, usageAccuracy=@usageAccuracy, freshnessScore=@freshnessScore,
    conflictResolution=@conflictResolution, falseRecallPenalty=@falseRecallPenalty,
    latencyScore=@latencyScore, coverageScore=@coverageScore,
    composite=@composite, latencyMs=@latencyMs, notes=@notes,
    denialDetected=@denialDetected, scoringNote=@scoringNote, ts=@ts
    WHERE id=@id`).run({
      ...merged,
      providersUsed: JSON.stringify(merged.providersUsed ?? []),
      hits: JSON.stringify(merged.hits ?? []),
      denialDetected: merged.denialDetected ? 1 : 0,
    } as any)
  return merged as MemoryBenchmarkRun
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

function snapFromRow(r: any): MemoryScoreSnapshot {
  return {
    id: String(r.id), platform: r.platform, scope: String(r.scope ?? ''),
    composite: Number(r.composite ?? 0), subScores: pj(String(r.subScores ?? '{}'), {}),
    runCount: Number(r.runCount ?? 0), ts: String(r.ts),
  }
}

export function listMemorySnapshots(platform: EvalPlatform, scope?: string): MemoryScoreSnapshot[] {
  const rows = scope
    ? db.prepare('SELECT * FROM memory_score_snapshots WHERE platform = ? AND scope = ? ORDER BY ts ASC').all(platform, scope)
    : db.prepare('SELECT * FROM memory_score_snapshots WHERE platform = ? ORDER BY ts ASC').all(platform)
  return (rows as any[]).map(snapFromRow)
}

export function saveMemorySnapshot(input: Omit<MemoryScoreSnapshot, 'id' | 'ts'> & { ts?: string }): MemoryScoreSnapshot {
  const snap: MemoryScoreSnapshot = { id: randomUUID(), ts: input.ts ?? new Date().toISOString(), ...input }
  db.prepare(`INSERT INTO memory_score_snapshots
    (id,platform,scope,composite,subScores,runCount,ts)
    VALUES (@id,@platform,@scope,@composite,@subScores,@runCount,@ts)`)
    .run({ ...snap, subScores: JSON.stringify(snap.subScores) })
  return snap
}

// ─── Install the curated built-in memory catalog on module load ────────────────
{
  import('./builtinEvalTasks.js').then(({ BUILTIN_MEMORIES, BUILTIN_BENCHMARK_PLATFORMS, builtinMemoryId }) => {
    const r = installBuiltinMemoryTasks(BUILTIN_MEMORIES, BUILTIN_BENCHMARK_PLATFORMS, builtinMemoryId)
    if (r.installed > 0) console.log(`[Evaluations] installed ${r.installed} built-in memory task${r.installed === 1 ? '' : 's'} (skipped ${r.skipped} already-present)`)
  }).catch(err => console.error('[Evaluations] built-in memory install failed:', err))
}
