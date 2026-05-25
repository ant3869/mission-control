// Gantt-style execution timeline for pipeline runs (Trigger.dev-inspired).
// One horizontal row per run; segments show queue → stage / wait / retry / failure.
// Dependency-free (Tailwind + lucide). Shares its scale across all visible runs
// so run lifecycles are directly comparable.

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Clock, Timer, RotateCcw, GitBranch, ChevronRight, Filter, Cpu,
} from 'lucide-react'
import type { PipelineRun, PipelineSegment, RunStatus } from '../../lib/api'

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDur(ms: number): string {
  if (!ms || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function shortSlug(slug: string): string {
  return slug.replace(/^-+/, '').split('-').filter(Boolean).slice(-2).join('/')
}

function shortModel(m: string): string {
  if (m.includes('opus')) return 'Opus'
  if (m.includes('haiku')) return 'Haiku'
  if (m.includes('sonnet')) return 'Sonnet'
  return m || '—'
}

// ─── Scale ──────────────────────────────────────────────────────────────────────

function niceTicks(maxMs: number): number[] {
  if (maxMs <= 0) return [0]
  const raw = maxMs / 6
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const ticks: number[] = []
  for (let t = 0; t <= maxMs + step * 0.5; t += step) ticks.push(t)
  return ticks
}

// ─── Segment styling ──────────────────────────────────────────────────────────

function segBar(seg: PipelineSegment): string {
  switch (seg.kind) {
    case 'queue':  return 'bg-slate-600'
    case 'wait':   return 'bg-violet-500/50'
    case 'retry':  return 'bg-amber-500'
    case 'failed': return 'bg-red-500'
    case 'stage':
    default:
      return seg.status === 'running' ? 'bg-blue-500 animate-pulse'
           : seg.status === 'failed'  ? 'bg-red-500'
           : 'bg-emerald-500'
  }
}

const LEGEND: Array<{ label: string; cls: string }> = [
  { label: 'Queued',    cls: 'bg-slate-600' },
  { label: 'Running',   cls: 'bg-blue-500' },
  { label: 'Completed', cls: 'bg-emerald-500' },
  { label: 'Retry',     cls: 'bg-amber-500' },
  { label: 'Waiting',   cls: 'bg-violet-500/50' },
  { label: 'Failed',    cls: 'bg-red-500' },
]

const RUN_DOT: Record<RunStatus, string> = {
  running:   'bg-blue-400 animate-pulse',
  queued:    'bg-text-muted',
  completed: 'bg-green-400',
  failed:    'bg-red-400',
}

// Left label column width — kept in sync between scale header and rows.
const LABEL_COL = 'w-52 min-w-[13rem] shrink-0'

// ─── Time scale header ──────────────────────────────────────────────────────────

function TimeScale({ ticks, maxMs }: { ticks: number[]; maxMs: number }) {
  return (
    <div className="flex items-stretch sticky top-0 z-10 bg-surface border-b border-border">
      <div className={clsx(LABEL_COL, 'px-3 py-1.5 text-xxs uppercase tracking-wider text-text-muted')}>Run</div>
      <div className="relative flex-1 h-7">
        {ticks.map((t, i) => {
          const left = maxMs > 0 ? (t / maxMs) * 100 : 0
          return (
            <div key={i} className="absolute top-0 bottom-0" style={{ left: `${left}%` }}>
              <div className="absolute top-0 bottom-0 w-px bg-border-subtle" />
              <span className={clsx('absolute top-1.5 text-xxs tabular-nums text-text-muted px-1',
                i === ticks.length - 1 ? '-translate-x-full' : '')}>
                {fmtDur(t)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Run row ────────────────────────────────────────────────────────────────────

function TimelineRow({ run, maxMs, ticks, open, onToggle, onOpenTrace }: {
  run: PipelineRun
  maxMs: number
  ticks: number[]
  open: boolean
  onToggle: () => void
  onOpenTrace: () => void
}) {
  return (
    <div className={clsx('border-b border-border-subtle', open && 'bg-card/40')}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        className="group flex items-stretch cursor-pointer hover:bg-card-hover/60 transition-colors"
      >
        {/* Label */}
        <div className={clsx(LABEL_COL, 'flex items-center gap-1.5 px-2 py-2')}>
          <ChevronRight size={12} className={clsx('shrink-0 text-text-muted transition-transform', open && 'rotate-90')} />
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', RUN_DOT[run.status])} />
          <div className="min-w-0">
            <p className="text-xs text-text-secondary group-hover:text-text-primary truncate leading-tight">{run.name}</p>
            <p className="text-xxs text-text-muted truncate">
              {shortSlug(run.projectSlug)} · {shortModel(run.model)}
              {run.retries > 0 && <span className="text-amber-300"> · ↺{run.retries}</span>}
            </p>
          </div>
        </div>

        {/* Track */}
        <div className="relative flex-1 my-1.5 mr-3 h-6">
          {/* gridlines */}
          {ticks.map((t, i) => (
            <div key={i} className="absolute top-0 bottom-0 w-px bg-border-subtle/40"
              style={{ left: `${maxMs > 0 ? (t / maxMs) * 100 : 0}%` }} />
          ))}
          {run.timeline.map((seg, i) => {
            const left  = maxMs > 0 ? (seg.startMs / maxMs) * 100 : 0
            const width = maxMs > 0 ? Math.max((seg.durationMs / maxMs) * 100, 0.4) : 0
            return (
              <div
                key={i}
                title={`${seg.label} · ${fmtDur(seg.durationMs)}`}
                className={clsx('absolute top-0.5 bottom-0.5 rounded-sm', segBar(seg),
                  seg.kind === 'retry' && 'ring-1 ring-amber-300/40')}
                style={{ left: `${left}%`, width: `${width}%`, minWidth: 2 }}
              />
            )
          })}
          {/* total duration label, trailing the bars */}
          <span
            className="absolute top-1/2 -translate-y-1/2 text-xxs tabular-nums text-text-muted whitespace-nowrap pl-1"
            style={{ left: `min(${maxMs > 0 ? (run.totalMs / maxMs) * 100 : 0}%, calc(100% - 40px))` }}
          >
            {fmtDur(run.totalMs)}
          </span>
        </div>
      </div>

      {open && <RowDetail run={run} onOpenTrace={onOpenTrace} />}
    </div>
  )
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function RowDetail({ run, onOpenTrace }: { run: PipelineRun; onOpenTrace: () => void }) {
  return (
    <div className="ml-6 mr-3 mb-2 rounded-lg border border-border bg-base/60 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-xxs text-text-muted">
        <span className="flex items-center gap-1"><Clock size={10} /> queue <span className="text-text-secondary tabular-nums">{fmtDur(run.queueMs)}</span></span>
        <span className="flex items-center gap-1"><Timer size={10} /> total <span className="text-text-secondary tabular-nums">{fmtDur(run.totalMs)}</span></span>
        <span className="flex items-center gap-1"><RotateCcw size={10} /> retries <span className="text-text-secondary tabular-nums">{run.retries}</span></span>
        <span>waiting <span className="text-text-secondary tabular-nums">{fmtDur(run.waitMs)}</span></span>
        {run.totalTokens > 0 && <span>tokens <span className="text-amber-300 tabular-nums">{fmtTokens(run.totalTokens)}</span></span>}
        <button
          onClick={(e) => { e.stopPropagation(); onOpenTrace() }}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-emerald-300 transition-colors"
        >
          <GitBranch size={10} /> Open trace
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {run.timeline.map((seg, i) => (
          <div key={i} className="flex items-center gap-2 text-xxs">
            <span className={clsx('w-2 h-2 rounded-sm shrink-0', segBar(seg))} />
            <span className="text-text-secondary truncate flex-1">
              {seg.label}
              {seg.kind === 'retry' && <span className="text-amber-300"> (attempt {seg.attempt})</span>}
            </span>
            <span className="text-text-muted tabular-nums shrink-0">+{fmtDur(seg.startMs)}</span>
            <span className="text-text-secondary tabular-nums shrink-0 w-14 text-right">{fmtDur(seg.durationMs)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Legend ─────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
      {LEGEND.map(l => (
        <span key={l.label} className="flex items-center gap-1.5 text-xxs text-text-muted">
          <span className={clsx('w-3 h-2 rounded-sm', l.cls)} />{l.label}
        </span>
      ))}
    </div>
  )
}

// ─── Filters ──────────────────────────────────────────────────────────────────

const STATUS_OPTS: Array<'all' | RunStatus> = ['all', 'running', 'completed', 'failed', 'queued']

function Select({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-card border border-border rounded text-xxs text-text-secondary px-2 py-1 hover:border-border focus:outline-none focus:border-emerald-700/50"
    >
      <option value="all">{label}: all</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function PipelineTimeline({ runs, onOpenTrace }: {
  runs: PipelineRun[]
  onOpenTrace: (run: PipelineRun) => void
}) {
  const [status, setStatus]   = useState<'all' | RunStatus>('all')
  const [project, setProject] = useState('all')
  const [model, setModel]     = useState('all')
  const [open, setOpen]       = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const projectOpts = useMemo(
    () => Array.from(new Set(runs.map(r => shortSlug(r.projectSlug)))).sort(),
    [runs],
  )
  const modelOpts = useMemo(
    () => Array.from(new Set(runs.map(r => shortModel(r.model)))).sort(),
    [runs],
  )
  const statusPresent = useMemo(() => new Set(runs.map(r => r.status)), [runs])

  const filtered = useMemo(() => runs.filter(r =>
    (status  === 'all' || r.status === status) &&
    (project === 'all' || shortSlug(r.projectSlug) === project) &&
    (model   === 'all' || shortModel(r.model) === model),
  ), [runs, status, project, model])

  // Shared scale: longest visible run, rounded up to the next tick.
  const { maxMs, ticks } = useMemo(() => {
    const longest = filtered.reduce((m, r) => Math.max(m, r.totalMs), 0) || 1
    const t = niceTicks(longest)
    return { maxMs: t[t.length - 1] || longest, ticks: t }
  }, [filtered])

  return (
    <div className="flex flex-col border border-border rounded-lg bg-surface overflow-hidden">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
        <span className="flex items-center gap-1 text-xxs uppercase tracking-wider text-text-muted">
          <Filter size={10} /> Filter
        </span>
        <div className="flex items-center gap-1 bg-card rounded border border-border p-0.5">
          {STATUS_OPTS.filter(s => s === 'all' || statusPresent.has(s as RunStatus)).map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={clsx('px-2 py-0.5 rounded text-xxs capitalize transition-all',
                status === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {s}
            </button>
          ))}
        </div>
        <Select value={project} onChange={setProject} options={projectOpts} label="project" />
        <Select value={model} onChange={setModel} options={modelOpts} label="model" />
        <span className="ml-auto text-xxs text-text-muted tabular-nums">
          {filtered.length} of {runs.length} runs
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Cpu size={16} className="text-text-muted" />
          <p className="text-xs text-text-muted">No runs match the current filters</p>
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <TimeScale ticks={ticks} maxMs={maxMs} />
          {filtered.map(run => (
            <TimelineRow
              key={run.id}
              run={run}
              maxMs={maxMs}
              ticks={ticks}
              open={open.has(run.id)}
              onToggle={() => toggle(run.id)}
              onOpenTrace={() => onOpenTrace(run)}
            />
          ))}
        </div>
      )}

      <div className="border-t border-border">
        <Legend />
      </div>
    </div>
  )
}
