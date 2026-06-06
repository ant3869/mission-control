// title: Task work-queues — grouped by coverage / failed / rerun / decisive
// path: src/components/evaluations/TaskQueues.tsx
// purpose: Replace the per-platform benchmark task catalogs with a single
//          actionable surface. Each task lands in exactly one bucket so the
//          user reads the queue and knows what to dispatch next, instead of
//          scanning two parallel tables.

import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { Beaker, Play, Loader2, AlertCircle, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { evaluations, ApiError, type BenchmarkTask, type BenchmarkRun } from '../../lib/api'
import { buildComparisonMatrix, groupTasksByStatus, type QueueEntry, type QueueBucket } from './synthesis'
import { fmtTimeAgo, fmtDuration, scoreBg, scoreColor, ErrorBanner } from './shared'

interface Props {
  tasks: BenchmarkTask[]
  runs:  BenchmarkRun[]
  onChanged: () => void
}

const BUCKET_META: Record<QueueBucket, { title: string; hint: string; tone: string }> = {
  needsCoverage: { title: 'Needs coverage',  hint: 'No graded run yet — dispatch any model.',                      tone: 'border-amber-500/30 bg-amber-500/[0.06]' },
  failed:        { title: 'Failed',          hint: 'Best graded score ≤ 40 — open the run to see why.',            tone: 'border-red-500/30 bg-red-500/[0.06]' },
  needsRerun:    { title: 'Needs rerun',     hint: 'Only one graded score or top score < 70 — confirm or improve.', tone: 'border-violet-500/30 bg-violet-500/[0.06]' },
  decisive:      { title: 'Decisive',        hint: '≥ 10 pt spread across models or top score ≥ 80 — settled for now.', tone: 'border-emerald-500/30 bg-emerald-500/[0.06]' },
  ungradeable:   { title: 'Needs grader',    hint: 'Runs completed but no rubric score — add a grader or rubric.', tone: 'border-white/15 bg-white/[0.02]' },
}

const BUCKET_ORDER: QueueBucket[] = ['needsCoverage', 'failed', 'needsRerun', 'ungradeable', 'decisive']

export function TaskQueues({ tasks, runs, onChanged }: Props) {
  const { rows } = useMemo(() => buildComparisonMatrix({ tasks, runs }), [tasks, runs])
  const queues = useMemo(() => groupTasksByStatus(rows), [rows])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy]   = useState<string | null>(null)

  const dispatchOn = async (entry: QueueEntry, model: string, agent: string) => {
    setBusy(entry.row.task.id); setError(null)
    try {
      await evaluations.runBenchmark({ taskId: entry.row.task.id, platform: entry.row.task.platform, model: model || undefined, agent: agent || undefined })
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'dispatch failed')
    } finally { setBusy(null) }
  }

  const remove = async (entry: QueueEntry) => {
    if (!confirm(`Delete "${entry.row.task.title}" and all its runs?`)) return
    try { await evaluations.deleteTask(entry.row.task.id); onChanged() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'delete failed') }
  }

  const totalEntries = BUCKET_ORDER.reduce((n, b) => n + queues[b].length, 0)

  return (
    <div className="space-y-3">
      {error && <ErrorBanner message={error} />}
      {totalEntries === 0 && (
        <div className="bg-bg-secondary border border-white/10 rounded-xl p-4 text-xs text-text-muted">
          No benchmark tasks defined yet. Create one above — built-ins ship with auto-graders.
        </div>
      )}
      {BUCKET_ORDER.map(bucket => {
        const list = queues[bucket]
        if (list.length === 0) return null
        const meta = BUCKET_META[bucket]
        return (
          <div key={bucket} className={clsx('rounded-xl border', meta.tone)}>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
              <Beaker size={12} className="text-violet-300" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-primary">{meta.title}</h4>
              <span className="text-[10px] text-text-muted">{meta.hint}</span>
              <span className="ml-auto text-[10px] text-text-muted">{list.length}</span>
            </div>
            <div className="divide-y divide-white/5">
              {list.map(entry => (
                <QueueRow key={entry.row.task.id} entry={entry}
                  busy={busy === entry.row.task.id}
                  onDispatch={(m, a) => dispatchOn(entry, m, a)}
                  onDelete={() => remove(entry)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function QueueRow({ entry, busy, onDispatch, onDelete }: {
  entry: QueueEntry; busy: boolean
  onDispatch: (model: string, agent: string) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [model, setModel] = useState('')
  const [agent, setAgent] = useState(entry.row.task.agent ?? '')
  const r = entry.row
  const t = r.task

  return (
    <div>
      <button type="button" onClick={() => setExpanded(v => !v)} className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-white/[0.04]">
        {expanded ? <ChevronDown size={11} className="text-text-muted" /> : <ChevronRight size={11} className="text-text-muted" />}
        <span className="text-xs text-text-primary truncate flex-1 min-w-0" title={t.title}>{t.title}</span>
        {t.builtIn && <span className="text-[9px] uppercase px-1 py-px rounded bg-violet-500/15 text-violet-200">auto</span>}
        {r.aliasTaskIds.length > 0 && <span className="text-[9px] uppercase px-1 py-px rounded bg-white/10 text-text-muted" title="Same task installed on both platforms — merged">merged</span>}
        {entry.bestScore != null && (
          <span className={clsx('inline-flex items-center justify-center min-w-[34px] px-1 py-0.5 rounded text-[10px] font-semibold tabular-nums', scoreBg(entry.bestScore), scoreColor(entry.bestScore))}>
            {Math.round(entry.bestScore)}
          </span>
        )}
        <span className="text-[10px] text-text-muted tabular-nums w-16 text-right">
          {entry.modelsRan}/{r.coverage.modelsTotal} models
        </span>
        <span className="text-[10px] text-text-muted tabular-nums w-12 text-right">n={entry.totalRuns}</span>
        <span className="text-[10px] text-text-muted w-16 text-right">{fmtTimeAgo(entry.lastTouchedAt)}</span>
      </button>
      {expanded && (
        <div className="px-4 py-2 bg-black/20 space-y-2 text-[11px]">
          <p className="text-text-secondary line-clamp-2" title={t.prompt}>{t.prompt}</p>
          {t.rubric && <p className="italic text-text-muted">Rubric: {t.rubric}</p>}
          <div className="flex flex-wrap gap-1.5">
            {[...r.cells.values()].filter(c => c.runCount > 0).map(c => (
              <span key={c.model} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-white/5 bg-white/[0.02]">
                <span className="font-mono text-text-secondary truncate max-w-[160px]">{c.model}</span>
                {c.latestScore != null
                  ? <span className={clsx('font-semibold tabular-nums', scoreColor(c.latestScore))}>{c.latestScore}</span>
                  : <span className="text-text-muted">ungraded</span>}
                <span className="text-text-muted">{c.latestOutcome ?? c.latestStatus ?? '—'}</span>
                <span className="text-text-muted">n={c.runCount}</span>
                {c.durationMs != null && c.durationMs > 0 && <span className="text-text-muted">{fmtDuration(c.durationMs)}</span>}
                <span className="text-text-muted/70">{fmtTimeAgo(c.latestTs)}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="model (optional override)"
              className="bg-bg-primary border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary w-44 font-mono" />
            <input value={agent} onChange={e => setAgent(e.target.value)} placeholder="agent (optional)"
              className="bg-bg-primary border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary w-36 font-mono" />
            <button onClick={() => onDispatch(model, agent)} disabled={busy}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 rounded disabled:opacity-40">
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              {busy ? 'Dispatching…' : 'Run on live agent'}
            </button>
            {!t.builtIn && (
              <button onClick={onDelete} className="ml-auto text-text-muted hover:text-red-300" title="Delete custom task">
                <Trash2 size={12} />
              </button>
            )}
            {entry.row.ungradeable && (
              <span className="ml-auto text-[10px] text-amber-300 inline-flex items-center gap-1">
                <AlertCircle size={11} /> no auto-grader — score will stay blank until you add one
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
