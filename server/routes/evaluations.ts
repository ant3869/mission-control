// title: Evaluations backend route
// path: server/routes/evaluations.ts
// purpose: REST surface for the Evaluations feature. Scoped to Hermes +
//          OpenClaw only — no Claude Code / editor telemetry. Reads derived
//          runs + scorecards from evalEngine (real session history) and
//          persists benchmark tasks/runs and manual rubric scores via
//          evalStore (SQLite). Benchmark runs really execute the task against
//          the connected agent and capture the resulting transcript.

import { Router } from 'express'
import { randomUUID } from 'crypto'
import {
  buildPlatformOverview, getEvalRuns, scoreModel, methodology, modelLabel,
  deriveFromTranscript, type EvaluationRun, type RunOutcome,
} from '../lib/evalEngine.js'
import {
  type EvalPlatform, isEvalPlatform, EVAL_PLATFORMS,
  listBenchmarkTasks, getBenchmarkTask, createBenchmarkTask, deleteBenchmarkTask,
  listBenchmarkRuns, createBenchmarkRun, updateBenchmarkRun,
  listManualScores, createManualScore,
  listSnapshots,
} from '../lib/evalStore.js'
import { isLive } from '../lib/connectors.js'
import { ensureConnected, request as ocRequest } from '../lib/openclawLive.js'
import { getPlatformMetrics } from '../lib/metrics.js'
import { hermesChat, hermesApiHealth } from '../lib/hermesApiServer.js'
import {
  type MemoryKind, listMemoryTasks, getMemoryTask, createMemoryTask, deleteMemoryTask,
  listMemoryRuns,
} from '../lib/memoryEvalStore.js'
import {
  detectProviders, buildMemoryOverview, prepareMemoryRun, executeMemoryRun, memoryMethodology,
} from '../lib/memoryEvalEngine.js'
import { gradeBuiltinAnswer, listAutoGradedSlugs } from '../lib/benchmarkGraders.js'

export const evaluationsRouter = Router()

function parsePlatform(v: any): EvalPlatform | null {
  return isEvalPlatform(v) ? v : null
}

// ─── Overviews (per platform) ──────────────────────────────────────────────────

evaluationsRouter.get('/hermes/overview', async (_req, res) => {
  try { res.json({ overview: await buildPlatformOverview('hermes', { snapshot: true }) }) }
  catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed to build overview' }) }
})

evaluationsRouter.get('/openclaw/overview', async (_req, res) => {
  try { res.json({ overview: await buildPlatformOverview('openclaw', { snapshot: true }) }) }
  catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed to build overview' }) }
})

// ─── Cross-platform model + agent rollups ──────────────────────────────────────

evaluationsRouter.get('/models', async (_req, res) => {
  try {
    const [oc, hr] = await Promise.all([buildPlatformOverview('openclaw'), buildPlatformOverview('hermes')])
    const models = [...oc.leaderboard, ...hr.leaderboard].sort((a, b) => b.overall - a.overall)
    res.json({
      models,
      platforms: [
        { platform: 'openclaw', reachable: oc.reachable, error: oc.error, modelCount: oc.summary.modelCount },
        { platform: 'hermes',   reachable: hr.reachable, error: hr.error, modelCount: hr.summary.modelCount },
      ],
      fetchedAt: new Date().toISOString(),
    })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

evaluationsRouter.get('/agents', async (_req, res) => {
  try {
    const sets = await Promise.all(EVAL_PLATFORMS.map(p => getEvalRuns(p)))
    const out: Array<{
      platform: EvalPlatform; agent: string; runCount: number; evaluatedCount: number
      successRate: number | null; modelCount: number; topModel: string | null
    }> = []
    for (const rs of sets) {
      if (!rs.reachable) continue
      const byAgent = new Map<string, EvaluationRun[]>()
      for (const r of rs.runs) {
        const arr = byAgent.get(r.agent) ?? []; arr.push(r); byAgent.set(r.agent, arr)
      }
      for (const [agent, runs] of byAgent) {
        const ev = runs.filter(r => r.outcome !== 'unresolved')
        const successN = runs.filter(r => r.outcome === 'success' || r.outcome === 'recovered').length
        const models = new Map<string, number>()
        for (const r of runs) models.set(r.model, (models.get(r.model) ?? 0) + 1)
        const topModel = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        out.push({
          platform: rs.platform, agent, runCount: runs.length, evaluatedCount: ev.length,
          successRate: ev.length ? Math.round((successN / ev.length) * 1000) / 10 : null,
          modelCount: models.size, topModel,
        })
      }
    }
    res.json({ agents: out.sort((a, b) => b.runCount - a.runCount), fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

evaluationsRouter.get('/agent-model-matrix', async (req, res) => {
  try {
    const want = parsePlatform(req.query.platform)
    const platforms = want ? [want] : EVAL_PLATFORMS
    const matrices = await Promise.all(platforms.map(async p => {
      const ov = await buildPlatformOverview(p)
      return { platform: p, reachable: ov.reachable, error: ov.error, ...ov.agentModelMatrix }
    }))
    res.json({ matrices, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

// ─── Model / agent drilldowns ─────────────────────────────────────────────────

evaluationsRouter.get('/model/:modelName', async (req, res) => {
  try {
    const want = parsePlatform(req.query.platform)
    const platforms = want ? [want] : EVAL_PLATFORMS
    const model = decodeURIComponent(req.params.modelName)
    const out: any[] = []
    for (const p of platforms) {
      const rs = await getEvalRuns(p)
      if (!rs.reachable) { out.push({ platform: p, reachable: false, error: rs.error }); continue }
      const runs = rs.runs.filter(r => r.model === model)
      if (runs.length === 0) continue
      const benchRuns = listBenchmarkRuns({ platform: p, model })
      const manuals = listManualScores({ platform: p, model })
      const snapshots = listSnapshots(p, model)
      const prev = snapshots[snapshots.length - 1]
      const card = scoreModel(p, model, runs, benchRuns, manuals, prev ? prev.overall : null)
      out.push({
        platform: p, reachable: true, error: null,
        scorecard: card, runs, benchmarkRuns: benchRuns, manualScores: manuals, snapshots,
      })
    }
    if (out.length === 0) return res.status(404).json({ error: `no runs found for model "${model}"` })
    res.json({ model, modelLabel: modelLabel(model), results: out, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

evaluationsRouter.get('/agent/:agentName', async (req, res) => {
  try {
    const want = parsePlatform(req.query.platform)
    const platforms = want ? [want] : EVAL_PLATFORMS
    const agent = decodeURIComponent(req.params.agentName)
    const out: any[] = []
    for (const p of platforms) {
      const rs = await getEvalRuns(p)
      if (!rs.reachable) { out.push({ platform: p, reachable: false, error: rs.error }); continue }
      const runs = rs.runs.filter(r => r.agent === agent)
      if (runs.length === 0) continue
      const byModel = new Map<string, EvaluationRun[]>()
      for (const r of runs) { const a = byModel.get(r.model) ?? []; a.push(r); byModel.set(r.model, a) }
      const cards = [...byModel.entries()].map(([model, mruns]) => {
        const bench = listBenchmarkRuns({ platform: p, model }).filter(b => !b.agent || b.agent === agent)
        const manuals = listManualScores({ platform: p, model }).filter(m => !m.agent || m.agent === agent)
        return scoreModel(p, model, mruns, bench, manuals, null)
      }).sort((a, b) => b.overall - a.overall)
      out.push({ platform: p, reachable: true, error: null, agent, scorecards: cards, runs })
    }
    if (out.length === 0) return res.status(404).json({ error: `no runs found for agent "${agent}"` })
    res.json({ agent, results: out, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

// ─── Runs feed (filterable) ────────────────────────────────────────────────────

evaluationsRouter.get('/runs', async (req, res) => {
  try {
    const want = parsePlatform(req.query.platform)
    const platforms = want ? [want] : EVAL_PLATFORMS
    const model   = req.query.model   ? String(req.query.model)   : ''
    const agent   = req.query.agent   ? String(req.query.agent)   : ''
    const outcome = req.query.outcome ? String(req.query.outcome) : ''
    const limit   = Math.min(Math.max(Number(req.query.limit ?? 80), 1), 400)

    const sets = await Promise.all(platforms.map(p => getEvalRuns(p)))
    let all: EvaluationRun[] = []
    for (const rs of sets) if (rs.reachable) all.push(...rs.runs)
    if (model)   all = all.filter(r => r.model === model)
    if (agent)   all = all.filter(r => r.agent === agent)
    if (outcome) all = all.filter(r => r.outcome === (outcome as RunOutcome))
    all.sort((a, b) => new Date(b.lastActiveAt ?? 0).getTime() - new Date(a.lastActiveAt ?? 0).getTime())
    res.json({ runs: all.slice(0, limit), total: all.length, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

// ─── Benchmarks ────────────────────────────────────────────────────────────────

evaluationsRouter.get('/benchmarks', (req, res) => {
  const platform = parsePlatform(req.query.platform) ?? undefined
  const tasks = listBenchmarkTasks(platform)
  const runs  = listBenchmarkRuns(platform ? { platform } : undefined)
  res.json({ tasks, runs, fetchedAt: new Date().toISOString() })
})

evaluationsRouter.get('/benchmarks/tasks/:id', (req, res) => {
  const task = getBenchmarkTask(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  const runs = listBenchmarkRuns({ taskId: task.id })
  res.json({ task, runs })
})

evaluationsRouter.post('/benchmarks/tasks', (req, res) => {
  try {
    const b = req.body ?? {}
    const platform = parsePlatform(b.platform)
    if (!platform) return res.status(400).json({ error: 'platform must be hermes or openclaw' })
    if (!String(b.title ?? '').trim()) return res.status(400).json({ error: 'title is required' })
    if (!String(b.prompt ?? '').trim()) return res.status(400).json({ error: 'prompt is required' })
    const task = createBenchmarkTask({
      platform, agent: b.agent, title: b.title, prompt: b.prompt,
      rubric: b.rubric, expectedTools: b.expectedTools, notes: b.notes,
    })
    res.status(201).json({ task })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

evaluationsRouter.delete('/benchmarks/tasks/:id', (req, res) => {
  const r = deleteBenchmarkTask(req.params.id)
  if (r.ok) return res.json({ ok: true })
  if (r.reason === 'builtin') {
    return res.status(409).json({ error: 'This is a built-in benchmark task. Built-ins ship with the dashboard and cannot be deleted — clone it instead.' })
  }
  return res.status(404).json({ error: 'Task not found' })
})

// Helpers for benchmark execution.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === 'text' ? String(b.text ?? '') : typeof b === 'string' ? b : '')).join('\n')
  }
  return ''
}

interface ExecResult { messages: any[]; durationMs: number; status: string; resolvedModel?: string }

async function executeOnOpenClaw(prompt: string, sessionKey: string): Promise<ExecResult> {
  const start = Date.now()
  await ensureConnected(12_000)
  await ocRequest('chat.send', { sessionKey, message: prompt, deliver: false, idempotencyKey: randomUUID() }, 12_000)
  // Poll for completion: the last assistant message stops changing.
  let lastSig = ''; let stable = 0; let messages: any[] = []
  for (let i = 0; i < 48; i++) {
    await sleep(5000)
    const h = await ocRequest('chat.history', { sessionKey, limit: 50, maxChars: 200_000 }, 10_000).catch(() => null)
    messages = h?.messages ?? []
    const lastAssistant = [...messages].reverse().find(m => String(m.role) === 'assistant')
    const sig = `${messages.length}|${extractText(lastAssistant?.content).slice(-200)}`
    if (sig === lastSig && lastAssistant) { stable++; if (stable >= 2) break } else { stable = 0; lastSig = sig }
  }
  return { messages, durationMs: Date.now() - start, status: messages.length ? 'completed' : 'no-response' }
}

async function executeOnHermes(prompt: string, _sessionId: string, model?: string): Promise<ExecResult> {
  // Real chat dispatch goes to the Hermes API SERVER (OpenAI-compat) — not the
  // operator dashboard. See server/lib/hermesApiServer.ts for the protocol
  // contract; the dashboard ports (9119/9121) intentionally return 405 for /v1.
  const r = await hermesChat(prompt, { model, timeoutMs: 180_000 })
  if (!r.ok) {
    throw new Error(
      `Hermes API server (${r.triedUrl}) rejected the request — ${r.error ?? 'unknown'}.\n` +
      `Verify: GET ${r.triedUrl.replace(/\/chat\/completions$/, '/models')} with the configured key returns 200.\n` +
      `If the URL points at the dashboard (e.g. 9119), update it in Settings → Hermes → API server URL (default http://127.0.0.1:8642/v1).`
    )
  }
  // Synthesize a transcript shape so deriveFromTranscript can score it the
  // same way as a polled session: one user turn + one assistant final reply.
  const messages = [
    { role: 'user', content: prompt },
    { role: 'assistant', content: r.answer ?? '' },
  ]
  return {
    messages, durationMs: r.latencyMs,
    status: r.answer ? 'completed' : 'no-response',
    resolvedModel: r.model ?? undefined,
  }
}

evaluationsRouter.post('/benchmarks/run', async (req, res) => {
  try {
    const b = req.body ?? {}
    const taskId = String(b.taskId ?? '')
    const task = getBenchmarkTask(taskId)
    if (!task) return res.status(404).json({ error: 'Task not found — create it via POST /benchmarks/tasks first.' })
    const platform = parsePlatform(b.platform) ?? task.platform
    if (!isLive(platform)) return res.status(409).json({ error: `${platform} is not connected — enable it in Settings before running benchmarks.` })
    const declaredModel = String(b.model ?? '').trim()
    const agent = String(b.agent ?? task.agent ?? '').trim()
    const resolvedAgent = agent || (platform === 'openclaw' ? 'main' : 'hermes')

    // Unique per dispatch so chat.history of one run never mixes into the next.
    const runStamp = Date.now().toString(36)
    const sessionKey = platform === 'openclaw'
      ? `agent:${resolvedAgent}:dashboard-benchmark:${task.id.slice(0, 8)}-${runStamp}`
      : `dashboard-benchmark-${task.id.slice(0, 8)}-${runStamp}`

    // Persist a "running" placeholder immediately so the UI shows feedback
    // straight away — execution itself can take minutes. The async runner
    // patches this row with the real outcome (or an error note) when it
    // finishes.
    const pending = createBenchmarkRun({
      taskId: task.id, platform, agent: resolvedAgent, model: declaredModel || 'unknown',
      status: 'running', outcome: 'unresolved',
      toolCalls: 0, wastedToolCalls: 0, retries: 0, durationMs: 0, tokens: 0, cost: 0,
      rubricScore: null, notes: `Execution in progress (session ${sessionKey.slice(-12)})…`,
    })
    res.status(202).json({ ok: true, status: 'dispatched', taskId, platform, runId: pending.id })

    const dispatchedAt = Date.now()
    const run = async () => {
      try {
        const exec = platform === 'openclaw'
          ? await executeOnOpenClaw(task.prompt, sessionKey)
          : await executeOnHermes(task.prompt, sessionKey, declaredModel)
        const q = deriveFromTranscript(exec.messages, exec.status)

        // Resolve the model the runtime actually used: OpenClaw needs a session
        // lookup; Hermes API server returns it directly in the chat response.
        let resolvedModel = exec.resolvedModel ?? declaredModel
        if (platform === 'openclaw') {
          try {
            const metrics = await getPlatformMetrics(platform)
            const row = metrics.sessionList.find(s => s.key === sessionKey)
            if (row?.model) resolvedModel = row.model
          } catch { /* keep declared */ }
        }

        // Pull the agent's final reply out of the (possibly mixed) message
        // stream so the UI can show it in the drilldown for successful runs.
        const finalAssistant = [...exec.messages].reverse().find(m => String(m?.role) === 'assistant')
        const answer = extractText(finalAssistant?.content).trim()

        // Automated grading for built-in benchmarks: each built-in slug has a
        // deterministic grader (exact-match, JSON deep-equal, refusal pattern,
        // …) so the rubricScore reflects real model performance instead of
        // staying null until someone manually scores it. Without this, every
        // dispatch was logged as `outcome=success` purely because the agent
        // replied something — making the leaderboard meaningless for
        // comparison.
        let rubricScore: number | null = null
        let gradeNote = ''
        if (task.builtIn && task.builtInSlug && answer) {
          const r = gradeBuiltinAnswer(task.builtInSlug, answer)
          if (r) {
            rubricScore = r.score
            gradeNote = `auto-graded ${r.score}/100 · ${r.reason}`
          }
        }

        // If the auto-grader judged a hard failure, override the
        // transcript-derived outcome. A model that "replies cleanly" with the
        // wrong answer should rank as a failure, not a success.
        const gradedFailure = rubricScore != null && rubricScore < 50
        const effectiveOutcome: RunOutcome = gradedFailure ? 'failure' : q.outcome
        const effectiveStatus = effectiveOutcome === 'unresolved'
          ? 'unresolved'
          : effectiveOutcome === 'failure'
            ? 'failure'
            : 'success'

        const noResponseNote = exec.status === 'no-response' ? 'Agent returned no response within ~4 minutes.' : ''
        const combinedNotes = [noResponseNote, gradeNote].filter(Boolean).join(' | ')

        updateBenchmarkRun(pending.id, {
          model: resolvedModel || 'unknown',
          status: effectiveStatus,
          outcome: effectiveOutcome,
          toolCalls: q.toolCalls, wastedToolCalls: q.wastedToolCalls,
          retries: q.repeatedToolCalls + Math.floor(q.oscillations / 2),
          durationMs: exec.durationMs,
          rubricScore,
          notes: combinedNotes,
          // Inspectable detail for the drilldown — captured for every outcome.
          answer,
          toolSequence: q.toolSequence,
          repeatedToolCalls: q.repeatedToolCalls,
          oscillations: q.oscillations,
          noProgressTools: q.noProgressTools,
          ts: new Date().toISOString(),
        })
      } catch (err: any) {
        updateBenchmarkRun(pending.id, {
          status: 'error', outcome: 'failure',
          durationMs: Date.now() - dispatchedAt,
          // Generous cap — multi-line Hermes endpoint-probe diagnostics get
          // truncated otherwise. The panel shows the full message on hover.
          notes: `Execution failed: ${String(err?.message ?? err).slice(0, 1500)}`,
          ts: new Date().toISOString(),
        })
      }
    }
    run().catch(() => { /* errors already captured into the benchmark_run row */ })
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err?.message ?? 'failed' })
  }
})

// Manual rubric score for a model (or specific run).
evaluationsRouter.post('/manual-score', (req, res) => {
  try {
    const b = req.body ?? {}
    const platform = parsePlatform(b.platform)
    if (!platform) return res.status(400).json({ error: 'platform must be hermes or openclaw' })
    if (!String(b.model ?? '').trim()) return res.status(400).json({ error: 'model is required' })
    const n = Number(b.score)
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'score must be a number 0..100' })
    const ms = createManualScore({
      platform, agent: b.agent, model: b.model, runId: b.runId,
      score: n, rubric: b.rubric, notes: b.notes, scoredBy: b.scoredBy,
    })
    res.status(201).json({ manualScore: ms })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

// Scoring methodology — transparent rules used to compute every score.
evaluationsRouter.get('/scoring-methodology', (_req, res) => {
  res.json({ ...methodology(), autoGradedBuiltinSlugs: listAutoGradedSlugs(), fetchedAt: new Date().toISOString() })
})

// ─── Memory benchmarking ──────────────────────────────────────────────────────

const MEMORY_KINDS: MemoryKind[] = ['recall', 'multihop', 'temporal', 'conflict', 'applied', 'negative']

evaluationsRouter.get('/memory/providers', async (req, res) => {
  try {
    const want = parsePlatform(req.query.platform)
    const platforms = want ? [want] : EVAL_PLATFORMS
    const providers = (await Promise.all(platforms.map(p => detectProviders(p)))).flat()
    res.json({ providers, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

evaluationsRouter.get('/memory/overview', async (req, res) => {
  try {
    const want = parsePlatform(req.query.platform)
    if (!want) return res.status(400).json({ error: 'platform query param required (hermes|openclaw)' })
    const overview = await buildMemoryOverview(want, { snapshot: true })
    res.json({ overview })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

evaluationsRouter.get('/memory/tasks', (req, res) => {
  const platform = parsePlatform(req.query.platform) ?? undefined
  res.json({ tasks: listMemoryTasks(platform), fetchedAt: new Date().toISOString() })
})

evaluationsRouter.get('/memory/tasks/:id', (req, res) => {
  const task = getMemoryTask(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json({ task, runs: listMemoryRuns({ taskId: task.id }) })
})

evaluationsRouter.post('/memory/tasks', (req, res) => {
  try {
    const b = req.body ?? {}
    const platform = parsePlatform(b.platform)
    if (!platform) return res.status(400).json({ error: 'platform must be hermes or openclaw' })
    if (!String(b.title ?? '').trim()) return res.status(400).json({ error: 'title is required' })
    if (!String(b.query ?? '').trim()) return res.status(400).json({ error: 'query is required' })
    const kind: MemoryKind = MEMORY_KINDS.includes(b.kind) ? b.kind : 'recall'
    const task = createMemoryTask({
      platform, agent: b.agent, title: b.title, kind, query: b.query,
      expectedFacts: Array.isArray(b.expectedFacts) ? b.expectedFacts : [],
      forbiddenFacts: Array.isArray(b.forbiddenFacts) ? b.forbiddenFacts : [],
      providers: Array.isArray(b.providers) ? b.providers : [],
      newerHints: Array.isArray(b.newerHints) ? b.newerHints : [],
      rubric: b.rubric, notes: b.notes,
    })
    res.status(201).json({ task })
  } catch (err: any) { res.status(500).json({ error: err?.message ?? 'failed' }) }
})

evaluationsRouter.delete('/memory/tasks/:id', (req, res) => {
  const r = deleteMemoryTask(req.params.id)
  if (r.ok) return res.json({ ok: true })
  if (r.reason === 'builtin') {
    return res.status(409).json({ error: 'This is a built-in memory task. Built-ins ship with the dashboard and cannot be deleted — clone it instead.' })
  }
  return res.status(404).json({ error: 'Task not found' })
})

evaluationsRouter.get('/memory/runs', (req, res) => {
  const platform = parsePlatform(req.query.platform) ?? undefined
  const taskId   = req.query.taskId ? String(req.query.taskId) : undefined
  const model    = req.query.model  ? String(req.query.model)  : undefined
  const provider = req.query.provider ? String(req.query.provider) : undefined
  res.json({ runs: listMemoryRuns({ platform, taskId, model, provider }), fetchedAt: new Date().toISOString() })
})

evaluationsRouter.post('/memory/run', async (req, res) => {
  try {
    const b = req.body ?? {}
    const taskId = String(b.taskId ?? '')
    const task = getMemoryTask(taskId)
    if (!task) return res.status(404).json({ error: 'Task not found — create one via POST /memory/tasks first.' })
    // Two-phase: persist the "running" placeholder row SYNCHRONOUSLY so the
    // UI sees it the moment it polls. Only the actual retrieval/dispatch work
    // runs async after the 202 response — no race window.
    const placeholder = prepareMemoryRun(task, { model: b.model, agent: b.agent })
    res.status(202).json({ ok: true, status: 'dispatched', taskId, runId: placeholder.id })
    executeMemoryRun(task, placeholder, { model: b.model, agent: b.agent }).catch(() => {
      /* engine persists its own error path into the placeholder row */
    })
  } catch (err: any) {
    if (!res.headersSent) res.status(500).json({ error: err?.message ?? 'failed' })
  }
})

evaluationsRouter.get('/memory/scoring-methodology', (_req, res) => {
  res.json({ ...memoryMethodology(), fetchedAt: new Date().toISOString() })
})
