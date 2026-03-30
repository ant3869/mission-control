import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Play, Clock, CheckCircle2, XCircle, Loader, Circle,
  ToggleLeft, ToggleRight, Timer, RefreshCw, AlertCircle,
  CalendarClock, ChevronRight, Cpu
} from 'lucide-react'
import { pipeline as pipelineApi, type PipelineRun, type PipelineStage, type ScheduledTask, type StageStatus, type RunStatus } from '../lib/api'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtSec(s: number): string {
  if (!s || s < 0) return '0s'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r > 0 ? `${m}m ${r}s` : `${m}m`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000)      return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function shortSlug(slug: string): string {
  return slug.replace(/^-+/, '').split('-').filter(Boolean).slice(-2).join('/')
}

// ─── Stage icon ───────────────────────────────────────────────────────────────

const STAGE_ICON: Record<StageStatus, React.ReactNode> = {
  completed: <CheckCircle2 size={11} className="text-green-400" />,
  running:   <Loader       size={11} className="text-blue-400 animate-spin" />,
  failed:    <XCircle      size={11} className="text-red-400" />,
  pending:   <Circle       size={11} className="text-text-muted" />,
  skipped:   <Circle       size={11} className="text-text-muted opacity-30" />,
}

// ─── Run status config ────────────────────────────────────────────────────────

const RUN_CFG: Record<RunStatus, { label: string; dot: string; badge: string }> = {
  running:   { label: 'Running',   dot: 'bg-blue-400 animate-pulse', badge: 'bg-blue-950/50 border-blue-900/50 text-blue-400'  },
  queued:    { label: 'Queued',    dot: 'bg-text-muted',             badge: 'bg-card border-border text-text-muted'             },
  completed: { label: 'Done',      dot: 'bg-green-400',              badge: 'bg-green-950/50 border-green-900/50 text-green-400'},
  failed:    { label: 'Failed',    dot: 'bg-red-400',                badge: 'bg-red-950/50 border-red-900/50 text-red-400'     },
}

// ─── Stage color ──────────────────────────────────────────────────────────────

const PHASE_COLOR: Record<string, string> = {
  Initialize:  'text-slate-400',
  Analyze:     'text-indigo-300',
  Execute:     'text-green-300',
  Code:        'text-emerald-300',
  Search:      'text-teal-300',
  Orchestrate: 'text-violet-300',
  Plan:        'text-amber-300',
  Compose:     'text-blue-300',
  Integrate:   'text-cyan-300',
  Complete:    'text-green-400',
}

// ─── Run card ─────────────────────────────────────────────────────────────────

function RunCard({ run }: { run: PipelineRun }) {
  const cfg = RUN_CFG[run.status]
  const completed = run.stages.filter(s => s.status === 'completed').length
  const pct = run.stages.length > 0 ? Math.round((completed / run.stages.length) * 100) : 0

  return (
    <div className="flex flex-col bg-card border border-border rounded-lg p-4 gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <Cpu size={13} className="text-text-muted mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-primary truncate leading-tight">{run.name}</p>
            <p className="text-xxs text-text-muted mt-0.5">{shortSlug(run.projectSlug)}</p>
          </div>
        </div>
        <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold shrink-0', cfg.badge)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', cfg.dot)} />
          {cfg.label}
        </span>
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between text-xxs text-text-muted mb-1">
          <span>{completed}/{run.stages.length} stages</span>
          {run.elapsedLabel && (
            <span className="flex items-center gap-1"><Timer size={9} />{run.elapsedLabel}</span>
          )}
        </div>
        <div className="h-1 bg-border rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', run.status === 'failed' ? 'bg-red-500' : run.status === 'running' ? 'bg-blue-500' : 'bg-green-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stage list */}
      <div className="flex flex-col gap-1">
        {run.stages.map((stage, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="shrink-0">{STAGE_ICON[stage.status]}</span>
            <span className={clsx('text-xxs flex-1 truncate',
              PHASE_COLOR[stage.name] ?? (
                stage.status === 'running'   ? 'text-blue-300'     :
                stage.status === 'completed' ? 'text-text-secondary' :
                stage.status === 'failed'    ? 'text-red-300'      :
                'text-text-muted'
              )
            )}>
              {stage.name}
              {stage.toolCount && stage.toolCount > 1 ? <span className="opacity-50 ml-1">×{stage.toolCount}</span> : null}
            </span>
            {stage.durationSec !== undefined && stage.durationSec > 0 && (
              <span className="text-xxs text-text-muted tabular-nums shrink-0">{fmtSec(stage.durationSec)}</span>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      {run.totalTokens > 0 && (
        <p className="text-xxs text-text-muted border-t border-border-subtle pt-2">
          {fmtTokens(run.totalTokens)} tokens · {run.model.includes('opus') ? 'Opus' : run.model.includes('haiku') ? 'Haiku' : 'Sonnet'}
        </p>
      )}
    </div>
  )
}

// ─── History row ──────────────────────────────────────────────────────────────

function HistoryRow({ run }: { run: PipelineRun }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-card hover:bg-card-hover transition-colors">
      <span className="shrink-0">
        {run.status === 'completed'
          ? <CheckCircle2 size={13} className="text-green-400" />
          : <XCircle      size={13} className="text-red-400" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-text-primary truncate">{run.name}</p>
        <p className="text-xxs text-text-muted">{shortSlug(run.projectSlug)} · {run.completedAgo}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xxs text-text-secondary tabular-nums">{run.elapsedLabel || '—'}</p>
        {run.totalTokens > 0 && (
          <p className="text-xxs text-text-muted tabular-nums">{fmtTokens(run.totalTokens)} tok</p>
        )}
      </div>
    </div>
  )
}

// ─── Scheduled task row ───────────────────────────────────────────────────────

function ScheduledRow({ task }: { task: ScheduledTask }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-card hover:bg-card-hover transition-colors">
      <span className="text-text-muted shrink-0">
        {task.enabled
          ? <ToggleRight size={14} className="text-green-400" />
          : <ToggleLeft  size={14} className="text-text-muted" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className={clsx('text-xs font-medium truncate', task.enabled ? 'text-text-primary' : 'text-text-muted')}>
          {task.description}
        </p>
        <p className="text-xxs text-text-muted">{task.schedule || task.cronExpr}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xxs text-text-secondary">{task.nextRunLabel || '—'}</p>
        <p className="text-xxs text-text-muted">last: {task.lastRunLabel}</p>
      </div>
    </div>
  )
}

// ─── Empty scheduled tasks CTA ────────────────────────────────────────────────

function ScheduledEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
      <CalendarClock size={16} className="text-text-muted" />
      <p className="text-xs text-text-muted">No scheduled tasks</p>
      <p className="text-xxs text-text-muted opacity-60 max-w-[200px]">
        Use the schedule skill to create recurring tasks
      </p>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function Pipeline() {
  const [active,    setActive]    = useState<PipelineRun[]>([])
  const [history,   setHistory]   = useState<PipelineRun[]>([])
  const [scheduled, setScheduled] = useState<ScheduledTask[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState('')
  const [cronFilter, setCronFilter] = useState<'all' | 'active' | 'paused'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [runs, sched] = await Promise.all([
        pipelineApi.runs(),
        pipelineApi.scheduled(),
      ])
      setActive(runs.active)
      setHistory(runs.history)
      setScheduled(sched.tasks)
      setFetchedAt(runs.fetchedAt)
      if (runs.error) setError(runs.error)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const runningCount  = active.filter(r => r.status === 'running').length
  const totalRuns     = history.length
  const failedRuns    = history.filter(r => r.status === 'failed').length
  const successRate   = totalRuns > 0 ? Math.round(((totalRuns - failedRuns) / totalRuns) * 100) : 100

  const filteredSched = scheduled.filter(j =>
    cronFilter === 'all' ? true : cronFilter === 'active' ? j.enabled : !j.enabled
  )

  const fetchedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Pipeline</h1>
          {!loading && (
            <p className="text-xs text-text-muted mt-0.5">
              <span className="text-blue-400">{runningCount} running</span>
              &nbsp;·&nbsp;<span className="text-text-secondary">{active.length} active</span>
              &nbsp;·&nbsp;<span className="text-text-secondary">{scheduled.length} scheduled</span>
              &nbsp;·&nbsp;<span className="text-green-400">{successRate}% success</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {fetchedLabel && <span className="text-xxs text-text-muted">as of {fetchedLabel}</span>}
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 mx-6 mt-3 px-4 py-2.5 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          <p className="text-xs">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Active runs */}
        <div className="px-6 py-4 border-b border-border">
          <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
            <Play size={10} /> Active Runs
            <span className="ml-1 px-1.5 py-0.5 rounded bg-card border border-border text-text-muted font-normal normal-case tracking-normal">
              {active.length}
            </span>
          </p>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-[180px] rounded-lg bg-card border border-border animate-pulse" />)}
            </div>
          ) : active.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Play size={16} className="text-text-muted" />
              <p className="text-xs text-text-muted">No active runs in the last 2 hours</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {active.map(run => <RunCard key={run.id} run={run} />)}
            </div>
          )}
        </div>

        {/* Bottom: scheduled + history */}
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
          {/* Scheduled tasks */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <Clock size={10} /> Scheduled
              </p>
              <div className="flex items-center gap-1 bg-card rounded border border-border p-0.5">
                {(['all', 'active', 'paused'] as const).map(f => (
                  <button key={f} onClick={() => setCronFilter(f)}
                    className={clsx('px-2 py-0.5 rounded text-xxs capitalize transition-all',
                      cronFilter === f ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {filteredSched.length === 0 ? (
              <ScheduledEmpty />
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
                {filteredSched.map(task => <ScheduledRow key={task.taskId} task={task} />)}
              </div>
            )}
          </div>

          {/* Run history */}
          <div className="px-6 py-4">
            <p className="text-xxs font-semibold uppercase tracking-wider text-text-muted mb-3 flex items-center gap-1.5">
              <CheckCircle2 size={10} /> Recent History
              <span className="ml-1 px-1.5 py-0.5 rounded bg-card border border-border text-text-muted font-normal normal-case tracking-normal">
                {history.length}
              </span>
            </p>
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <CheckCircle2 size={16} className="text-text-muted" />
                <p className="text-xs text-text-muted">No sessions in the last 48h</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
                {history.map(run => <HistoryRow key={run.id} run={run} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
