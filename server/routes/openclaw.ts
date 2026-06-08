// title: OpenClaw backend route
// path: server/routes/openclaw.ts
// purpose: Ingest pushed OpenClaw events and expose session/agent/cron
//          endpoints. All logic lives in the shared source-aware modules so
//          Hermes (server/routes/hermes.ts) behaves identically.

import { Router } from 'express'
import { ingestEvent, getRawEvents, derivePeople, derivePublications } from '../lib/agentEvents.js'
import { getSessions, getSessionDetail, getAgents, getCron } from '../lib/agentSources.js'
import { isLive, getConnector } from '../lib/connectors.js'
import { cronAction, type CronAction } from '../lib/gateway.js'
import { getPlatformMetrics } from '../lib/metrics.js'
import { addListener as liveAddListener, recent as liveRecent } from '../lib/openclawLive.js'
import { readMemoryFileRpc } from '../lib/openclawWs.js'
import { fetchMemoryFileContent } from '../lib/gateway.js'
import { isSafeMemoryFileName, readMemoryFile, writeMemoryFile } from '../lib/memoryFilesFs.js'

function ocExtraDirs(): string[] | undefined {
  const dir = getConnector('openclaw')?.workspaceDir
  return dir ? [dir] : undefined
}

export const openclawRouter = Router()
const SOURCE = 'openclaw' as const
const CRON_ACTIONS: CronAction[] = ['pause', 'resume', 'trigger']

openclawRouter.post('/events', (req, res) => {
  const auth = req.header('authorization') || ''
  const expected = process.env.OPENCLAW_PUSH_TOKEN || ''
  if (expected && auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const result = ingestEvent(SOURCE, req.body ?? {})
  if (!result.ok) return res.status(400).json({ error: result.error })
  return res.status(201).json({ ok: true })
})

openclawRouter.get('/sessions', async (_req, res) => {
  const sessions = await getSessions(SOURCE)
  res.json({ sessions, fetchedAt: new Date().toISOString() })
})

openclawRouter.get('/sessions/:id', async (req, res) => {
  const session = await getSessionDetail(SOURCE, req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json({ session, fetchedAt: new Date().toISOString() })
})

openclawRouter.get('/agents', async (_req, res) => {
  const agents = await getAgents(SOURCE)
  res.json({ agents, fetchedAt: new Date().toISOString() })
})

openclawRouter.get('/cron', async (_req, res) => {
  const jobs = await getCron(SOURCE)
  res.json({ jobs, fetchedAt: new Date().toISOString() })
})

openclawRouter.post('/cron/:jobId/:action', async (req, res) => {
  const action = req.params.action as CronAction
  if (!CRON_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid action' })
  if (!isLive(SOURCE)) return res.status(409).json({ error: 'connector not enabled — add a token in Settings' })
  const r = await cronAction(SOURCE, req.params.jobId, action)
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error })
  res.json({ ok: true })
})

openclawRouter.get('/metrics', async (req, res) => {
  const metrics = await getPlatformMetrics(SOURCE, req.query.force === '1')
  res.json({ metrics, fetchedAt: new Date().toISOString() })
})

// Server-Sent Events: true live tail of gateway events.
openclawRouter.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders?.()

  const send = (e: unknown) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`) } catch { /* client gone */ } }
  for (const e of liveRecent()) send(e)              // backlog so the tail isn't empty
  const remove = liveAddListener(send)               // live events
  const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 25_000)

  req.on('close', () => { clearInterval(ping); remove(); res.end() })
})

openclawRouter.get('/events', (_req, res) => {
  res.json({ events: getRawEvents(SOURCE), fetchedAt: new Date().toISOString() })
})

// Real people who have interacted with the agents (derived from event senders).
openclawRouter.get('/people', (_req, res) => {
  res.json({ people: derivePeople(SOURCE), fetchedAt: new Date().toISOString() })
})

// Real content the agents have published (briefings, status, digests, replies).
openclawRouter.get('/publications', (_req, res) => {
  res.json({ publications: derivePublications(SOURCE), fetchedAt: new Date().toISOString() })
})

// ─── Memory file read/write ────────────────────────────────────────────────────

openclawRouter.get('/memory-file', async (req, res) => {
  const name = String(req.query.name ?? '')
  if (!isSafeMemoryFileName(name)) return res.status(400).json({ error: 'invalid file name' })
  // Try reading via gateway RPC first (works when OpenClaw is running, even remotely)
  const rpc = await readMemoryFileRpc(name)
  if (rpc) return res.json({ name, content: rpc.content, path: rpc.path })
  // Try HTTP REST on the OpenClaw gateway as second option
  const gw = await fetchMemoryFileContent('openclaw', name)
  if (gw) return res.json({ name, content: gw.content, path: gw.path })
  // Fall back to local FS only if a workspaceDir is configured
  const result = readMemoryFile(name, ocExtraDirs())
  if (!result) return res.status(404).json({ error: 'file not found' })
  return res.json({ name, content: result.content, path: result.path })
})

openclawRouter.put('/memory-file', (req, res) => {
  const name = String(req.query.name ?? '')
  if (!isSafeMemoryFileName(name)) return res.status(400).json({ error: 'invalid file name' })
  const content = req.body?.content
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' })
  const result = writeMemoryFile(name, content, ocExtraDirs())
  if (!result.ok) return res.status(result.error === 'file not found' ? 404 : 500).json({ error: result.error })
  return res.json({ ok: true, path: result.path })
})
