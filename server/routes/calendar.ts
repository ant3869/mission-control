/**
 * Google Calendar → /api/calendar
 *
 * All Google access is delegated to server/lib/googleCalendar.ts (which gets its
 * auth from server/lib/googleAuth.ts). This router is a thin HTTP surface.
 *
 *   GET    /api/calendar/events?days=7        → upcoming events (all calendars)
 *   GET    /api/calendar/range?start=&end=    → events on primary in a range
 *   GET    /api/calendar/calendars            → list calendars
 *   POST   /api/calendar/events               → create an event
 *   PATCH  /api/calendar/events/:id           → update an event
 *   DELETE /api/calendar/events/:id           → delete an event
 */
import { Router } from 'express'
import { GoogleAuthError, isConfigured, hasToken } from '../lib/googleAuth.js'
import {
  listCalendars, listEventsAcrossCalendars, listEventsRange,
  createEvent, updateEvent, deleteEvent,
} from '../lib/googleCalendar.js'

export const calendarRouter = Router()

// Turn any thrown error into a consistent status + state the frontend can act on.
function fail(res: any, err: any) {
  if (err instanceof GoogleAuthError) {
    const httpStatus =
      err.state === 'not_configured' || err.state === 'disconnected' ? 503 :
      err.state === 'reconnect_required' || err.state === 'missing_scopes' ? 401 : 502
    return res.status(httpStatus).json({ error: err.message, state: err.state })
  }
  return res.status(500).json({ error: err?.message ?? 'Calendar error' })
}

function guard(res: any): boolean {
  if (!isConfigured()) {
    res.status(503).json({ error: 'Google Calendar not configured', state: 'not_configured',
      hint: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.' })
    return false
  }
  if (!hasToken()) {
    res.status(503).json({ error: 'Google Calendar not connected', state: 'disconnected',
      hint: 'Visit /api/auth/google to connect.' })
    return false
  }
  return true
}

// GET /api/calendar/events  — aggregated across all readable calendars.
//   ?days=N                  → now … now+N days   (legacy)
//   ?start=ISO&end=ISO       → explicit window     (used by Day/Week/Month/Agenda)
calendarRouter.get('/events', async (req, res) => {
  if (!guard(res)) return
  try {
    const { start, end } = req.query as { start?: string; end?: string }
    let timeMin: string, timeMax: string, days: number

    if (start && end) {
      const s = new Date(start), e = new Date(end)
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) {
        return res.status(400).json({ error: 'invalid start/end (need ISO with end > start)' })
      }
      // Clamp the span so a bad request can't fan out across months × calendars.
      const maxEnd = new Date(s.getTime() + 62 * 864e5)
      timeMin = s.toISOString()
      timeMax = (e > maxEnd ? maxEnd : e).toISOString()
      days    = Math.round((new Date(timeMax).getTime() - s.getTime()) / 864e5)
    } else {
      days    = Math.min(Math.max(Number(req.query.days ?? 7), 1), 62)
      const now = new Date()
      timeMin = now.toISOString()
      timeMax = new Date(now.getTime() + days * 864e5).toISOString()
    }

    const events = await listEventsAcrossCalendars(timeMin, timeMax)
    res.json({ events, fetchedAt: new Date().toISOString(), days, start: timeMin, end: timeMax })
  } catch (err) { fail(res, err) }
})

// GET /api/calendar/range?start=ISO&end=ISO  — primary calendar, explicit window
calendarRouter.get('/range', async (req, res) => {
  if (!guard(res)) return
  const start = String(req.query.start ?? '')
  const end   = String(req.query.end ?? '')
  if (!start || !end) return res.status(400).json({ error: 'start and end (ISO) are required' })
  try {
    const events = await listEventsRange(start, end)
    res.json({ events, fetchedAt: new Date().toISOString() })
  } catch (err) { fail(res, err) }
})

// GET /api/calendar/calendars
calendarRouter.get('/calendars', async (_req, res) => {
  if (!guard(res)) return
  try {
    res.json({ calendars: await listCalendars() })
  } catch (err) { fail(res, err) }
})

// POST /api/calendar/events  { title, description?, location?, start, end?, allDay?, calendarId? }
calendarRouter.post('/events', async (req, res) => {
  if (!guard(res)) return
  if (!String(req.body?.title ?? req.body?.summary ?? '').trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  try {
    const event = await createEvent(buildResource(req.body), req.body?.calendarId || 'primary')
    res.status(201).json({ event })
  } catch (err) { fail(res, err) }
})

// PATCH /api/calendar/events/:id  (?calendarId= or body.calendarId)
calendarRouter.patch('/events/:id', async (req, res) => {
  if (!guard(res)) return
  const calendarId = String(req.body?.calendarId || req.query.calendarId || 'primary')
  try {
    const event = await updateEvent(req.params.id, buildResource(req.body), calendarId)
    res.json({ event })
  } catch (err) { fail(res, err) }
})

// DELETE /api/calendar/events/:id  (?calendarId=)
calendarRouter.delete('/events/:id', async (req, res) => {
  if (!guard(res)) return
  const calendarId = String(req.query.calendarId || 'primary')
  try {
    await deleteEvent(req.params.id, calendarId)
    res.json({ ok: true })
  } catch (err) { fail(res, err) }
})

// Map a loose JSON body into a Calendar event resource.
function buildResource(body: any) {
  const b = body ?? {}
  const resource: any = {
    summary:     b.summary ?? b.title ?? '(No title)',
    description: b.description ?? '',
    location:    b.location || undefined,
  }
  if (b.allDay && b.start) {
    resource.start = { date: String(b.start).slice(0, 10) }
    resource.end   = { date: String(b.end ?? b.start).slice(0, 10) }
  } else if (b.start) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    resource.start = { dateTime: new Date(b.start).toISOString(), timeZone: tz }
    resource.end   = { dateTime: new Date(b.end ?? b.start).toISOString(), timeZone: tz }
  }
  return resource
}
