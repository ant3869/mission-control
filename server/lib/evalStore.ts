// title: Evaluations persistence store
// path: server/lib/evalStore.ts
// purpose: SQLite-backed storage for the Evaluations feature — benchmark tasks,
//          benchmark runs, manual scores, and model score snapshots. Scoped to
//          Hermes + OpenClaw only. All records are real, user/agent-produced
//          data; nothing here is seeded or fabricated. Lives in data/ which the
//          tsx watcher ignores, so writes don't trigger server restarts.

import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DatabaseSync } from 'node:sqlite'

export type EvalPlatform = 'hermes' | 'openclaw'
export const EVAL_PLATFORMS: EvalPlatform[] = ['hermes', 'openclaw']
export function isEvalPlatform(v: any): v is EvalPlatform {
  return v === 'hermes' || v === 'openclaw'
}

// ─── Entity shapes ────────────────────────────────────────────────────────────

export interface BenchmarkTask {
  id:           string
  platform:     EvalPlatform
  agent:        string        // '' = any agent on the platform
  title:        string
  prompt:       string
  rubric:       string        // free-text scoring guidance for manual rubric scoring
  expectedTools: string[]     // tools a good run is expected to use (optional)
  notes:        string
  builtIn:      boolean       // true = ships with the dashboard; UI protects from delete
  builtInSlug:  string        // catalog slug; '' for user-created tasks
  createdAt:    string
  updatedAt:    string
}

export interface BenchmarkRun {
  id:          string
  taskId:      string
  platform:    EvalPlatform
  agent:       string
  model:       string
  status:      string         // success | failure | partial | error | unresolved
  outcome:     string         // mirrors derived-run outcome vocabulary
  toolCalls:   number
  wastedToolCalls: number
  retries:     number
  durationMs:  number
  tokens:      number
  cost:        number
  rubricScore: number | null  // 0..100 manual rubric score (null = not scored)
  notes:       string
  // Inspectable detail captured at completion so the UI can show the same
  // drilldown for successful runs as it does for failed ones.
  answer:      string         // final assistant text returned by the live agent
  toolSequence: string[]      // ordered tool names from the run's transcript
  repeatedToolCalls: number   // consecutive identical (name+arg) tool calls
  oscillations: number        // A,B,A ping-pong patterns
  noProgressTools: number     // tool calls whose result was an error
  ts:          string
}

export interface ManualScore {
  id:        string
  platform:  EvalPlatform
  agent:     string
  model:     string
  runId:     string           // session key / run id this score applies to ('' = model-level)
  score:     number           // 0..100
  rubric:    Record<string, number> // optional per-dimension sub-scores
  notes:     string
  scoredBy:  string
  ts:        string
}

export interface ModelScoreSnapshot {
  id:             string
  platform:       EvalPlatform
  model:          string
  windowDays:     number
  overall:        number
  subScores:      Record<string, number | null>
  runCount:       number
  evaluatedCount: number
  ts:             string
}

// ─── DB setup ─────────────────────────────────────────────────────────────────

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'evaluations.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS benchmark_tasks (
    id            TEXT PRIMARY KEY,
    platform      TEXT NOT NULL,
    agent         TEXT NOT NULL DEFAULT '',
    title         TEXT NOT NULL,
    prompt        TEXT NOT NULL DEFAULT '',
    rubric        TEXT NOT NULL DEFAULT '',
    expectedTools TEXT NOT NULL DEFAULT '[]',
    notes         TEXT NOT NULL DEFAULT '',
    createdAt     TEXT NOT NULL,
    updatedAt     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS benchmark_runs (
    id              TEXT PRIMARY KEY,
    taskId          TEXT NOT NULL,
    platform        TEXT NOT NULL,
    agent           TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'unresolved',
    outcome         TEXT NOT NULL DEFAULT 'unresolved',
    toolCalls       INTEGER NOT NULL DEFAULT 0,
    wastedToolCalls INTEGER NOT NULL DEFAULT 0,
    retries         INTEGER NOT NULL DEFAULT 0,
    durationMs      INTEGER NOT NULL DEFAULT 0,
    tokens          INTEGER NOT NULL DEFAULT 0,
    cost            REAL NOT NULL DEFAULT 0,
    rubricScore     REAL,
    notes           TEXT NOT NULL DEFAULT '',
    ts              TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS manual_scores (
    id        TEXT PRIMARY KEY,
    platform  TEXT NOT NULL,
    agent     TEXT NOT NULL DEFAULT '',
    model     TEXT NOT NULL DEFAULT '',
    runId     TEXT NOT NULL DEFAULT '',
    score     REAL NOT NULL DEFAULT 0,
    rubric    TEXT NOT NULL DEFAULT '{}',
    notes     TEXT NOT NULL DEFAULT '',
    scoredBy  TEXT NOT NULL DEFAULT 'manual',
    ts        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_score_snapshots (
    id             TEXT PRIMARY KEY,
    platform       TEXT NOT NULL,
    model          TEXT NOT NULL,
    windowDays     INTEGER NOT NULL DEFAULT 0,
    overall        REAL NOT NULL DEFAULT 0,
    subScores      TEXT NOT NULL DEFAULT '{}',
    runCount       INTEGER NOT NULL DEFAULT 0,
    evaluatedCount INTEGER NOT NULL DEFAULT 0,
    ts             TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bench_runs_task ON benchmark_runs(taskId);
  CREATE INDEX IF NOT EXISTS idx_bench_runs_model ON benchmark_runs(platform, model);
  CREATE INDEX IF NOT EXISTS idx_manual_model ON manual_scores(platform, model);
  CREATE INDEX IF NOT EXISTS idx_snap_model ON model_score_snapshots(platform, model, ts DESC);
`)

// Any "running" benchmark_runs left over from a prior server run are orphaned
// (their async runner is gone). Surface that honestly rather than letting them
// spin forever.
db.exec(`UPDATE benchmark_runs SET status = 'error', outcome = 'failure',
  notes = 'Server restarted while this run was in flight — dispatch the task again.'
  WHERE status = 'running'`)

// Idempotent migration: add the drilldown columns if the table pre-dates them.
function tryAddColumn(table: string, column: string, decl: string) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`) } catch { /* column already exists */ }
}
tryAddColumn('benchmark_runs', 'answer',            "TEXT NOT NULL DEFAULT ''")
tryAddColumn('benchmark_runs', 'toolSequence',      "TEXT NOT NULL DEFAULT '[]'")
tryAddColumn('benchmark_runs', 'repeatedToolCalls', 'INTEGER NOT NULL DEFAULT 0')
tryAddColumn('benchmark_runs', 'oscillations',      'INTEGER NOT NULL DEFAULT 0')
tryAddColumn('benchmark_runs', 'noProgressTools',   'INTEGER NOT NULL DEFAULT 0')
tryAddColumn('benchmark_tasks', 'builtIn',          'INTEGER NOT NULL DEFAULT 0')
tryAddColumn('benchmark_tasks', 'builtInSlug',      "TEXT NOT NULL DEFAULT ''")

function pj<T>(s: string, fb: T): T { try { return JSON.parse(s) as T } catch { return fb } }

// ─── Benchmark tasks ──────────────────────────────────────────────────────────

function taskFromRow(r: any): BenchmarkTask {
  return {
    id: String(r.id), platform: r.platform, agent: String(r.agent ?? ''),
    title: String(r.title ?? ''), prompt: String(r.prompt ?? ''), rubric: String(r.rubric ?? ''),
    expectedTools: pj(String(r.expectedTools ?? '[]'), []), notes: String(r.notes ?? ''),
    builtIn: Boolean(r.builtIn), builtInSlug: String(r.builtInSlug ?? ''),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  }
}

export function listBenchmarkTasks(platform?: EvalPlatform): BenchmarkTask[] {
  const rows = platform
    ? db.prepare('SELECT * FROM benchmark_tasks WHERE platform = ? ORDER BY createdAt DESC').all(platform)
    : db.prepare('SELECT * FROM benchmark_tasks ORDER BY createdAt DESC').all()
  return (rows as any[]).map(taskFromRow)
}

export function getBenchmarkTask(id: string): BenchmarkTask | null {
  const r = db.prepare('SELECT * FROM benchmark_tasks WHERE id = ?').get(id)
  return r ? taskFromRow(r) : null
}

export function createBenchmarkTask(input: {
  id?: string; platform: EvalPlatform; agent?: string; title: string; prompt: string
  rubric?: string; expectedTools?: string[]; notes?: string
  builtIn?: boolean; builtInSlug?: string
}): BenchmarkTask {
  const now = new Date().toISOString()
  const task: BenchmarkTask = {
    id: input.id ?? randomUUID(), platform: input.platform, agent: (input.agent ?? '').trim(),
    title: input.title.trim(), prompt: input.prompt.trim(), rubric: (input.rubric ?? '').trim(),
    expectedTools: (input.expectedTools ?? []).map(String).filter(Boolean), notes: (input.notes ?? '').trim(),
    builtIn: !!input.builtIn, builtInSlug: (input.builtInSlug ?? '').trim(),
    createdAt: now, updatedAt: now,
  }
  db.prepare(`INSERT INTO benchmark_tasks
    (id,platform,agent,title,prompt,rubric,expectedTools,notes,builtIn,builtInSlug,createdAt,updatedAt)
    VALUES (@id,@platform,@agent,@title,@prompt,@rubric,@expectedTools,@notes,@builtIn,@builtInSlug,@createdAt,@updatedAt)`)
    .run({
      ...task,
      expectedTools: JSON.stringify(task.expectedTools),
      builtIn: task.builtIn ? 1 : 0,
    })
  return task
}

export function deleteBenchmarkTask(id: string): { ok: boolean; reason?: string } {
  // Built-in tasks ship with the dashboard and are reinstalled on every start.
  // Refuse delete at the storage layer so curl / mis-clicks can't drop them.
  const row = db.prepare('SELECT builtIn FROM benchmark_tasks WHERE id = ?').get(id) as any
  if (!row) return { ok: false, reason: 'not-found' }
  if (Number(row.builtIn) === 1) return { ok: false, reason: 'builtin' }
  db.prepare('DELETE FROM benchmark_tasks WHERE id = ?').run(id)
  db.prepare('DELETE FROM benchmark_runs WHERE taskId = ?').run(id)
  return { ok: true }
}

/** Install (insert if missing) every built-in benchmark task for every
 *  platform. Idempotent — built-ins are keyed by `builtin:<slug>:<platform>`
 *  so a row is never duplicated and user-edited content is preserved on
 *  restart. Skip with the SKIP_EVAL_SEEDS env var. */
export function installBuiltinBenchmarkTasks(
  catalog: ReadonlyArray<{ slug: string; title: string; prompt: string; rubric: string; expectedTools: string[]; notes: string }>,
  platforms: ReadonlyArray<EvalPlatform>,
  idFor: (slug: string, platform: EvalPlatform) => string,
): { installed: number; skipped: number } {
  if (process.env.SKIP_EVAL_SEEDS) return { installed: 0, skipped: 0 }
  let installed = 0, skipped = 0
  const exists = db.prepare('SELECT 1 FROM benchmark_tasks WHERE id = ?')
  for (const platform of platforms) {
    for (const entry of catalog) {
      const id = idFor(entry.slug, platform)
      if (exists.get(id)) { skipped++; continue }
      createBenchmarkTask({
        id, platform, title: entry.title, prompt: entry.prompt, rubric: entry.rubric,
        expectedTools: entry.expectedTools, notes: entry.notes,
        builtIn: true, builtInSlug: entry.slug,
      })
      installed++
    }
  }
  return { installed, skipped }
}

// ─── Benchmark runs ───────────────────────────────────────────────────────────

function runFromRow(r: any): BenchmarkRun {
  return {
    id: String(r.id), taskId: String(r.taskId), platform: r.platform, agent: String(r.agent ?? ''),
    model: String(r.model ?? ''), status: String(r.status ?? 'unresolved'), outcome: String(r.outcome ?? 'unresolved'),
    toolCalls: Number(r.toolCalls ?? 0), wastedToolCalls: Number(r.wastedToolCalls ?? 0),
    retries: Number(r.retries ?? 0), durationMs: Number(r.durationMs ?? 0),
    tokens: Number(r.tokens ?? 0), cost: Number(r.cost ?? 0),
    rubricScore: r.rubricScore == null ? null : Number(r.rubricScore),
    notes: String(r.notes ?? ''),
    answer: String(r.answer ?? ''),
    toolSequence: pj(String(r.toolSequence ?? '[]'), []),
    repeatedToolCalls: Number(r.repeatedToolCalls ?? 0),
    oscillations: Number(r.oscillations ?? 0),
    noProgressTools: Number(r.noProgressTools ?? 0),
    ts: String(r.ts),
  }
}

export function listBenchmarkRuns(filter?: { platform?: EvalPlatform; model?: string; taskId?: string }): BenchmarkRun[] {
  const where: string[] = []
  const args: any[] = []
  if (filter?.platform) { where.push('platform = ?'); args.push(filter.platform) }
  if (filter?.model)    { where.push('model = ?');    args.push(filter.model) }
  if (filter?.taskId)   { where.push('taskId = ?');   args.push(filter.taskId) }
  const sql = `SELECT * FROM benchmark_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC`
  return (db.prepare(sql).all(...args) as any[]).map(runFromRow)
}

function runToRow(run: BenchmarkRun): Record<string, any> {
  return {
    ...run,
    toolSequence: JSON.stringify(run.toolSequence ?? []),
    // Optional fields default to safe values for INSERT statements.
    answer: run.answer ?? '',
    repeatedToolCalls: run.repeatedToolCalls ?? 0,
    oscillations: run.oscillations ?? 0,
    noProgressTools: run.noProgressTools ?? 0,
  }
}

export function createBenchmarkRun(input: Omit<BenchmarkRun, 'id' | 'ts'> & { id?: string; ts?: string }): BenchmarkRun {
  const run: BenchmarkRun = {
    id: input.id ?? randomUUID(), ts: input.ts ?? new Date().toISOString(),
    answer: '', toolSequence: [], repeatedToolCalls: 0, oscillations: 0, noProgressTools: 0,
    ...input,
  } as BenchmarkRun
  db.prepare(`INSERT INTO benchmark_runs
    (id,taskId,platform,agent,model,status,outcome,toolCalls,wastedToolCalls,retries,durationMs,tokens,cost,rubricScore,notes,
     answer,toolSequence,repeatedToolCalls,oscillations,noProgressTools,ts)
    VALUES (@id,@taskId,@platform,@agent,@model,@status,@outcome,@toolCalls,@wastedToolCalls,@retries,@durationMs,@tokens,@cost,@rubricScore,@notes,
     @answer,@toolSequence,@repeatedToolCalls,@oscillations,@noProgressTools,@ts)`)
    .run(runToRow(run))
  return run
}

/** Patch an existing benchmark_run row. Used to flip a "running" placeholder
 *  to its final outcome once execution finishes (or errors). */
export function updateBenchmarkRun(id: string, patch: Partial<Omit<BenchmarkRun, 'id'>>): BenchmarkRun | null {
  const cur = db.prepare('SELECT * FROM benchmark_runs WHERE id = ?').get(id) as any
  if (!cur) return null
  const merged = { ...runFromRow(cur), ...patch, id } as BenchmarkRun
  db.prepare(`UPDATE benchmark_runs SET
    taskId=@taskId, platform=@platform, agent=@agent, model=@model,
    status=@status, outcome=@outcome, toolCalls=@toolCalls, wastedToolCalls=@wastedToolCalls,
    retries=@retries, durationMs=@durationMs, tokens=@tokens, cost=@cost,
    rubricScore=@rubricScore, notes=@notes,
    answer=@answer, toolSequence=@toolSequence, repeatedToolCalls=@repeatedToolCalls,
    oscillations=@oscillations, noProgressTools=@noProgressTools,
    ts=@ts
    WHERE id=@id`).run(runToRow(merged))
  return merged
}

// ─── Manual scores ────────────────────────────────────────────────────────────

function manualFromRow(r: any): ManualScore {
  return {
    id: String(r.id), platform: r.platform, agent: String(r.agent ?? ''), model: String(r.model ?? ''),
    runId: String(r.runId ?? ''), score: Number(r.score ?? 0), rubric: pj(String(r.rubric ?? '{}'), {}),
    notes: String(r.notes ?? ''), scoredBy: String(r.scoredBy ?? 'manual'), ts: String(r.ts),
  }
}

export function listManualScores(filter?: { platform?: EvalPlatform; model?: string }): ManualScore[] {
  const where: string[] = []
  const args: any[] = []
  if (filter?.platform) { where.push('platform = ?'); args.push(filter.platform) }
  if (filter?.model)    { where.push('model = ?');    args.push(filter.model) }
  const sql = `SELECT * FROM manual_scores ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC`
  return (db.prepare(sql).all(...args) as any[]).map(manualFromRow)
}

export function createManualScore(input: {
  platform: EvalPlatform; agent?: string; model: string; runId?: string
  score: number; rubric?: Record<string, number>; notes?: string; scoredBy?: string
}): ManualScore {
  const ms: ManualScore = {
    id: randomUUID(), platform: input.platform, agent: (input.agent ?? '').trim(), model: input.model.trim(),
    runId: (input.runId ?? '').trim(), score: Math.max(0, Math.min(100, Number(input.score) || 0)),
    rubric: input.rubric ?? {}, notes: (input.notes ?? '').trim(), scoredBy: (input.scoredBy ?? 'manual').trim() || 'manual',
    ts: new Date().toISOString(),
  }
  db.prepare(`INSERT INTO manual_scores
    (id,platform,agent,model,runId,score,rubric,notes,scoredBy,ts)
    VALUES (@id,@platform,@agent,@model,@runId,@score,@rubric,@notes,@scoredBy,@ts)`)
    .run({ ...ms, rubric: JSON.stringify(ms.rubric) })
  return ms
}

// ─── Model score snapshots ─────────────────────────────────────────────────────

function snapFromRow(r: any): ModelScoreSnapshot {
  return {
    id: String(r.id), platform: r.platform, model: String(r.model ?? ''), windowDays: Number(r.windowDays ?? 0),
    overall: Number(r.overall ?? 0), subScores: pj(String(r.subScores ?? '{}'), {}),
    runCount: Number(r.runCount ?? 0), evaluatedCount: Number(r.evaluatedCount ?? 0), ts: String(r.ts),
  }
}

export function listSnapshots(platform: EvalPlatform, model?: string): ModelScoreSnapshot[] {
  const rows = model
    ? db.prepare('SELECT * FROM model_score_snapshots WHERE platform = ? AND model = ? ORDER BY ts ASC').all(platform, model)
    : db.prepare('SELECT * FROM model_score_snapshots WHERE platform = ? ORDER BY ts ASC').all(platform)
  return (rows as any[]).map(snapFromRow)
}

/** Most recent snapshot timestamp for a model (used to throttle snapshotting). */
export function latestSnapshotTs(platform: EvalPlatform, model: string): string | null {
  const r = db.prepare('SELECT ts FROM model_score_snapshots WHERE platform = ? AND model = ? ORDER BY ts DESC LIMIT 1').get(platform, model) as any
  return r?.ts ?? null
}

export function saveSnapshot(input: Omit<ModelScoreSnapshot, 'id' | 'ts'> & { ts?: string }): ModelScoreSnapshot {
  const snap: ModelScoreSnapshot = { id: randomUUID(), ts: input.ts ?? new Date().toISOString(), ...input }
  db.prepare(`INSERT INTO model_score_snapshots
    (id,platform,model,windowDays,overall,subScores,runCount,evaluatedCount,ts)
    VALUES (@id,@platform,@model,@windowDays,@overall,@subScores,@runCount,@evaluatedCount,@ts)`)
    .run({ ...snap, subScores: JSON.stringify(snap.subScores) })
  return snap
}

// ─── Install the curated built-in benchmark catalog on module load ─────────────
// Idempotent: each (slug, platform) pair maps to a deterministic ID, so an
// existing row (including one the user has edited) is preserved. New entries
// added to the catalog show up on next start; deletions in code do NOT remove
// existing rows from the DB.
{
  // Dynamic import lives at module-load time but avoids the cycle of having
  // the catalog file pull in evalStore.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  import('./builtinEvalTasks.js').then(({ BUILTIN_BENCHMARKS, BUILTIN_BENCHMARK_PLATFORMS, builtinBenchmarkId }) => {
    const r = installBuiltinBenchmarkTasks(BUILTIN_BENCHMARKS, BUILTIN_BENCHMARK_PLATFORMS, builtinBenchmarkId)
    if (r.installed > 0) console.log(`[Evaluations] installed ${r.installed} built-in benchmark task${r.installed === 1 ? '' : 's'} (skipped ${r.skipped} already-present)`)
  }).catch(err => console.error('[Evaluations] built-in benchmark install failed:', err))
}
