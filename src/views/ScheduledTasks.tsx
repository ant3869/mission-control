import { useState, useEffect } from 'react'
import { format, startOfWeek, addDays, isToday } from 'date-fns'
import { clsx } from 'clsx'
import { Zap, Clock, RefreshCw, AlertCircle, ExternalLink, Video } from 'lucide-react'
import { alwaysRunningTasks } from '../data/mockData'
import { calendar, type CalendarEvent } from '../lib/api'
import type { TaskColor } from '../types'

// ─── Color maps (kept for Always Running section) ──────────────────────────────

const alwaysRunningColors: Record<TaskColor, string> = {
  red:    'bg-red-950/50 border-red-900/50 text-red-300',
  orange: 'bg-orange-950/50 border-orange-900/50 text-orange-300',
  amber:  'bg-amber-950/50 border-amber-900/50 text-amber-200',
  blue:   'bg-blue-950/50 border-blue-900/50 text-blue-300',
  indigo: 'bg-indigo-950/50 border-indigo-900/50 text-indigo-300',
  green:  'bg-green-950/50 border-green-900/50 text-green-300',
  teal:   'bg-teal-950/50 border-teal-900/50 text-teal-300',
  purple: 'bg-purple-950/50 border-purple-900/50 text-purple-300',
  violet: 'bg-violet-950/50 border-violet-900/50 text-violet-300',
  slate:  'bg-slate-800/50 border-slate-700/50 text-slate-300',
  rose:   'bg-rose-950/50 border-rose-900/50 text-rose-300',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event }: { event: CalendarEvent }) {
  const color = colorForEvent(event.id)
  return (
    <div className={clsx('flex flex-col gap-0.5 px-2.5 py-2 rounded border cursor-pointer hover:opacity-90 transition-opacity group', color)}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-medium leading-tight truncate flex-1">{event.name}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {event.meetLink && (
            <a href={event.meetLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              className="shrink-0" title="Join meeting">
              <Video size={9} className="opacity-70 hover:opacity-100" />
            </a>
          )}
          {event.htmlLink && (
            <a href={event.htmlLink} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              className="shrink-0" title="Open in Google Calendar">
              <ExternalLink size={9} className="opacity-70 hover:opacity-100" />
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <Clock size={9} className="opacity-50 shrink-0" />
        <span className="text-xxs opacity-60">{event.timeDisplay}</span>
        {event.allDay && <span className="text-xxs opacity-50">All day</span>}
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

// ─── Not connected banner ─────────────────────────────────────────────────────

function ConnectBanner() {
  return (
    <div className="flex items-center gap-3 mx-4 my-3 px-4 py-3 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300">
      <AlertCircle size={14} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">Google Calendar not connected</p>
        <p className="text-xxs opacity-70 mt-0.5">
          Add your credentials to <code className="font-mono">.env</code> then visit{' '}
          <a href="/api/auth/google" target="_blank" rel="noreferrer" className="underline hover:opacity-100">
            /api/auth/google
          </a>{' '}
          to authenticate.
        </p>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ScheduledTasks() {
  const [viewMode, setViewMode] = useState<'week' | 'today'>('week')
  const [events, setEvents]     = useState<CalendarEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const today     = new Date()
  const weekStart = startOfWeek(today)

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i)
    return { dayIndex: i, date, label: DAY_LABELS[i], dayNum: format(date, 'd'), isToday: isToday(date) }
  })

  const visibleDays = viewMode === 'today' ? weekDays.filter(d => d.isToday) : weekDays

  const loadEvents = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await calendar.events(7)
      setEvents(data.events)
      setFetchedAt(data.fetchedAt)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadEvents() }, [])

  const getEventsForDay = (dayIndex: number) =>
    events
      .filter(e => e.dayOfWeek === dayIndex)
      .sort((a, b) => a.timeMinutes - b.timeMinutes)

  const notConfigured = error?.includes('not configured')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Calendar</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading
              ? 'Loading events…'
              : error && !notConfigured
              ? <span className="text-red-400">Error: {error}</span>
              : <><span className="text-text-secondary">{events.length} events this week</span>
                  {fetchedAt && <>&nbsp;·&nbsp;<span className="opacity-50">updated {new Date(fetchedAt).toLocaleTimeString()}</span></>}
                </>
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadEvents}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-card text-text-muted hover:text-text-secondary transition-colors text-xs"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="flex items-center gap-1 bg-card rounded border border-border p-0.5">
            {(['week', 'today'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={clsx(
                  'px-3 py-1 rounded text-xs font-medium capitalize transition-all',
                  viewMode === mode ? 'bg-card-hover text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Always Running */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0 bg-surface/50">
        <div className="flex items-center gap-1.5 text-text-muted">
          <Zap size={12} className="text-accent-amber" />
          <span className="text-xs font-medium text-text-secondary">Always Running</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {alwaysRunningTasks.map(task => (
            <div
              key={task.id}
              className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium', alwaysRunningColors[task.color])}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />
              <span>{task.name}</span>
              <span className="opacity-50">·</span>
              <span className="opacity-70">{task.frequency}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Connect banner */}
      {notConfigured && <ConnectBanner />}

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto">
        <div
          className={clsx('grid h-full min-h-0', viewMode === 'week' ? 'grid-cols-7' : 'grid-cols-1')}
          style={{ minWidth: viewMode === 'week' ? '700px' : undefined }}
        >
          {visibleDays.map(({ dayIndex, label, dayNum, isToday: todayFlag }) => {
            const dayEvents = getEventsForDay(dayIndex)
            return (
              <div key={dayIndex} className={clsx('flex flex-col border-r border-border last:border-r-0', todayFlag && 'bg-surface/30')}>
                {/* Day header */}
                <div className={clsx('flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0', todayFlag && 'bg-surface/60')}>
                  <span className={clsx('text-xs font-semibold uppercase tracking-wider', todayFlag ? 'text-accent-blue' : 'text-text-muted')}>
                    {label}
                  </span>
                  <span className={clsx('flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold',
                    todayFlag ? 'bg-accent-blue text-black' : 'text-text-secondary')}>
                    {dayNum}
                  </span>
                  <span className="ml-auto text-xxs text-text-muted tabular-nums">{dayEvents.length || ''}</span>
                </div>

                {/* Events */}
                <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1">
                  {loading && todayFlag && (
                    <div className="flex items-center justify-center h-16">
                      <span className="text-xxs text-text-muted animate-pulse">Loading…</span>
                    </div>
                  )}
                  {!loading && dayEvents.map(ev => <EventCard key={ev.id} event={ev} />)}
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
    </div>
  )
}
