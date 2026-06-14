// title: Google Calendar service (dedicated)
// path: server/lib/googleCalendar.ts
// purpose: All Calendar API access lives here — read events, list calendars, and
//   create/update/delete events — plus the pure mapping from a Mission Control
//   To-Do into a Google Calendar event. Auth is delegated entirely to
//   googleAuth.ts; this module never builds an OAuth client itself. Every call
//   classifies failures into a GoogleAuthError so callers (routes, sync helper)
//   get a stable connection state instead of a raw stack trace.

import type { calendar_v3 } from 'googleapis'
import {
  getCalendarClient, ensureAccessToken, classifyGoogleError,
  GoogleAuthError, invalidateStatus,
} from './googleAuth.js'

const PRIMARY = 'primary'
// Stamped onto every event we create so a To-Do's event can be recovered even if
// the locally stored id is lost — this is the anti-duplicate safety net.
const TODO_PROP = 'mcTodoId'

// ─── Shared error wrapper ────────────────────────────────────────────────────

async function call<T>(fn: (cal: calendar_v3.Calendar) => Promise<T>): Promise<T> {
  const cal = getCalendarClient()
  if (!cal) throw new GoogleAuthError('disconnected', 'Google Calendar is not connected.')
  await ensureAccessToken()
  try {
    return await fn(cal)
  } catch (err) {
    const { state, message } = classifyGoogleError(err)
    if (state !== 'auth_error') invalidateStatus()
    throw new GoogleAuthError(state, message)
  }
}

// ─── To-Do → event mapping (pure, unit-tested) ───────────────────────────────

export interface TodoDetailsLike {
  date?:         string
  time?:         string
  location?:     string
  phone?:        string
  cost?:         string
  url?:          string
  contact?:      string
  category?:     string
  customFields?: Record<string, string>
}

export interface TodoLike {
  id:        string
  title:     string
  notes?:    string
  severity?: string
  dueDate?:  string   // ISO or empty
  details?:  TodoDetailsLike
}

export interface ResolvedDateTime {
  start:    Date
  end:      Date
  allDay:   boolean
  timeZone: string
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/** Parse a loose date string into {y,m,d} (m is 0-based) or null. */
export function parseLooseDate(raw?: string): { y: number; m: number; d: number } | null {
  const s = (raw ?? '').trim()
  if (!s) return null

  // ISO: 2026-06-17
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return { y: +m[1], m: +m[2] - 1, d: +m[3] }

  // US numeric: 06/17/2026 or 6/17/26
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    let y = +m[3]
    if (y < 100) y += 2000
    return { y, m: +m[1] - 1, d: +m[2] }
  }

  // Day-month-year first ("17 Jun 2026") so the day isn't mistaken for a year.
  m = s.match(/(\d{1,2})\s+([a-z]{3,})\.?(?:\s+(\d{4}))?/i)
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]
    return { y: m[3] ? +m[3] : new Date().getFullYear(), m: mo, d: +m[1] }
  }
  // Month-name-first ("Jun 17, 2026" / "June 17").
  m = s.match(/([a-z]{3,})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i)
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()]
    return { y: m[3] ? +m[3] : new Date().getFullYear(), m: mo, d: +m[2] }
  }
  return null
}

/** Parse a loose time string into {h,min} (24h) or null. */
export function parseLooseTime(raw?: string): { h: number; min: number } | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i)
  if (!m) return null
  let h = +m[1]
  const min = m[2] ? +m[2] : 0
  const mer = m[3]?.toLowerCase().replace(/\./g, '')
  if (mer === 'pm' && h < 12) h += 12
  if (mer === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return { h, min }
}

/**
 * Decide the event's date/time from a To-Do.
 * Priority for the DATE: details.date → dueDate. For the TIME: details.time.
 * A date with a time → a 60-minute timed event. A date with no time → all-day.
 * No resolvable date → null (the task is not calendar-eligible).
 */
export function resolveTodoDateTime(todo: TodoLike): ResolvedDateTime | null {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  let ymd = parseLooseDate(todo.details?.date)
  if (!ymd && todo.dueDate) {
    const d = new Date(todo.dueDate)
    if (!Number.isNaN(d.getTime())) ymd = { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }
  }
  if (!ymd) return null

  const time = parseLooseTime(todo.details?.time)
  if (time) {
    const start = new Date(ymd.y, ymd.m, ymd.d, time.h, time.min, 0, 0)
    const end = new Date(start.getTime() + 60 * 60_000)
    return { start, end, allDay: false, timeZone }
  }
  const start = new Date(ymd.y, ymd.m, ymd.d, 0, 0, 0, 0)
  const end = new Date(start.getTime() + 24 * 60 * 60_000)
  return { start, end, allDay: true, timeZone }
}

function ymdString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Build the rich description body from every relevant task field. */
export function buildEventDescription(todo: TodoLike): string {
  const d = todo.details ?? {}
  const lines: string[] = []
  if (todo.notes?.trim()) { lines.push(todo.notes.trim(), '') }
  const push = (label: string, v?: string) => { if (v && v.trim()) lines.push(`${label}: ${v.trim()}`) }
  push('Priority', todo.severity)
  push('Category', d.category)
  push('Location', d.location)
  push('Phone', d.phone)
  push('Contact', d.contact)
  push('Cost', d.cost)
  push('URL', d.url)
  if (d.customFields) for (const [k, v] of Object.entries(d.customFields)) push(k, v)
  lines.push('', '— Synced from Mission Control')
  return lines.join('\n').trim()
}

/** Map a To-Do to a Google Calendar event resource. Returns null if no date. */
export function buildEventFromTodo(todo: TodoLike): calendar_v3.Schema$Event | null {
  const when = resolveTodoDateTime(todo)
  if (!when) return null

  const event: calendar_v3.Schema$Event = {
    summary:     todo.title,
    description: buildEventDescription(todo),
    location:    todo.details?.location || undefined,
    extendedProperties: { private: { [TODO_PROP]: todo.id } },
  }
  if (when.allDay) {
    event.start = { date: ymdString(when.start) }
    event.end   = { date: ymdString(when.end) }
  } else {
    event.start = { dateTime: when.start.toISOString(), timeZone: when.timeZone }
    event.end   = { dateTime: when.end.toISOString(),   timeZone: when.timeZone }
  }
  return event
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export interface MappedEvent {
  id:           string
  name:         string
  description:  string
  location:     string
  htmlLink:     string
  status:       string
  allDay:       boolean
  startIso:     string | null
  endIso:       string | null
  timeDisplay:  string
  timeMinutes:  number
  dayOfWeek:    number | null
  organizer:    string
  attendees:    Array<{ email: string; displayName?: string; responseStatus: string; self: boolean }>
  calendarColor: string | null
  recurrence:   boolean
  meetLink:     string | null
  todoId:       string | null
  calendarId:   string        // which calendar this event lives on
  writable:     boolean       // true when the user can edit/delete it
}

export function mapEvent(ev: calendar_v3.Schema$Event, calendarId = '', writable = false): MappedEvent {
  const startRaw = ev.start?.dateTime ?? ev.start?.date ?? null
  const endRaw   = ev.end?.dateTime   ?? ev.end?.date   ?? null
  const start    = startRaw ? new Date(startRaw) : null
  return {
    id:           ev.id ?? '',
    name:         ev.summary ?? '(No title)',
    description:  ev.description ?? '',
    location:     ev.location ?? '',
    htmlLink:     ev.htmlLink ?? '',
    status:       ev.status ?? '',
    allDay:       !ev.start?.dateTime,
    startIso:     startRaw,
    endIso:       endRaw,
    timeDisplay:  start ? start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All day',
    timeMinutes:  start ? start.getHours() * 60 + start.getMinutes() : 0,
    dayOfWeek:    start ? start.getDay() : null,
    organizer:    ev.organizer?.email ?? '',
    attendees:    (ev.attendees ?? []).map(a => ({
      email: a.email ?? '', displayName: a.displayName ?? undefined,
      responseStatus: a.responseStatus ?? '', self: a.self ?? false,
    })),
    calendarColor: ev.colorId ?? null,
    recurrence:    Boolean(ev.recurrence),
    meetLink:      ev.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri ?? null,
    todoId:        ev.extendedProperties?.private?.[TODO_PROP] ?? null,
    calendarId,
    writable,
  }
}

export async function listCalendars() {
  return call(async cal => {
    const list = await cal.calendarList.list({ minAccessRole: 'reader' })
    return (list.data.items ?? []).map(c => ({
      id: c.id, summary: c.summary, description: c.description,
      primary: c.primary ?? false, color: c.backgroundColor, accessRole: c.accessRole,
    }))
  })
}

/** Aggregate events across every calendar the user can read, within a window. */
export async function listEventsAcrossCalendars(timeMinIso: string, timeMaxIso: string): Promise<MappedEvent[]> {
  return call(async cal => {
    const calList = await cal.calendarList.list({ minAccessRole: 'reader' })
    const items = (calList.data.items ?? []).filter(c => c.id)
    const ids = items.map(c => c.id!)
    const writableById = new Map(items.map(c => [c.id!, c.accessRole === 'owner' || c.accessRole === 'writer']))

    const results = await Promise.allSettled(
      ids.map(id => cal.events.list({
        calendarId: id, timeMin: timeMinIso, timeMax: timeMaxIso,
        singleEvents: true, orderBy: 'startTime', maxResults: 50,
      })),
    )

    const out: MappedEvent[] = []
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') return
      const calId = ids[i]
      const writable = writableById.get(calId) ?? false
      for (const ev of (r.value.data.items ?? [])) out.push(mapEvent(ev, calId, writable))
    })
    return out.sort((a, b) => (a.startIso ?? '').localeCompare(b.startIso ?? ''))
  })
}

/** Events on the PRIMARY calendar within an explicit ISO range (calendar→app awareness). */
export async function listEventsRange(startIso: string, endIso: string, calendarId = PRIMARY): Promise<MappedEvent[]> {
  return call(async cal => {
    const res = await cal.events.list({
      calendarId, timeMin: startIso, timeMax: endIso,
      singleEvents: true, orderBy: 'startTime', maxResults: 100,
    })
    return (res.data.items ?? []).map(ev => mapEvent(ev, calendarId, calendarId === PRIMARY))
  })
}

export async function upcomingEvents(days = 7): Promise<MappedEvent[]> {
  const now = new Date()
  const end = new Date(now.getTime() + days * 24 * 60 * 60_000)
  return listEventsRange(now.toISOString(), end.toISOString())
}

export async function getEvent(eventId: string, calendarId = PRIMARY): Promise<MappedEvent | null> {
  return call(async cal => {
    try {
      const res = await cal.events.get({ calendarId, eventId })
      return mapEvent(res.data, calendarId, true)
    } catch (err: any) {
      if (err?.response?.status === 404 || err?.code === 404) return null
      throw err
    }
  })
}

/** Recover a To-Do's event by its stamped private property (anti-duplicate net). */
export async function findEventByTodoId(todoId: string, calendarId = PRIMARY): Promise<MappedEvent | null> {
  return call(async cal => {
    const res = await cal.events.list({
      calendarId, privateExtendedProperty: [`${TODO_PROP}=${todoId}`],
      showDeleted: false, maxResults: 1, singleEvents: true,
    })
    const item = res.data.items?.[0]
    return item ? mapEvent(item) : null
  })
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createEvent(resource: calendar_v3.Schema$Event, calendarId = PRIMARY): Promise<MappedEvent> {
  return call(async cal => {
    const res = await cal.events.insert({ calendarId, requestBody: resource })
    return mapEvent(res.data, calendarId, true)
  })
}

export async function updateEvent(eventId: string, resource: calendar_v3.Schema$Event, calendarId = PRIMARY): Promise<MappedEvent> {
  return call(async cal => {
    const res = await cal.events.patch({ calendarId, eventId, requestBody: resource })
    return mapEvent(res.data, calendarId, true)
  })
}

export async function deleteEvent(eventId: string, calendarId = PRIMARY): Promise<void> {
  return call(async cal => {
    try {
      await cal.events.delete({ calendarId, eventId })
    } catch (err: any) {
      // Already gone — treat as success so unlink/delete is idempotent.
      if (err?.response?.status === 404 || err?.code === 404 || err?.response?.status === 410) return
      throw err
    }
  })
}
