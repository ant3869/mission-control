// title: Harness Benchmarks backend route
// path: server/routes/harnessBench.ts
// purpose: REST surface for the Harness Benchmarks page. Lists code-seeded task
//          packs, real harness/model availability, and persisted runs/results;
//          starts/cancels/reruns real benchmark runs (App → OpenClaw/Hermes →
//          model → result). No mock data — model lists and runs come from live
//          harness calls.

import { Router } from 'express'
import { isLive, getConnector } from '../lib/connectors.js'
import { hermesApiHealth } from '../lib/hermesApiServer.js'
import { ensureConnected, request as ocRequest } from '../lib/openclawLive.js'
import { packSummaries, getPack } from '../lib/harnessBenchPacks.js'
import { LANES, FAILURE_TYPES, type BenchmarkHarness } from '../lib/harnessBenchTypes.js'
import { startRun, rerunFailed, requestCancel } from '../lib/harnessBenchRunner.js'
import {
  listRuns, getRunWithResults, deleteRun, modelComparison,
} from '../lib/harnessBenchStore.js'

export const harnessBenchRouter = Router()

function parseHarness(v: any): BenchmarkHarness | null {
  return v === 'openclaw' || v === 'hermes' ? v : null
}

// ─── meta: packs, lanes, failure types ──────────────────────────────────────────

harnessBenchRouter.get('/packs', (_req, res) => {
  res.json({ packs: packSummaries(), lanes: LANES, failureTypes: FAILURE_TYPES, fetchedAt: new Date().toISOString() })
})

harnessBenchRouter.get('/packs/:id', (req, res) => {
  const pack = getPack(req.params.id)
  if (!pack) return res.status(404).json({ error: 'pack not found' })
  res.json({ pack })
})

// ─── harness + model availability (real) ────────────────────────────────────────

harnessBenchRouter.get('/connectors', (_req, res) => {
  const oc = getConnector('openclaw'); const hm = getConnector('hermes')
  res.json({
    harnesses: [
      { id: 'openclaw', label: 'OpenClaw', live: isLive('openclaw'), baseUrl: oc?.baseUrl ?? '', enabled: !!oc?.enabled },
      { id: 'hermes',   label: 'Hermes',   live: isLive('hermes'),   baseUrl: hm?.baseUrl ?? '', apiBaseUrl: hm?.apiBaseUrl ?? '', enabled: !!hm?.enabled },
    ],
    fetchedAt: new Date().toISOString(),
  })
})

harnessBenchRouter.get('/models', async (req, res) => {
  const harness = parseHarness(req.query.harness)
  if (!harness) return res.status(400).json({ error: 'harness query param must be openclaw|hermes' })
  try {
    if (harness === 'hermes') {
      const h = await hermesApiHealth()
      return res.json({ harness, reachable: h.reachable, models: h.models, error: h.error, source: 'hermes-api-server', fetchedAt: new Date().toISOString() })
    }
    // OpenClaw — best-effort models.list over the live WS (read-only RPC).
    try {
      await ensureConnected(8000)
      const r: any = await ocRequest('models.list', {}, 8000)
      const list: any[] = Array.isArray(r?.models) ? r.models : Array.isArray(r) ? r : []
      const models = list.map(m => String(m?.id ?? m?.name ?? m)).filter(Boolean)
      return res.json({ harness, reachable: true, models, error: null, source: 'openclaw-ws', fetchedAt: new Date().toISOString() })
    } catch (e: any) {
      return res.json({ harness, reachable: isLive('openclaw'), models: [], error: e?.message ?? 'models.list unavailable', source: 'openclaw-ws', fetchedAt: new Date().toISOString() })
    }
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'failed' })
  }
})

// ─── runs ────────────────────────────────────────────────────────────────────────

harnessBenchRouter.get('/runs', (_req, res) => {
  res.json({ runs: listRuns(120), fetchedAt: new Date().toISOString() })
})

harnessBenchRouter.get('/runs/:id', (req, res) => {
  const run = getRunWithResults(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  res.json({ run })
})

harnessBenchRouter.get('/runs/:id/export', (req, res) => {
  const run = getRunWithResults(req.params.id)
  if (!run) return res.status(404).json({ error: 'run not found' })
  res.setHeader('Content-Disposition', `attachment; filename="benchmark-${run.id}.json"`)
  res.setHeader('Content-Type', 'application/json')
  res.send(JSON.stringify({ run, exportedAt: new Date().toISOString() }, null, 2))
})

harnessBenchRouter.post('/runs', (req, res) => {
  const b = req.body ?? {}
  const harness = parseHarness(b.harness)
  if (!harness) return res.status(400).json({ error: 'harness must be openclaw|hermes' })
  if (!String(b.taskPackId ?? '').trim()) return res.status(400).json({ error: 'taskPackId is required' })
  const result = startRun({
    harness, taskPackId: String(b.taskPackId),
    model: b.model ? String(b.model) : undefined,
    provider: b.provider ? String(b.provider) : undefined,
    endpoint: b.endpoint ? String(b.endpoint) : undefined,
    token: b.token ? String(b.token) : undefined,
    mode: b.mode,
  })
  if (!result.ok) return res.status(409).json({ error: result.error })
  res.status(202).json({ ok: true, run: result.run })
})

harnessBenchRouter.post('/runs/:id/cancel', (req, res) => {
  requestCancel(req.params.id)
  res.json({ ok: true })
})

harnessBenchRouter.post('/runs/:id/rerun-failed', (req, res) => {
  const result = rerunFailed(req.params.id)
  if (!result.ok) return res.status(409).json({ error: result.error })
  res.status(202).json({ ok: true, run: result.run })
})

harnessBenchRouter.delete('/runs/:id', (req, res) => {
  const ok = deleteRun(req.params.id)
  if (!ok) return res.status(404).json({ error: 'run not found' })
  res.json({ ok: true })
})

// ─── cross-run model comparison ───────────────────────────────────────────────────

harnessBenchRouter.get('/comparison', (_req, res) => {
  res.json({ rows: modelComparison(), lanes: LANES, fetchedAt: new Date().toISOString() })
})
