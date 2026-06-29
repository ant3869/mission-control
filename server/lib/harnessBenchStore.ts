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
import { deriveFamily, estimateCost, estimateTokens, type ModelFamily } from './harnessBenchPricing.js'

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
    resolved_model TEXT,
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
    sample_count  INTEGER NOT NULL DEFAULT 1,
    pass_count    INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    reported_cost REAL NOT NULL DEFAULT 0,
    ts            TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bench_results_run ON bench_results(run_id);
`)

// Migrate existing DBs created before later columns existed.
for (const col of [
  'sample_count INTEGER NOT NULL DEFAULT 1', 'pass_count INTEGER NOT NULL DEFAULT 0',
  'output_tokens INTEGER NOT NULL DEFAULT 0', 'input_tokens INTEGER NOT NULL DEFAULT 0',
  'reported_cost REAL NOT NULL DEFAULT 0',
]) {
  try { db.exec(`ALTER TABLE bench_results ADD COLUMN ${col}`) } catch { /* already present */ }
}
try { db.exec('ALTER TABLE bench_runs ADD COLUMN resolved_model TEXT') } catch { /* already present */ }

// ─── row mappers ──────────────────────────────────────────────────────────────

function runFromRow(r: any): BenchmarkRun {
  return {
    id: r.id, harness: r.harness as BenchmarkHarness, mode: r.mode as ExecutionMode,
    modelName: r.model_name, resolvedModel: r.resolved_model ?? null,
    provider: r.provider, endpoint: r.endpoint ?? undefined,
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
    sampleCount: r.sample_count ?? 1, passCount: r.pass_count ?? 0,
    outputTokens: r.output_tokens ?? 0, inputTokens: r.input_tokens ?? 0, reportedCost: r.reported_cost ?? 0,
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
  failureCount?: number; error?: string | null; resolvedModel?: string | null
}

export function updateRun(id: string, patch: RunPatch): BenchmarkRun | null {
  const cur = getRun(id)
  if (!cur) return null
  const next = { ...cur, ...patch }
  db.prepare(`
    UPDATE bench_runs SET status=?, finished_at=?, completed_count=?, total_score=?,
      pass_rate=?, avg_latency=?, failure_count=?, error=?, resolved_model=? WHERE id=?
  `).run(next.status, next.finishedAt ?? null, next.completedCount, next.totalScore,
    next.passRate ?? null, next.avgLatencyMs ?? null, next.failureCount, next.error ?? null,
    next.resolvedModel ?? null, id)
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
      score_reason, notes, prompt, expected_behavior, sample_count, pass_count,
      output_tokens, input_tokens, reported_cost, ts)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, r.runId, r.taskId, r.taskTitle, r.lane, r.status, r.points, r.maxPoints,
    r.latencyMs ?? null, r.modelResponse ?? '',
    r.rawHarnessOutput !== undefined ? JSON.stringify(r.rawHarnessOutput) : null,
    r.parsedToolCall !== undefined ? JSON.stringify(r.parsedToolCall) : null,
    r.errorMessage ?? null, r.failureType ?? null, r.scoreReason ?? null, r.notes ?? null,
    r.prompt ?? null, r.expectedBehavior ?? null, r.sampleCount ?? 1, r.passCount ?? 0,
    Math.round(r.outputTokens ?? 0), Math.round(r.inputTokens ?? 0), r.reportedCost ?? 0, ts)
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

export type CompareMode = 'latest' | 'average' | 'best'
export type CompareGroupBy = 'model' | 'provider'

export interface ModelComparisonRow {
  harness: BenchmarkHarness; modelName: string; provider: string
  family: ModelFamily       // provider family (Anthropic/OpenAI/Google/…)
  modelCount: number        // 1 for model rows; N distinct models for provider rows
  taskPackId: string; taskPackName: string
  runs: number          // total completed runs available in this group
  runsUsed: number      // how many of them this row's score is computed from (mode-dependent)
  totalScore: number; maxScore: number; overallPct: number | null
  passRate: number | null; avgLatencyMs: number | null; failureCount: number
  laneScores: Record<string, number | null>   // lane → percentage
  // ── Model fingerprint: characteristics that differ even at equal accuracy ──
  reliabilityPct: number | null   // sample pass-consistency = Σpassed / Σsamples
  latencyStdevMs: number | null   // speed consistency (lower = steadier)
  avgResponseChars: number        // verbosity — mean response length (chars)
  avgOutputTokens: number         // verbosity — mean output tokens/task
  tokensEstimated: boolean        // true → tokens estimated from chars (no usage reported)
  fenceRate: number               // % of responses wrapped in ``` code fences
  estCostUsd: number | null       // est USD per run (one pack pass)
  costEstimated: boolean          // true → from pricing table (no harness-reported cost)
  maxSamples: number              // largest samples/task used (1 → reliability == pass rate)
  trend: number[]                 // overall % of each completed run in the group, oldest → newest
  lastRunAt: string
}

type Entry = { r: BenchmarkTaskResult; model: string }

// The model identity for comparison is what the harness ACTUALLY ran
// (resolvedModel), not what was requested — OpenClaw ignores the per-call model,
// so two differently-labelled runs may be the same model and must collapse.
function effModel(r: BenchmarkRun): string { return (r.resolvedModel && r.resolvedModel.trim()) || r.modelName }

function chooseRuns(rs: BenchmarkRun[], mode: CompareMode): { chosen: BenchmarkRun[]; ref: BenchmarkRun } {
  const sortedDesc = [...rs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const pctOf = (r: BenchmarkRun) => (r.maxScore > 0 ? r.totalScore / r.maxScore : -1)
  const chosen = mode === 'average' ? rs : mode === 'best' ? [[...rs].sort((a, b) => pctOf(b) - pctOf(a))[0]] : [sortedDesc[0]]
  return { chosen, ref: sortedDesc[0] }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : 0)

type Metrics = Pick<ModelComparisonRow,
  'totalScore' | 'maxScore' | 'overallPct' | 'passRate' | 'avgLatencyMs' | 'failureCount' | 'laneScores' |
  'reliabilityPct' | 'latencyStdevMs' | 'avgResponseChars' | 'avgOutputTokens' | 'tokensEstimated' |
  'fenceRate' | 'estCostUsd' | 'costEstimated' | 'maxSamples'>

function metricsFor(entries: Entry[], runsUsed: number): Metrics {
  const results = entries.map(e => e.r)
  const scored = results.filter(x => x.status === 'passed' || x.status === 'failed')
  const totalScore = scored.reduce((s, x) => s + x.points, 0)
  const maxScore = scored.reduce((s, x) => s + x.maxPoints, 0)
  const passed = scored.filter(x => x.status === 'passed').length
  const lat = results.map(x => x.latencyMs).filter((n): n is number => typeof n === 'number')
  const failureCount = results.filter(x => x.status === 'failed' || x.status === 'error').length

  const perSamples = (x: BenchmarkTaskResult) => (x.sampleCount && x.sampleCount > 1 ? x.sampleCount : 1)
  const perPasses = (x: BenchmarkTaskResult) => (x.sampleCount && x.sampleCount > 1 ? (x.passCount ?? 0) : (x.status === 'passed' ? 1 : 0))
  const sumSamples = results.reduce((s, x) => s + perSamples(x), 0)
  const sumPasses = results.reduce((s, x) => s + perPasses(x), 0)
  const reliabilityPct = sumSamples > 0 ? Math.round((sumPasses / sumSamples) * 100) : null
  const maxSamples = results.reduce((m, x) => Math.max(m, x.sampleCount ?? 1), 1)
  const latMean = avg(lat)
  const latStdev = lat.length > 1 ? Math.round(Math.sqrt(avg(lat.map(n => (n - latMean) ** 2)))) : null
  const avgResponseChars = Math.round(avg(results.map(x => (x.modelResponse ?? '').length)))
  const fenceRate = results.length ? Math.round((results.filter(x => (x.modelResponse ?? '').includes('```')).length / results.length) * 100) : 0

  // Tokens — real usage when reported, else estimated from chars (~4 chars/token).
  const outTok = (x: BenchmarkTaskResult) => ((x.outputTokens ?? 0) > 0 ? x.outputTokens! : estimateTokens((x.modelResponse ?? '').length))
  const inTok = (x: BenchmarkTaskResult) => ((x.inputTokens ?? 0) > 0 ? x.inputTokens! : estimateTokens((x.prompt ?? '').length))
  const tokensEstimated = !results.some(x => (x.outputTokens ?? 0) > 0)
  const avgOutputTokens = Math.round(avg(results.map(outTok)))

  // Cost — harness-reported when present, else estimated from the pricing table.
  let totalCost = 0; let anyRealCost = false
  for (const e of entries) {
    if ((e.r.reportedCost ?? 0) > 0) { totalCost += e.r.reportedCost!; anyRealCost = true }
    else totalCost += estimateCost(e.model, inTok(e.r), outTok(e.r))
  }
  const estCostUsd = results.length ? totalCost / Math.max(1, runsUsed) : null
  const costEstimated = !anyRealCost

  const laneScores: Record<string, number | null> = {}
  const byLane = new Map<string, BenchmarkTaskResult[]>()
  for (const x of scored) { const a = byLane.get(x.lane) ?? []; a.push(x); byLane.set(x.lane, a) }
  for (const [lane, xs] of byLane) {
    const mp = xs.reduce((s, x) => s + x.maxPoints, 0)
    laneScores[lane] = mp > 0 ? Math.round((xs.reduce((s, x) => s + x.points, 0) / mp) * 100) : null
  }

  return {
    totalScore, maxScore, overallPct: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null,
    passRate: scored.length ? Math.round((passed / scored.length) * 100) : null,
    avgLatencyMs: lat.length ? Math.round(latMean) : null, failureCount, laneScores,
    reliabilityPct, latencyStdevMs: latStdev, avgResponseChars, avgOutputTokens, tokensEstimated,
    fenceRate, estCostUsd: estCostUsd != null ? Math.round(estCostUsd * 1e6) / 1e6 : null, costEstimated, maxSamples,
  }
}

/**
 * Cross-run comparison. mode = latest|average|best (which run(s) per group);
 * groupBy = 'model' (per model + pack) or 'provider' (rolled up by family + pack).
 */
export function modelComparison(mode: CompareMode = 'latest', groupBy: CompareGroupBy = 'model'): ModelComparisonRow[] {
  const runs = listRuns(500).filter(r => r.status === 'completed')

  if (groupBy === 'provider') {
    const byFam = new Map<string, BenchmarkRun[]>()
    for (const r of runs) {
      const k = `${r.harness}|${deriveFamily(effModel(r))}|${r.taskPackId}`
      const arr = byFam.get(k) ?? []; arr.push(r); byFam.set(k, arr)
    }
    const out: ModelComparisonRow[] = []
    for (const [, rs] of byFam) {
      const byModel = new Map<string, BenchmarkRun[]>()
      for (const r of rs) { const a = byModel.get(effModel(r)) ?? []; a.push(r); byModel.set(effModel(r), a) }
      const entries: Entry[] = []; let runsUsed = 0
      for (const [model, runsM] of byModel) {
        const { chosen } = chooseRuns(runsM, mode); runsUsed += chosen.length
        for (const run of chosen) for (const x of listResults(run.id)) entries.push({ r: x, model })
      }
      const ref = [...rs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
      const family = deriveFamily(effModel(ref))
      out.push({
        harness: ref.harness, modelName: family, provider: family, family, modelCount: byModel.size,
        taskPackId: ref.taskPackId, taskPackName: ref.taskPackName,
        runs: rs.length, runsUsed, ...metricsFor(entries, runsUsed),
        trend: [...rs].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(r => r.maxScore > 0 ? Math.round((r.totalScore / r.maxScore) * 100) : 0),
        lastRunAt: ref.startedAt,
      })
    }
    return out.sort((a, b) => (b.overallPct ?? -1) - (a.overallPct ?? -1))
  }

  const byKey = new Map<string, BenchmarkRun[]>()
  for (const r of runs) {
    const k = `${r.harness}|${effModel(r)}|${r.provider}|${r.taskPackId}`
    const arr = byKey.get(k) ?? []; arr.push(r); byKey.set(k, arr)
  }
  const out: ModelComparisonRow[] = []
  for (const [, rs] of byKey) {
    const { chosen, ref } = chooseRuns(rs, mode)
    const model = effModel(ref)
    const entries: Entry[] = chosen.flatMap(run => listResults(run.id).map(x => ({ r: x, model })))
    out.push({
      harness: ref.harness, modelName: model, provider: ref.provider,
      family: deriveFamily(model), modelCount: 1,
      taskPackId: ref.taskPackId, taskPackName: ref.taskPackName,
      runs: rs.length, runsUsed: chosen.length, ...metricsFor(entries, chosen.length),
      trend: [...rs].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(r => r.maxScore > 0 ? Math.round((r.totalScore / r.maxScore) * 100) : 0),
      lastRunAt: ref.startedAt,
    })
  }
  return out.sort((a, b) => (b.overallPct ?? -1) - (a.overallPct ?? -1))
}

/** Bulk cleanup. scope 'failed' removes failed/cancelled runs; 'all' wipes history. */
export function clearRuns(scope: 'failed' | 'all'): number {
  if (scope === 'all') {
    const n = (db.prepare('SELECT COUNT(*) AS c FROM bench_runs').get() as any)?.c ?? 0
    db.exec('DELETE FROM bench_results; DELETE FROM bench_runs;')
    return n
  }
  const rows = db.prepare("SELECT id FROM bench_runs WHERE status IN ('failed','cancelled')").all() as any[]
  for (const r of rows) db.prepare('DELETE FROM bench_results WHERE run_id = ?').run(r.id)
  const res = db.prepare("DELETE FROM bench_runs WHERE status IN ('failed','cancelled')").run()
  return Number(res.changes ?? 0)
}
