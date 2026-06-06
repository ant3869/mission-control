// title: Harness Benchmark persistence (SQLite)
// path: server/lib/harnessBenchStore.ts
// purpose: Persist benchmark runs + per-task results (incl. raw harness output)
//          in a dedicated data/harness_bench.db using node:sqlite — same pattern
//          as openclaw.ts. Task packs themselves are code-seeded (harnessBenchPacks)
//          so only runs/results are stored here.

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  BenchmarkRun, BenchmarkTaskResult, RunStatus, ExecutionMode, BenchmarkHarness,
} from './harnessBenchTypes.js'

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'harness_bench.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS bench_runs (
    id            TEXT PRIMARY KEY,
    harness       TEXT NOT NULL,
    mode          TEXT NOT NULL,
    model_name    TEXT NOT NULL,
    provider      TEXT NOT NULL,
    endpoint      TEXT,
    task_pack_id  TEXT NOT NULL,
    task_pack_name TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    status        TEXT NOT NULL,
    task_count    INTEGER NOT NULL,
    completed_count INTEGER NOT NULL DEFAULT 0,
    total_score   REAL NOT NULL DEFAULT 0,
    max_score     REAL NOT NULL DEFAULT 0,
    pass_rate     REAL,
    avg_latency   REAL,
    failure_count INTEGER NOT NULL DEFAULT 0,
    error         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_bench_runs_started ON bench_runs(started_at DESC);

  CREATE TABLE IF NOT EXISTS bench_results (
    id            TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL,
    task_id       TEXT NOT NULL,
    task_title    TEXT NOT NULL,
    lane          TEXT NOT NULL,
    status        TEXT NOT NULL,
    points        REAL NOT NULL DEFAULT 0,
    max_points    REAL NOT NULL DEFAULT 0,
    latency_ms    REAL,
    model_response TEXT,
    raw_json      TEXT,
    parsed_tool_json TEXT,
    error_message TEXT,
    failure_type  TEXT,
    score_reason  TEXT,
    notes         TEXT,
    prompt        TEXT,
    expected_behavior TEXT,
    ts            TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bench_results_run ON bench_results(run_id);
`)

// ─── row mappers ──────────────────────────────────────────────────────────────

function runFromRow(r: any): BenchmarkRun {
  return {
    id: r.id, harness: r.harness as BenchmarkHarness, mode: r.mode as ExecutionMode,
    modelName: r.model_name, provider: r.provider, endpoint: r.endpoint ?? undefined,
    taskPackId: r.task_pack_id, taskPackName: r.task_pack_name,
    startedAt: r.started_at, finishedAt: r.finished_at ?? null, status: r.status as RunStatus,
    taskCount: r.task_count, completedCount: r.completed_count,
    totalScore: r.total_score, maxScore: r.max_score,
    passRate: r.pass_rate, avgLatencyMs: r.avg_latency, failureCount: r.failure_count,
    error: r.error ?? null,
  }
}

function resultFromRow(r: any): BenchmarkTaskResult {
  return {
    id: r.id, runId: r.run_id, taskId: r.task_id, taskTitle: r.task_title, lane: r.lane,
    status: r.status, points: r.points, maxPoints: r.max_points, latencyMs: r.latency_ms,
    modelResponse: r.model_response ?? '',
    rawHarnessOutput: r.raw_json ? safeParse(r.raw_json) : undefined,
    parsedToolCall: r.parsed_tool_json ? safeParse(r.parsed_tool_json) : undefined,
    errorMessage: r.error_message ?? null, failureType: r.failure_type ?? null,
    scoreReason: r.score_reason ?? undefined, notes: r.notes ?? undefined,
    prompt: r.prompt ?? undefined, expectedBehavior: r.expected_behavior ?? undefined,
    ts: r.ts,
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return s } }

// ─── runs ─────────────────────────────────────────────────────────────────────

export interface CreateRunInput {
  harness: BenchmarkHarness; mode: ExecutionMode; modelName: string; provider: string
  endpoint?: string; taskPackId: string; taskPackName: string; taskCount: number; maxScore: number
}

export function createRun(input: CreateRunInput): BenchmarkRun {
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO bench_runs (id, harness, mode, model_name, provider, endpoint, task_pack_id,
      task_pack_name, started_at, status, task_count, completed_count, total_score, max_score, failure_count)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,0)
  `).run(id, input.harness, input.mode, input.modelName, input.provider, input.endpoint ?? null,
    input.taskPackId, input.taskPackName, now, 'running', input.taskCount, input.maxScore)
  return getRun(id)!
}

export function getRun(id: string): BenchmarkRun | null {
  const row = db.prepare('SELECT * FROM bench_runs WHERE id = ?').get(id)
  return row ? runFromRow(row) : null
}

export function getRunWithResults(id: string): BenchmarkRun | null {
  const run = getRun(id)
  if (!run) return null
  run.results = listResults(id)
  return run
}

export function listRuns(limit = 100): BenchmarkRun[] {
  const rows = db.prepare('SELECT * FROM bench_runs ORDER BY started_at DESC LIMIT ?').all(limit)
  return rows.map(runFromRow)
}

export interface RunPatch {
  status?: RunStatus; finishedAt?: string | null; completedCount?: number
  totalScore?: number; passRate?: number | null; avgLatencyMs?: number | null
  failureCount?: number; error?: string | null
}

export function updateRun(id: string, patch: RunPatch): BenchmarkRun | null {
  const cur = getRun(id)
  if (!cur) return null
  const next = { ...cur, ...patch }
  db.prepare(`
    UPDATE bench_runs SET status=?, finished_at=?, completed_count=?, total_score=?,
      pass_rate=?, avg_latency=?, failure_count=?, error=? WHERE id=?
  `).run(next.status, next.finishedAt ?? null, next.completedCount, next.totalScore,
    next.passRate ?? null, next.avgLatencyMs ?? null, next.failureCount, next.error ?? null, id)
  return getRun(id)
}

export function deleteRun(id: string): boolean {
  db.prepare('DELETE FROM bench_results WHERE run_id = ?').run(id)
  const r = db.prepare('DELETE FROM bench_runs WHERE id = ?').run(id)
  return (r.changes ?? 0) > 0
}

// ─── results ──────────────────────────────────────────────────────────────────

export function addResult(r: Omit<BenchmarkTaskResult, 'id' | 'ts'> & { id?: string; ts?: string }): BenchmarkTaskResult {
  const id = r.id ?? randomUUID()
  const ts = r.ts ?? new Date().toISOString()
  db.prepare(`
    INSERT INTO bench_results (id, run_id, task_id, task_title, lane, status, points, max_points,
      latency_ms, model_response, raw_json, parsed_tool_json, error_message, failure_type,
      score_reason, notes, prompt, expected_behavior, ts)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, r.runId, r.taskId, r.taskTitle, r.lane, r.status, r.points, r.maxPoints,
    r.latencyMs ?? null, r.modelResponse ?? '',
    r.rawHarnessOutput !== undefined ? JSON.stringify(r.rawHarnessOutput) : null,
    r.parsedToolCall !== undefined ? JSON.stringify(r.parsedToolCall) : null,
    r.errorMessage ?? null, r.failureType ?? null, r.scoreReason ?? null, r.notes ?? null,
    r.prompt ?? null, r.expectedBehavior ?? null, ts)
  return { ...r, id, ts } as BenchmarkTaskResult
}

/** Replace a prior result for the same (run, task) — used by rerun-failed. */
export function deleteResultsForTask(runId: string, taskId: string): void {
  db.prepare('DELETE FROM bench_results WHERE run_id = ? AND task_id = ?').run(runId, taskId)
}

export function listResults(runId: string): BenchmarkTaskResult[] {
  const rows = db.prepare('SELECT * FROM bench_results WHERE run_id = ? ORDER BY ts ASC').all(runId)
  return rows.map(resultFromRow)
}

// ─── cross-run model comparison ────────────────────────────────────────────────

export interface ModelComparisonRow {
  harness: BenchmarkHarness; modelName: string; provider: string
  runs: number; totalScore: number; maxScore: number; overallPct: number | null
  passRate: number | null; avgLatencyMs: number | null; failureCount: number
  laneScores: Record<string, number | null>   // lane → percentage
  lastRunAt: string
}

export function modelComparison(): ModelComparisonRow[] {
  const runs = listRuns(500).filter(r => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled')
  const byKey = new Map<string, BenchmarkRun[]>()
  for (const r of runs) {
    const k = `${r.harness}|${r.modelName}|${r.provider}`
    const arr = byKey.get(k) ?? []; arr.push(r); byKey.set(k, arr)
  }
  const out: ModelComparisonRow[] = []
  for (const [k, rs] of byKey) {
    const [harness, modelName, provider] = k.split('|')
    const results = rs.flatMap(r => listResults(r.id))
    const scored = results.filter(x => x.status === 'passed' || x.status === 'failed')
    const totalScore = scored.reduce((s, x) => s + x.points, 0)
    const maxScore = scored.reduce((s, x) => s + x.maxPoints, 0)
    const passed = scored.filter(x => x.status === 'passed').length
    const lat = results.map(x => x.latencyMs).filter((n): n is number => typeof n === 'number')
    const failureCount = results.filter(x => x.status === 'failed' || x.status === 'error').length
    // Per-lane percentage.
    const laneScores: Record<string, number | null> = {}
    const byLane = new Map<string, BenchmarkTaskResult[]>()
    for (const x of scored) { const a = byLane.get(x.lane) ?? []; a.push(x); byLane.set(x.lane, a) }
    for (const [lane, xs] of byLane) {
      const mp = xs.reduce((s, x) => s + x.maxPoints, 0)
      laneScores[lane] = mp > 0 ? Math.round((xs.reduce((s, x) => s + x.points, 0) / mp) * 100) : null
    }
    out.push({
      harness: harness as BenchmarkHarness, modelName, provider,
      runs: rs.length, totalScore, maxScore,
      overallPct: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null,
      passRate: scored.length ? Math.round((passed / scored.length) * 100) : null,
      avgLatencyMs: lat.length ? Math.round(lat.reduce((s, n) => s + n, 0) / lat.length) : null,
      failureCount, laneScores,
      lastRunAt: rs.map(r => r.startedAt).sort().slice(-1)[0] ?? '',
    })
  }
  return out.sort((a, b) => (b.overallPct ?? -1) - (a.overallPct ?? -1))
}
