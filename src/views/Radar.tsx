import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { TrendingUp, Activity, DollarSign, Zap, BarChart2, RefreshCw, AlertCircle, Bot } from 'lucide-react'
import { radar, type DailyUsageLive, type RadarUsageResponse } from '../lib/api'

type Period = '7d' | '14d' | '30d'

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ─── CSS bar chart ─────────────────────────────────────────────────────────────

function BarChart({ data, valueKey, color, prefix = '' }: {
  data: DailyUsageLive[]
  valueKey: 'tokens' | 'cost' | 'runs'
  color: string
  prefix?: string
}) {
  const max = Math.max(...data.map(d => d[valueKey]), 1)
  const last = data[data.length - 1]

  return (
    <div className="flex items-end gap-1 h-24 w-full">
      {data.map((d, i) => {
        const isLast = d === last
        const pct    = (d[valueKey] / max) * 100
        const val    = d[valueKey]
        const label  = valueKey === 'cost' ? `$${val.toFixed(4)}` : valueKey === 'tokens' ? fmt(val) : String(val)

        return (
          <div key={i} className="group relative flex-1 flex flex-col items-center justify-end h-full">
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
              <div className="bg-surface border border-border rounded px-2 py-1 text-center whitespace-nowrap">
                <p className="text-xxs font-semibold text-text-primary">{prefix}{label}</p>
                <p className="text-xxs text-text-muted">{d.date}</p>
              </div>
            </div>
            <div
              className={clsx('w-full rounded-t transition-all', color, isLast ? 'opacity-100' : 'opacity-50 hover:opacity-75')}
              style={{ height: `${Math.max(pct, 2)}%` }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string; sub: string; icon: React.ReactNode; color: string
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 bg-card rounded-lg border border-border">
      <div className={clsx('flex items-center gap-1.5', color)}>
        {icon}
        <span className="text-xxs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-text-primary tabular-nums">{value}</p>
      <p className="text-xxs text-text-muted">{sub}</p>
    </div>
  )
}

// ─── Model breakdown row ───────────────────────────────────────────────────────

const MODEL_COLORS: Record<string, string> = {
  opus:    '#8b5cf6',
  sonnet:  '#3b82f6',
  haiku:   '#14b8a6',
}

function modelColor(model: string): string {
  for (const [key, color] of Object.entries(MODEL_COLORS)) {
    if (model.toLowerCase().includes(key)) return color
  }
  return '#64748b'
}

function modelShortName(model: string): string {
  if (model.includes('opus'))   return 'Opus'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('haiku'))  return 'Haiku'
  return model.split('-').slice(0, 2).join('-')
}

function ModelRow({ stat, maxTokens }: { stat: RadarUsageResponse['modelBreakdown'][0]; maxTokens: number }) {
  const pct   = maxTokens > 0 ? (stat.tokens / maxTokens) * 100 : 0
  const color = modelColor(stat.model)
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 w-24 shrink-0">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-semibold text-text-primary">{modelShortName(stat.model)}</span>
      </div>
      <div className="flex-1">
        <div className="flex justify-between text-xxs text-text-muted mb-1">
          <span>{fmt(stat.tokens)} tokens</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full opacity-80" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
      <div className="flex items-center gap-5 shrink-0">
        <div className="text-right">
          <p className="text-xs font-semibold text-text-primary tabular-nums">${stat.cost.toFixed(4)}</p>
          <p className="text-xxs text-text-muted">cost</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-text-primary tabular-nums">{stat.runs}</p>
          <p className="text-xxs text-text-muted">runs</p>
        </div>
      </div>
    </div>
  )
}

// ─── Not configured banner ────────────────────────────────────────────────────

function SetupBanner({ error }: { error: string }) {
  const notConfigured = error.includes('not configured')
  return (
    <div className={clsx(
      'flex items-start gap-3 mx-6 mt-4 px-4 py-3 rounded-lg border',
      notConfigured
        ? 'border-amber-900/40 bg-amber-950/20 text-amber-300'
        : 'border-red-900/40 bg-red-950/20 text-red-300',
    )}>
      <AlertCircle size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">
          {notConfigured ? 'Anthropic API key not configured' : 'Failed to load usage data'}
        </p>
        <p className="text-xxs opacity-70 mt-1">
          {notConfigured
            ? <>Add <code className="font-mono">ANTHROPIC_API_KEY</code> to your <code className="font-mono">.env</code> file and restart the server.</>
            : error
          }
        </p>
      </div>
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export function Radar() {
  const [period, setPeriod] = useState<Period>('7d')
  const [data, setData]     = useState<RadarUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const periodDays: Record<Period, number> = { '7d': 7, '14d': 14, '30d': 30 }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await radar.usage(periodDays[period])
      setData(res)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const daily    = data?.dailyUsage ?? []
  const models   = data?.modelBreakdown ?? []
  const maxModel = Math.max(...models.map(m => m.tokens), 1)
  const today    = daily[daily.length - 1]

  const avgPerDay = daily.length > 0
    ? (data!.totalRuns / daily.length).toFixed(1)
    : '0'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Radar</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading
              ? <span className="animate-pulse">Loading usage data…</span>
              : data
              ? <><span className="text-text-secondary">
                    {period} · {fmt(data.totalTokens)} tokens · ${data.totalCost.toFixed(4)}
                  </span>
                  {today && <>&nbsp;·&nbsp;<span className="opacity-50">today: {fmt(today.tokens)} tok</span></>}
                </>
              : 'Usage analytics'
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="p-1.5 rounded border border-border bg-card text-text-muted hover:text-text-secondary transition-colors disabled:opacity-50">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="flex items-center gap-1 bg-card rounded border border-border p-0.5">
            {(['7d', '14d', '30d'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={clsx('px-3 py-1 rounded text-xs font-medium transition-all',
                  period === p ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && <SetupBanner error={error} />}

      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
        {/* Stat cards */}
        {(data || loading) && (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard
              label="Total Cost"
              value={loading ? '—' : `$${data!.totalCost.toFixed(4)}`}
              sub={`${period} period`}
              icon={<DollarSign size={12} />}
              color="text-green-400"
            />
            <StatCard
              label="Total Tokens"
              value={loading ? '—' : fmt(data!.totalTokens)}
              sub="input + output"
              icon={<Activity size={12} />}
              color="text-violet-400"
            />
            <StatCard
              label="Total Runs"
              value={loading ? '—' : String(data!.totalRuns)}
              sub={loading ? '' : `${avgPerDay} runs/day avg`}
              icon={<Zap size={12} />}
              color="text-blue-400"
            />
            <StatCard
              label="Today"
              value={loading || !today ? '—' : `$${today.cost.toFixed(4)}`}
              sub={loading || !today ? '' : `${today.runs} runs · ${fmt(today.tokens)} tok`}
              icon={<TrendingUp size={12} />}
              color="text-amber-400"
            />
          </div>
        )}

        {/* Charts */}
        {daily.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[
              { valueKey: 'cost'   as const, label: 'Daily Cost',   color: 'bg-green-500',  prefix: '$' },
              { valueKey: 'tokens' as const, label: 'Daily Tokens', color: 'bg-violet-500', prefix: ''  },
              { valueKey: 'runs'   as const, label: 'Daily Runs',   color: 'bg-blue-500',   prefix: ''  },
            ].map(({ valueKey, label, color, prefix }) => (
              <div key={valueKey} className="flex flex-col gap-3 bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-text-muted">
                    <BarChart2 size={12} />
                    <span className="text-xxs font-semibold uppercase tracking-wider">{label}</span>
                  </div>
                </div>
                <BarChart data={daily} valueKey={valueKey} color={color} prefix={prefix} />
                <div className="flex justify-between text-xxs text-text-muted pt-1 border-t border-border-subtle">
                  <span>{daily[0]?.date}</span>
                  <span>{daily[daily.length - 1]?.date}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Model breakdown */}
        {models.length > 0 && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Activity size={12} className="text-text-muted" />
              <span className="text-xxs font-semibold uppercase tracking-wider text-text-muted">By Model — {period}</span>
              {data?.fetchedAt && (
                <span className="ml-auto text-xxs text-text-muted opacity-40">
                  {new Date(data.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            {models.map(stat => <ModelRow key={stat.model} stat={stat} maxTokens={maxModel} />)}
          </div>
        )}

        {/* OpenClaw activity */}
        {data?.openclawStats && data.openclawStats.length > 0 && (() => {
          const stats = data.openclawStats!
          const totalEvents   = stats.reduce((s, d) => s + d.events, 0)
          const totalMessages = stats.reduce((s, d) => s + d.messages, 0)
          const maxEvents     = Math.max(...stats.map(d => d.events), 1)
          return (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <Bot size={12} className="text-amber-400" />
                <span className="text-xxs font-semibold uppercase tracking-wider text-text-muted">OpenClaw Activity — {period}</span>
                <span className="ml-auto flex items-center gap-3 text-xxs text-text-muted">
                  <span>{totalEvents} events</span>
                  <span>{totalMessages} messages</span>
                </span>
              </div>
              <div className="px-4 py-4">
                <div className="flex items-end gap-[2px] h-20">
                  {stats.map(d => {
                    const h = maxEvents > 0 ? (d.events / maxEvents) * 100 : 0
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                        <div className="w-full rounded-sm bg-amber-500/80 transition-all group-hover:bg-amber-400"
                             style={{ height: `${Math.max(h, 2)}%` }} />
                        <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:block
                                        bg-card-hover border border-border rounded px-1.5 py-0.5 text-xxs text-text-primary whitespace-nowrap z-10">
                          {d.events} events · {d.messages} msgs
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-between text-xxs text-text-muted pt-2 border-t border-border-subtle mt-3">
                  <span>{stats[0]?.date}</span>
                  <span>{stats[stats.length - 1]?.date}</span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Empty state when API key not set */}
        {!loading && !data && !error && (
          <div className="flex flex-col items-center justify-center h-40">
            <BarChart2 size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">No usage data available</span>
          </div>
        )}
      </div>
    </div>
  )
}
