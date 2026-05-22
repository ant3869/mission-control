// title: Hermes backend route
// path: server/routes/hermes.ts
// purpose: Track the Hermes agent platform identically to OpenClaw — ingest
//          pushed events and expose session/agent/cron endpoints. Live data is
//          pulled from the Hermes gateway when a token is configured in
//          Settings; pushed events are also accepted for parity with OpenClaw.

import { Router } from 'express'
import { ingestEvent, getRawEvents } from '../lib/agentEvents.js'
import { getSessions, getSessionDetail, getAgents, getCron } from '../lib/agentSources.js'
import { isLive } from '../lib/connectors.js'
import { cronAction, type CronAction } from '../lib/gateway.js'
import { getPlatformMetrics } from '../lib/metrics.js'
import { addListener as liveAddListener, recent as liveRecent } from '../lib/hermesLive.js'

export const hermesRouter = Router()
const SOURCE = 'hermes' as const
const CRON_ACTIONS: CronAction[] = ['pause', 'resume', 'trigger']

hermesRouter.post('/events', (req, res) => {
  const auth = req.header('authorization') || ''
  const expected = process.env.HERMES_PUSH_TOKEN || ''
  if (expected && auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const result = ingestEvent(SOURCE, req.body ?? {})
  if (!result.ok) return res.status(400).json({ error: result.error })
  return res.status(201).json({ ok: true })
})

hermesRouter.get('/sessions', async (_req, res) => {
  const sessions = await getSessions(SOURCE)
  res.json({ sessions, fetchedAt: new Date().toISOString() })
})

hermesRouter.get('/sessions/:id', async (req, res) => {
  const session = await getSessionDetail(SOURCE, req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json({ session, fetchedAt: new Date().toISOString() })
})

hermesRouter.get('/agents', async (_req, res) => {
  const agents = await getAgents(SOURCE)
  res.json({ agents, fetchedAt: new Date().toISOString() })
})

hermesRouter.get('/cron', async (_req, res) => {
  const jobs = await getCron(SOURCE)
  res.json({ jobs, fetchedAt: new Date().toISOString() })
})

hermesRouter.post('/cron/:jobId/:action', async (req, res) => {
  const action = req.params.action as CronAction
  if (!CRON_ACTIONS.includes(action)) return res.status(400).json({ error: 'invalid action' })
  if (!isLive(SOURCE)) return res.status(409).json({ error: 'connector not enabled — add a token in Settings' })
  const r = await cronAction(SOURCE, req.params.jobId, action)
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error })
  res.json({ ok: true })
})

hermesRouter.get('/metrics', async (req, res) => {
  const metrics = await getPlatformMetrics(SOURCE, req.query.force === '1')
  res.json({ metrics, fetchedAt: new Date().toISOString() })
})

// Server-Sent Events: Hermes live tail (polled from /api/logs).
hermesRouter.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders?.()
  const send = (e: unknown) => { try { res.write(`data: ${JSON.stringify(e)}\n\n`) } catch { /* gone */ } }
  for (const e of liveRecent()) send(e)
  const remove = liveAddListener(send)
  const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 25_000)
  req.on('close', () => { clearInterval(ping); remove(); res.end() })
})

hermesRouter.get('/events', (_req, res) => {
  res.json({ events: getRawEvents(SOURCE), fetchedAt: new Date().toISOString() })
})
