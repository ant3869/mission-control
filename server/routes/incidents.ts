import { Router } from 'express'
import { getRawEvents } from '../lib/agentEvents.js'
import { getIncidentStore } from '../lib/incidentStore.js'
import { getJournalStore } from '../lib/journal.js'
import { redact } from '../lib/redact.js'

export const incidentsRouter = Router()

incidentsRouter.get('/', (_req, res) => {
  const incidents = getIncidentStore().list()
  res.json({ incidents, open: incidents.filter((item) => item.status === 'open').length, resolved: incidents.filter((item) => item.status === 'resolved').length })
})

incidentsRouter.post('/:id/resolve', (req, res) => {
  if (!getIncidentStore().resolve(String(req.params.id))) return res.status(404).json({ error: 'Incident not found' })
  res.json({ ok: true })
})

incidentsRouter.get('/:id/replay', (req, res) => {
  const incident = getIncidentStore().get(String(req.params.id))
  if (!incident) return res.status(404).json({ error: 'Incident not found' })
  const from = new Date(incident.firstSeenAt).getTime() - 15 * 60_000
  const to = new Date(incident.lastSeenAt).getTime() + 15 * 60_000
  const events = (['openclaw', 'hermes'] as const).flatMap((source) => getRawEvents(source, 500).map((event) => ({ ...event, source })))
    .filter((event) => { const ts = new Date(event.ts).getTime(); return ts >= from && ts <= to })
    .map((event) => ({ kind: 'event', ts: event.ts, data: redact(event) }))
  const operations = getJournalStore().list(500).filter((entry) => { const ts = new Date(entry.createdAt).getTime(); return ts >= from && ts <= to })
    .map((entry) => ({ kind: 'operation', ts: entry.createdAt, data: entry }))
  res.json({ incident, timeline: [...events, ...operations].sort((a, b) => a.ts.localeCompare(b.ts)) })
})
