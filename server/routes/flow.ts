// title: Flow backend route
// path: server/routes/flow.ts
// purpose: Session run history and message flow across both agent platforms.
//          Combines live gateway sessions with locally-captured events so the
//          Flow view always has data even without an active connector.

import { Router } from 'express'
import { getSessions, getSessionDetail } from '../lib/agentSources.js'
import type { AgentSource } from '../lib/agentEvents.js'

export const flowRouter = Router()

const VALID_SOURCES = new Set<AgentSource>(['openclaw', 'hermes'])

// GET /api/flow/runs?source=all|openclaw|hermes&limit=50
flowRouter.get('/runs', async (req, res) => {
  try {
    const sourceParam = String(req.query.source ?? 'all')
    const limit       = Math.min(Number(req.query.limit ?? 50), 200)

    const sources: AgentSource[] = sourceParam === 'all'
      ? ['openclaw', 'hermes']
      : VALID_SOURCES.has(sourceParam as AgentSource) ? [sourceParam as AgentSource] : ['openclaw', 'hermes']

    const all = (await Promise.all(sources.map(s => getSessions(s)))).flat()

    all.sort((a, b) => new Date(b.lastActiveAt ?? 0).getTime() - new Date(a.lastActiveAt ?? 0).getTime())

    const runs = all.slice(0, limit).map(s => ({
      id:           s.id,
      source:       s.source ?? (s.projectSlug as AgentSource),
      title:        s.title,
      firstMessage: s.firstMessage,
      messageCount: s.messageCount,
      startedAt:    s.startedAt,
      lastActiveAt: s.lastActiveAt,
      inputTokens:  s.inputTokens,
      outputTokens: s.outputTokens,
      isHeartbeat:  s.isHeartbeat,
      cwd:          s.cwd,
    }))

    res.json({ runs, total: all.length, fetchedAt: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load flow runs', detail: (err as Error).message })
  }
})

// GET /api/flow/runs/:source/:id — detail with messages
flowRouter.get('/runs/:source/:id', async (req, res) => {
  try {
    const source = req.params.source as AgentSource
    if (!VALID_SOURCES.has(source)) return res.status(400).json({ error: 'invalid source' })

    const session = await getSessionDetail(source, req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })

    res.json({ run: session, fetchedAt: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load session detail', detail: (err as Error).message })
  }
})

// GET /api/flow/summary — high-level counts per source
flowRouter.get('/summary', async (_req, res) => {
  try {
    const [oc, hr] = await Promise.all([getSessions('openclaw'), getSessions('hermes')])
    const summarise = (sessions: typeof oc) => ({
      total:      sessions.length,
      heartbeats: sessions.filter(s => s.isHeartbeat).length,
      messages:   sessions.reduce((n, s) => n + (s.messageCount ?? 0), 0),
      newest:     sessions[0]?.lastActiveAt ?? null,
    })
    res.json({
      openclaw: summarise(oc),
      hermes:   summarise(hr),
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load flow summary', detail: (err as Error).message })
  }
})
