// title: Model Ops dashboard
// path: src/views/ModelOps.tsx
// purpose: Helicone-style operational model analytics — spend, latency, volume,
//          failure rate, cost-vs-latency scatter, and model/provider comparison.
//          Data comes from /api/modelops (real JSONL signals + mock fallback).

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Gauge, RefreshCw, AlertCircle, DollarSign, Timer, Zap, AlertTriangle,
  ScatterChart, Table2, Flame, TrendingUp, BarChart3, Layers, Boxes, CheckCircle2, XCircle,
} from 'lucide-react'
import {
  MiniStat, ChartCard, Histogram, Scatter, fmtNum,
  type Bar, type ScatterPoint,
} from '../components/charts'
import { modelOps, type ModelOpsResponse, type ModelOpsModelRow, type ModelOpsRun, type ModelOpsSourceRow, type ModelOpsScope } from '../lib/api'

type Period = '7d' | '14d' | '30d'
const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '14d': 14, '30d': 30 }

const SCOPES: Array<{ id: ModelOpsScope; label: string; hint: string }> = [
  { id: 'all',    label: 'All',         hint: 'Claude Code + agents combined' },
  { id: 'claude', label: 'Claude Code', hint: 'Local Claude Code (subscription) usage only' },
  { id: 'agents', label: 'Agents',      hint: 'OpenClaw + Hermes (per-token API billing) only' },
]

// ─── Formatting ──────────────────────────────────────────────────────────────────

function money(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`
  if (n >= 1)   return `$${n.toFixed(2)}`
  if (n > 0)    return `$${n.toFixed(4)}`
  return '$0'
}

function latency(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
}

function pct(n: number): string {
  if (!isFinite(n)) return '—'
  const v = n * 100
  return `${v < 1 && v > 0 ? v.toFixed(2) : v.toFixed(1)}%`
}

// ─── Color palettes ───────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: '#d97757',
  OpenAI:    '#10a37f',
  Google:    '#4285f4',
  Meta:      '#3b82f6',
  Mistral:   '#ff7000',
  DeepSeek:  '#7c83ff',
  xAI:       '#94a3b8',
  Other:     '#64748b',
}
function providerColor(p: string): string { return PROVIDER_COLORS[p] ?? PROVIDER_COLORS.Other }

function modelDotColor(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('opus'))   return '#8b5cf6'
  if (m.includes('sonnet')) return '#3b82f6'
  if (m.includes('haiku'))  return '#14b8a6'
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3')) return '#10a37f'
  if (m.includes('gemini')) return '#4285f4'
  return '#64748b'
}

function failureColor(rate: number): string {
  if (rate >= 0.05) return 'text-red-400'
  if (rate >= 0.02) return 'text-amber-400'
  if (rate > 0)     return 'text-yellow-400'
  return 'text-emerald-400'
}

const SOURCE_COLORS: Record<string, string> = {
  claude:   '#d97757',
  openclaw: '#22d3ee',
  hermes:   '#a78bfa',
  mock:     '#64748b',
}
const SOURCE_LABELS: Record<string, string> = {
  claude: 'Claude Code', openclaw: 'OpenClaw', hermes: 'Hermes', mock: 'Sample data',
}
function sourceColor(s: string): string { return SOURCE_COLORS[s] ?? '#64748b' }

// ─── By platform (Claude / OpenClaw / Hermes) ──────────────────────────────────────

function SourceBreakdown({ rows }: { rows: ModelOpsSourceRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {rows.map(r => {
        const hasData = r.runs > 0 || r.cost > 0
        return (
          <div key={r.source} className="bg-bg-secondary border border-white/10 rounded-xl p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: sourceColor(r.source) }} />
              <span className="text-sm font-semibold text-text-primary">{r.label}</span>
              <span className="ml-auto flex items-center gap-1 text-[10px]">
                {r.reachable
                  ? <><CheckCircle2 size={11} className="text-emerald-400" /><span className="text-emerald-400">connected</span></>
                  : <><XCircle size={11} className="text-text-muted" /><span className="text-text-muted">offline</span></>}
              </span>
            </div>

            {hasData ? (
              <>
                <div className="flex items-end gap-4">
                  <div>
                    <p className="text-xl font-bold text-emerald-400 tabular-nums leading-none">{money(r.cost)}</p>
                    <p className="text-[10px] text-text-muted mt-1">{r.models} model{r.models !== 1 ? 's' : ''} · {fmtNum(r.runs)} runs</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-xs text-text-secondary tabular-nums">{latency(r.avgLatencyMs)}</p>
                    <p className={clsx('text-[10px] tabular-nums', failureColor(r.failureRate))}>{pct(r.failureRate)} fail</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/5">
                  {r.topModels.map((m, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-text-secondary">
                      {m.modelLabel} <span className="text-text-muted">{money(m.cost)}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-text-muted py-2">
                {r.error ? r.error : 'No usage in this period'}
                {!r.reachable && (r.source === 'openclaw' || r.source === 'hermes') && (
                  <span className="block mt-1 text-[10px] opacity-70">Connect a token in Settings → {r.label} to pull its model usage.</span>
                )}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Cost vs latency scatter ───────────────────────────────────────────────────────

function CostLatencyScatter({ data }: { data: ModelOpsResponse }) {
  const points: ScatterPoint[] = useMemo(() => {
    const maxTokens = Math.max(...data.scatter.map(p => p.tokens), 1)
    return data.scatter.map(p => ({
      x: p.avgLatencyMs,
      y: p.cost,
      r: 3 + Math.sqrt(p.tokens / maxTokens) * 7,
      color: providerColor(p.provider),
      label:
        `${p.modelLabel} · ${p.provider}\n` +
        `via ${SOURCE_LABELS[p.source] ?? p.source}\n` +
        `cost ${money(p.cost)} · latency ${latency(p.avgLatencyMs)}\n` +
        `${fmtNum(p.tokens)} tokens · ${p.runs} runs · fail ${pct(p.failureRate)}\n` +
        `${p.date}`,
    }))
  }, [data.scatter])

  const providersPresent = useMemo(
    () => Array.from(new Set(data.scatter.map(p => p.provider))),
    [data.scatter],
  )

  return (
    <ChartCard
      title="Cost vs latency"
      icon={<ScatterChart size={13} className="text-violet-400" />}
      className="lg:col-span-2"
      right={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {providersPresent.map(p => (
            <span key={p} className="flex items-center gap-1 text-[10px] text-text-muted">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: providerColor(p) }} />
              {p}
            </span>
          ))}
        </div>
      }
    >
      <Scatter
        points={points}
        height={260}
        xLabel="avg latency"
        yLabel="cost (USD)"
        xFormat={latency}
        yFormat={money}
      />
      <p className="text-[10px] text-text-muted mt-1.5">
        One point per session cluster · bubble size ∝ token volume · hover for details
      </p>
    </ChartCard>
  )
}

// ─── Provider comparison ────────────────────────────────────────────────────────────

function ProviderComparison({ data }: { data: ModelOpsResponse }) {
  const maxCost = Math.max(...data.providers.map(p => p.cost), 0.0001)
  return (
    <ChartCard title="Providers" icon={<Layers size={13} className="text-violet-400" />}>
      <div className="space-y-3">
        {data.providers.map(p => (
          <div key={p.provider} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: providerColor(p.provider) }} />
              <span className="text-xs font-medium text-text-primary">{p.provider}</span>
              <span className="ml-auto text-xs font-semibold text-text-primary tabular-nums">{money(p.cost)}</span>
            </div>
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max((p.cost / maxCost) * 100, 3)}%`, backgroundColor: providerColor(p.provider) }} />
            </div>
            <div className="flex items-center gap-3 text-[10px] text-text-muted">
              <span>{p.runs} runs</span>
              <span>{fmtNum(p.tokens)} tok</span>
              <span>{latency(p.avgLatencyMs)}</span>
              <span className={failureColor(p.failureRate)}>{pct(p.failureRate)} fail</span>
            </div>
          </div>
        ))}
        {data.providers.length === 0 && <p className="text-xs text-text-muted">No provider data</p>}
      </div>
    </ChartCard>
  )
}

// ─── Model comparison table ─────────────────────────────────────────────────────────

function ModelTable({ models }: { models: ModelOpsModelRow[] }) {
  const maxCost = Math.max(...models.map(m => m.cost), 0.0001)
  return (
    <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <Table2 size={13} className="text-violet-400" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Model comparison</h3>
        <span className="ml-auto text-[10px] text-text-muted">{models.length} models</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-white/5">
              <th className="text-left  font-semibold px-4 py-2">Model</th>
              <th className="text-left  font-semibold px-3 py-2">Platform</th>
              <th className="text-left  font-semibold px-3 py-2">Provider</th>
              <th className="text-right font-semibold px-3 py-2">Runs</th>
              <th className="text-right font-semibold px-3 py-2">Tokens</th>
              <th className="text-right font-semibold px-3 py-2">Avg latency</th>
              <th className="text-right font-semibold px-3 py-2">P95</th>
              <th className="text-right font-semibold px-4 py-2">Cost</th>
              <th className="text-right font-semibold px-4 py-2">Fail rate</th>
            </tr>
          </thead>
          <tbody>
            {models.map(m => (
              <tr key={`${m.source}-${m.model}`} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: modelDotColor(m.model) }} />
                    <span className="font-medium text-text-primary truncate">{m.modelLabel}</span>
                    {m.estimated && (
                      <span className="text-[9px] px-1 py-px rounded bg-white/5 text-text-muted border border-white/10" title="Latency estimated — no inter-message samples for this model">est</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: sourceColor(m.source) }} />
                    {m.sourceLabel}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-text-secondary">{m.provider}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{m.runs}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{fmtNum(m.tokens)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{latency(m.avgLatencyMs)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{latency(m.p95LatencyMs)}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden sm:block w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.max((m.cost / maxCost) * 100, 4)}%` }} />
                    </div>
                    <span className="tabular-nums font-semibold text-emerald-400 w-16 text-right">{money(m.cost)}</span>
                  </div>
                </td>
                <td className={clsx('px-4 py-2.5 text-right tabular-nums font-medium', failureColor(m.failureRate))}>
                  {pct(m.failureRate)}
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-text-muted">No model data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Run panels (expensive / slow) ──────────────────────────────────────────────────

function RunPanel({
  title, icon, runs, metric,
}: {
  title: string
  icon: React.ReactNode
  runs: ModelOpsRun[]
  metric: 'cost' | 'latency'
}) {
  const max = Math.max(...runs.map(r => (metric === 'cost' ? r.cost : r.avgLatencyMs)), 0.0001)
  return (
    <ChartCard title={title} icon={icon}>
      <div className="space-y-0">
        {runs.map((r, i) => {
          const v = metric === 'cost' ? r.cost : r.avgLatencyMs
          const accent = metric === 'cost' ? 'bg-rose-500/60' : 'bg-amber-500/60'
          const valColor = metric === 'cost' ? 'text-rose-400' : 'text-amber-400'
          return (
            <div key={`${r.id}-${i}`} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: sourceColor(r.source) }} title={r.sourceLabel} />
              <span className="text-xs text-text-secondary w-24 flex-shrink-0 truncate" title={`${r.modelLabel} · ${r.sourceLabel}`}>{r.modelLabel}</span>
              <div className="flex-1 min-w-0 relative h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className={clsx('absolute inset-y-0 left-0 rounded-full', accent)} style={{ width: `${Math.max((v / max) * 100, 3)}%` }} />
              </div>
              <span className={clsx('text-xs font-semibold tabular-nums w-16 text-right flex-shrink-0', valColor)}>
                {metric === 'cost' ? money(r.cost) : latency(r.avgLatencyMs)}
              </span>
              <span className="hidden md:block text-[10px] text-text-muted w-20 flex-shrink-0 text-right">
                {metric === 'cost' ? `${fmtNum(r.tokens)} tok` : money(r.cost)}
              </span>
            </div>
          )
        })}
        {runs.length === 0 && <p className="text-xs text-text-muted py-2">No runs</p>}
      </div>
    </ChartCard>
  )
}

// ─── Usage trend ────────────────────────────────────────────────────────────────────

function UsageTrend({ data }: { data: ModelOpsResponse }) {
  const trend = data.trend
  const span = trend.length > 0 ? `${trend[0].date} – ${trend[trend.length - 1].date}` : ''

  const series: Array<{ key: 'cost' | 'requests' | 'avgLatencyMs'; label: string; color: string; fmt: (n: number) => string }> = [
    { key: 'cost',         label: 'Spend',       color: '#34d399', fmt: money },
    { key: 'requests',     label: 'Requests',    color: '#60a5fa', fmt: (n) => String(Math.round(n)) },
    { key: 'avgLatencyMs', label: 'Avg latency', color: '#fbbf24', fmt: latency },
  ]

  return (
    <ChartCard
      title="Usage trend"
      icon={<TrendingUp size={13} className="text-violet-400" />}
      right={<span className="text-[10px] text-text-muted">{span}</span>}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {series.map(s => {
          const bars: Bar[] = trend.map(d => ({
            value: d[s.key],
            color: s.color,
            label: `${d.date} · ${s.fmt(d[s.key])}`,
          }))
          const latest = trend[trend.length - 1]
          return (
            <div key={s.key} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{s.label}</span>
                {latest && <span className="text-xs font-semibold tabular-nums" style={{ color: s.color }}>{s.fmt(latest[s.key])}</span>}
              </div>
              {bars.length > 0
                ? <Histogram bars={bars} height={56} />
                : <div className="h-14 flex items-center justify-center text-[10px] text-text-muted">No data</div>}
            </div>
          )
        })}
      </div>
    </ChartCard>
  )
}

// ─── Main view ──────────────────────────────────────────────────────────────────────

export function ModelOps() {
  const [period, setPeriod]   = useState<Period>('7d')
  const [scope, setScope]     = useState<ModelOpsScope>('all')
  const [data, setData]       = useState<ModelOpsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      setData(await modelOps.summary(PERIOD_DAYS[period], scope))
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load model analytics')
    } finally {
      setLoading(false)
    }
  }, [period, scope])

  useEffect(() => { load() }, [load])

  const s = data?.summary
  const isMock = data?.source === 'mock'

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Gauge size={20} className="text-violet-400 flex-shrink-0" />
          <h1 className="text-lg font-semibold text-text-primary">Model Ops</h1>
          {data && (
            <span className={clsx(
              'text-[10px] px-2 py-0.5 rounded-full border flex-shrink-0',
              isMock
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
            )}>
              {isMock ? 'sample data' : data.source === 'mixed' ? 'live · multi-source' : 'live · Claude sessions'}
            </span>
          )}
          {data && data.estimatedDimensions.length > 0 && (
            <span className="hidden sm:inline text-[10px] text-text-muted" title="These metrics are estimated from model tier where direct telemetry is unavailable">
              {data.estimatedDimensions.join(', ')} estimated
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-bg-secondary rounded border border-white/10 p-0.5">
            {SCOPES.map(sc => (
              <button key={sc.id} onClick={() => setScope(sc.id)} title={sc.hint}
                className={clsx('px-3 py-1 rounded text-xs font-medium transition-all',
                  scope === sc.id ? 'bg-white/10 text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {sc.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-bg-secondary rounded border border-white/10 p-0.5">
            {(['7d', '14d', '30d'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={clsx('px-3 py-1 rounded text-xs font-medium transition-all',
                  period === p ? 'bg-white/10 text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {p}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400 flex-shrink-0">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <MiniStat
            label={scope === 'agents' ? 'API spend' : 'Token value'}
            value={loading || !s ? '—' : money(s.totalSpend)}
            sub={s
              ? (scope === 'agents'
                  ? `${period} · real API $ · ${s.spendTrendPct > 0 ? '↑' : s.spendTrendPct < 0 ? '↓' : '→'} ${Math.abs(s.spendTrendPct)}%`
                  : `${period} · notional · Claude on subscription`)
              : ''}
            accent="text-emerald-400"
            icon={<DollarSign size={12} />}
          />
          <MiniStat
            label="Avg latency"
            value={loading || !s ? '—' : latency(s.avgLatencyMs)}
            sub={s ? 'per request, run-weighted' : ''}
            accent="text-amber-300"
            icon={<Timer size={12} />}
          />
          <MiniStat
            label="Requests"
            value={loading || !s ? '—' : fmtNum(s.totalRequests)}
            sub={s ? `${s.modelCount} models · ${s.providerCount} providers` : ''}
            accent="text-blue-300"
            icon={<Zap size={12} />}
          />
          <MiniStat
            label="Failure rate"
            value={loading || !s ? '—' : pct(s.failureRate)}
            sub={s ? `${s.failures} failed of ${fmtNum(s.totalRequests)}` : ''}
            accent={s ? failureColor(s.failureRate) : 'text-text-primary'}
            icon={<AlertTriangle size={12} />}
          />
        </div>

        {loading && !data && (
          <div className="flex items-center gap-2 text-xs text-text-muted animate-pulse">
            <RefreshCw size={12} className="animate-spin" /> Loading model analytics…
          </div>
        )}

        {data && (
          <>
            {/* By platform — what Claude / OpenClaw / Hermes are each using.
                Hidden when only one platform is in view (the toggle says it all). */}
            {data.bySource.length > 1 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Boxes size={13} className="text-violet-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">By platform</h3>
                  {scope !== 'all' && (
                    <span className="text-[10px] text-text-muted">· separated from Claude Code (different billing model)</span>
                  )}
                </div>
                <SourceBreakdown rows={data.bySource} />
              </div>
            )}

            {/* Scatter + providers */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
              <CostLatencyScatter data={data} />
              <ProviderComparison data={data} />
            </div>

            {/* Model comparison table */}
            <ModelTable models={data.models} />

            {/* Expensive + slow runs */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
              <RunPanel title="Most expensive runs" icon={<Flame size={13} className="text-rose-400" />} runs={data.expensiveRuns} metric="cost" />
              <RunPanel title="Slowest runs"        icon={<Timer size={13} className="text-amber-400" />} runs={data.slowRuns} metric="latency" />
            </div>

            {/* Usage trend */}
            <UsageTrend data={data} />

            {/* Empty state */}
            {data.models.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
                <BarChart3 size={32} className="opacity-30" />
                <p className="text-sm">No model activity in this period</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
