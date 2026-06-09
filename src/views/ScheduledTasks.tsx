import { useState, useEffect, useCallback } from 'react'
import { format, startOfWeek, addDays, isToday } from 'date-fns'
import { clsx } from 'clsx'
import { Zap, Clock, RefreshCw, AlertCircle, ExternalLink, Video, Pause, Play, Loader2 } from 'lucide-react'
import { calendar, agentCron, type CalendarEvent, type AgentCronJob, type ConnectorId, type CronAction } from '../lib/api'

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
        <p className="text-xs font-medium">Google Calendar needs reconnecting</p>
        <p className="text-xxs opacity-70 mt-0.5">
          Not connected, or the saved token expired. Ensure your credentials are in{' '}
          <code className="font-mono">.env</code>, then visit{' '}
          <a href="/api/auth/google" target="_blank" rel="noreferrer" className="underline hover:opacity-100">
            /api/auth/google
          </a>{' '}
          to (re)authenticate.
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
  const [viewMode, setViewMode] = useState<'week' | 'today'>('week')
  const [events, setEvents]     = useState<CalendarEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

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

  useEffect(() => { loadEvents(); loadCron() }, [loadCron])

  const refreshAll = () => { loadEvents(); loadCron() }

  const getEventsForDay = (dayIndex: number) =>
    events
      .filter(e => e.dayOfWeek === dayIndex)
      .sort((a, b) => a.timeMinutes - b.timeMinutes)

  // "not configured" (no creds) AND auth failures like invalid_grant (token
  // expired/revoked) both resolve the same way: re-authenticate at /api/auth/google.
  const needsAuth = !!error && /not configured|invalid_grant|invalid_token|invalid_request|unauthorized|401|credential|refresh token|expired/i.test(error)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Calendar</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading
              ? 'Loading events…'
              : error && !needsAuth
              ? <span className="text-red-400">Error: {error}</span>
              : <><span className="text-text-secondary">{events.length} events this week</span>
                  {fetchedAt && <>&nbsp;·&nbsp;<span className="opacity-50">updated {new Date(fetchedAt).toLocaleTimeString()}</span></>}
                </>
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshAll}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-card text-text-muted hover:text-text-secondary transition-colors text-xs"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading || cronLoading ? 'animate-spin' : ''} />
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

      {/* Always Running — real recurring agent jobs (OpenClaw / Hermes cron) */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0 bg-surface/50">
        <div className="flex items-center gap-1.5 text-text-muted shrink-0">
          <Zap size={12} className="text-accent-amber" />
          <span className="text-xs font-medium text-text-secondary">Always Running</span>
          {!cronLoading && cronJobs.length > 0 && (
            <span className="text-xxs text-text-muted tabular-nums">
              {cronJobs.filter(j => j.enabled).length}/{cronJobs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {cronLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[26px] w-32 rounded-full bg-card border border-border animate-pulse" />
            ))
          ) : cronJobs.length === 0 ? (
            <span className="text-xxs text-text-muted italic">No recurring agent jobs — connect OpenClaw or Hermes in Settings to schedule them.</span>
          ) : (
            cronJobs.map(job => (
              <CronPill key={`${job.source}:${job.id}`} job={job} busy={busyJob === job.id} onToggle={() => toggleJob(job)} />
            ))
          )}
        </div>
      </div>

      {/* Connect banner */}
      {needsAuth && <ConnectBanner />}

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
