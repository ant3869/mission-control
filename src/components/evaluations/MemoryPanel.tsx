// title: Memory benchmarking panel (per-platform)
// path: src/components/evaluations/MemoryPanel.tsx
// purpose: Surface the Memory Benchmarking subsystem for one platform —
//          providers detected, leaderboards by model/provider/agent, provider
//          comparison, tasks, recent runs, drilldown into hits & agent answer.

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  Brain, Plus, Play, RefreshCw, Trash2, ChevronDown, ChevronRight, Database, Loader2, AlertCircle,
} from 'lucide-react'
import {
  memoryEvaluations, ApiError,
  type EvalPlatform, type MemoryOverview, type MemoryProviderInfo, type MemoryBenchmarkTask,
  type MemoryBenchmarkRun, type MemoryScorecard, type MemoryKind, type ProviderComparison,
} from '../../lib/api'
import {
  fmtTimeAgo, fmtDuration, EmptyState, ErrorBanner, NotConnected, PlatformBadge,
  scoreColor, scoreBg, HeuristicTag,
} from './shared'

interface Props {
  platform: EvalPlatform
  /** Hide the internal toolbar (title + Refresh + New). The parent supplies
   *  one unified toolbar across both platform panels. */
  compact?: boolean
  /** Increment to force a reload from outside (parent Refresh button). */
  refreshSignal?: number
}

export function MemoryPanel({ platform, compact, refreshSignal }: Props) {
  const [overview, setOverview] = useState<MemoryOverview | null>(null)
  const [tasks, setTasks]       = useState<MemoryBenchmarkTask[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showNew, setShowNew]   = useState(false)
  const [openTask, setOpenTask] = useState<string | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [ov, t] = await Promise.all([
        memoryEvaluations.overview(platform),
        memoryEvaluations.tasks(platform),
      ])
      setOverview(ov); setTasks(t.tasks)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load memory benchmarks')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [platform, refreshSignal])

  // Poll while any run is in flight.
  useEffect(() => {
    const inflight = (overview?.recentRuns ?? []).some(r => r.status === 'running')
    if (!inflight) {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
      return
    }
    if (pollTimer.current) return
    pollTimer.current = setInterval(() => { load() }, 8000)
    return () => { if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.recentRuns])

  if (error && !overview) return <ErrorBanner message={error} />
  if (!overview) return <div className="text-xs text-text-muted">Loading {platform} memory benchmarks…</div>
  if (!overview.reachable) {
    return (
      <>
        {error && <ErrorBanner message={error} />}
        <NotConnected platform={platform} />
      </>
    )
  }

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex items-center gap-3 flex-wrap">
          <Brain size={14} className="text-violet-400" />
          <h3 className="text-sm font-semibold text-text-primary">Memory Benchmarks</h3>
          <PlatformBadge platform={platform} />
          <HeuristicTag tip="Retrieval correctness is measured by case-insensitive substring matches of declared expectedFacts inside provider results. Honest but heuristic — see Methodology." />
          <span className="text-[10px] text-text-muted">
            {overview.providers.length} provider{overview.providers.length === 1 ? '' : 's'} · {overview.summary.runCount} run{overview.summary.runCount === 1 ? '' : 's'}
          </span>
          <button onClick={() => setShowNew(v => !v)}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/30 rounded">
            <Plus size={12} /> New memory task
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded">
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      )}

      {/* Per-panel compact header — just the platform badge + counts. The
          parent toolbar handles refresh + new-task in compact mode. */}
      {compact && (
        <div className="flex items-center gap-2 text-[11px]">
          <PlatformBadge platform={platform} />
          <span className="text-text-muted">
            {overview.providers.length} provider{overview.providers.length === 1 ? '' : 's'} · {overview.summary.runCount} run{overview.summary.runCount === 1 ? '' : 's'}
          </span>
          {loading && <RefreshCw size={11} className="text-text-muted animate-spin" />}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <ProvidersStrip providers={overview.providers} />

      {showNew && !compact && (
        <NewMemoryTaskForm
          platform={platform}
          providers={overview.providers}
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load() }}
        />
      )}

      <SummaryStrip overview={overview} />

      {overview.providerLeaderboard.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ScorecardTable title="By model" cards={overview.modelLeaderboard} />
          <ScorecardTable title="By memory provider" cards={overview.providerLeaderboard} />
        </div>
      )}

      {overview.providerComparison.length > 0 && (
        <ProviderComparisonTable rows={overview.providerComparison} />
      )}

      {/* Tasks */}
      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="bg-bg-secondary border border-white/10 rounded-xl">
            <EmptyState
              icon={<Brain size={28} />}
              title="No memory benchmark tasks yet"
              hint="Create a task with expectedFacts (strings that SHOULD be retrievable) and forbiddenFacts (stale / negative-control strings). Run it to probe providers + (optionally) the live agent."
            />
          </div>
        ) : tasks.map(t => (
          <MemoryTaskCard
            key={t.id} task={t}
            runs={overview.recentRuns.filter(r => r.taskId === t.id)}
            providers={overview.providers}
            expanded={openTask === t.id}
            onToggle={() => setOpenTask(openTask === t.id ? null : t.id)}
            onReload={load}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Providers strip ──────────────────────────────────────────────────────────

function ProvidersStrip({ providers }: { providers: MemoryProviderInfo[] }) {
  if (providers.length === 0) {
    return (
      <div className="bg-bg-secondary border border-white/10 rounded-xl p-4">
        <p className="text-xs text-text-muted">
          <span className="text-amber-300">No memory providers detected.</span> Providers are derived from real platform state — workspace memory files or session history must exist. External providers (Mem0, vector DB, Obsidian, etc.) appear here once a real integration is wired.
        </p>
      </div>
    )
  }
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <Database size={12} className="text-violet-400" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Detected providers</h4>
        <HeuristicTag tip="Detected at runtime from live platform state. No placeholders are listed." />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {providers.map(p => (
          <div key={p.name} className="flex items-start gap-2 p-2 bg-white/[0.02] rounded border border-white/5">
            <span className={clsx('mt-1 w-2 h-2 rounded-full flex-shrink-0', p.baseline ? 'bg-emerald-400' : 'bg-cyan-400')} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-text-primary font-medium truncate">{p.label}</span>
                <span className="text-[9px] px-1 py-px rounded bg-white/5 text-text-muted uppercase tracking-wider">
                  {p.baseline ? 'baseline' : 'external'}
                </span>
                <span className="text-[9px] px-1 py-px rounded bg-white/5 text-text-muted font-mono">{p.type}</span>
              </div>
              <p className="text-[10px] text-text-muted leading-snug mt-0.5">{p.notes}</p>
              {p.itemCount != null && <p className="text-[10px] text-text-muted">{p.itemCount} item{p.itemCount === 1 ? '' : 's'} indexed</p>}
              <p className="text-[10px] font-mono text-text-muted/70 truncate">{p.name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function SummaryStrip({ overview }: { overview: MemoryOverview }) {
  const s = overview.summary
  // Hide the "unknown" model bucket here — runs from pure-retrieval tasks have
  // no model attribution, so claiming a "best model" of "unknown" is misleading.
  const bestModelLabel = s.bestModel
    ? (s.bestModel.scope === 'unknown' || !s.bestModel.scope.trim() ? '(retrieval only)' : s.bestModel.scope)
    : '—'
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Stat label="Runs" value={String(s.runCount)} />
      <Stat label="Composite" value={s.avgComposite != null ? String(s.avgComposite) : '—'} color={scoreColor(s.avgComposite)} />
      <Stat label="Retrieval" value={s.avgRetrieval != null ? `${s.avgRetrieval}%` : '—'} color={scoreColor(s.avgRetrieval)} />
      <Stat label="Usage" value={s.avgUsage != null ? `${s.avgUsage}%` : '—'} color={scoreColor(s.avgUsage)} />
      <Stat label="False recall" value={s.avgFalseRecall != null ? `${s.avgFalseRecall}` : '—'} color={s.avgFalseRecall != null && s.avgFalseRecall > 15 ? 'text-accent-red' : undefined} />
      <Stat label="Best model" value={bestModelLabel} sub={s.bestModel ? `${s.bestModel.composite}` : 'no runs yet'} />
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2.5 bg-bg-secondary border border-white/10 rounded-xl">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className={clsx('text-lg font-bold tabular-nums leading-none truncate', color ?? 'text-text-primary')}>{value}</span>
      {sub && <span className="text-[10px] text-text-muted truncate">{sub}</span>}
    </div>
  )
}

// ─── Scorecard table (used for both model & provider leaderboards) ────────────

function displayScope(label: string): string {
  // Runs from pure-retrieval tasks (recall / temporal — no applied dispatch)
  // are not attributed to a model. The engine groups them under "unknown";
  // render that honestly as "(no model)" so it doesn't look like a real model.
  return label === 'unknown' || !label.trim() ? '(no model)' : label
}

function ScorecardTable({ title, cards }: { title: string; cards: MemoryScorecard[] }) {
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h4>
        <span className="ml-auto text-[10px] text-text-muted">{cards.length}</span>
      </div>
      {cards.length === 0 ? (
        <EmptyState title="No runs yet" />
      ) : (
        // overflow-x-auto so narrow side-by-side columns scroll instead of clipping.
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.02] text-text-muted">
              <tr className="text-left">
                <th className="px-3 py-1.5 font-medium whitespace-nowrap">Scope</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Comp</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Retr</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Use</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Fresh</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">False</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Runs</th>
                <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Conf</th>
              </tr>
            </thead>
            <tbody>
              {cards.map(c => {
                const display = displayScope(c.label)
                const muted = display === '(no model)'
                return (
                  <tr key={c.scope} className="border-t border-white/5">
                    <td className="px-3 py-1.5 max-w-[260px]">
                      <span className={clsx('block truncate', muted ? 'text-text-muted italic' : 'text-text-primary')} title={c.scope}>{display}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <span className={clsx('inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 rounded font-semibold tabular-nums', scoreBg(c.composite), scoreColor(c.composite))}>
                        {c.composite}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtPct(c.subScores.retrievalAccuracy)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtPct(c.subScores.usageAccuracy)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtPct(c.subScores.freshnessScore)}</td>
                    <td className={clsx('px-2 py-1.5 text-right tabular-nums whitespace-nowrap', c.falseRecallPenalty > 15 && 'text-red-300')}>{c.falseRecallPenalty.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-text-muted">{c.runCount}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-text-muted">{Math.round(c.confidence)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function fmtPct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n)}%`
}

// ─── Provider comparison ──────────────────────────────────────────────────────

function ProviderComparisonTable({ rows }: { rows: ProviderComparison[] }) {
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
        <Database size={13} className="text-violet-400" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Memory provider comparison</h4>
        <HeuristicTag tip="Baseline (native) vs external providers, ranked by retrieval accuracy. Latency and false-positive counts are derived from real benchmark runs against each provider." />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-white/[0.02] text-text-muted">
            <tr className="text-left">
              <th className="px-3 py-1.5 font-medium whitespace-nowrap">Provider</th>
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">Type</th>
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">Kind</th>
              <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Retrieval</th>
              <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Fresh</th>
              <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">False pos</th>
              <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Latency</th>
              <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">Runs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.provider} className="border-t border-white/5">
                <td className="px-3 py-1.5 max-w-[280px]">
                  <span className="block truncate text-text-primary" title={r.provider}>{r.provider}</span>
                </td>
                <td className="px-2 py-1.5 text-text-muted font-mono text-[10px] whitespace-nowrap">{r.type}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className={clsx('text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide',
                    r.baseline ? 'bg-emerald-500/15 text-emerald-300' : 'bg-cyan-500/15 text-cyan-300')}>
                    {r.baseline ? 'baseline' : 'external'}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtPct(r.retrievalAccuracy)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtPct(r.freshnessScore)}</td>
                <td className={clsx('px-2 py-1.5 text-right tabular-nums whitespace-nowrap', r.falsePositives != null && r.falsePositives > 1 && 'text-red-300')}>
                  {r.falsePositives == null ? '—' : r.falsePositives.toFixed(1)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-muted whitespace-nowrap">{r.avgLatencyMs}ms</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-text-muted whitespace-nowrap">{r.runs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Task card + runs ─────────────────────────────────────────────────────────

interface TaskCardProps {
  task: MemoryBenchmarkTask
  runs: MemoryBenchmarkRun[]
  providers: MemoryProviderInfo[]
  expanded: boolean
  onToggle: () => void
  onReload: () => void
}

function MemoryTaskCard({ task, runs, providers, expanded, onToggle, onReload }: TaskCardProps) {
  const [model, setModel] = useState('')
  const [agent, setAgent] = useState(task.agent ?? '')
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState<string | null>(null)
  const running = runs.some(r => r.status === 'running')

  const dispatch = async () => {
    setBusy(true); setErr(null)
    try {
      await memoryEvaluations.run({ taskId: task.id, model: model || undefined, agent: agent || undefined })
      await onReload()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed to dispatch') }
    finally { setBusy(false) }
  }

  const remove = async () => {
    if (!confirm('Delete this memory task and all its runs?')) return
    try { await memoryEvaluations.deleteTask(task.id); await onReload() }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed to delete') }
  }

  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors">
        {expanded ? <ChevronDown size={14} className="text-text-muted mt-0.5" /> : <ChevronRight size={14} className="text-text-muted mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200">{task.kind}</span>
            {task.builtIn && (
              <span title="Built-in task — ships with the dashboard. Can't be deleted."
                className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200 border border-cyan-500/30">
                Built-in
              </span>
            )}
            <h5 className="text-sm font-semibold text-text-primary">{task.title}</h5>
            {task.agent && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-text-muted">{task.agent}</span>}
          </div>
          <p className="text-xs text-text-muted mt-1 truncate">{task.query}</p>
        </div>
        <span className="text-[10px] text-text-muted">{runs.length} run{runs.length === 1 ? '' : 's'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5">
          {err && <ErrorBanner message={err} />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-xs">
            <KvList label="Expected facts (must appear)" values={task.expectedFacts} color="text-emerald-300" />
            <KvList label="Forbidden / stale facts (must NOT appear)" values={task.forbiddenFacts} color="text-red-300" />
            {task.newerHints.length > 0 && <KvList label="Newer hints (temporal preference)" values={task.newerHints} color="text-cyan-300" />}
            {task.providers.length > 0 && <KvList label="Providers (scoped)" values={task.providers} color="text-text-muted" />}
            {task.rubric && (
              <div className="md:col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Rubric</p>
                <p className="text-xs text-text-secondary italic">{task.rubric}</p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-white/5">
            <input value={model} onChange={e => setModel(e.target.value)} placeholder="model (optional)"
              className="bg-bg-primary border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary w-44 font-mono" />
            <input value={agent} onChange={e => setAgent(e.target.value)} placeholder="agent (optional)"
              className="bg-bg-primary border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary w-36 font-mono" />
            <button onClick={dispatch} disabled={busy || running || providers.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 rounded disabled:opacity-40 disabled:cursor-not-allowed">
              {(busy || running) ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              {busy ? 'Dispatching…' : running ? 'Running…' : 'Run benchmark'}
            </button>
            {providers.length === 0 && <span className="text-[10px] text-amber-300 flex items-center gap-1"><AlertCircle size={11} /> no providers detected</span>}
            {!task.builtIn && (
              <button onClick={remove} className="ml-auto text-text-muted hover:text-red-300" title="Delete task"><Trash2 size={13} /></button>
            )}
            {task.builtIn && (
              <span className="ml-auto text-[10px] text-text-muted italic" title="Built-in tasks can't be deleted">built-in · protected</span>
            )}
          </div>

          {runs.length > 0 && (
            <div className="divide-y divide-white/5 rounded border border-white/5 overflow-hidden">
              {runs.map(r => <MemoryRunRow key={r.id} run={r} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function KvList({ label, values, color }: { label: string; values: string[]; color: string }) {
  if (values.length === 0) return null
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">
        {values.map((v, i) => (
          <span key={i} className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5', color)}>{v}</span>
        ))}
      </div>
    </div>
  )
}

function MemoryRunRow({ run }: { run: MemoryBenchmarkRun }) {
  const [open, setOpen] = useState(false)
  const running = run.status === 'running'
  const errored = run.status === 'error'
  return (
    <div className={clsx(running && 'bg-violet-500/10', errored && 'bg-red-500/5')}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-3 px-3 py-2 text-xs text-left hover:bg-white/5">
        {running ? (
          <Loader2 size={11} className="text-violet-300 animate-spin flex-shrink-0" />
        ) : (
          <span className={clsx('w-2 h-2 rounded-full flex-shrink-0',
            run.status === 'success' ? 'bg-emerald-400' : run.status === 'failure' ? 'bg-red-400' : 'bg-amber-400')} />
        )}
        <span className={clsx('w-24 truncate font-mono', running ? 'text-violet-300' : 'text-text-muted')}>
          {running ? 'running' : run.status}
        </span>
        {/* Refusal-detected pill — only relevant on negative-control runs.
            Surfaces the engine's denial heuristic so users can tell whether
            a "success" was a correct refusal vs a clean retrieval. */}
        {run.denialDetected && !running && (
          <span title={run.scoringNote || 'agent refuted the premise — false-recall penalty suppressed'}
            className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex-shrink-0">
            refused ✓
          </span>
        )}
        <span className="text-text-primary truncate flex-1 min-w-0">{run.model || '(unknown model)'}</span>
        <span className="text-text-muted tabular-nums w-14 text-right" title="composite">{running ? '—' : run.composite}</span>
        <span className="text-text-muted tabular-nums w-14 text-right" title="retrieval">{run.retrievalAccuracy == null ? '—' : `${run.retrievalAccuracy}%`}</span>
        <span className="text-text-muted tabular-nums w-14 text-right" title="usage">{run.usageAccuracy == null ? '—' : `${run.usageAccuracy}%`}</span>
        <span className={clsx('tabular-nums w-12 text-right', run.falseRecallPenalty > 15 ? 'text-red-300' : 'text-text-muted')} title="false-recall penalty">
          {run.falseRecallPenalty.toFixed(0)}
        </span>
        <span className="text-text-muted tabular-nums w-16 text-right">{fmtDuration(run.latencyMs)}</span>
        <span className="text-text-muted text-[10px] w-16 text-right">{fmtTimeAgo(run.ts)}</span>
        {open ? <ChevronDown size={11} className="text-text-muted" /> : <ChevronRight size={11} className="text-text-muted" />}
      </button>
      {open && <MemoryRunDetail run={run} />}
    </div>
  )
}

function MemoryRunDetail({ run }: { run: MemoryBenchmarkRun }) {
  return (
    <div className="px-4 pb-3 pt-2 bg-black/20 space-y-3 text-[11px]">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DetailCell label="Expected found" value={`${run.expectedFound}/${run.expectedTotal}`} />
        <DetailCell label="Forbidden found" value={String(run.forbiddenFound)} bad={run.forbiddenFound > 0} />
        <DetailCell label="Irrelevant hits" value={String(run.irrelevantHits)} />
        <DetailCell label="Providers used" value={String(run.providersUsed.length)} />
        <DetailCell label="Conflict resolution" value={run.conflictResolution == null ? '—' : `${run.conflictResolution}%`} />
        <DetailCell label="Freshness" value={run.freshnessScore == null ? '—' : `${run.freshnessScore}%`} />
        <DetailCell label="Latency score" value={run.latencyScore == null ? '—' : `${run.latencyScore}%`} />
        <DetailCell label="Coverage" value={run.coverageScore == null ? '—' : `${run.coverageScore}%`} />
      </div>

      {run.providersUsed.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Providers queried</p>
          <div className="flex flex-wrap gap-1">
            {run.providersUsed.map(p => <span key={p} className="font-mono text-[10px] bg-white/5 px-1.5 py-0.5 rounded text-text-muted">{p}</span>)}
          </div>
        </div>
      )}

      {run.hits.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-text-muted">Retrieval hits ({run.hits.length})</p>
          {run.hits.slice(0, 8).map((h, i) => (
            <div key={i} className="bg-white/[0.02] border border-white/5 rounded p-2 text-[11px]">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="font-mono text-text-muted truncate">{h.provider}</span>
                <span className="text-text-muted">·</span>
                <span className="text-text-muted truncate flex-1 min-w-0">{h.source}</span>
                <span className="text-text-muted">score {h.score}</span>
                {h.ts && <span className="text-text-muted">· {fmtTimeAgo(h.ts)}</span>}
              </div>
              {h.matchedFacts.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {h.matchedFacts.map((m, j) => <span key={j} className="text-[10px] font-mono px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300">{m}</span>)}
                </div>
              )}
              <p className="text-text-secondary whitespace-pre-wrap break-words">{h.excerpt}</p>
            </div>
          ))}
          {run.hits.length > 8 && <p className="text-[10px] text-text-muted">+{run.hits.length - 8} more hits not shown</p>}
        </div>
      ) : (
        <p className="text-[11px] text-text-muted italic">No retrieval hits returned by any provider.</p>
      )}

      {run.agentAnswer != null && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">Agent answer</p>
            <span className="text-[10px] text-emerald-300">expected: {run.answerHasExpected}</span>
            {run.answerHasForbidden > 0 && <span className="text-[10px] text-red-300">forbidden: {run.answerHasForbidden}</span>}
          </div>
          <pre className="bg-white/[0.02] border border-white/5 rounded p-2 text-text-primary whitespace-pre-wrap break-words font-sans">
            {run.agentAnswer || '(empty)'}
          </pre>
        </div>
      )}

      {run.scoringNote && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Scoring decision</p>
          <p className={clsx('text-[11px] leading-snug', run.denialDetected ? 'text-emerald-300' : 'text-amber-300')}>
            {run.scoringNote}
          </p>
        </div>
      )}

      {run.notes && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Notes</p>
          <pre className="bg-white/[0.02] border border-white/5 rounded p-2 text-text-secondary whitespace-pre-wrap break-words font-mono text-[10px]">{run.notes}</pre>
        </div>
      )}
    </div>
  )
}

function DetailCell({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <span className={clsx('text-text-primary font-semibold tabular-nums', bad && 'text-red-300')}>{value}</span>
    </div>
  )
}

// ─── New task form ────────────────────────────────────────────────────────────

const KINDS: MemoryKind[] = ['recall', 'multihop', 'temporal', 'conflict', 'applied', 'negative']

export function NewMemoryTaskForm({ platform, providers, onClose, onCreated }: {
  platform: EvalPlatform; providers: MemoryProviderInfo[]; onClose: () => void; onCreated: () => void
}) {
  const [title, setTitle]     = useState('')
  const [query, setQuery]     = useState('')
  const [kind, setKind]       = useState<MemoryKind>('recall')
  const [agent, setAgent]     = useState('')
  const [expected, setExpected]   = useState('')
  const [forbidden, setForbidden] = useState('')
  const [newer, setNewer]         = useState('')
  const [scopedProviders, setScopedProviders] = useState<string[]>([])
  const [rubric, setRubric]   = useState('')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !query.trim()) { setErr('title and query are required'); return }
    setBusy(true); setErr(null)
    try {
      await memoryEvaluations.createTask({
        platform, agent: agent.trim() || undefined, title: title.trim(), kind, query: query.trim(),
        expectedFacts:  expected.split('\n').map(s => s.trim()).filter(Boolean),
        forbiddenFacts: forbidden.split('\n').map(s => s.trim()).filter(Boolean),
        newerHints:     newer.split('\n').map(s => s.trim()).filter(Boolean),
        providers:      scopedProviders.length ? scopedProviders : undefined,
        rubric: rubric.trim() || undefined,
      })
      onCreated()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed to create') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="bg-bg-secondary border border-violet-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-primary">New memory task — {platform}</h4>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">cancel</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Title" value={title} onChange={setTitle} required />
        <SelectField label="Kind" value={kind} onChange={(v) => setKind(v as MemoryKind)} options={KINDS.map(k => ({ value: k, label: k }))} />
        <Field label="Agent (optional)" value={agent} onChange={setAgent} placeholder="e.g. main" />
      </div>
      <FieldArea label="Query" value={query} onChange={setQuery} rows={2} required placeholder="The question or probe sent to the memory layer / agent" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FieldArea label="Expected facts (one per line — must be retrieved/used)" value={expected} onChange={setExpected} rows={4} />
        <FieldArea label="Forbidden / stale facts (one per line — must NOT appear)" value={forbidden} onChange={setForbidden} rows={4} />
      </div>
      {kind === 'temporal' && (
        <FieldArea label="Newer hints (substrings that signal the freshest match — temporal preference)" value={newer} onChange={setNewer} rows={2} />
      )}
      {providers.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Provider scope (optional — leave none selected to probe every detected provider)</p>
          <div className="flex flex-wrap gap-2">
            {providers.map(p => {
              const on = scopedProviders.includes(p.name)
              return (
                <button key={p.name} type="button"
                  onClick={() => setScopedProviders(on ? scopedProviders.filter(n => n !== p.name) : [...scopedProviders, p.name])}
                  className={clsx('text-[10px] font-mono px-2 py-1 rounded border transition-colors',
                    on ? 'bg-violet-500/20 border-violet-500/40 text-violet-200' : 'bg-white/5 border-white/10 text-text-muted hover:text-text-primary')}>
                  {p.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <FieldArea label="Rubric (optional)" value={rubric} onChange={setRubric} rows={2} placeholder="Free-text scoring guidance for manual review" />
      {err && <p className="text-xs text-red-300">{err}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/30 rounded">
          <Plus size={12} /> Create task
        </button>
      </div>
    </form>
  )
}

function Field({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}{required && <span className="text-red-300 ml-1">*</span>}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="bg-bg-primary border border-white/10 rounded px-2 py-1.5 text-sm text-text-primary" />
    </label>
  )
}
function FieldArea({ label, value, onChange, placeholder, rows = 3, required }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string; rows?: number; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}{required && <span className="text-red-300 ml-1">*</span>}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="bg-bg-primary border border-white/10 rounded px-2 py-1.5 text-sm text-text-primary font-mono" />
    </label>
  )
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (s: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-bg-primary border border-white/10 rounded px-2 py-1.5 text-sm text-text-primary">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}
