import { useState, useEffect, useCallback, useMemo } from 'react'
import { format, startOfWeek, addDays, isToday } from 'date-fns'
import { clsx } from 'clsx'
import {
  Zap, Clock, RefreshCw, AlertCircle, ExternalLink, Video, Pause, Play, Loader2,
  ChevronLeft, ChevronRight, CalendarDays, Plus, Trash2, Check, X, MapPin, AlignLeft,
} from 'lucide-react'
import { calendar, agentCron, type CalendarEvent, type CalendarEventInput, type AgentCronJob, type ConnectorId, type CronAction } from '../lib/api'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { friendlyError } from '../lib/friendlyError'
import { apiUrl } from '../lib/apiTransport.js'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type ViewMode = 'day' | 'week' | 'month' | 'agenda'
const VIEW_MODES: ViewMode[] = ['day', 'week', 'month', 'agenda']
const AGENDA_DAYS = 30

// Pick a stable colour for each event based on its id
const EVENT_COLORS = [
  'bg-blue-950/60 border-blue-900/60 text-blue-300',
  'bg-violet-950/60 border-violet-900/60 text-violet-300',
  'bg-teal-950/60 border-teal-900/60 text-teal-300',
  'bg-indigo-950/60 border-indigo-900/60 text-indigo-300',
  'bg-cyan-950/60 border-cyan-900/60 text-cyan-300',
  'bg-purple-950/60 border-purple-900/60 text-purple-300',
  'bg-green-950/60 border-green-900/60 text-green-300',
]

function colorForEvent(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length]
}

// ─── Date helpers ───────────────────────────────────────────────────────────
// Match events to days by their LOCAL calendar date. All-day events carry a
// bare YYYY-MM-DD start (no time) — use it verbatim so they don't drift a day in
// negative-offset timezones; timed events resolve through the local Date.

const pad2 = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

// Local date math (kept here rather than imported — avoids a date-fns module-
// resolution quirk under this tsconfig, and these are one-liners anyway).
const startOfDay   = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addWeeks     = (d: Date, n: number) => addDays(d, n * 7)
const addMonths    = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1)
  t.setDate(Math.min(d.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()))
  return t
}
const isSameMonth  = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()

function eventDateKey(e: CalendarEvent): string {
  if (!e.startIso) return ''
  if (e.allDay) return e.startIso.slice(0, 10)
  return dateKey(new Date(e.startIso))
}

/** The fetch + display window for a given view, anchored on `anchor`. */
function getRange(view: ViewMode, anchor: Date): { start: Date; end: Date } {
  if (view === 'day')   { const s = startOfDay(anchor);                    return { start: s, end: addDays(s, 1) } }
  if (view === 'week')  { const s = startOfWeek(anchor);                   return { start: s, end: addDays(s, 7) } }
  if (view === 'agenda'){ const s = startOfDay(anchor);                    return { start: s, end: addDays(s, AGENDA_DAYS) } }
  /* month */           { const s = startOfWeek(startOfMonth(anchor));     return { start: s, end: addDays(s, 42) } }
}

function periodLabel(view: ViewMode, anchor: Date): string {
  if (view === 'day')   return format(anchor, 'EEE, MMM d, yyyy')
  if (view === 'month') return format(anchor, 'MMMM yyyy')
  if (view === 'agenda') {
    const s = startOfDay(anchor)
    return `${format(s, 'MMM d')} – ${format(addDays(s, AGENDA_DAYS - 1), 'MMM d')}`
  }
  const ws = startOfWeek(anchor)
  return `${format(ws, 'MMM d')} – ${format(addDays(ws, 6), 'MMM d, yyyy')}`
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, onClick }: { event: CalendarEvent; onClick?: () => void }) {
  const color = colorForEvent(event.id)
  return (
    <div
      onClick={onClick}
      className={clsx('flex flex-col gap-0.5 px-2.5 py-2 rounded border cursor-pointer hover:opacity-90 transition-opacity group', color)}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-medium leading-tight truncate flex-1">{event.name}</span>
        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {event.meetLink && (
            <a href={event.meetLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              className="flex min-h-6 min-w-6 shrink-0 items-center justify-center sm:min-h-0 sm:min-w-0" title="Join meeting">
              <Video size={9} className="opacity-70 hover:opacity-100" />
            </a>
          )}
          {event.htmlLink && (
            <a href={event.htmlLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              className="flex min-h-6 min-w-6 shrink-0 items-center justify-center sm:min-h-0 sm:min-w-0" title="Open in Google Calendar">
              <ExternalLink size={9} className="opacity-70 hover:opacity-100" />
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <Clock size={9} className="opacity-50 shrink-0" />
        <span className="text-xxs opacity-60">{event.allDay ? 'All day' : event.timeDisplay}</span>
        {event.recurrence && <span className="text-xxs opacity-40">↻</span>}
        {event.location && (
          <>
            <span className="text-xxs opacity-40">·</span>
            <span className="text-xxs opacity-50 truncate">{event.location}</span>
          </>
        )}
      </div>
      {event.attendees.length > 1 && (
        <span className="text-xxs opacity-40 mt-0.5">
          {event.attendees.length} attendees
        </span>
      )}
    </div>
  )
}

// ─── Event composer (create / edit / delete) ──────────────────────────────────

type ComposerState =
  | { mode: 'create'; date: Date }
  | { mode: 'edit'; event: CalendarEvent }

const timeInput = (iso: string | null) =>
  iso ? `${pad2(new Date(iso).getHours())}:${pad2(new Date(iso).getMinutes())}` : '09:00'

function EventComposer({ state, onClose, onSaved }: {
  state: ComposerState
  onClose: () => void
  onSaved: () => void
}) {
  useEscapeKey(onClose)
  const editing  = state.mode === 'edit'
  const ev       = editing ? state.event : null
  const writable = !editing || ev!.writable !== false

  const initDate = editing
    ? (ev!.allDay ? (ev!.startIso ?? dateKey(new Date())).slice(0, 10)
                  : ev!.startIso ? dateKey(new Date(ev!.startIso)) : dateKey(new Date()))
    : dateKey(state.date)

  const [title, setTitle]             = useState(ev?.name ?? '')
  const [allDay, setAllDay]           = useState(ev?.allDay ?? false)
  const [date, setDate]               = useState(initDate)
  const [startTime, setStartTime]     = useState(editing && !ev!.allDay ? timeInput(ev!.startIso) : '09:00')
  const [endTime, setEndTime]         = useState(editing && !ev!.allDay ? timeInput(ev!.endIso) : '10:00')
  const [location, setLocation]       = useState(ev?.location ?? '')
  const [description, setDescription] = useState(ev?.description ?? '')
  const [busy, setBusy]               = useState(false)
  const [err, setErr]                 = useState<string | null>(null)

  function buildPayload(): CalendarEventInput {
    const base = {
      title: title.trim(),
      location: location.trim() || undefined,
      description: description.trim() || undefined,
      calendarId: ev?.calendarId,
    }
    if (allDay) {
      const next = dateKey(addDays(new Date(`${date}T00:00:00`), 1))
      return { ...base, allDay: true, start: date, end: next }
    }
    const startISO = new Date(`${date}T${startTime}:00`)
    let endISO = new Date(`${date}T${(endTime || startTime)}:00`)
    if (endISO <= startISO) endISO = new Date(startISO.getTime() + 60 * 60_000)
    return { ...base, allDay: false, start: startISO.toISOString(), end: endISO.toISOString() }
  }

  async function save() {
    if (!title.trim()) { setErr('Title is required'); return }
    setBusy(true); setErr(null)
    try {
      if (editing) await calendar.update(ev!.id, buildPayload())
      else         await calendar.create(buildPayload())
      onSaved()
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  async function remove() {
    if (!ev || !confirm(`Delete "${ev.name}"?`)) return
    setBusy(true); setErr(null)
    try { await calendar.remove(ev.id, ev.calendarId); onSaved() }
    catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  const inputCls = 'w-full min-h-11 px-3 py-2 rounded-lg bg-base border border-border text-base sm:text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50 disabled:opacity-60 sm:min-h-0 sm:px-2.5 sm:py-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="animate-rise-in relative flex h-[100dvh] w-full max-w-none flex-col overflow-hidden rounded-none border border-border bg-surface shadow-2xl shadow-black/40 safe-top safe-bottom sm:h-auto sm:max-h-[90vh] sm:max-w-md sm:rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sm:px-5 sm:py-3.5">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-accent-blue" />
            <h2 className="text-sm font-semibold text-text-primary">{editing ? 'Edit event' : 'New event'}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-card text-text-muted hover:text-text-primary sm:min-h-0 sm:min-w-0 sm:p-1">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-5">
          {!writable && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-amber-300">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <p className="text-xxs leading-snug">This event is on a read-only calendar, so it can't be edited here.</p>
            </div>
          )}

          {/* Title */}
          <label className="flex flex-col gap-1">
            <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Title</span>
            <input autoFocus value={title} disabled={!writable} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Start moving into new place"
              onKeyDown={e => { if (e.key === 'Enter' && writable) save() }}
              className={inputCls} />
          </label>

          {/* All-day toggle */}
          <div className="flex min-h-11 items-center justify-between sm:min-h-0">
            <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">All-day</span>
            <button role="switch" aria-checked={allDay} disabled={!writable}
              onClick={() => setAllDay(v => !v)}
              className={clsx('relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-40',
                allDay ? 'bg-accent-blue/70' : 'bg-card border border-border')}>
              <span className={clsx('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', allDay && 'translate-x-4')} />
            </button>
          </div>

          {/* Date + time */}
          <div className="grid grid-cols-1 gap-2 min-[393px]:grid-cols-2">
            <label className={clsx('flex flex-col gap-1', allDay && 'min-[393px]:col-span-2')}>
              <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Date</span>
              <input type="date" value={date} disabled={!writable} onChange={e => setDate(e.target.value)} className={inputCls} />
            </label>
            {!allDay && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Start</span>
                  <input type="time" value={startTime} disabled={!writable} onChange={e => setStartTime(e.target.value)} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 min-[393px]:col-start-2">
                  <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">End</span>
                  <input type="time" value={endTime} disabled={!writable} onChange={e => setEndTime(e.target.value)} className={inputCls} />
                </label>
              </>
            )}
          </div>

          {/* Location */}
          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xxs font-semibold uppercase tracking-wide text-text-muted">
              <MapPin size={10} /> Location
            </span>
            <input value={location} disabled={!writable} onChange={e => setLocation(e.target.value)}
              placeholder="Address or place" className={inputCls} />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-xxs font-semibold uppercase tracking-wide text-text-muted">
              <AlignLeft size={10} /> Notes
            </span>
            <textarea value={description} disabled={!writable} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="Any details — what to bring, who to call, costs…" className={clsx(inputCls, 'resize-none')} />
          </label>

          {err && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <p className="text-xxs leading-snug">{friendlyError(err, 'Google Calendar')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border safe-bottom sm:px-5 sm:py-3.5">
          {writable && (
            <button onClick={save} disabled={busy || !title.trim()}
              className="flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium disabled:opacity-40 sm:min-h-0 sm:py-1.5">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {editing ? 'Save' : 'Add event'}
            </button>
          )}
          <button onClick={onClose} className="min-h-11 px-3 py-2 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs sm:min-h-0 sm:py-1.5">
            {writable ? 'Cancel' : 'Close'}
          </button>
          {editing && writable && (
            <button onClick={remove} disabled={busy}
              className="ml-auto flex min-h-11 items-center gap-1.5 px-3 py-2 rounded-lg border border-red-900/40 bg-red-950/20 text-red-400 hover:bg-red-950/40 text-xs disabled:opacity-50 sm:min-h-0 sm:py-1.5">
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Month cell ───────────────────────────────────────────────────────────────

function MonthCell({ date, events, inMonth, onPick, onAdd }: {
  date: Date; events: CalendarEvent[]; inMonth: boolean
  onPick: (d: Date) => void; onAdd: (d: Date) => void
}) {
  const today = isToday(date)
  const shown = events.slice(0, 3)
  const extra = events.length - shown.length
  return (
    <div
      className={clsx(
        'group/cell flex flex-col gap-0.5 border-r border-b border-border p-1 text-left min-h-[84px] overflow-hidden transition-colors hover:bg-card-hover cursor-pointer',
        !inMonth && 'bg-surface/30',
        today && 'bg-accent-blue/5',
      )}
      onClick={() => onPick(date)}
    >
      <div className="flex items-center justify-between">
        <span className={clsx('flex items-center justify-center w-5 h-5 rounded-full text-xxs font-semibold',
          today ? 'bg-accent-blue text-black' : inMonth ? 'text-text-secondary' : 'text-text-muted/50')}>
          {format(date, 'd')}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onAdd(date) }}
          title="Add event"
          className="opacity-0 group-hover/cell:opacity-100 text-text-muted hover:text-emerald-400 transition-all"
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {shown.map(e => (
          <span key={e.id} title={`${e.allDay ? 'All day' : e.timeDisplay} · ${e.name}`}
            className={clsx('truncate text-[9px] px-1 py-px rounded border', colorForEvent(e.id))}>
            {!e.allDay && <span className="opacity-60 mr-0.5">{e.timeDisplay}</span>}{e.name}
          </span>
        ))}
        {extra > 0 && <span className="text-[9px] text-text-muted pl-1">+{extra} more</span>}
      </div>
    </div>
  )
}

// ─── Not connected banner ─────────────────────────────────────────────────────

function ConnectBanner() {
  return (
    <div className="flex items-start gap-3 mx-4 my-3 px-4 py-3 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300">
      <AlertCircle size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">Google Calendar needs reconnecting</p>
        <p className="text-xxs opacity-70 mt-0.5">
          Not connected, or the saved token expired. Connect from{' '}
          <a href={apiUrl('/api/auth/google')} target="_blank" rel="noreferrer" className="underline hover:opacity-100">
            Settings → Google
          </a>{' '}
          to (re)authenticate — the token then refreshes itself.
        </p>
      </div>
    </div>
  )
}

// ─── Always-Running cron pill (real OpenClaw / Hermes recurring jobs) ──────────

function sourceTag(source: ConnectorId) {
  return source === 'openclaw'
    ? { label: 'Claw', cls: 'bg-amber-950/50 border-amber-900/50 text-amber-300', dot: 'bg-amber-400' }
    : { label: 'Hermes', cls: 'bg-violet-950/50 border-violet-900/50 text-violet-300', dot: 'bg-violet-400' }
}

function CronPill({ job, busy, onToggle }: { job: AgentCronJob; busy: boolean; onToggle: () => void }) {
  const tag = sourceTag(job.source)
  const title = [
    job.name,
    `Schedule: ${job.schedule}`,
    job.nextRunLabel ? `Next: ${job.nextRunLabel}` : '',
    job.lastRunLabel ? `Last: ${job.lastRunLabel}` : '',
    job.runCount ? `${job.runCount} runs · ${Math.round(job.successRate)}% ok` : '',
    job.sample ? `\n${job.sample.slice(0, 160)}` : '',
  ].filter(Boolean).join('\n')
  return (
    <div
      title={title}
      className={clsx(
        'group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border text-xs font-medium transition-all',
        job.enabled ? 'bg-card border-border text-text-secondary' : 'bg-surface border-border-subtle text-text-muted opacity-70',
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', job.enabled ? `${tag.dot} animate-pulse` : 'bg-text-muted')} />
      <span className="truncate max-w-[160px] text-text-primary/90">{job.name}</span>
      <span className="opacity-50">·</span>
      <span className="opacity-70 truncate max-w-[120px]">{job.nextRunLabel && job.nextRunLabel !== '—' ? job.nextRunLabel : job.schedule}</span>
      <span className={clsx('ml-0.5 px-1 py-px rounded-full border text-[9px] font-semibold shrink-0', tag.cls)}>{tag.label}</span>
      <button
        onClick={onToggle}
        disabled={busy}
        title={job.enabled ? 'Pause this job' : 'Resume this job'}
        className="ml-0.5 w-5 h-5 flex items-center justify-center rounded-full text-text-muted hover:text-text-primary hover:bg-card-hover opacity-0 group-hover:opacity-100 transition-all shrink-0 disabled:opacity-50"
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : job.enabled ? <Pause size={11} /> : <Play size={11} />}
      </button>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ScheduledTasks() {
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'agenda' : 'week',
  )
  const [anchor, setAnchor]     = useState<Date>(() => new Date())
  const [events, setEvents]     = useState<CalendarEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [composer, setComposer] = useState<ComposerState | null>(null)

  // Real recurring agent jobs (OpenClaw + Hermes cron) for the Always Running strip.
  const [cronJobs, setCronJobs]   = useState<AgentCronJob[]>([])
  const [cronLoading, setCronLoading] = useState(true)
  const [busyJob, setBusyJob]     = useState<string | null>(null)

  const loadCron = useCallback(async () => {
    setCronLoading(true)
    try {
      const [oc, hm] = await Promise.allSettled([agentCron.openclaw(), agentCron.hermes()])
      const jobs: AgentCronJob[] = []
      if (oc.status === 'fulfilled') jobs.push(...oc.value.jobs)
      if (hm.status === 'fulfilled') jobs.push(...hm.value.jobs)
      // Enabled first, then by name.
      jobs.sort((a, b) => (a.enabled === b.enabled ? a.name.localeCompare(b.name) : a.enabled ? -1 : 1))
      setCronJobs(jobs)
    } catch { /* leave whatever we have */ } finally { setCronLoading(false) }
  }, [])

  const toggleJob = async (job: AgentCronJob) => {
    const action: CronAction = job.enabled ? 'pause' : 'resume'
    setBusyJob(job.id)
    setCronJobs(prev => prev.map(j => j.id === job.id ? { ...j, enabled: !j.enabled } : j)) // optimistic
    try {
      const r = await agentCron.action(job.source, job.rawId || job.id, action)
      if (!r.ok) throw new Error(r.error || 'failed')
    } catch {
      setCronJobs(prev => prev.map(j => j.id === job.id ? { ...j, enabled: job.enabled } : j)) // revert
    } finally { setBusyJob(null) }
  }

  // Fetch events for the current view's window (re-runs when view or anchor changes).
  const loadEvents = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { start, end } = getRange(viewMode, anchor)
      const data = await calendar.eventsBetween(start.toISOString(), end.toISOString())
      setEvents(data.events)
      setFetchedAt(data.fetchedAt)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [viewMode, anchor])

  useEffect(() => { loadEvents() }, [loadEvents])
  useEffect(() => { loadCron() }, [loadCron])

  const refreshAll = () => { loadEvents(); loadCron() }

  // Index events by local date for O(1) per-day lookup, sorted within a day.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of events) {
      const k = eventDateKey(e)
      if (!k) continue
      const list = map.get(k)
      if (list) list.push(e)
      else map.set(k, [e])
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.timeMinutes - b.timeMinutes)
    }
    return map
  }, [events])
  const eventsForDate = useCallback((d: Date) => eventsByDay.get(dateKey(d)) ?? [], [eventsByDay])

  // Navigation: prev/next move by the view's natural unit; "Today" re-anchors now.
  const step = (dir: 1 | -1) => setAnchor(a =>
    viewMode === 'day'    ? addDays(a, dir)
    : viewMode === 'week'   ? addWeeks(a, dir)
    : viewMode === 'month'  ? addMonths(a, dir)
    : addDays(a, dir * 7))   // agenda: page a week at a time
  const goToday = () => setAnchor(new Date())

  const pickDay = (d: Date) => { setAnchor(d); setViewMode('day') }

  // "not configured" (no creds) AND auth failures like invalid_grant (token
  // expired/revoked) both resolve the same way: re-authenticate at /api/auth/google.
  const needsAuth = !!error && /not configured|disconnected|reconnect|invalid_grant|invalid_token|invalid_request|unauthorized|401|credential|refresh token|expired|missing scope/i.test(error)

  const columns = viewMode === 'day'
    ? [startOfDay(anchor)]
    : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))

  const monthCells = useMemo(
    () => Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(startOfMonth(anchor)), i)),
    [anchor],
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3 border-b border-border shrink-0 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-5 sm:pb-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-text-primary">Calendar</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading
              ? 'Loading events…'
              : error && !needsAuth
              ? <span className="text-red-400">Error: {error}</span>
              : <><span className="text-text-secondary">{events.length} event{events.length === 1 ? '' : 's'}</span>
                  {fetchedAt && <>&nbsp;·&nbsp;<span className="opacity-50">updated {new Date(fetchedAt).toLocaleTimeString()}</span></>}
                </>
            }
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {/* Period navigation */}
          <div className="flex w-full items-center gap-1 sm:w-auto">
            <button onClick={() => step(-1)} title="Previous"
              className="flex h-11 w-11 items-center justify-center rounded border border-border bg-card text-text-muted hover:text-text-primary transition-colors sm:h-7 sm:w-7">
              <ChevronLeft size={14} />
            </button>
            <button onClick={goToday} title="Jump to today"
              className="h-11 flex-1 rounded border border-border bg-card px-3 text-xs text-text-secondary hover:text-text-primary transition-colors sm:h-7 sm:flex-none sm:px-2.5">
              Today
            </button>
            <button onClick={() => step(1)} title="Next"
              className="flex h-11 w-11 items-center justify-center rounded border border-border bg-card text-text-muted hover:text-text-primary transition-colors sm:h-7 sm:w-7">
              <ChevronRight size={14} />
            </button>
            <button onClick={refreshAll} disabled={loading} title="Refresh"
              className="flex h-11 w-11 items-center justify-center rounded border border-border bg-card text-text-muted hover:text-text-secondary transition-colors sm:hidden">
              <RefreshCw size={12} className={loading || cronLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          <span className="text-xs font-medium text-text-secondary tabular-nums min-w-[150px] text-center hidden sm:block">
            {periodLabel(viewMode, anchor)}
          </span>

          <button onClick={refreshAll} disabled={loading} title="Refresh"
            className="hidden w-7 h-7 items-center justify-center rounded border border-border bg-card text-text-muted hover:text-text-secondary transition-colors sm:flex">
            <RefreshCw size={12} className={loading || cronLoading ? 'animate-spin' : ''} />
          </button>

          <button onClick={() => setComposer({ mode: 'create', date: anchor })} title="Add an event"
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/25 sm:h-7 sm:min-h-0 sm:w-auto sm:px-2.5">
            <Plus size={13} /> New event
          </button>

          {/* View switcher */}
          <div className="w-full overflow-x-auto sm:w-auto sm:overflow-visible">
            <div className="flex min-w-max items-center gap-0.5 bg-card rounded border border-border p-0.5">
              {VIEW_MODES.map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={clsx(
                    'min-h-11 px-3 py-1 rounded text-xs font-medium capitalize transition-all sm:min-h-0 sm:px-2.5',
                    viewMode === mode ? 'bg-card-hover text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile period label (header version is hidden < sm) */}
      <div className="sm:hidden px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs font-medium text-text-secondary">{periodLabel(viewMode, anchor)}</span>
      </div>

      {/* Always Running — real recurring agent jobs (OpenClaw / Hermes cron) */}
      <div className="flex flex-col gap-2 px-4 py-3 border-b border-border shrink-0 bg-surface/50 sm:flex-row sm:items-center sm:gap-3 sm:px-6">
        <div className="flex w-full items-center gap-1.5 text-text-muted sm:w-auto sm:shrink-0">
          <Zap size={12} className="text-accent-amber" />
          <span className="text-xs font-medium text-text-secondary">Always Running</span>
          {!cronLoading && cronJobs.length > 0 && (
            <span className="ml-auto text-xxs text-text-muted tabular-nums sm:ml-0">
              {cronJobs.filter(j => j.enabled).length}/{cronJobs.length}
            </span>
          )}
        </div>
        <div className="min-w-0 w-full overflow-x-auto sm:overflow-visible">
          <div className="flex w-max items-center gap-2 sm:w-auto sm:flex-wrap">
            {cronLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[26px] w-32 shrink-0 rounded-full bg-card border border-border animate-pulse" />
              ))
            ) : cronJobs.length === 0 ? (
              <span className="max-w-full whitespace-normal text-xxs text-text-muted italic">No recurring agent jobs — connect OpenClaw or Hermes in Settings to schedule them.</span>
            ) : (
              cronJobs.map(job => (
                <CronPill key={`${job.source}:${job.id}`} job={job} busy={busyJob === job.id} onToggle={() => toggleJob(job)} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Connect banner */}
      {needsAuth && <ConnectBanner />}

      {/* ── Day / Week grid ── */}
      {(viewMode === 'day' || viewMode === 'week') && (
        <div className="flex-1 max-w-full overflow-auto">
          <div
            className={clsx('grid h-full min-h-0', viewMode === 'week' ? 'grid-cols-7' : 'grid-cols-1')}
            style={{ minWidth: viewMode === 'week' ? '700px' : undefined }}
          >
            {columns.map((date, i) => {
              const dayEvents = eventsForDate(date)
              const todayFlag = isToday(date)
              return (
                <div key={i} className={clsx('flex flex-col border-r border-border last:border-r-0', todayFlag && 'bg-surface/30')}>
                  <div className={clsx('flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0', todayFlag && 'bg-surface/60')}>
                    <span className={clsx('text-xs font-semibold uppercase tracking-wider', todayFlag ? 'text-accent-blue' : 'text-text-muted')}>
                      {DAY_LABELS[date.getDay()]}
                    </span>
                    <span className={clsx('flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold',
                      todayFlag ? 'bg-accent-blue text-black' : 'text-text-secondary')}>
                      {format(date, 'd')}
                    </span>
                    {viewMode === 'day' && <span className="text-xs text-text-muted">{format(date, 'MMMM yyyy')}</span>}
                    <span className="ml-auto text-xxs text-text-muted tabular-nums">{dayEvents.length || ''}</span>
                    <button onClick={() => setComposer({ mode: 'create', date })} title="Add event to this day"
                      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-text-muted hover:text-emerald-400 transition-colors sm:min-h-0 sm:min-w-0">
                      <Plus size={13} />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1">
                    {loading && (
                      <div className="flex items-center justify-center h-16">
                        <span className="text-xxs text-text-muted animate-pulse">Loading…</span>
                      </div>
                    )}
                    {!loading && dayEvents.map(ev => <EventCard key={ev.id} event={ev} onClick={() => setComposer({ mode: 'edit', event: ev })} />)}
                    {!loading && dayEvents.length === 0 && (
                      <div className="flex items-center justify-center h-16">
                        <span className="text-xxs text-text-muted">No events</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Month grid ── */}
      {viewMode === 'month' && (
        <div className="flex-1 max-w-full overflow-auto">
          <div className="min-w-[640px] flex flex-col h-full">
            <div className="grid grid-cols-7 border-b border-border shrink-0">
              {DAY_LABELS.map(d => (
                <div key={d} className="px-2 py-1.5 text-xxs font-semibold uppercase tracking-wider text-text-muted border-r border-border last:border-r-0">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 grid-rows-6 flex-1 border-l border-t border-border">
              {monthCells.map((date, i) => (
                <MonthCell key={i} date={date} events={eventsForDate(date)} inMonth={isSameMonth(date, anchor)} onPick={pickDay} onAdd={d => setComposer({ mode: 'create', date: d })} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Agenda list ── */}
      {viewMode === 'agenda' && (
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={18} className="animate-spin text-text-muted" />
            </div>
          ) : (() => {
            const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(startOfDay(anchor), i))
              .map(d => ({ date: d, items: eventsForDate(d) }))
              .filter(x => x.items.length > 0)
            if (days.length === 0) {
              return (
                <div className="flex flex-col items-center gap-2 py-20 text-text-muted">
                  <CalendarDays size={22} className="opacity-30" />
                  <p className="text-xs">No events in the next {AGENDA_DAYS} days.</p>
                </div>
              )
            }
            return (
              <div className="flex flex-col">
                {days.map(({ date, items }) => {
                  const todayFlag = isToday(date)
                  return (
                    <div key={dateKey(date)} className="group/agenda flex gap-3 px-4 sm:px-6 py-3 border-b border-border-subtle">
                      <div className="shrink-0 w-14">
                        <button onClick={() => pickDay(date)} className="w-full text-left">
                          <div className={clsx('text-xxs font-semibold uppercase tracking-wider', todayFlag ? 'text-accent-blue' : 'text-text-muted')}>
                            {DAY_LABELS[date.getDay()]}
                          </div>
                          <div className={clsx('text-lg font-semibold leading-none tabular-nums', todayFlag ? 'text-accent-blue' : 'text-text-primary')}>
                            {format(date, 'd')}
                          </div>
                          <div className="text-xxs text-text-muted">{format(date, 'MMM')}</div>
                        </button>
                        <button
                          onClick={() => setComposer({ mode: 'create', date })}
                          title="Add event"
                          className="mt-1 flex min-h-11 min-w-11 items-center justify-center text-text-muted opacity-100 transition-all hover:text-emerald-400 sm:min-h-0 sm:min-w-0 sm:opacity-0 sm:group-hover/agenda:opacity-100"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        {items.map(ev => <EventCard key={ev.id} event={ev} onClick={() => setComposer({ mode: 'edit', event: ev })} />)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}

      {/* Event composer (create / edit / delete) */}
      {composer && (
        <EventComposer
          state={composer}
          onClose={() => setComposer(null)}
          onSaved={() => { setComposer(null); loadEvents() }}
        />
      )}
    </div>
  )
}
