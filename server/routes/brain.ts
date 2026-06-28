// title: Brain backend route
// path: server/routes/brain.ts
// purpose: Expose the raw agent event log (SQLite) as a queryable API so the
//          Brain view can show LLM call history, tool activity, loop detection
//          signals, and session timelines across both OpenClaw and Hermes.

import { Router } from 'express'
import { getRawEvents, ingestEvent, type AgentSource } from '../lib/agentEvents.js'

export const brainRouter = Router()

const VALID_SOURCES = new Set<AgentSource>(['openclaw', 'hermes'])

// GET /api/brain/events?source=openclaw|hermes|all&limit=200&type=tool|message|session|cron|error
brainRouter.get('/events', (req, res) => {
  try {
    const sourceParam = String(req.query.source ?? 'all')
    const limit       = Math.min(Number(req.query.limit ?? 200), 1000)
    const typeFilter  = String(req.query.type ?? '').toLowerCase()

    const sources: AgentSource[] = sourceParam === 'all'
      ? ['openclaw', 'hermes']
      : VALID_SOURCES.has(sourceParam as AgentSource) ? [sourceParam as AgentSource] : ['openclaw', 'hermes']

    let events = sources.flatMap(s => getRawEvents(s, limit))

    if (typeFilter && typeFilter !== 'all') {
      events = events.filter(e => e.eventType.toLowerCase().includes(typeFilter))
    }

    // Re-sort merged results newest-first and honour the limit
    events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    events = events.slice(0, limit)

    // Aggregate tool usage counts from the event window
    const toolCounts = new Map<string, number>()
    const typeCounts = new Map<string, number>()
    for (const e of events) {
      const top = e.eventType.split(':')[0]
      typeCounts.set(top, (typeCounts.get(top) ?? 0) + 1)
      const tool = (e.payload as any)?.tool ?? (e.payload as any)?.toolName ?? (e.payload as any)?.name ?? ''
      if (tool && (e.eventType.includes('tool') || top === 'tool')) {
        toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1)
      }
    }

    // Detect potential loops: same tool called 5+ times in a sliding window
    const loops: Array<{ tool: string; count: number; sessionKey: string | null }> = []
    const sessionToolWindow = new Map<string, Map<string, number>>()
    for (const e of [...events].reverse()) {
      if (!e.eventType.includes('tool')) continue
      const tool = (e.payload as any)?.tool ?? (e.payload as any)?.toolName ?? ''
      if (!tool) continue
      const key = e.sessionKey ?? '_global'
      const map = sessionToolWindow.get(key) ?? new Map<string, number>()
      map.set(tool, (map.get(tool) ?? 0) + 1)
      sessionToolWindow.set(key, map)
    }
    for (const [sessionKey, map] of sessionToolWindow) {
      for (const [tool, count] of map) {
        if (count >= 5) loops.push({ tool, count, sessionKey: sessionKey === '_global' ? null : sessionKey })
      }
    }

    res.json({
      events,
      total: events.length,
      typeCounts: Object.fromEntries(typeCounts),
      topTools: [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tool, count]) => ({ tool, count })),
      loopSignals: loops.sort((a, b) => b.count - a.count).slice(0, 20),
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load brain events', detail: (err as Error).message })
  }
})

// GET /api/brain/stats — aggregate event statistics per source
brainRouter.get('/stats', (_req, res) => {
  try {
    const result: Record<string, any> = {}
    for (const source of ['openclaw', 'hermes'] as AgentSource[]) {
      const events = getRawEvents(source, 500)
      const typeCounts: Record<string, number> = {}
      const dailyCounts: Record<string, number> = {}
      for (const e of events) {
        const top = e.eventType.split(':')[0]
        typeCounts[top] = (typeCounts[top] ?? 0) + 1
        const day = e.ts.slice(0, 10)
        dailyCounts[day] = (dailyCounts[day] ?? 0) + 1
      }
      result[source] = {
        total: events.length,
        typeCounts,
        daily: Object.entries(dailyCounts).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14).map(([date, count]) => ({ date, count })),
        oldest: events[events.length - 1]?.ts ?? null,
        newest: events[0]?.ts ?? null,
      }
    }
    res.json({ stats: result, fetchedAt: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load brain stats', detail: (err as Error).message })
  }
})
