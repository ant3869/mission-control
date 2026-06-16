// title: Memory operations API
// path: server/routes/memoryops.ts
// purpose: End-to-end memory monitoring for OpenClaw (+ Hermes-ready): live
//          event timeline (SSE), doctor/embedding/vector health, the workspace
//          file/daily-dump browser, time-series metrics, consolidation runs, and
//          agent-side push ingest. Mounted alongside the legacy memory viewer at
//          /api/memory. See docs/memory-redesign.md for the full design.

import { Router } from 'express'
import { isLive, getConnector } from '../lib/connectors.js'
import { getPlatformMetrics } from '../lib/metrics.js'
import { getMemoryHealth } from '../lib/memoryDoctor.js'
import { readMemoryFileRpc } from '../lib/openclawWs.js'
import { fetchMemoryFileContent, fetchSessions } from '../lib/gateway.js'
import { getSessionDetail } from '../lib/agentSources.js'
import { isSafeMemoryFileName, readMemoryFile } from '../lib/memoryFilesFs.js'
import {
  remoteStatus, listDailyLogs, readDailyLog, listDreams, readDream,
  readDreamEvents, readRecallSummary, readPhaseSignals, readLongTermMemory,
  readMemorySystemState,
} from '../lib/remoteMemoryFs.js'
import { syncDailyLogs, ensureDailyIndex } from '../lib/memorySync.js'
import { searchDailyLogs, dailyIndexMeta, getIndexedDailyLog } from '../lib/memoryStore.js'
import { addMemoryListener, recentMemoryEvents, ingestPushedEvent } from '../lib/memoryCollector.js'
import {
  listMemoryEvents, recordMemoryEvent, memoryEventCounts, memoryEventMetrics,
  recordVectorStat, listVectorStats, listConsolidationRuns, recordConsolidationRun,
  listMemoryObjects, setMemoryObjectProtected,
  type MemorySource, type MemoryEventType,
} from '../lib/memoryStore.js'

export const memoryOpsRouter = Router()

const SOURCES = new Set<MemorySource>(['openclaw', 'hermes'])
function srcOf(q: any): MemorySource | undefined {
  const s = String(q ?? '')
  return SOURCES.has(s as MemorySource) ? (s as MemorySource) : undefined
}
function extraDirs(source: MemorySource): string[] | undefined {
  const dir = getConnector(source)?.workspaceDir
  return dir ? [dir] : undefined
}

// Snapshot vector stats into the time series whenever we have fresh doctor data,
// so the growth chart builds even without the agent-side push collector.
async function snapshotVector(source: MemorySource, vector: Awaited<ReturnType<typeof getMemoryHealth>>['vector']) {
  if (!vector || vector.recordCount == null) return
  const last = listVectorStats(source, 'default').slice(-1)[0]
  // Only append when the count changed or the last sample is > 5 min old.
  if (last && last.recordCount === vector.recordCount && Date.now() - new Date(last.ts).getTime() < 300_000) return
  recordVectorStat({
    source, collection: 'default', recordCount: vector.recordCount,
    dimensions: vector.dimensions, indexType: vector.indexType, orphanCount: 0, health: vector.status,
  })
}

// ─── Overview (header KPIs + everything the default tab needs) ─────────────────

memoryOpsRouter.get('/overview', async (req, res) => {
  const source = srcOf(req.query.source) ?? 'openclaw'
  const force = req.query.force === '1'
  const counts = memoryEventCounts(source)
  let health = null, files: any[] = []
  try {
    health = await getMemoryHealth(source, force)
    if (health.vector) await snapshotVector(source, health.vector)
  } catch { /* health stays null */ }
  try {
    if (isLive(source)) {
      const m = await getPlatformMetrics(source, force)
      files = (m.memoryFiles ?? []).map(f => ({ name: f.name, size: f.size, updatedAt: f.updatedAt, path: f.path, missing: f.missing }))
    }
  } catch { /* files stay empty */ }

  res.json({
    source,
    counts,
    health,
    files,
    recentEvents: listMemoryEvents({ source, limit: 40 }),
    vectorSeries: listVectorStats(source, 'default'),
    fetchedAt: new Date().toISOString(),
  })
})

// ─── Event timeline ─────────────────────────────────────────────────────────────

memoryOpsRouter.get('/events', (req, res) => {
  const source = srcOf(req.query.source)
  const type = String(req.query.type ?? 'all')
  const limit = Number(req.query.limit ?? 200)
  res.json({ events: listMemoryEvents({ source, type, limit }), fetchedAt: new Date().toISOString() })
})

// Live SSE tail of memory events (backlog + live).
memoryOpsRouter.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders?.()
  const send = (e: unknown) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`) } catch { /* gone */ } }
  for (const e of recentMemoryEvents()) send(e)
  const remove = addMemoryListener(send)
  const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 25_000)
  req.on('close', () => { clearInterval(ping); remove(); res.end() })
})

// ─── Health / vector / metrics ──────────────────────────────────────────────────

memoryOpsRouter.get('/health', async (req, res) => {
  const source = srcOf(req.query.source) ?? 'openclaw'
  res.json(await getMemoryHealth(source, req.query.force === '1'))
})

memoryOpsRouter.get('/vector', async (req, res) => {
  const source = srcOf(req.query.source) ?? 'openclaw'
  let current = null
  try { current = (await getMemoryHealth(source)).vector } catch { /* null */ }
  if (current) await snapshotVector(source, current)
  res.json({ source, current, series: listVectorStats(source, 'default'), fetchedAt: new Date().toISOString() })
})

memoryOpsRouter.get('/metrics', (req, res) => {
  const source = srcOf(req.query.source)
  const hours = Number(req.query.hours ?? 24)
  res.json({ source: source ?? 'all', hours, ...memoryEventMetrics({ source, hours }), fetchedAt: new Date().toISOString() })
})

memoryOpsRouter.get('/consolidation', (req, res) => {
  const source = srcOf(req.query.source)
  res.json({ runs: listConsolidationRuns(source), fetchedAt: new Date().toISOString() })
})

// ─── File / daily-dump browser ──────────────────────────────────────────────────

memoryOpsRouter.get('/files', async (req, res) => {
  const source = srcOf(req.query.source) ?? 'openclaw'
  if (!isLive(source)) return res.json({ files: [], objects: listMemoryObjects(source), error: 'not connected' })
  try {
    const m = await getPlatformMetrics(source, req.query.force === '1')
    const files = (m.memoryFiles ?? []).map(f => ({ name: f.name, size: f.size, updatedAt: f.updatedAt, path: f.path, missing: f.missing }))
    res.json({ files, objects: listMemoryObjects(source), fetchedAt: new Date().toISOString() })
  } catch (e: any) {
    res.json({ files: [], objects: listMemoryObjects(source), error: String(e?.message ?? e) })
  }
})

memoryOpsRouter.get('/file', async (req, res) => {
  const source = srcOf(req.query.source) ?? 'openclaw'
  const name = String(req.query.name ?? '')
  if (!isSafeMemoryFileName(name)) return res.status(400).json({ error: 'invalid file name' })
  if (source === 'openclaw') {
    const rpc = await readMemoryFileRpc(name).catch(() => null)
    if (rpc) return res.json({ name, content: rpc.content, path: rpc.path })
  }
  const gw = await fetchMemoryFileContent(source, name).catch(() => null)
  if (gw) return res.json({ name, content: gw.content, path: gw.path })
  const local = readMemoryFile(name, extraDirs(source))
  if (!local) return res.status(404).json({ error: 'file not found' })
  res.json({ name, content: local.content, path: local.path })
})

// ─── Manual controls ────────────────────────────────────────────────────────────

memoryOpsRouter.post('/object/:id/protect', (req, res) => {
  const ok = setMemoryObjectProtected(req.params.id, req.body?.protected !== false)
  if (!ok) return res.status(404).json({ error: 'object not found' })
  res.json({ ok: true })
})

// ─── Daily conversations (the real history: sessions grouped by day) ────────────
//
// OpenClaw stores no date-named daily files and exposes no memory/journal RPC —
// the durable conversation record IS its session store (sessions.list returns up
// to 1000 in one call; ~442 today, back to late March). We group every session
// by the day it happened so "everything discussed on date X" is browsable, then
// lazy-load each session's cleaned transcript via chat.history on demand.

function channelOf(s: any): string {
  const key = String(s.key ?? '')
  const raw = String(s.origin?.provider ?? s.lastChannel ?? s.channel ?? s.deliveryContext?.channel ?? '').toLowerCase()
  if (/discord/.test(raw)) return 'discord'
  if (/slack/.test(raw)) return 'slack'
  if (/telegram/.test(raw)) return 'telegram'
  if (/webchat/.test(raw)) return 'webchat'
  if (/:heartbeat\b/.test(key) || /heartbeat/.test(raw)) return 'heartbeat'
  if (/:cron\b|:cron:/.test(key)) return 'cron'
  if (/dashboard-research/.test(key)) return 'research'
  if (/dashboard-memory/.test(key)) return 'benchmark'
  if (/:subagent:/.test(key)) return 'sub-agent'
  return raw || 'other'
}
function titleOf(s: any): string {
  const t = String(s.displayName ?? s.origin?.label ?? s.title ?? '').trim()
  if (t) return t
  const key = String(s.key ?? '')
  const tail = key.split(':').slice(2).join(':') || key
  return tail || 'session'
}
function dayKey(ms: number): string { return new Date(ms).toISOString().slice(0, 10) }
function dayLabel(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

memoryOpsRouter.get('/daily', async (req, res) => {
  const source = srcOf(req.query.source) ?? 'openclaw'
  if (!isLive(source)) return res.json({ source, total: 0, days: [], error: 'not connected — add a token in Settings' })
  try {
    let sessions: any[] = []
    if (source === 'openclaw') {
      const { ensureConnected, request } = await import('../lib/openclawLive.js')
      await ensureConnected(12_000)
      const r = await request('sessions.list', { limit: 1000 }, 18_000)
      sessions = r?.sessions ?? []
    } else {
      const live = await fetchSessions('hermes')
      sessions = live.ok && live.data ? live.data : []
    }

    const groups = new Map<string, any>()
    for (const s of sessions) {
      const startMs = Number(s.startedAt ?? s.updatedAt ?? 0)
      if (!startMs) continue
      const date = dayKey(startMs)
      const g = groups.get(date) ?? { date, label: dayLabel(date), sessionCount: 0, channels: new Set<string>(), sessions: [] as any[] }
      const channel = channelOf(s)
      g.channels.add(channel)
      g.sessionCount++
      g.sessions.push({
        key: String(s.key ?? s.sessionId ?? ''),
        title: titleOf(s),
        channel,
        model: String(s.model ?? ''),
        startedAt: new Date(startMs).toISOString(),
        updatedAt: s.updatedAt ? new Date(Number(s.updatedAt)).toISOString() : new Date(startMs).toISOString(),
        status: String(s.status ?? ''),
        runtimeMs: Number(s.runtimeMs ?? 0),
        isHeartbeat: channel === 'heartbeat' || channel === 'cron',
      })
      groups.set(date, g)
    }
    const days = [...groups.values()]
      .map(g => ({ ...g, channels: [...g.channels].sort(), sessions: g.sessions.sort((a: any, b: any) => b.startedAt.localeCompare(a.startedAt)) }))
      .sort((a, b) => b.date.localeCompare(a.date))

    res.json({ source, total: sessions.length, days, fetchedAt: new Date().toISOString() })
  } catch (e: any) {
    res.json({ source, total: 0, days: [], error: String(e?.message ?? e) })
  }
})

// One session's cleaned transcript (chat.history → role/content/timestamp, with
// <think> and tool noise already stripped by agentSources.mapHistoryMessages).
memoryOpsRouter.get('/session', async (req, res) => {
  const source = srcOf(req.query.source) ?? 'openclaw'
  const key = String(req.query.key ?? '')
  if (!key) return res.status(400).json({ error: 'session key required' })
  try {
    const detail = await getSessionDetail(source, key)
    if (!detail) return res.status(404).json({ error: 'session not found' })
    res.json({ session: detail, fetchedAt: new Date().toISOString() })
  } catch (e: any) {
    res.status(502).json({ error: String(e?.message ?? e) })
  }
})

// ─── Disk: the REAL on-machine memory system (read live over SSH) ───────────────
// OpenClaw's daily logs + sleep-cycle dreaming pipeline live on the agent box and
// are not served by the gateway. We read them over SSH (see remoteMemoryFs.ts).

memoryOpsRouter.get('/disk/status', async (req, res) => {
  res.json(await remoteStatus(req.query.force === '1'))
})

// Unified header summary — the single source of truth for the top-bar KPIs, all
// derived from the real on-disk memory system (not the empty live-event store).
memoryOpsRouter.get('/disk/summary', async (req, res) => {
  const force = req.query.force === '1'
  const [status, recall, events, health, sys] = await Promise.all([
    remoteStatus(force),
    readRecallSummary(force).catch(() => ({ total: 0 } as any)),
    readDreamEvents(400, force).catch(() => [] as any[]),
    getMemoryHealth('openclaw', force).catch(() => null),
    readMemorySystemState(force).catch(() => null),
  ])
  const dreams = events.filter((e: any) => e.type === 'memory.dream.completed').length
  const promotions = events.filter((e: any) => e.type === 'memory.promotion.applied').length
  const recallEvents = events.filter((e: any) => e.type === 'memory.recall.recorded').length
  const emb = health?.embedding
  // Live recall plugin (gateway view).
  const plugin = emb?.ok === true ? 'ok' : /unavail|disabl|not enabled|missing/i.test(String(emb?.error ?? '')) ? 'off' : emb?.ok === false ? 'error' : 'unknown'
  // The dreaming pipeline is "stale" if it hasn't produced a dream in 7+ days.
  const lastDream = sys?.lastDream ?? null
  const stale = !lastDream || Date.now() - new Date(lastDream).getTime() > 7 * 86_400_000
  // Embedding/vector status reflects the DISK store, not just the gateway plugin.
  const embedding = sys?.lance?.present
    ? (sys.lance.lastWrite && Date.now() - new Date(sys.lance.lastWrite).getTime() < 3 * 86_400_000 ? 'active' : 'idle')
    : plugin === 'ok' ? 'ok' : 'off'
  res.json({
    reachable: status.reachable,
    dailyLogs: status.dailyCount,
    dreamReports: status.dreamCount,
    bytes: status.bytes,
    recallChunks: recall.total ?? 0,
    recallEvents, dreams, promotions,
    embedding, plugin,
    vectorStore: sys?.lance ?? null,
    freshness: { lastDailyLog: sys?.lastDailyLog ?? null, lastDream, lastRecallUpdate: sys?.lastRecallUpdate ?? null, lastEvent: sys?.lastEvent ?? null },
    stale,
    fetchedAt: new Date().toISOString(),
  })
})

memoryOpsRouter.get('/disk/daily', async (req, res) => {
  res.json({ logs: await listDailyLogs(req.query.force === '1'), fetchedAt: new Date().toISOString() })
})

memoryOpsRouter.get('/disk/daily/:date', async (req, res) => {
  // Serve from the local index when present (instant); else read live over SSH.
  const indexed = getIndexedDailyLog(req.params.date)
  if (indexed) return res.json({ date: req.params.date, content: indexed.content, indexed: true })
  const content = await readDailyLog(req.params.date)
  if (content == null) return res.status(404).json({ error: 'daily log not found' })
  res.json({ date: req.params.date, content })
})

// Full-text index: sync (remote → memory.db), meta, and search across all days.
memoryOpsRouter.post('/disk/sync', async (req, res) => {
  res.json(await syncDailyLogs(req.query.force === '1'))
})

memoryOpsRouter.get('/disk/index', (_req, res) => {
  res.json(dailyIndexMeta())
})

memoryOpsRouter.get('/disk/search', async (req, res) => {
  const q = String(req.query.q ?? '')
  await ensureDailyIndex().catch(() => {})   // warm the index on first use
  res.json({ q, results: searchDailyLogs(q, 60), index: dailyIndexMeta() })
})

memoryOpsRouter.get('/disk/dreams', async (req, res) => {
  res.json({ dreams: await listDreams(req.query.force === '1'), fetchedAt: new Date().toISOString() })
})

memoryOpsRouter.get('/disk/dream', async (req, res) => {
  const content = await readDream(String(req.query.phase ?? ''), String(req.query.date ?? ''))
  if (content == null) return res.status(404).json({ error: 'dream not found' })
  res.json({ phase: req.query.phase, date: req.query.date, content })
})

memoryOpsRouter.get('/disk/events', async (req, res) => {
  res.json({ events: await readDreamEvents(Number(req.query.limit ?? 250), req.query.force === '1'), fetchedAt: new Date().toISOString() })
})

memoryOpsRouter.get('/disk/recall', async (req, res) => {
  res.json(await readRecallSummary(req.query.force === '1'))
})

memoryOpsRouter.get('/disk/phase-signals', async (req, res) => {
  res.json(await readPhaseSignals(req.query.force === '1'))
})

memoryOpsRouter.get('/disk/longterm', async (req, res) => {
  const content = await readLongTermMemory(req.query.force === '1')
  if (content == null) return res.status(404).json({ error: 'MEMORY.md not found' })
  res.json({ content, fetchedAt: new Date().toISOString() })
})

// ─── Agent-side push ingest (Plane 3 / Plane 4) ─────────────────────────────────

const VALID_TYPES = new Set<MemoryEventType>(['created', 'updated', 'retrieved', 'embedded', 'consolidated', 'skipped', 'deleted', 'error'])

function pushAuthOk(req: any): boolean {
  const expected = process.env.OPENCLAW_PUSH_TOKEN || ''
  if (!expected) return true   // no token configured → accept (local-only setups)
  return (req.header('authorization') || '') === `Bearer ${expected}`
}

// POST a memory lifecycle event from the agent machine (truly real-time + the
// only source of decision events like dedup/skip/merge the RPC surface omits).
memoryOpsRouter.post('/events', (req, res) => {
  if (!pushAuthOk(req)) return res.status(401).json({ error: 'unauthorized' })
  const b = req.body ?? {}
  let type = String(b.type ?? '').replace(/^memory:/, '') as MemoryEventType
  if (!VALID_TYPES.has(type)) type = 'created'
  const source = srcOf(b.source) ?? 'openclaw'
  const saved = recordMemoryEvent({
    source, type,
    trigger: ['auto', 'manual', 'cron'].includes(b.trigger) ? b.trigger : 'auto',
    status: b.status === 'fail' ? 'fail' : 'ok',
    objectId: b.objectId ?? null, sessionKey: b.sessionKey ?? null, tool: b.tool ?? null,
    title: String(b.title ?? type), summary: String(b.summary ?? '').slice(0, 200),
    latencyMs: typeof b.latencyMs === 'number' ? b.latencyMs : null,
    origin: 'push', payload: b.payload ?? {},
  })
  ingestPushedEvent(saved)
  res.status(201).json({ ok: true, id: saved.id })
})

// POST a vector-store stats snapshot from an agent-side collector (Plane 4).
memoryOpsRouter.post('/vector-stats', (req, res) => {
  if (!pushAuthOk(req)) return res.status(401).json({ error: 'unauthorized' })
  const b = req.body ?? {}
  const source = srcOf(b.source) ?? 'openclaw'
  const stat = recordVectorStat({
    source, collection: String(b.collection ?? 'default'),
    recordCount: Number(b.recordCount ?? 0), dimensions: b.dimensions == null ? null : Number(b.dimensions),
    indexType: b.indexType ?? null, orphanCount: Number(b.orphanCount ?? 0), health: String(b.health ?? 'ok'),
  })
  res.status(201).json({ ok: true, id: stat.id })
})

// POST a consolidation/dreaming run summary from the agent machine (Plane 3).
memoryOpsRouter.post('/consolidation', (req, res) => {
  if (!pushAuthOk(req)) return res.status(401).json({ error: 'unauthorized' })
  const b = req.body ?? {}
  const source = srcOf(b.source) ?? 'openclaw'
  const run = recordConsolidationRun({
    source, trigger: String(b.trigger ?? 'cron'), status: String(b.status ?? 'done'),
    inputs: Number(b.inputs ?? 0), merged: Number(b.merged ?? 0), pruned: Number(b.pruned ?? 0),
    summarized: Number(b.summarized ?? 0), notes: String(b.notes ?? '').slice(0, 1000),
    durationMs: Number(b.durationMs ?? 0), startedAt: String(b.startedAt ?? new Date().toISOString()),
  })
  res.status(201).json({ ok: true, id: run.id })
})
