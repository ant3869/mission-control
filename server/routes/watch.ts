// title: Unified real-time watch stream
// path: server/routes/watch.ts
// purpose: Single SSE endpoint that fans out live events from OpenClaw,
//          Hermes, and local Claude Code JSONL tailing — each event tagged
//          with its source so the frontend can split/filter as needed.

import { Router } from 'express'
import { addListener as ocAddListener, recent as ocRecent, rawEvents as ocRawEvents } from '../lib/openclawLive.js'
import { addListener as hAddListener,  recent as hRecent  } from '../lib/hermesLive.js'
import { addListener as cAddListener,  recent as cRecent  } from '../lib/claudeLive.js'
import type { LiveEvent } from '../lib/openclawLive.js'

export type WatchSource = 'openclaw' | 'hermes' | 'claude'
export type WatchEvent  = LiveEvent & { source: WatchSource }

export const watchRouter = Router()

watchRouter.get('/stream', (req, res) => {
  res.set({
    'Content-Type':    'text/event-stream',
    'Cache-Control':   'no-cache',
    Connection:        'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  const send = (e: WatchEvent) => {
    try { res.write(`data: ${JSON.stringify(e)}\n\n`) } catch { /* client gone */ }
  }

  // Send buffered history from all three sources, merged and time-sorted.
  const PER_SOURCE = 30
  const history: WatchEvent[] = [
    ...ocRecent().slice(-PER_SOURCE).map(e => ({ ...e, source: 'openclaw' as const })),
    ...hRecent().slice(-PER_SOURCE).map(e  => ({ ...e, source: 'hermes'   as const })),
    ...cRecent().slice(-PER_SOURCE).map(e  => ({ ...e, source: 'claude'   as const })),
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

  for (const e of history) send(e)

  // Subscribe to live events from all three sources.
  const removeOC = ocAddListener(e => send({ ...e, source: 'openclaw' }))
  const removeH  = hAddListener(e  => send({ ...e, source: 'hermes'   }))
  const removeC  = cAddListener(e  => send({ ...e, source: 'claude'   }))
  const ping     = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 25_000)

  req.on('close', () => { clearInterval(ping); removeOC(); removeH(); removeC(); res.end() })
})

watchRouter.get('/debug', (_req, res) => {
  res.json({ rawEvents: ocRawEvents() })
})

watchRouter.get('/debug-poll', async (req, res) => {
  const { request: ocRequest, isConnected } = await import('../lib/openclawLive.js')
  if (!isConnected()) return res.json({ error: 'not connected' })
  try {
    const sessionsList = await ocRequest('sessions.list', {}, 6000)
    const sessArr: any[] = Array.isArray(sessionsList) ? sessionsList
      : (sessionsList?.sessions ?? sessionsList?.data ?? sessionsList?.items ?? [])
    const wantKey = typeof req.query.key === 'string' ? req.query.key : null
    const firstKey = wantKey ?? sessArr[0]?.key ?? sessArr[0]?.id ?? null
    let history: any = null
    if (firstKey) {
      history = await ocRequest('chat.history', { sessionKey: firstKey, limit: 5, maxChars: 10000 }, 8000)
    }
    res.json({ sessionsList: sessArr.slice(0, 5), firstKey, historySnippet: history })
  } catch (e: any) {
    res.json({ error: e?.message ?? 'rpc failed' })
  }
})
