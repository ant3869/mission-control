// Sub-view — rendered as the "Cron" tab inside Activity.tsx. Not mounted directly in App.tsx.
import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Clock, Play, Pause, Zap, RefreshCw, AlertCircle, CheckCircle2, XCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { agentCron, metrics, type AgentCronJob, type ConnectorId, type MetricCronRun } from '../lib/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAgo(iso: string | null): string {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function fmtNext(iso: string | null, label: string): string {
  if (!iso) return label || '—'
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  if (s < 0)     return 'overdue'
  if (s < 60)    return `in ${s}s`
  if (s < 3600)  return `in ${Math.round(s / 60)}m`
  if (s < 86400) return `in ${Math.round(s / 3600)}h`
  return `in ${Math.round(s / 86400)}d`
}

const SOURCE_BADGE: Record<ConnectorId, { label: string; cls: string }> = {
  openclaw: { label: 'OpenClaw', cls: 'bg-amber-950/40 border-amber-900/40 text-amber-300' },
  hermes:   { label: 'Hermes',   cls: 'bg-purple-950/40 border-purple-900/40 text-purple-300' },
}

// ─── Job row ──────────────────────────────────────────────────────────────────

function RunHistory({ runs, jobId }: { runs: MetricCronRun[]; jobId: string }) {
  const mine = runs.filter(r => r.jobId === jobId).slice(0, 8)
  if (mine.length === 0) return <p className="text-xxs text-text-muted px-3 pb-3">No recent runs recorded</p>
  return (
    <div className="px-3 pb-3 flex flex-col gap-1">
      <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1">Recent runs</p>
      {mine.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          {r.status === 'success' || r.status === 'ok'
            ? <CheckCircle2 size={11} className="text-green-400 shrink-0" />
            : r.status === 'error' || r.status === 'fail'
              ? <XCircle size={11} className="text-red-400 shrink-0" />
              : <Clock size={11} className="text-text-muted shrink-0" />}
          <span className="text-text-muted tabular-nums w-24 shrink-0">{fmtAgo(r.ts)}</span>
          <span className={clsx('text-xxs', r.status === 'success' || r.status === 'ok' ? 'text-green-400' : r.error ? 'text-red-400' : 'text-text-muted')}>
            {r.error || r.status}
          </span>
        </div>
      ))}
    </div>
  )
}

function JobRow({ job, runs, onAction }: {
  job: AgentCronJob
  runs: MetricCronRun[]
  onAction: (source: ConnectorId, id: string, action: 'pause' | 'resume' | 'trigger') => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy]         = useState<string | null>(null)
  const badge = SOURCE_BADGE[job.source]
  const rateColor = job.successRate >= 90 ? 'text-green-400' : job.successRate >= 70 ? 'text-amber-400' : 'text-red-400'

  async function act(action: 'pause' | 'resume' | 'trigger') {
    setBusy(action)
    try { await onAction(job.source, job.rawId, action) } finally { setBusy(null) }
  }

  return (
    <div className={clsx('border-b border-border last:border-0 transition-colors', expanded ? 'bg-card-hover' : 'hover:bg-card-hover/50')}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Expand toggle */}
        <button onClick={() => setExpanded(e => !e)} className="text-text-muted hover:text-text-secondary transition-colors shrink-0">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        {/* Enabled dot */}
        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', job.enabled ? 'bg-green-400' : 'bg-slate-600')} />

        {/* Name + source */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary truncate">{job.name}</span>
            <span className={clsx('px-1.5 py-0.5 rounded border text-xxs shrink-0', badge.cls)}>{badge.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xxs text-text-muted font-mono">{job.cronExpr || job.schedule}</span>
            {job.lastRunLabel && <span className="text-xxs text-text-muted">last {job.lastRunLabel}</span>}
            {job.nextRunLabel && <span className="text-xxs text-text-muted">next {fmtNext(job.nextRunAt, job.nextRunLabel)}</span>}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 shrink-0">
          {job.runCount > 0 && (
            <div className="text-right hidden sm:block">
              <p className={clsx('text-xs font-semibold tabular-nums', rateColor)}>{job.successRate}%</p>
              <p className="text-xxs text-text-muted">{job.runCount} runs</p>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => act(job.enabled ? 'pause' : 'resume')}
              disabled={busy !== null}
              title={job.enabled ? 'Pause' : 'Resume'}
              className={clsx(
                'p-1.5 rounded border text-xs transition-colors disabled:opacity-40',
                job.enabled
                  ? 'border-amber-900/40 bg-amber-950/20 text-amber-300 hover:bg-amber-950/40'
                  : 'border-green-900/40 bg-green-950/20 text-green-300 hover:bg-green-950/40'
              )}
            >
              {busy === 'pause' || busy === 'resume'
                ? <RefreshCw size={11} className="animate-spin" />
                : job.enabled ? <Pause size={11} /> : <Play size={11} />}
            </button>
            <button
              onClick={() => act('trigger')}
              disabled={busy !== null}
              title="Trigger now"
              className="p-1.5 rounded border border-blue-900/40 bg-blue-950/20 text-blue-300 hover:bg-blue-950/40 text-xs transition-colors disabled:opacity-40"
            >
              {busy === 'trigger' ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded: prompt preview + run history */}
      {expanded && (
        <div className="px-10 pb-3 space-y-2 border-t border-border/50">
          {job.prompt && (
            <div className="pt-3">
              <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1">Prompt</p>
              <p className="text-xs text-text-secondary leading-relaxed line-clamp-3 font-mono bg-base border border-border rounded px-3 py-2">
                {job.prompt}
              </p>
            </div>
          )}
          <RunHistory runs={runs} jobId={job.id} />
        </div>
      )}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

interface CronState {
  jobs: AgentCronJob[]
  runs: MetricCronRun[]
  fetchedAt: string
}

export function CronJobs() {
  const [data, setData]       = useState<CronState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [ocCron, hrCron, ocMet, hrMet] = await Promise.allSettled([
        agentCron.openclaw(),
        agentCron.hermes(),
        metrics.openclaw(),
        metrics.hermes(),
      ])

      const jobs: AgentCronJob[] = []
      if (ocCron.status === 'fulfilled') jobs.push(...ocCron.value.jobs)
      if (hrCron.status === 'fulfilled') jobs.push(...hrCron.value.jobs)

      const runs: MetricCronRun[] = []
      if (ocMet.status === 'fulfilled') runs.push(...(ocMet.value.metrics.cron.runs ?? []))
      if (hrMet.status === 'fulfilled') runs.push(...(hrMet.value.metrics.cron.runs ?? []))

      setData({ jobs, runs, fetchedAt: new Date().toISOString() })

      const errors = [ocCron, hrCron].filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason?.message ?? 'Unknown error')
      if (errors.length > 0 && jobs.length === 0) setError(errors.join(' · '))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load cron jobs')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(source: ConnectorId, jobId: string, action: 'pause' | 'resume' | 'trigger') {
    await agentCron.action(source, jobId, action)
    await load(true)
  }

  const totalJobs    = data?.jobs.length ?? 0
  const enabledJobs  = data?.jobs.filter(j => j.enabled).length ?? 0
  const ocJobs       = data?.jobs.filter(j => j.source === 'openclaw').length ?? 0
  const hrJobs       = data?.jobs.filter(j => j.source === 'hermes').length ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Clock size={15} className="text-text-muted" /> Scheduled Jobs
          </h1>
          {!loading && data && (
            <p className="text-xs text-text-muted mt-0.5">
              <span className="text-green-400">{enabledJobs} active</span>
              &nbsp;·&nbsp;{totalJobs} total
              {ocJobs > 0 && <>&nbsp;·&nbsp;<span className="text-amber-300">{ocJobs} OpenClaw</span></>}
              {hrJobs > 0 && <>&nbsp;·&nbsp;<span className="text-purple-300">{hrJobs} Hermes</span></>}
            </p>
          )}
        </div>
        <button onClick={() => load()} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 mx-6 mt-4 px-4 py-3 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300 shrink-0">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <p className="text-xs leading-snug">{error}</p>
        </div>
      )}

      {/* Job list */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-card border border-border animate-pulse" />
            ))}
          </div>
        ) : !data || data.jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <Clock size={20} className="text-text-muted" />
            <p className="text-sm text-text-muted">No scheduled jobs found</p>
            <p className="text-xs text-text-muted opacity-60">Jobs appear when OpenClaw or Hermes are connected with cron configured</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {data.jobs.map(job => (
              <JobRow key={`${job.source}:${job.id}`} job={job} runs={data.runs} onAction={handleAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
