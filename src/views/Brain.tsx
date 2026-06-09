import { useState, useEffect, useCallback, useMemo } from 'react'
import { isRefreshPaused } from '../lib/refreshBus'
import { LiveBadge } from '../components/LiveBadge'
import { clsx } from 'clsx'
import {
  Brain as BrainIcon, RefreshCw, AlertTriangle, ChevronRight, ChevronDown,
  Zap, Activity, Cpu, AlertCircle, BarChart3, PieChart, Layers,
} from 'lucide-react'
import { MiniStat, Histogram, Donut, ChartCard, type Bar, type Segment } from '../components/charts'

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = 'all' | 'openclaw' | 'hermes'

interface BrainEvent {
  id:         string
  source:     string
  eventType:  string
  sessionKey: string | null
  agentId:    string | null
  ts:         string
  payload:    Record<string, unknown>
}

interface LoopSignal {
  tool:       string
  count:      number
  sessionKey: string | null
}

interface BrainResponse {
  events:      BrainEvent[]
  total:       number
  typeCounts:  Record<string, number>
  topTools:    Array<{ tool: string; count: number }>
  loopSignals: LoopSignal[]
  fetchedAt:   string
}

interface StatsResponse {
  stats: Record<string, {
    total:      number
    typeCounts: Record<string, number>
    daily:      Array<{ date: string; count: number }>
    oldest:     string | null
    newest:     string | null
  }>
  fetchedAt: string
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchBrainEvents(source: Source, limit: number, typeFilter: string): Promise<BrainResponse> {
  const params = new URLSearchParams({ source, limit: String(limit) })
  if (typeFilter && typeFilter !== 'all') params.set('type', typeFilter)
  const res = await fetch(`/api/brain/events?${params}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function fetchBrainStats(): Promise<StatsResponse> {
  const res = await fetch('/api/brain/stats')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function typeColor(t: string): string {
  const l = t.toLowerCase()
  if (l.includes('error') || l.includes('fail'))  return 'text-red-400'
  if (l.includes('tool'))                          return 'text-amber-400'
  if (l.includes('session'))                       return 'text-blue-400'
  if (l.includes('message') || l.includes('msg')) return 'text-emerald-400'
  if (l.includes('cron'))                          return 'text-violet-400'
  return 'text-slate-400'
}

function sourceDot(s: string): string {
  if (s === 'openclaw') return 'bg-cyan-400'
  if (s === 'hermes')   return 'bg-violet-400'
  return 'bg-slate-400'
}

// Hex equivalents of typeColor() for SVG/inline-styled charts.
function categoryHex(t: string): string {
  const l = t.toLowerCase()
  if (l.includes('error') || l.includes('fail'))  return '#f87171' // red-400
  if (l.includes('tool'))                          return '#fbbf24' // amber-400
  if (l.includes('session'))                       return '#60a5fa' // blue-400
  if (l.includes('message') || l.includes('msg')) return '#4ade80' // emerald-400
  if (l.includes('cron'))                          return '#a78bfa' // violet-400
  return '#64748b'                                                  // slate-500
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60)   return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 48)    return `${hrs}h`
  return `${Math.round(hrs / 24)}d`
}

// ─── Activity overview (histogram + type donut + stat strip) ───────────────────

function BrainOverview({ data }: { data: BrainResponse }) {
  const BUCKETS = 48

  const { bars, windowLabel } = useMemo(() => {
    const evs = data.events
    if (evs.length === 0) return { bars: [] as Bar[], windowLabel: '' }
    const times = evs.map(e => new Date(e.ts).getTime())
    const max = Math.max(...times)
    const min = Math.min(...times)
    const span = Math.max(max - min, 1)
    const step = span / BUCKETS
    const counts: Array<Map<string, number>> = Array.from({ length: BUCKETS }, () => new Map())
    for (const e of evs) {
      const idx = Math.min(BUCKETS - 1, Math.floor((new Date(e.ts).getTime() - min) / step))
      const cat = e.eventType.split(':')[0]
      counts[idx].set(cat, (counts[idx].get(cat) ?? 0) + 1)
    }
    const bars: Bar[] = counts.map((m, i) => {
      let total = 0, topCat = '', topN = 0
      for (const [cat, n] of m) { total += n; if (n > topN) { topN = n; topCat = cat } }
      const bucketStart = new Date(min + i * step)
      return {
        value: total,
        color: topCat ? categoryHex(topCat) : '#64748b',
        label: `${total} events · ${bucketStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      }
    })
    return { bars, windowLabel: fmtDuration(span) }
  }, [data.events])

  const typeSegments: Segment[] = useMemo(() => {
    return Object.entries(data.typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([type, value]) => ({ value, color: categoryHex(type), label: type }))
  }, [data.typeCounts])

  const sourcesActive = new Set(data.events.map(e => e.source)).size
  const topTool = data.topTools[0]

  return (
    <div className="space-y-4">
      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Events" value={data.total.toLocaleString()} sub="in window" icon={<Activity size={12} />} accent="text-text-primary" />
        <MiniStat label="Event types" value={String(Object.keys(data.typeCounts).length)} sub={typeSegments[0]?.label ?? '—'} icon={<Layers size={12} />} accent="text-violet-300" />
        <MiniStat label="Top tool" value={topTool ? `${topTool.count}×` : '—'} sub={topTool?.tool ?? 'no tool calls'} icon={<Zap size={12} />} accent="text-amber-300" />
        <MiniStat label="Loop signals" value={String(data.loopSignals.length)} sub={data.loopSignals.length ? 'review needed' : 'all clear'} icon={<Cpu size={12} />} accent={data.loopSignals.length ? 'text-amber-400' : 'text-emerald-400'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity density */}
        <ChartCard
          title="Activity density"
          icon={<BarChart3 size={13} className="text-violet-400" />}
          right={windowLabel && <span className="text-[10px] text-text-muted">{sourcesActive} source{sourcesActive !== 1 ? 's' : ''} · {windowLabel} span</span>}
          className="lg:col-span-2"
        >
          {bars.length > 0
            ? <Histogram bars={bars} height={72} />
            : <div className="h-[72px] flex items-center justify-center text-xs text-text-muted">No events to chart</div>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {['message', 'tool', 'session', 'error', 'cron'].map(cat => (
              <div key={cat} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: categoryHex(cat) }} />
                <span className="text-[10px] text-text-muted capitalize">{cat}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        {/* Type distribution donut */}
        <ChartCard title="By type" icon={<PieChart size={13} className="text-violet-400" />}>
          {typeSegments.length > 0 ? (
            <div className="flex items-center gap-4">
              <Donut segments={typeSegments} centerTop={data.total.toLocaleString()} centerBottom="events" />
              <div className="flex-1 min-w-0 space-y-1.5">
                {typeSegments.map(s => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="text-xs text-text-muted truncate flex-1">{s.label}</span>
                    <span className="text-xs text-text-primary tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[92px] flex items-center justify-center text-xs text-text-muted">No data</div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}

// ─── Event row ───────────────────────────────────────────────────────────────

function EventRow({ e }: { e: BrainEvent }) {
  const [open, setOpen] = useState(false)
  const payload = JSON.stringify(e.payload, null, 2)

  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-left transition-colors"
      >
        <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', sourceDot(e.source))} />
        <span className={clsx('text-xs font-mono w-36 flex-shrink-0 truncate', typeColor(e.eventType))}>{e.eventType}</span>
        <span className="text-xs text-text-muted flex-shrink-0 w-24 text-right font-mono">{fmtTime(e.ts)}</span>
        <span className="text-xs text-slate-500 flex-shrink-0 w-20">{fmtDate(e.ts)}</span>
        <span className="text-xs text-text-muted truncate flex-1 min-w-0">
          {e.sessionKey ? <span className="font-mono text-slate-500 mr-2">{e.sessionKey.slice(0, 12)}…</span> : null}
          {e.agentId ? <span className="text-slate-600 mr-2">{e.agentId.slice(0, 12)}</span> : null}
          {(e.payload as any)?.tool ?? (e.payload as any)?.toolName ?? (e.payload as any)?.content?.toString().slice(0, 60) ?? ''}
        </span>
        {open ? <ChevronDown size={14} className="text-text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-text-muted flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-4 pb-3 bg-black/20">
          <pre className="text-xs text-text-muted font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-60 overflow-y-auto">{payload}</pre>
        </div>
      )}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function Brain() {
  const [source, setSource]         = useState<Source>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [limit, setLimit]           = useState(200)
  const [tab, setTab]               = useState<'events' | 'stats' | 'loops'>('events')
  const [data, setData]             = useState<BrainResponse | null>(null)
  const [stats, setStats]           = useState<StatsResponse | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const loadEvents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [evR, stR] = await Promise.all([fetchBrainEvents(source, limit, typeFilter), fetchBrainStats()])
      setData(evR); setStats(stR)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [source, limit, typeFilter])

  useEffect(() => { loadEvents() }, [loadEvents])

  // Keep the event brain live: silent auto-refresh every 10s (honours global Pause).
  useEffect(() => {
    const t = setInterval(() => { if (!isRefreshPaused()) loadEvents(true) }, 10_000)
    return () => clearInterval(t)
  }, [loadEvents])

  const typeOptions = ['all', ...Object.keys(data?.typeCounts ?? {}).sort()]

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <BrainIcon size={20} className="text-violet-400" />
          <h1 className="text-lg font-semibold text-text-primary">Brain</h1>
          <span className="text-xs text-text-muted bg-white/5 px-2 py-0.5 rounded-full">event inspector</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Source filter */}
          <select
            value={source}
            onChange={e => setSource(e.target.value as Source)}
            className="text-xs bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-text-primary"
          >
            <option value="all">All sources</option>
            <option value="openclaw">OpenClaw</option>
            <option value="hermes">Hermes</option>
          </select>
          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="text-xs bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-text-primary"
          >
            {typeOptions.map(t => (
              <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
            ))}
          </select>
          {/* Limit */}
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="text-xs bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-text-primary"
          >
            {[50, 100, 200, 500].map(n => <option key={n} value={n}>Last {n}</option>)}
          </select>
          <LiveBadge className="mr-1" />
          <button
            onClick={() => loadEvents()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors"
          >
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 pt-3 flex-shrink-0">
        {(['events', 'stats', 'loops'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-3 py-1.5 text-xs rounded-md transition-colors capitalize',
              tab === t ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'text-text-muted hover:text-text-primary hover:bg-white/5'
            )}
          >
            {t}
            {t === 'loops' && (data?.loopSignals?.length ?? 0) > 0 && (
              <span className="ml-1.5 bg-amber-500/20 text-amber-400 text-[10px] px-1.5 rounded-full">{data!.loopSignals.length}</span>
            )}
          </button>
        ))}
        {data && (
          <span className="ml-auto text-xs text-text-muted">
            {data.total.toLocaleString()} events · updated {new Date(data.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto mt-3">

        {/* Events tab */}
        {tab === 'events' && (
          <>
          {data && data.events.length > 0 && (
            <div className="px-6 mb-4"><BrainOverview data={data} /></div>
          )}
          <div className="bg-bg-secondary border border-white/10 rounded-xl mx-6 mb-6 overflow-hidden">
            {!data || data.events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
                <Activity size={40} className="opacity-30" />
                <p className="text-sm">No events captured yet</p>
                <p className="text-xs opacity-60">Events are recorded when an agent connector pushes data</p>
              </div>
            ) : (
              data.events.map(e => <EventRow key={e.id} e={e} />)
            )}
          </div>
          </>
        )}

        {/* Stats tab */}
        {tab === 'stats' && stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mx-6 mb-6">
            {Object.entries(stats.stats).map(([src, s]) => (
              <div key={src} className="bg-bg-secondary border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <span className={clsx('w-2 h-2 rounded-full', sourceDot(src))} />
                  <h3 className="text-sm font-semibold text-text-primary capitalize">{src}</h3>
                  <span className="ml-auto text-xs text-text-muted">{s.total.toLocaleString()} total</span>
                </div>
                <div className="space-y-1.5">
                  {Object.entries(s.typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2">
                      <span className={clsx('text-xs font-mono truncate flex-1', typeColor(type))}>{type}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-white/5 rounded-full h-1.5">
                          <div
                            className="bg-violet-500/60 h-1.5 rounded-full"
                            style={{ width: `${Math.min(100, (count / s.total) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-muted w-8 text-right">{count}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {s.daily.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <p className="text-xs text-text-muted mb-2 flex items-center gap-1"><BarChart3 size={11} /> Daily volume</p>
                    <Histogram
                      bars={[...s.daily].reverse().map(d => ({
                        value: d.count,
                        color: sourceDot(src).includes('cyan') ? '#22d3ee' : '#a78bfa',
                        label: `${d.date}: ${d.count}`,
                      }))}
                      height={44}
                    />
                  </div>
                )}
                {data?.topTools && data.topTools.length > 0 && src !== 'hermes' && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <p className="text-xs text-text-muted mb-2 flex items-center gap-1"><Zap size={11} /> Top tools</p>
                    <div className="space-y-1">
                      {data.topTools.slice(0, 5).map(({ tool, count }) => (
                        <div key={tool} className="flex items-center justify-between text-xs">
                          <span className="text-text-muted font-mono truncate">{tool}</span>
                          <span className="text-amber-400 ml-2">{count}×</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Loops tab */}
        {tab === 'loops' && (
          <div className="mx-6 mb-6 space-y-3">
            {!data || data.loopSignals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3 bg-bg-secondary border border-white/10 rounded-xl">
                <Cpu size={40} className="opacity-30" />
                <p className="text-sm">No loop signals detected</p>
                <p className="text-xs opacity-60">A loop is flagged when the same tool is called 5+ times in a session</p>
              </div>
            ) : (
              data.loopSignals.map((sig, i) => (
                <div key={i} className="flex items-center gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                  <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-amber-300 font-mono">{sig.tool}</p>
                    {sig.sessionKey && <p className="text-xs text-text-muted font-mono mt-0.5">session: {sig.sessionKey}</p>}
                  </div>
                  <span className="text-lg font-bold text-amber-400">{sig.count}×</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
