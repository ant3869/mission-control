// title: Harness Benchmarks view
// path: src/views/HarnessBenchmarks.tsx
// purpose: Benchmark how a model performs THROUGH OpenClaw/Hermes — App →
//          harness → selected model → tools/context/routing → result. Distinct
//          from generic model benchmarks: every run is a real harness dispatch
//          across 9 agent-behavior lanes, scored deterministically.

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  FlaskConical, Play, Square, RotateCcw, Download, X, Loader2, CheckCircle2,
  XCircle, AlertTriangle, Clock, Cpu, Filter, RefreshCw, ChevronRight, Server, Zap,
  Trash2, Wifi, WifiOff,
} from 'lucide-react'
import {
  harnessBench as api,
  type BenchmarkHarness, type HbPackSummary, type HbLaneMeta, type HbRun,
  type HbTaskResult, type HbResultStatus, type HbComparisonRow,
} from '../lib/api'

const POLL_MS = 1500

// ─── small helpers ────────────────────────────────────────────────────────────

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
function relTime(iso?: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000), h = Math.floor(diff / 3_600_000), d = Math.floor(diff / 86_400_000)
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; if (h < 24) return `${h}h ago`
  if (d < 7) return `${d}d ago`; return new Date(iso).toLocaleDateString()
}
function fmtTokens(n: number, est: boolean): string { return (est ? '~' : '') + (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)) }
function fmtCost(v: number | null | undefined, est: boolean): string {
  if (v == null) return '—'
  const s = v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`
  return (est ? '~' : '') + s
}
const FAMILY_COLOR: Record<string, string> = {
  Anthropic: 'text-orange-300', OpenAI: 'text-emerald-300', Google: 'text-blue-300',
  Meta: 'text-indigo-300', Mistral: 'text-amber-300', Other: 'text-text-secondary',
}
type StatusStyle = { dot: string; text: string; label: string; Icon: typeof CheckCircle2 }
const STATUS_STYLE: Record<HbResultStatus, StatusStyle> = {
  passed:        { dot: 'bg-green-500',  text: 'text-green-400',  label: 'Passed',  Icon: CheckCircle2 },
  failed:        { dot: 'bg-red-500',    text: 'text-red-400',    label: 'Failed',  Icon: XCircle },
  error:         { dot: 'bg-orange-500', text: 'text-orange-400', label: 'Error',   Icon: AlertTriangle },
  manual_review: { dot: 'bg-amber-400',  text: 'text-amber-400',  label: 'Review',  Icon: AlertTriangle },
}
const PARTIAL_STYLE: StatusStyle = { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Partial', Icon: AlertTriangle }

// A 'failed' result that still earned points (partial credit on a multi-criteria
// task) is shown as "Partial" so the gradation is visible, not hidden as a red fail.
function isPartial(r: HbTaskResult): boolean { return r.status === 'failed' && r.points > 0 && r.points < r.maxPoints }
function displayStyle(r: HbTaskResult): StatusStyle { return isPartial(r) ? PARTIAL_STYLE : STATUS_STYLE[r.status] }

const RUN_STATUS_STYLE: Record<string, string> = {
  running:   'text-blue-400 bg-blue-950/40 border-blue-900/50',
  queued:    'text-text-muted bg-card border-border',
  completed: 'text-green-400 bg-green-950/40 border-green-900/50',
  failed:    'text-red-400 bg-red-950/40 border-red-900/50',
  cancelled: 'text-amber-400 bg-amber-950/40 border-amber-900/50',
}

function failureChip(ft?: string | null) {
  if (!ft) return null
  return (
    <span className="px-1.5 py-0.5 rounded border border-red-900/40 bg-red-950/30 text-red-300 text-xxs font-mono">
      {ft}
    </span>
  )
}

// ─── stat ─────────────────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xxs uppercase tracking-wide text-text-muted">{label}</span>
      <span className={clsx('text-sm font-semibold tabular-nums truncate', accent ?? 'text-text-primary')}>{value}</span>
    </div>
  )
}

// ─── sparkline (per-model score trend across runs) ──────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  if (!data?.length) return <span className="text-text-muted/40">·</span>
  if (data.length === 1) return <span className="text-text-muted tabular-nums text-xxs" title="one run — no trend yet">{data[0]}%</span>
  const w = 54, h = 16, n = data.length
  const xy = (v: number, i: number) => [ (i / (n - 1)) * (w - 2) + 1, h - 1 - (Math.max(0, Math.min(100, v)) / 100) * (h - 2) ] as const
  const pts = data.map((v, i) => xy(v, i).map(z => z.toFixed(1)).join(',')).join(' ')
  const [lx, ly] = xy(data[n - 1], n - 1)
  const delta = data[n - 1] - data[0]
  const col = delta > 0 ? '#34d399' : delta < 0 ? '#f87171' : '#9ca3af'
  return (
    <svg width={w} height={h} className="inline-block align-middle" role="img"
      aria-label={`score trend over ${n} runs`}>
      <title>{`overall % per run (oldest → newest): ${data.join('% → ')}%`}</title>
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="1.7" fill={col} />
    </svg>
  )
}

// ─── lane card ────────────────────────────────────────────────────────────────

function LaneCard({ meta, results, active, onClick }: {
  meta: HbLaneMeta; results: HbTaskResult[]; active: boolean; onClick: () => void
}) {
  const scored = results.filter(r => r.status === 'passed' || r.status === 'failed')
  const passed = scored.filter(r => r.status === 'passed').length
  const maxP = scored.reduce((s, r) => s + r.maxPoints, 0)
  const gotP = scored.reduce((s, r) => s + r.points, 0)
  const score = maxP > 0 ? Math.round((gotP / maxP) * 100) : null
  const lat = results.map(r => r.latencyMs).filter((n): n is number => typeof n === 'number')
  const avgLat = lat.length ? Math.round(lat.reduce((s, n) => s + n, 0) / lat.length) : null
  const failures = results.filter(r => r.status === 'failed' || r.status === 'error').length
  const empty = results.length === 0

  const scoreColor = score == null ? 'text-text-muted' : score >= 80 ? 'text-green-400' : score >= 50 ? 'text-amber-400' : 'text-red-400'

  return (
    <button
      onClick={onClick}
      title={meta.blurb}
      className={clsx(
        'flex flex-col gap-2 p-3 rounded-lg border text-left transition-all',
        empty ? 'opacity-50' : 'hover:bg-card-hover',
        active ? 'border-accent-blue bg-card-hover' : 'border-border bg-card',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary truncate">{meta.short}</span>
        <span className={clsx('text-sm font-bold tabular-nums', scoreColor)}>{score == null ? '—' : `${score}%`}</span>
      </div>
      <div className="h-1 rounded-full bg-base overflow-hidden">
        <div className={clsx('h-full rounded-full', score == null ? 'bg-text-muted' : score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-400' : 'bg-red-500')}
          style={{ width: `${score ?? 0}%` }} />
      </div>
      <div className="flex items-center justify-between text-xxs text-text-muted tabular-nums">
        <span>{passed}/{scored.length} pass</span>
        <span>{fmtLatency(avgLat)}</span>
        <span className={failures ? 'text-red-400' : ''}>{failures} fail</span>
      </div>
    </button>
  )
}

// ─── detail drawer ──────────────────────────────────────────────────────────────

function DetailDrawer({ result, laneLabel, onClose }: {
  result: HbTaskResult; laneLabel: (l: string) => string; onClose: () => void
}) {
  const s = displayStyle(result)
  const raw = result.rawHarnessOutput != null ? JSON.stringify(result.rawHarnessOutput, null, 2) : ''
  const tool = result.parsedToolCall != null ? JSON.stringify(result.parsedToolCall, null, 2) : ''
  const ro = result.rawHarnessOutput as any
  const isMulti = ro && typeof ro === 'object' && ro.multiTurn === true
  const turn1Answer = isMulti ? String(ro.turn1?.answer ?? '') : ''
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl h-full bg-surface border-l border-border overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-surface border-b border-border px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 min-w-0">
            <s.Icon size={15} className={s.text} />
            <span className="text-sm font-semibold text-text-primary truncate">{result.taskTitle}</span>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx('px-2 py-0.5 rounded border text-xxs', 'border-border bg-card', s.text)}>{s.label}</span>
            <span className="px-2 py-0.5 rounded border border-border bg-card text-xxs text-text-secondary">{laneLabel(result.lane)}</span>
            <span className="text-xxs text-text-muted tabular-nums">{result.points}/{result.maxPoints} pts · {fmtLatency(result.latencyMs)}</span>
            {(result.sampleCount ?? 1) > 1 && (
              <span className={clsx('px-2 py-0.5 rounded border text-xxs tabular-nums', 'border-border bg-card',
                (result.passCount ?? 0) === result.sampleCount ? 'text-green-400' : (result.passCount ?? 0) === 0 ? 'text-red-400' : 'text-amber-400')}>
                reliability {result.passCount}/{result.sampleCount}
              </span>
            )}
            {failureChip(result.failureType)}
          </div>

          <Section title="Prompt"><pre className="whitespace-pre-wrap break-words text-xxs text-text-secondary font-mono">{result.prompt || '—'}</pre></Section>
          <Section title="Expected behavior"><p className="text-xs text-text-secondary leading-relaxed">{result.expectedBehavior || '—'}</p></Section>
          {isMulti && (
            <Section title="Turn 1 reply  ·  before the follow-up">
              <p className="text-xxs text-text-muted -mt-0.5 mb-1">This task is multi-turn: the model answered, then got new information. Only the final (turn 2) reply below is scored.</p>
              <pre className="whitespace-pre-wrap break-words text-xxs text-text-secondary font-mono bg-base rounded border border-border p-2.5 max-h-56 overflow-y-auto">{turn1Answer || '(empty)'}</pre>
            </Section>
          )}
          <Section title={isMulti ? 'Turn 2 reply  ·  final, judged' : 'Scored model output  ·  judged'}>
            <p className="text-xxs text-text-muted -mt-0.5 mb-1">The model is scored on this — OpenClaw’s <code className="text-accent-teal">&lt;final&gt;</code> wrapper is stripped so the wrapper isn’t penalized.</p>
            <pre className="whitespace-pre-wrap break-words text-xxs text-text-primary font-mono bg-base rounded border border-green-900/30 p-2.5 max-h-72 overflow-y-auto">{result.modelResponse || '(empty)'}</pre>
          </Section>
          {tool && <Section title="Parsed tool call"><pre className="whitespace-pre-wrap break-words text-xxs text-accent-teal font-mono bg-base rounded border border-border p-2.5">{tool}</pre></Section>}
          <Section title="Scoring detail"><p className="text-xs text-text-secondary leading-relaxed">{result.scoreReason || '—'}</p></Section>
          {result.errorMessage && <Section title="Error"><pre className="whitespace-pre-wrap break-words text-xxs text-red-300 font-mono bg-red-950/20 rounded border border-red-900/40 p-2.5">{result.errorMessage}</pre></Section>}
          {result.notes && <Section title="Notes"><p className="text-xs text-text-muted">{result.notes}</p></Section>}
          {raw && (
            <Section title="Raw harness output  ·  full transcript">
              <p className="text-xxs text-text-muted -mt-0.5 mb-1">Unmodified harness transcript, saved for debugging — NOT what scoring reads.</p>
              <pre className="whitespace-pre-wrap break-words text-xxs text-text-muted font-mono bg-base rounded border border-border p-2.5 max-h-72 overflow-y-auto">{raw.slice(0, 8000)}</pre>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xxs uppercase tracking-wide text-text-muted font-medium">{title}</span>
      {children}
    </div>
  )
}

// ─── main view ────────────────────────────────────────────────────────────────

export function HarnessBenchmarks() {
  const [tab, setTab] = useState<'run' | 'compare'>('run')

  // meta
  const [packs, setPacks] = useState<HbPackSummary[]>([])
  const [lanes, setLanes] = useState<HbLaneMeta[]>([])
  const [harnesses, setHarnesses] = useState<Array<{ id: BenchmarkHarness; label: string; live: boolean; baseUrl: string; apiBaseUrl?: string }>>([])

  // controls
  const [harness, setHarness] = useState<BenchmarkHarness>('hermes')
  const [models, setModels] = useState<string[]>([])
  const [modelsErr, setModelsErr] = useState<string | null>(null)
  const [modelsStatus, setModelsStatus] = useState<'loading' | 'connected' | 'failed'>('loading')
  const [showModelsErr, setShowModelsErr] = useState(false)
  const [model, setModel] = useState('')
  const [packId, setPackId] = useState('quick-smoke-pack')
  const [samples, setSamples] = useState(1)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [endpoint, setEndpoint] = useState('')
  const [token, setToken] = useState('')

  // runs
  const [runsList, setRunsList] = useState<HbRun[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [run, setRun] = useState<HbRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [laneFilter, setLaneFilter] = useState<string | null>(null)
  const [detail, setDetail] = useState<HbTaskResult | null>(null)

  // comparison
  const [comparison, setComparison] = useState<HbComparisonRow[]>([])
  const [compareMode, setCompareMode] = useState<'latest' | 'average' | 'best'>('latest')
  const [groupBy, setGroupBy] = useState<'model' | 'provider'>('model')

  const laneLabel = useCallback((id: string) => lanes.find(l => l.id === id)?.label ?? id, [lanes])

  // ── initial load ──
  useEffect(() => {
    api.packs().then(r => { setPacks(r.packs); setLanes(r.lanes) }).catch(e => setError(e.message))
    api.connectors().then(r => {
      setHarnesses(r.harnesses)
      const live = r.harnesses.find(h => h.live)
      if (live) setHarness(live.id)
    }).catch(() => {})
    refreshRuns()
  }, [])

  const refreshRuns = useCallback(() => {
    api.runs().then(r => setRunsList(r.runs)).catch(() => {})
  }, [])

  // ── load models when harness changes ──
  useEffect(() => {
    setModels([]); setModelsErr(null); setModelsStatus('loading')
    api.models(harness)
      .then(r => {
        setModels(r.models)
        setModelsStatus(r.reachable ? 'connected' : 'failed')
        if (!r.reachable && r.error) setModelsErr(r.error)
      })
      .catch(e => { setModelsErr(e.message); setModelsStatus('failed') })
    // default pack matching harness
    setPackId(prev => {
      const p = packs.find(x => x.id === prev)
      if (p && (p.harness === 'any' || p.harness === harness)) return prev
      const match = packs.find(x => x.harness === harness) ?? packs.find(x => x.harness === 'any')
      return match?.id ?? prev
    })
  }, [harness, packs])

  // ── poll active run ──
  useEffect(() => {
    if (!activeRunId) return
    let stop = false
    const tick = async () => {
      try {
        const r = await api.run(activeRunId)
        if (stop) return
        setRun(r.run)
        if (r.run.status === 'running' || r.run.status === 'queued') {
          setTimeout(tick, POLL_MS)
        } else {
          refreshRuns()
          if (tab === 'compare') api.comparison(compareMode, groupBy).then(c => setComparison(c.rows)).catch(() => {})
        }
      } catch { if (!stop) setTimeout(tick, POLL_MS) }
    }
    tick()
    return () => { stop = true }
  }, [activeRunId, refreshRuns, tab])

  // ── comparison load ──
  useEffect(() => {
    if (tab === 'compare') api.comparison(compareMode, groupBy).then(c => setComparison(c.rows)).catch(e => setError(e.message))
  }, [tab, compareMode, groupBy])

  const harnessLive = harnesses.find(h => h.id === harness)?.live ?? false
  const canRun = (harnessLive || !!endpoint.trim()) && !!packId && !starting && (!run || run.status !== 'running')

  const start = async () => {
    setStarting(true); setError(null); setLaneFilter(null); setDetail(null)
    try {
      const res = await api.start({
        harness, taskPackId: packId,
        model: model.trim() || undefined,
        endpoint: endpoint.trim() || undefined,
        token: token.trim() || undefined,
        samples,
      })
      setActiveRunId(res.run.id)
      setRun(res.run)
    } catch (e: any) { setError(e.message) } finally { setStarting(false) }
  }

  const cancel = async () => { if (activeRunId) { await api.cancel(activeRunId).catch(() => {}) } }
  const rerun = async () => {
    if (!activeRunId) return
    try { const r = await api.rerunFailed(activeRunId); setActiveRunId(r.run.id); setRun(r.run) }
    catch (e: any) { setError(e.message) }
  }
  const openRun = async (id: string) => {
    setActiveRunId(id); setLaneFilter(null); setDetail(null)
    try { setRun((await api.run(id)).run) } catch (e: any) { setError(e.message) }
  }
  const deleteRunById = async (id: string) => {
    if (!window.confirm('Delete this benchmark run? This cannot be undone.')) return
    try { await api.remove(id) } catch (e: any) { setError(e.message) }
    if (activeRunId === id) { setActiveRunId(null); setRun(null) }
    refreshRuns()
  }
  const clearRuns = async (scope: 'failed' | 'all') => {
    const msg = scope === 'all'
      ? 'Clear ALL benchmark history? Every run and result will be permanently deleted.'
      : 'Clear all failed/cancelled runs?'
    if (!window.confirm(msg)) return
    try {
      const r = await api.clear(scope)
      if (scope === 'all' || (run && (run.status === 'failed' || run.status === 'cancelled'))) { setActiveRunId(null); setRun(null) }
      refreshRuns()
      setError(r.removed === 0 ? `Nothing to clear (${scope}).` : null)
    } catch (e: any) { setError(e.message) }
  }

  const results = run?.results ?? []
  const filtered = laneFilter ? results.filter(r => r.lane === laneFilter) : results
  const scored = results.filter(r => r.status === 'passed' || r.status === 'failed')
  const isRunning = run?.status === 'running' || run?.status === 'queued'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <FlaskConical size={18} className="text-accent-purple" />
          <div>
            <h1 className="text-base font-semibold text-text-primary">Harness Benchmarks</h1>
            <p className="text-xs text-text-muted mt-0.5">
              App → OpenClaw/Hermes → model → tools/context/routing → result · <span className="text-text-secondary">not raw model benchmarks</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 p-0.5 rounded-lg border border-border bg-card">
          {(['run', 'compare'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('px-3 py-1 rounded text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {t === 'run' ? 'Benchmark' : 'Compare'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'run' ? (
        <div className="flex-1 overflow-y-auto">
          {/* Run controls */}
          <div className="px-6 py-4 border-b border-border flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              {/* Harness */}
              <Field label="Harness">
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {harnesses.map(h => (
                    <button key={h.id} onClick={() => setHarness(h.id)}
                      className={clsx('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                        harness === h.id ? 'bg-card-hover text-text-primary' : 'bg-card text-text-muted hover:text-text-secondary')}>
                      <span className={clsx('w-1.5 h-1.5 rounded-full', h.live ? 'bg-green-500' : 'bg-text-muted')} />
                      {h.label}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Model */}
              <Field label="Model">
                <input
                  list="hb-models"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder={models.length ? 'auto (or pick / type)' : 'auto / type model id'}
                  className="w-56 px-3 py-1.5 rounded-lg border border-border bg-base text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60"
                />
                <datalist id="hb-models">
                  {models.map(m => <option key={m} value={m} />)}
                </datalist>
                <ConnectorStatus
                  harnessLabel={harnesses.find(h => h.id === harness)?.label ?? harness}
                  status={modelsStatus} count={models.length}
                  error={modelsErr} expanded={showModelsErr} onToggle={() => setShowModelsErr(v => !v)}
                />
              </Field>

              {/* Pack */}
              <Field label="Task pack">
                <select value={packId} onChange={e => setPackId(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-border bg-base text-xs text-text-primary focus:outline-none focus:border-accent-blue/60">
                  {packs.filter(p => p.harness === 'any' || p.harness === harness).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.taskCount})</option>
                  ))}
                </select>
              </Field>

              {/* Samples (consistency) */}
              <Field label="Samples / task">
                <div className="flex rounded-lg border border-border overflow-hidden" title="Run each task N times and score on reliability (pass-consistency). The real separator between capable models.">
                  {[1, 3, 5].map(n => (
                    <button key={n} onClick={() => setSamples(n)}
                      className={clsx('px-3 py-1.5 text-xs font-medium tabular-nums transition-colors',
                        samples === n ? 'bg-card-hover text-text-primary' : 'bg-card text-text-muted hover:text-text-secondary')}>
                      {n}×
                    </button>
                  ))}
                </div>
              </Field>

              {/* Actions */}
              <div className="flex items-center gap-2 ml-auto">
                {isRunning ? (
                  <button onClick={cancel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-900/50 bg-amber-950/30 text-amber-300 text-xs font-medium hover:bg-amber-950/50">
                    <Square size={12} /> Cancel
                  </button>
                ) : (
                  <button onClick={start} disabled={!canRun}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent-blue/90 hover:bg-accent-blue disabled:opacity-40 text-white text-xs font-semibold">
                    {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Start run
                  </button>
                )}
                {run && run.failureCount > 0 && !isRunning && (
                  <button onClick={rerun} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
                    <RotateCcw size={12} /> Rerun failed
                  </button>
                )}
                {run && (
                  <a href={api.exportUrl(run.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
                    <Download size={12} /> Export
                  </a>
                )}
              </div>
            </div>

            {/* Advanced: endpoint override */}
            <div>
              <button onClick={() => setShowAdvanced(v => !v)} className="flex items-center gap-1 text-xxs text-text-muted hover:text-text-secondary">
                <ChevronRight size={11} className={clsx('transition-transform', showAdvanced && 'rotate-90')} />
                Advanced · OSS/local endpoint override
              </button>
              {showAdvanced && (
                <div className="flex flex-wrap items-end gap-3 mt-2 p-3 rounded-lg border border-border bg-card">
                  <Field label="OpenAI-compatible /v1 base URL">
                    <input value={endpoint} onChange={e => setEndpoint(e.target.value)}
                      placeholder="http://127.0.0.1:11434/v1 (Ollama / LM Studio / vLLM)"
                      className="w-80 px-3 py-1.5 rounded-lg border border-border bg-base text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60" />
                  </Field>
                  <Field label="Bearer token (optional)">
                    <input value={token} onChange={e => setToken(e.target.value)} type="password" placeholder="if required"
                      className="w-44 px-3 py-1.5 rounded-lg border border-border bg-base text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60" />
                  </Field>
                  <p className="text-xxs text-text-muted max-w-xs">When set, the run dispatches directly to this endpoint (still labelled <span className="text-accent-teal">harness_direct</span>) — used for local/OSS models.</p>
                </div>
              )}
            </div>

            {!harnessLive && !endpoint.trim() && (
              <p className="text-xxs text-text-muted flex items-center gap-1.5">
                <AlertTriangle size={11} className="text-amber-400" /> {harness} not connected — enable it in Settings, or set an endpoint override. Manual model entry still works.
              </p>
            )}
            {error && <p className="text-xxs text-red-400">{error}</p>}
          </div>

          {/* Past runs */}
          {runsList.length > 0 && (
            <div className="px-6 py-3 border-b border-border flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xxs uppercase tracking-wide text-text-muted font-medium flex items-center gap-1"><Clock size={11} /> Recent runs</span>
                <span className="text-xxs text-text-muted">({runsList.length})</span>
                <button onClick={refreshRuns} title="Refresh" className="p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary"><RefreshCw size={11} /></button>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => clearRuns('failed')} className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-card hover:bg-card-hover text-xxs text-text-muted hover:text-text-secondary">
                    <Trash2 size={10} /> Clear failed
                  </button>
                  <button onClick={() => clearRuns('all')} className="flex items-center gap-1 px-2 py-1 rounded border border-red-900/40 bg-red-950/20 hover:bg-red-950/40 text-xxs text-red-300">
                    <Trash2 size={10} /> Clear all
                  </button>
                </div>
              </div>
              <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
                {runsList.slice(0, 16).map(r => (
                  <RunChip key={r.id} run={r} selected={run?.id === r.id} onOpen={() => openRun(r.id)} onDelete={() => deleteRunById(r.id)} />
                ))}
              </div>
            </div>
          )}

          {/* Summary + lanes + table */}
          {run ? (
            <div className="px-6 py-4 flex flex-col gap-4">
              {/* Summary */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className={clsx('px-2 py-0.5 rounded border text-xxs font-medium capitalize flex items-center gap-1.5', RUN_STATUS_STYLE[run.status])}>
                    {isRunning && <Loader2 size={10} className="animate-spin" />}
                    {run.status}
                  </span>
                  <span className="px-2 py-0.5 rounded border border-accent-teal/40 bg-accent-teal/10 text-accent-teal text-xxs font-mono">{run.mode}</span>
                  <span className="text-xxs text-text-muted">{run.completedCount}/{run.taskCount} tasks · {relTime(run.startedAt)}</span>
                  {run.error && <span className={clsx('text-xxs truncate max-w-2xl', run.error.startsWith('⚠') ? 'text-amber-400' : 'text-red-400')} title={run.error}>· {run.error}</span>}
                  {!isRunning && (
                    <button onClick={() => deleteRunById(run.id)} title="Delete this run"
                      className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-card hover:bg-red-950/30 hover:border-red-900/40 text-xxs text-text-muted hover:text-red-300 transition-colors">
                      <Trash2 size={10} /> Delete
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  <Stat label="Harness" value={<span className="flex items-center gap-1"><Server size={12} className="text-text-muted" />{run.harness}</span>} />
                  <Stat label="Model" value={
                    run.resolvedModel && run.resolvedModel.toLowerCase() !== run.modelName.toLowerCase()
                      ? <span className="flex items-center gap-1" title={`requested ${run.modelName}`}><Cpu size={12} className="text-amber-400" /><span className="text-amber-300">{run.resolvedModel}</span></span>
                      : <span className="flex items-center gap-1"><Cpu size={12} className="text-text-muted" />{run.modelName}</span>
                  } />
                  <Stat label="Provider" value={run.provider} />
                  <Stat label="Total score" value={`${run.totalScore}/${run.maxScore}`} accent="text-accent-blue" />
                  <Stat label="Pass rate" value={run.passRate == null ? '—' : `${run.passRate}%`} accent={run.passRate != null && run.passRate >= 70 ? 'text-green-400' : 'text-amber-400'} />
                  <Stat label="Avg latency" value={fmtLatency(run.avgLatencyMs)} />
                  <Stat label="Failures" value={run.failureCount} accent={run.failureCount ? 'text-red-400' : 'text-green-400'} />
                </div>
              </div>

              {/* Lane cards */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-text-secondary">Lanes</span>
                  {laneFilter && (
                    <button onClick={() => setLaneFilter(null)} className="flex items-center gap-1 text-xxs text-accent-blue hover:underline">
                      <Filter size={10} /> clear filter ({laneLabel(laneFilter)})
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {lanes.map(meta => (
                    <LaneCard key={meta.id} meta={meta} results={results.filter(r => r.lane === meta.id)}
                      active={laneFilter === meta.id}
                      onClick={() => setLaneFilter(laneFilter === meta.id ? null : meta.id)} />
                  ))}
                </div>
              </div>

              {/* Results table */}
              <div className="rounded-xl border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface text-text-muted">
                      <th className="text-left font-medium px-3 py-2 w-20">Status</th>
                      <th className="text-left font-medium px-3 py-2">Lane</th>
                      <th className="text-left font-medium px-3 py-2">Task</th>
                      <th className="text-right font-medium px-3 py-2 w-16">Score</th>
                      <th className="text-right font-medium px-3 py-2 w-20">Latency</th>
                      <th className="text-left font-medium px-3 py-2 w-36">Failure</th>
                      <th className="px-3 py-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-text-muted">{isRunning ? 'Running tasks…' : 'No results'}</td></tr>
                    ) : filtered.map(r => {
                      const s = displayStyle(r)
                      return (
                        <tr key={r.id} className="border-b border-border-subtle hover:bg-card-hover cursor-pointer" onClick={() => setDetail(r)}>
                          <td className="px-3 py-2"><span className={clsx('flex items-center gap-1.5', s.text)}><span className={clsx('w-1.5 h-1.5 rounded-full', s.dot)} />{s.label}</span></td>
                          <td className="px-3 py-2 text-text-muted">{laneLabel(r.lane)}</td>
                          <td className="px-3 py-2 text-text-primary">{r.taskTitle}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className="text-text-secondary">{r.points}/{r.maxPoints}</span>
                            {(r.sampleCount ?? 1) > 1 && (
                              <span className={clsx('ml-1 text-xxs', (r.passCount ?? 0) === r.sampleCount ? 'text-green-400' : (r.passCount ?? 0) === 0 ? 'text-red-400' : 'text-amber-400')}>
                                {r.passCount}/{r.sampleCount}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtLatency(r.latencyMs)}</td>
                          <td className="px-3 py-2">{failureChip(r.failureType)}</td>
                          <td className="px-3 py-2 text-right"><ChevronRight size={13} className="text-text-muted inline" /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {scored.length === 0 && results.some(r => r.status === 'manual_review') && (
                <p className="text-xxs text-text-muted">Some tasks are rubric/manual-review and are intentionally not auto-scored.</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-center">
              <FlaskConical size={28} className="text-text-muted" />
              <p className="text-sm text-text-secondary">Pick a harness, model and task pack, then Start run.</p>
              <p className="text-xs text-text-muted max-w-md">Each task is dispatched live through the harness and scored deterministically across 9 agent-behavior lanes.</p>
            </div>
          )}
        </div>
      ) : (
        <ComparisonTab rows={comparison} lanes={lanes} mode={compareMode} onMode={setCompareMode} groupBy={groupBy} onGroupBy={setGroupBy} />
      )}

      {detail && <DetailDrawer result={detail} laneLabel={laneLabel} onClose={() => setDetail(null)} />}
    </div>
  )
}

// ─── compare tab ──────────────────────────────────────────────────────────────

// Build a spreadsheet-friendly CSV of the cross-model comparison (everything the
// table shows: headline metrics + per-lane scores), for sharing / offline analysis.
function comparisonToCsv(rows: HbComparisonRow[], lanes: HbLaneMeta[], groupBy: 'model' | 'provider'): string {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const head = ['Harness', groupBy === 'provider' ? 'Provider' : 'Model', 'Family', 'Models', 'Task pack',
    'Runs used', 'Runs', 'Overall %', 'Pass %', 'Reliability %', 'Speed ms', 'Speed stdev ms',
    'Avg tokens', 'Tokens estimated', 'Cost USD', 'Cost estimated', 'Fence %', 'Fails', ...lanes.map(l => l.short)]
  const lines = [head.map(esc).join(',')]
  for (const r of rows) {
    lines.push([r.harness, r.modelName, r.family, r.modelCount, r.taskPackName,
      r.runsUsed, r.runs, r.overallPct, r.passRate, r.reliabilityPct, r.avgLatencyMs, r.latencyStdevMs,
      r.avgOutputTokens, r.tokensEstimated, r.estCostUsd, r.costEstimated, r.fenceRate, r.failureCount,
      ...lanes.map(l => r.laneScores[l.id])].map(esc).join(','))
  }
  return lines.join('\n')
}

function ComparisonTab({ rows, lanes, mode, onMode, groupBy, onGroupBy }: {
  rows: HbComparisonRow[]; lanes: HbLaneMeta[]
  mode: 'latest' | 'average' | 'best'; onMode: (m: 'latest' | 'average' | 'best') => void
  groupBy: 'model' | 'provider'; onGroupBy: (g: 'model' | 'provider') => void
}) {
  const modeBlurb = mode === 'latest'
    ? 'Each row uses the most recent completed run per model + task pack — older runs don’t drag the score down.'
    : mode === 'average'
      ? 'Each row averages ALL completed runs per model + task pack.'
      : 'Each row uses each model’s single best run per task pack.'
  const ModeToggle = (
    <div className="flex items-center gap-1 p-0.5 rounded-lg border border-border bg-card">
      {(['latest', 'average', 'best'] as const).map(m => (
        <button key={m} onClick={() => onMode(m)}
          className={clsx('px-2.5 py-1 rounded text-xxs font-medium capitalize transition-colors',
            mode === m ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
          {m}
        </button>
      ))}
    </div>
  )
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([comparisonToCsv(rows, lanes, groupBy)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `harness-comparison-${groupBy}-${mode}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <span className="text-xs font-semibold text-text-secondary">Model comparison</span>
          <p className="text-xxs text-text-muted mt-0.5">{modeBlurb}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xxs uppercase tracking-wide text-text-muted">Group by</span>
            <div className="flex items-center gap-1 p-0.5 rounded-lg border border-border bg-card">
              {(['model', 'provider'] as const).map(g => (
                <button key={g} onClick={() => onGroupBy(g)}
                  className={clsx('px-2.5 py-1 rounded text-xxs font-medium capitalize transition-colors',
                    groupBy === g ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xxs uppercase tracking-wide text-text-muted">Compare by</span>
            {ModeToggle}
          </div>
          {rows.length > 0 && (
            <button onClick={exportCsv} title="Download this comparison as CSV"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
              <Download size={12} /> Export CSV
            </button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 text-center py-24">
          <Zap size={26} className="text-text-muted" />
          <p className="text-sm text-text-secondary">No completed runs to compare yet.</p>
          <p className="text-xs text-text-muted">Run a benchmark on the Benchmark tab — results show up here per model + task pack.</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface text-text-muted">
                  <th className="text-left font-medium px-3 py-2">{groupBy === 'provider' ? 'Provider' : 'Model'}</th>
                  <th className="text-left font-medium px-3 py-2">Task pack</th>
                  <th className="text-right font-medium px-3 py-2">Overall</th>
                  <th className="text-right font-medium px-3 py-2">Pass</th>
                  <th className="text-right font-medium px-3 py-2" title="Sample pass-consistency (Σpassed / Σsamples). At 1 sample this equals pass rate.">Reliab.</th>
                  <th className="text-right font-medium px-3 py-2" title="Average latency per task (± standard deviation = speed consistency)">Speed</th>
                  <th className="text-right font-medium px-3 py-2" title="Verbosity — mean output tokens per task (~ = estimated from chars when the harness reports no usage)">Tokens</th>
                  <th className="text-right font-medium px-3 py-2" title="Estimated USD per run (one pack pass). ~ = from the pricing table; real harness-reported cost is used when available.">Cost</th>
                  <th className="text-right font-medium px-3 py-2" title="Share of responses wrapped in ``` code fences (format/markdown tendency)">Fences</th>
                  <th className="text-right font-medium px-3 py-2">Fails</th>
                  <th className="text-right font-medium px-3 py-2" title="runs used / runs available">Runs</th>
                  <th className="text-center font-medium px-3 py-2" title="Overall % of each completed run over time (oldest → newest) — spot improvement or regression">Trend</th>
                  {lanes.map(l => <th key={l.id} className="text-right font-medium px-2 py-2 whitespace-nowrap" title={l.label}>{l.short}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.harness}-${r.modelName}-${r.taskPackId}-${i}`} className="border-b border-border-subtle hover:bg-card-hover">
                    <td className="px-3 py-2 font-medium">
                      {groupBy === 'provider' ? (
                        <span className={clsx(FAMILY_COLOR[r.family] ?? 'text-text-primary')}>
                          {r.family}<span className="text-text-muted font-normal"> · {r.modelCount} model{r.modelCount === 1 ? '' : 's'}</span>
                        </span>
                      ) : (
                        <span className="text-text-primary">{r.modelName}<span className={clsx('font-normal ml-1', FAMILY_COLOR[r.family] ?? 'text-text-muted')}>· {r.family}</span></span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-muted">{r.taskPackName}</td>
                    <td className={clsx('px-3 py-2 text-right font-bold tabular-nums', (r.overallPct ?? 0) >= 80 ? 'text-green-400' : (r.overallPct ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400')}>{r.overallPct == null ? '—' : `${r.overallPct}%`}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{r.passRate == null ? '—' : `${r.passRate}%`}</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', r.reliabilityPct == null ? 'text-text-muted' : r.reliabilityPct >= 90 ? 'text-green-400' : r.reliabilityPct >= 60 ? 'text-amber-400' : 'text-red-400')}
                        title={r.maxSamples > 1 ? `${r.maxSamples} samples/task` : '1 sample/task — equals pass rate; run 3×/5× for a real reliability signal'}>
                      {r.reliabilityPct == null ? '—' : `${r.reliabilityPct}%`}{r.maxSamples > 1 && <span className="text-text-muted text-xxs">·{r.maxSamples}×</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted" title={r.latencyStdevMs != null ? `± ${fmtLatency(r.latencyStdevMs)} stdev` : undefined}>
                      {fmtLatency(r.avgLatencyMs)}{r.latencyStdevMs != null && <span className="text-text-muted/60 text-xxs"> ±{fmtLatency(r.latencyStdevMs)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted" title={`${r.avgResponseChars} chars/task${r.tokensEstimated ? ' · tokens estimated from chars' : ''}`}>{fmtTokens(r.avgOutputTokens, r.tokensEstimated)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted" title={r.costEstimated ? 'estimated from the pricing table (no harness-reported cost)' : 'harness-reported cost'}>{fmtCost(r.estCostUsd, r.costEstimated)}</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', r.fenceRate === 0 ? 'text-text-muted' : 'text-amber-400')}>{r.fenceRate}%</td>
                    <td className={clsx('px-3 py-2 text-right tabular-nums', r.failureCount ? 'text-red-400' : 'text-text-muted')}>{r.failureCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">{mode === 'average' ? r.runs : `${r.runsUsed}/${r.runs}`}</td>
                    <td className="px-3 py-2 text-center"><Sparkline data={r.trend} /></td>
                    {lanes.map(l => {
                      const v = r.laneScores[l.id]
                      return <td key={l.id} className={clsx('px-2 py-2 text-right tabular-nums', v == null ? 'text-text-muted/40' : v >= 80 ? 'text-green-400' : v >= 50 ? 'text-amber-400' : 'text-red-400')}>{v == null ? '·' : v}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xxs text-text-muted mt-2 space-y-1">
            <p>Grouped by model + harness + task pack. Lane columns are pass-weighted percentages; “·” = no scored task in that lane.</p>
            <p>
              <span className="text-text-secondary">Model fingerprint</span> — differences that show even at equal accuracy:
              <b className="text-text-secondary"> Reliab.</b> = sample pass-consistency (run 3×/5× for signal) ·
              <b className="text-text-secondary"> Speed</b> = avg latency ± stdev (speed consistency) ·
              <b className="text-text-secondary"> Tokens</b> = mean output tokens/task (verbosity) ·
              <b className="text-text-secondary"> Cost</b> = est. USD per run ·
              <b className="text-text-secondary"> Fences</b> = % of replies wrapped in ``` (markdown tendency).
              <span className="text-text-muted"> A leading “~” means estimated (no harness-reported usage/cost). Pricing is editable in <code>server/lib/harnessBenchPricing.ts</code>.</span>
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xxs uppercase tracking-wide text-text-muted font-medium">{label}</label>
      {children}
    </div>
  )
}

// Recent-run card — model, pack, score, relative time, pass/fail counts, mode.
function RunChip({ run, selected, onOpen, onDelete }: {
  run: HbRun; selected: boolean; onOpen: () => void; onDelete: () => void
}) {
  const scorePct = run.maxScore > 0 ? Math.round((run.totalScore / run.maxScore) * 100) : null
  const passed = Math.max(0, run.completedCount - run.failureCount)
  const dot = run.status === 'completed' ? 'bg-green-500'
    : run.status === 'running' ? 'bg-blue-500 animate-pulse'
    : run.status === 'failed' ? 'bg-red-500'
    : run.status === 'cancelled' ? 'bg-amber-400' : 'bg-text-muted'
  return (
    <div className={clsx(
      'relative shrink-0 w-[208px] rounded-lg border p-2.5 transition-colors group',
      selected ? 'border-accent-blue bg-card-hover ring-1 ring-accent-blue/40' : 'border-border bg-card hover:bg-card-hover',
    )}>
      <button onClick={onOpen} className="w-full text-left">
        <div className="flex items-center gap-1.5 mb-0.5 pr-5">
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', dot)} />
          <span className="text-xs font-semibold text-text-primary truncate flex-1">{run.modelName}</span>
          {scorePct != null && (
            <span className={clsx('text-xs font-bold tabular-nums', scorePct >= 80 ? 'text-green-400' : scorePct >= 50 ? 'text-amber-400' : 'text-red-400')}>{scorePct}%</span>
          )}
        </div>
        <div className="text-xxs text-text-muted truncate mb-1">{run.taskPackName}</div>
        <div className="flex items-center gap-2 text-xxs tabular-nums">
          <span className="text-green-400">✓{passed}</span>
          <span className={run.failureCount ? 'text-red-400' : 'text-text-muted'}>✗{run.failureCount}</span>
          <span className="text-text-muted ml-auto">{relTime(run.startedAt)}</span>
        </div>
        <div className="mt-1">
          <span className="px-1.5 py-0.5 rounded border border-accent-teal/30 bg-accent-teal/10 text-accent-teal text-[10px] font-mono">{run.mode}</span>
        </div>
      </button>
      <button onClick={onDelete} title="Delete run"
        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-950/40 text-text-muted hover:text-red-300 transition-opacity">
        <Trash2 size={11} />
      </button>
    </div>
  )
}

// Compact connector status replacing the prominent model-fetch warning.
function ConnectorStatus({ harnessLabel, status, count, error, expanded, onToggle }: {
  harnessLabel: string; status: 'loading' | 'connected' | 'failed'; count: number
  error: string | null; expanded: boolean; onToggle: () => void
}) {
  const conf = status === 'loading'
    ? { Icon: Loader2, cls: 'text-text-muted', label: 'checking…', spin: true }
    : status === 'connected'
      ? { Icon: Wifi, cls: 'text-green-400', label: `connected · ${count} model${count === 1 ? '' : 's'}`, spin: false }
      : { Icon: WifiOff, cls: 'text-amber-400', label: count > 0 ? 'failed (cached)' : 'unavailable', spin: false }
  const Icon = conf.Icon
  const clickable = status === 'failed' && !!error
  return (
    <div className="mt-0.5">
      <button
        onClick={clickable ? onToggle : undefined}
        className={clsx('flex items-center gap-1 text-xxs', conf.cls, clickable && 'hover:underline cursor-pointer')}
      >
        <Icon size={10} className={conf.spin ? 'animate-spin' : ''} />
        {harnessLabel} models: {conf.label}
        {clickable && <ChevronRight size={9} className={clsx('transition-transform', expanded && 'rotate-90')} />}
      </button>
      {expanded && error && (
        <p className="text-xxs text-text-muted mt-1 max-w-[224px] break-words">{error} · manual model entry still works.</p>
      )}
    </div>
  )
}
