/**
 * Google Calendar → /api/calendar
 *
 * Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN in .env
 *
 * GET /api/calendar/events?days=7        → upcoming events for N days
 * GET /api/calendar/calendars            → list all calendars
 */
import { Router } from 'express'
import { google } from 'googleapis'

export const calendarRouter = Router()

function getCalendarClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN })
  return google.calendar({ version: 'v3', auth })
}

calendarRouter.get('/events', async (req, res) => {
  const cal = getCalendarClient()
  if (!cal) {
    return res.status(503).json({
      error: 'Google Calendar not configured',
      hint:  'Visit /api/auth/google to authenticate, then set GOOGLE_REFRESH_TOKEN in .env',
    })
  }

  const days = Math.min(Number(req.query.days ?? 7), 30)
  const now  = new Date()
  const end  = new Date(now)
  end.setDate(end.getDate() + days)

  try {
    // Get all calendars the user has
    const calList = await cal.calendarList.list({ minAccessRole: 'reader' })
    const calIds  = (calList.data.items ?? []).map(c => c.id!).filter(Boolean)

    // Fetch events from all calendars in parallel
    const results = await Promise.allSettled(
      calIds.map(id =>
        cal.events.list({
          calendarId:   id,
          timeMin:      now.toISOString(),
          timeMax:      end.toISOString(),
          singleEvents: true,
          orderBy:      'startTime',
          maxResults:   50,
        })
      )
    )

    const events = results
      .filter((r): r is PromiseFulfilledResult<typeof r extends PromiseFulfilledResult<infer T> ? T : never> => r.status === 'fulfilled')
      .flatMap(r => (r.value as any).data.items ?? [])
      .sort((a: any, b: any) => {
        const aTime = a.start?.dateTime ?? a.start?.date ?? ''
        const bTime = b.start?.dateTime ?? b.start?.date ?? ''
        return aTime.localeCompare(bTime)
      })

    const mapped = events.map((ev: any) => {
      const startRaw = ev.start?.dateTime ?? ev.start?.date
      const endRaw   = ev.end?.dateTime   ?? ev.end?.date
      const start    = startRaw ? new Date(startRaw) : null
      const end      = endRaw   ? new Date(endRaw)   : null

      // Compute timeMinutes for the calendar grid (hours * 60 + minutes)
      const timeMinutes = start
        ? start.getHours() * 60 + start.getMinutes()
        : 0

      // Which days of the week this falls on (0=Sun, 6=Sat)
      const dayOfWeek = start ? start.getDay() : null

      return {
        id:           ev.id,
        name:         ev.summary ?? '(No title)',
        description:  ev.description ?? '',
        location:     ev.location ?? '',
        htmlLink:     ev.htmlLink ?? '',
        status:       ev.status,
        allDay:       !ev.start?.dateTime,
        startIso:     startRaw ?? null,
        endIso:       endRaw   ?? null,
        timeDisplay:  start ? start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All day',
        timeMinutes,
        dayOfWeek,
        organizer:    ev.organizer?.email ?? '',
        attendees:    (ev.attendees ?? []).map((a: any) => ({
          email:            a.email,
          displayName:      a.displayName,
          responseStatus:   a.responseStatus,
          self:             a.self ?? false,
        })),
        calendarColor: ev.colorId ?? null,
        recurrence:   ev.recurrence ? true : false,
        meetLink:     ev.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri ?? null,
      }
    })

    res.json({ events: mapped, fetchedAt: new Date().toISOString(), days })
  } catch (err: any) {
    console.error('[calendar/events]', err.message)
    res.status(500).json({ error: err.message })
  }
})

calendarRouter.get('/calendars', async (_req, res) => {
  const cal = getCalendarClient()
  if (!cal) return res.status(503).json({ error: 'Google Calendar not configured' })

  try {
    const list = await cal.calendarList.list({ minAccessRole: 'reader' })
    const items = (list.data.items ?? []).map(c => ({
      id:          c.id,
      summary:     c.summary,
      description: c.description,
      primary:     c.primary ?? false,
      color:       c.backgroundColor,
      accessRole:  c.accessRole,
    }))
    res.json({ calendars: items })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
