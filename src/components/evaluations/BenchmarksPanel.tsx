// title: Benchmarks panel — manage tasks, dispatch real runs, view results
// path: src/components/evaluations/BenchmarksPanel.tsx

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Beaker, Play, Plus, Trash2, RefreshCw, AlertCircle, Loader2 } from 'lucide-react'
import {
  evaluations, type BenchmarkTask, type BenchmarkRun, type EvalPlatform, ApiError,
} from '../../lib/api'
import { fmtTimeAgo, fmtDuration, EmptyState, PlatformBadge, scoreColor, ErrorBanner } from './shared'

interface PanelProps { platform: EvalPlatform; reachable: boolean }

export function BenchmarksPanel({ platform, reachable }: PanelProps) {
  const [tasks, setTasks]     = useState<BenchmarkTask[]>([])
  const [runs, setRuns]       = useState<BenchmarkRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [dispatching, setDispatching] = useState<string | null>(null)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const r = await evaluations.benchmarks(platform)
      setTasks(r.tasks); setRuns(r.runs)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load benchmarks')
    } finally { setLoading(false) }
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [platform])

  // Poll every 8s while any run is still "running" so the row updates without
  // the user having to refresh manually. Stops when no in-flight rows remain.
  useEffect(() => {
    const hasRunning = runs.some(r => r.status === 'running')
    if (!hasRunning) {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
      return
    }
    if (pollTimer.current) return
    pollTimer.current = setInterval(() => { load() }, 8000)
    return () => {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs])

  const onDispatch = async (taskId: string, model: string, agent: string) => {
    setDispatching(taskId); setError(null)
    try {
      await evaluations.runBenchmark({ taskId, platform, model: model || undefined, agent: agent || undefined })
      // Immediately reload so the "running" placeholder row appears; the poll
      // effect above keeps refreshing until the row flips to its final state.
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to dispatch benchmark')
    } finally { setDispatching(null) }
  }

  const onDelete = async (id: string) => {
    if (!confirm('Delete this benchmark task and all its runs?')) return
    try { await evaluations.deleteTask(id); await load() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Failed to delete') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Beaker size={14} className="text-violet-400" />
        <h3 className="text-sm font-semibold text-text-primary">Benchmarks</h3>
        <PlatformBadge platform={platform} />
        <span className="text-[10px] text-text-muted">{tasks.length} task{tasks.length === 1 ? '' : 's'} · {runs.length} run{runs.length === 1 ? '' : 's'}</span>
        <button
          onClick={() => setShowNew(v => !v)}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-xs bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border border-violet-500/30 rounded transition-colors"
        >
          <Plus size={12} /> New task
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors"
        >
          <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {showNew && <NewTaskForm platform={platform} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}

      {tasks.length === 0 ? (
        <div className="bg-bg-secondary border border-white/10 rounded-xl">
          <EmptyState
            icon={<Beaker size={28} />}
            title="No benchmark tasks defined yet"
            hint="Create a task to run a known prompt against the live agent. Runs are real — they dispatch the prompt to the gateway and capture the resulting transcript. No demo data."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map(t => (
            <TaskCard
              key={t.id}
              task={t}
              runs={runs.filter(r => r.taskId === t.id)}
              reachable={reachable}
              dispatching={dispatching === t.id}
              onDispatch={onDispatch}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NewTaskForm({ platform, onClose, onCreated }: { platform: EvalPlatform; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle]   = useState('')
  const [prompt, setPrompt] = useState('')
  const [agent, setAgent]   = useState('')
  const [rubric, setRubric] = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !prompt.trim()) { setErr('title and prompt are required'); return }
    setBusy(true); setErr(null)
    try {
      await evaluations.createTask({ platform, title: title.trim(), prompt: prompt.trim(), agent: agent.trim() || undefined, rubric: rubric.trim() || undefined })
      onCreated()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed to create') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="bg-bg-secondary border border-violet-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-primary">New benchmark task — {platform}</h4>
        <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">cancel</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Title" value={title} onChange={setTitle} required />
        <Field label="Agent (optional)" value={agent} onChange={setAgent} placeholder="leave blank for any agent on this platform" />
      </div>
      <FieldArea label="Prompt" value={prompt} onChange={setPrompt} rows={5} required />
      <FieldArea label="Rubric (optional)" value={rubric} onChange={setRubric} rows={2} placeholder="e.g. must call web search, must end with a JSON object…" />
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

interface TaskProps {
  task: BenchmarkTask
  runs: BenchmarkRun[]
  reachable: boolean
  dispatching: boolean
  onDispatch: (taskId: string, model: string, agent: string) => void
  onDelete: (id: string) => void
}

function TaskCard({ task, runs, reachable, dispatching, onDispatch, onDelete }: TaskProps) {
  const [model, setModel] = useState('')
  const [agent, setAgent] = useState(task.agent ?? '')
  const scored = runs.filter(r => r.rubricScore != null)
  const avgScore = scored.length ? Math.round(scored.reduce((s, r) => s + (r.rubricScore as number), 0) / scored.length) : null
  const runningCount = runs.filter(r => r.status === 'running').length
  const inFlight = dispatching || runningCount > 0

  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-white/10">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformBadge platform={task.platform} />
            <h4 className="text-sm font-semibold text-text-primary">{task.title}</h4>
            {task.agent && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-text-muted">{task.agent}</span>}
          </div>
          <p className="text-xs text-text-muted mt-1 line-clamp-2">{task.prompt}</p>
          {task.rubric && <p className="text-[11px] text-text-muted mt-1 italic">Rubric: {task.rubric}</p>}
        </div>
        <button onClick={() => onDelete(task.id)} title="Delete task" className="text-text-muted hover:text-red-300 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="px-4 py-2.5 bg-white/[0.02] border-b border-white/5 flex items-center gap-2 flex-wrap">
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="model (optional override)"
          className="bg-bg-primary border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary w-48 font-mono" />
        <input value={agent} onChange={e => setAgent(e.target.value)} placeholder="agent (optional)"
          className="bg-bg-primary border border-white/10 rounded px-2 py-1 text-[11px] text-text-primary w-40 font-mono" />
        <button
          disabled={!reachable || inFlight}
          onClick={() => onDispatch(task.id, model, agent)}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {inFlight ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          {dispatching ? 'Dispatching…' : runningCount > 0 ? `Running (${runningCount})…` : 'Run on live agent'}
        </button>
        {!reachable && (
          <span className="text-[10px] text-amber-300 flex items-center gap-1">
            <AlertCircle size={11} /> agent not connected
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-muted">
          {runs.length} run{runs.length === 1 ? '' : 's'}
          {runningCount > 0 && ` · ${runningCount} in flight`}
          {avgScore != null && ` · avg rubric ${avgScore}`}
        </span>
      </div>
      {runs.length > 0 && (
        <div className="divide-y divide-white/5 max-h-72 overflow-y-auto">
          {runs.map(r => <BenchRunRow key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

function BenchRunRow({ r }: { r: BenchmarkRun }) {
  const running = r.status === 'running'
  const errored = r.status === 'error'
  const bad = r.outcome === 'failure' || r.outcome === 'stalled' || r.outcome === 'unresolved' || errored
  // Show the diagnostic toggle for any non-success row that has notes worth
  // surfacing. Multi-line notes get a pre-formatted block; single-line ones get
  // their text shown inline on expand.
  const hasDiag = bad && !!r.notes && !running
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={clsx(running && 'bg-violet-500/10', errored && 'bg-red-500/5')}>
      <div className="px-4 py-2 flex items-center gap-3 text-xs">
        {running ? (
          <Loader2 size={12} className="text-violet-300 animate-spin flex-shrink-0" />
        ) : (
          <span className={clsx('w-2 h-2 rounded-full flex-shrink-0',
            r.outcome === 'success' || r.outcome === 'recovered' ? 'bg-emerald-400'
            : r.outcome === 'failure' ? 'bg-red-400'
            : 'bg-amber-400')} />
        )}
        <span className={clsx('font-mono w-24 truncate flex-shrink-0', running ? 'text-violet-300' : errored ? 'text-red-300' : 'text-text-muted')}>
          {running ? 'running' : r.outcome}
        </span>
        {/* Model + diagnostic toggle: the model name truncates, but the toggle
            stays outside the truncate span so it never gets clipped. */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-text-primary truncate min-w-0" title={r.notes || undefined}>
            {r.model || '(unknown model)'}{running && ' · awaiting agent…'}
          </span>
          {hasDiag && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex-shrink-0 text-red-300 underline decoration-dotted hover:text-red-200"
            >
              {expanded ? 'hide details' : 'show diagnostic'}
            </button>
          )}
          {bad && !r.notes && !running && (
            <span className="flex-shrink-0 text-text-muted italic text-[10px]">no diagnostic captured · re-dispatch</span>
          )}
        </div>
        {r.agent && <span className="text-text-muted text-[10px] font-mono truncate w-20">{r.agent}</span>}
        <span className="text-text-muted tabular-nums w-12 text-right">{r.toolCalls}t</span>
        <span className={clsx('tabular-nums w-12 text-right', r.wastedToolCalls > 0 ? 'text-amber-300' : 'text-text-muted')}>{r.wastedToolCalls}w</span>
        <span className="text-text-muted tabular-nums w-16 text-right">{running ? '—' : fmtDuration(r.durationMs)}</span>
        <span className={clsx('tabular-nums w-12 text-right font-semibold', scoreColor(r.rubricScore))}>{r.rubricScore ?? '—'}</span>
        <span className="text-text-muted text-[10px] w-16 text-right">{fmtTimeAgo(r.ts)}</span>
      </div>
      {hasDiag && expanded && (
        <pre className="px-4 pb-3 text-[10px] text-red-200/80 font-mono whitespace-pre-wrap break-all">{r.notes}</pre>
      )}
    </div>
  )
}
