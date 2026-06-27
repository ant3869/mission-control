// Sub-view — rendered as the "Sessions" tab inside Activity.tsx. Not mounted directly in App.tsx.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { isRefreshPaused } from '../lib/refreshBus'
import { LiveBadge } from '../components/LiveBadge'
import { usePersistedState } from '../hooks/usePersistedState'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import {
  GitBranch, RefreshCw, AlertCircle, ChevronRight,
  MessageSquare, Activity, Hash, Coins, Heart, BarChart3,
} from 'lucide-react'
import { MiniStat, Histogram, SegmentBar, ChartCard, fmtNum, type Bar } from '../components/charts'

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = 'all' | 'openclaw' | 'hermes'

interface FlowRun {
  id:           string
  source:       string
  title:        string
  firstMessage: string | null
  messageCount: number | null
  startedAt:    string | null
  lastActiveAt: string | null
  inputTokens:  number | null
  outputTokens: number | null
  isHeartbeat:  boolean
  cwd:          string | null
}

interface FlowRunsResponse {
  runs:      FlowRun[]
  total:     number
  fetchedAt: string
}

interface FlowMessage {
  role:    string
  content: string
  ts?:     string
  tokens?: number
}

interface FlowDetail {
  id:       string
  title?:   string
  messages: FlowMessage[]
}

interface FlowDetailResponse {
  run:       FlowDetail
  fetchedAt: string
}

interface FlowSummary {
  openclaw: { total: number; heartbeats: number; messages: number; newest: string | null }
  hermes:   { total: number; heartbeats: number; messages: number; newest: string | null }
  fetchedAt: string
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchRuns(source: Source, limit: number): Promise<FlowRunsResponse> {
  const res = await fetch(`/api/flow/runs?source=${source}&limit=${limit}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function fetchRun(source: string, id: string): Promise<FlowDetailResponse> {
  const res = await fetch(`/api/flow/runs/${source}/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function fetchSummary(): Promise<FlowSummary> {
  const res = await fetch('/api/flow/summary')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAgo(iso: string | null): string {
  if (!iso) return '—'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

function fmtTokens(n: number | null): string {
  if (n == null) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function sourceDot(s: string): string {
  if (s === 'openclaw') return 'bg-cyan-400'
  if (s === 'hermes')   return 'bg-violet-400'
  return 'bg-slate-400'
}

function roleColor(r: string): string {
  if (r === 'user') return 'text-blue-400'
  if (r === 'assistant') return 'text-emerald-400'
  if (r === 'tool' || r === 'tool_result') return 'text-amber-400'
  return 'text-slate-400'
}

// ─── Flow overview (stat cards + activity sparkline + source split) ────────────

function FlowOverview({ data, summary }: { data: FlowRunsResponse; summary: FlowSummary | null }) {
  const runs = data.runs

  const totalTokens = useMemo(
    () => runs.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0),
    [runs]
  )
  const loadedMessages = useMemo(() => runs.reduce((n, r) => n + (r.messageCount ?? 0), 0), [runs])
  const heartbeats     = (summary?.openclaw.heartbeats ?? 0) + (summary?.hermes.heartbeats ?? 0)
  const avgMsgs        = runs.length ? Math.round(loadedMessages / runs.length) : 0

  // Activity: bucket loaded runs by their last-active time
  const bars: Bar[] = useMemo(() => {
    const BUCKETS = 36
    const times = runs.map(r => r.lastActiveAt ? new Date(r.lastActiveAt).getTime() : 0).filter(Boolean)
    if (times.length === 0) return []
    const max = Math.max(...times), min = Math.min(...times)
    const span = Math.max(max - min, 1), step = span / BUCKETS
    const buckets = Array.from({ length: BUCKETS }, () => ({ oc: 0, hr: 0 }))
    for (const r of runs) {
      if (!r.lastActiveAt) continue
      const idx = Math.min(BUCKETS - 1, Math.floor((new Date(r.lastActiveAt).getTime() - min) / step))
      if (r.source === 'hermes') buckets[idx].hr++; else buckets[idx].oc++
    }
    return buckets.map((b, i) => ({
      value: b.oc + b.hr,
      color: b.hr > b.oc ? '#a78bfa' : '#22d3ee',
      label: `${b.oc + b.hr} runs · ${new Date(min + i * step).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' })}`,
    }))
  }, [runs])

  const ocRuns = summary?.openclaw.total ?? runs.filter(r => r.source === 'openclaw').length
  const hrRuns = summary?.hermes.total ?? runs.filter(r => r.source === 'hermes').length

  return (
    <div className="space-y-4 mb-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Total runs" value={data.total.toLocaleString()} sub={`${runs.length} loaded`} icon={<Hash size={12} />} />
        <MiniStat label="Messages" value={fmtNum(loadedMessages)} sub={`~${avgMsgs}/run avg`} icon={<MessageSquare size={12} />} accent="text-emerald-300" />
        <MiniStat label="Tokens" value={fmtNum(totalTokens)} sub="across loaded runs" icon={<Coins size={12} />} accent="text-amber-300" />
        <MiniStat label="Heartbeats" value={heartbeats.toLocaleString()} sub="automated pings" icon={<Heart size={12} />} accent="text-blue-300" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard
          title="Run activity"
          icon={<BarChart3 size={13} className="text-emerald-400" />}
          className="lg:col-span-2"
          right={<span className="text-[10px] text-text-muted flex items-center gap-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" />OpenClaw</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-400" />Hermes</span>
          </span>}
        >
          {bars.length > 0
            ? <Histogram bars={bars} height={64} />
            : <div className="h-16 flex items-center justify-center text-xs text-text-muted">No timestamped runs</div>}
        </ChartCard>

        <ChartCard title="Source split" icon={<GitBranch size={13} className="text-emerald-400" />}>
          <div className="pt-1">
            <SegmentBar
              segments={[
                { value: ocRuns, color: '#22d3ee', label: 'OpenClaw' },
                { value: hrRuns, color: '#a78bfa', label: 'Hermes' },
              ]}
            />
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

// ─── Run detail panel ────────────────────────────────────────────────────────

function RunDetailPanel({ run, source, onClose }: { run: FlowRun; source: string; onClose: () => void }) {
  useEscapeKey(onClose)
  const [detail, setDetail]   = useState<FlowDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetchRun(source, run.id)
      .then(r => setDetail(r.run))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [run.id, source])

  return (
    <div className="flex flex-col h-full border-l border-white/10 bg-bg-primary">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">{run.title || run.id}</p>
          <p className="text-xs text-text-muted mt-0.5">{run.messageCount ?? 0} messages · {fmtAgo(run.lastActiveAt)}</p>
        </div>
        <button onClick={onClose} className="ml-3 text-text-muted hover:text-text-primary p-1 rounded hover:bg-white/5">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && <div className="flex justify-center py-10 text-text-muted text-sm">Loading messages…</div>}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 flex items-center gap-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
        {detail?.messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-1">
            <span className={clsx('text-xs font-semibold uppercase tracking-wider', roleColor(m.role))}>{m.role}</span>
            <div className="bg-bg-secondary border border-white/5 rounded-lg p-3">
              <p className="text-xs text-text-muted whitespace-pre-wrap break-words">{m.content?.slice(0, 800)}{(m.content?.length ?? 0) > 800 ? '…' : ''}</p>
              {m.tokens != null && <p className="text-[10px] text-slate-600 mt-1">{m.tokens.toLocaleString()} tokens</p>}
            </div>
          </div>
        ))}
        {detail && detail.messages.length === 0 && (
          <div className="text-center py-10 text-text-muted text-sm">No messages in this session</div>
        )}
      </div>
    </div>
  )
}

// ─── Run row ──────────────────────────────────────────────────────────────────

function RunRow({ run, selected, onClick }: { run: FlowRun; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 text-left transition-colors',
        selected ? 'bg-violet-500/10' : 'hover:bg-white/5'
      )}
    >
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', sourceDot(run.source))} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{run.title || run.firstMessage || run.id}</p>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-text-muted">{fmtAgo(run.lastActiveAt)}</span>
          {run.messageCount != null && (
            <span className="text-xs text-text-muted flex items-center gap-1">
              <MessageSquare size={10} /> {run.messageCount}
            </span>
          )}
          {(run.inputTokens != null || run.outputTokens != null) && (
            <span className="text-xs text-text-muted">
              {fmtTokens((run.inputTokens ?? 0) + (run.outputTokens ?? 0))} tok
            </span>
          )}
          {run.isHeartbeat && <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 rounded-full border border-blue-500/20">heartbeat</span>}
        </div>
      </div>
      <ChevronRight size={14} className={clsx('flex-shrink-0 transition-transform', selected && 'rotate-90')} />
    </button>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function Flow() {
  const [source, setSource]                   = usePersistedState<Source>('mc:flow:source', 'all')
  const [limit, setLimit]                     = useState(50)
  const [data, setData]                       = useState<FlowRunsResponse | null>(null)
  const [summary, setSummary]                 = useState<FlowSummary | null>(null)
  const [selected, setSelected]               = useState<{ run: FlowRun; source: string } | null>(null)
  const [loading, setLoading]                 = useState(false)
  const [error, setError]                     = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [runsR, sumR] = await Promise.all([fetchRuns(source, limit), fetchSummary()])
      setData(runsR); setSummary(sumR)
    } catch (e: any) { setError(e.message ?? 'Failed to load') }
    finally { if (!silent) setLoading(false) }
  }, [source, limit])

  useEffect(() => { load() }, [load])

  // Keep session history live: silent auto-refresh every 15s (honours global Pause).
  useEffect(() => {
    const t = setInterval(() => { if (!isRefreshPaused()) load(true) }, 15_000)
    return () => clearInterval(t)
  }, [load])

  const totalMessages = summary
    ? (summary.openclaw.messages + summary.hermes.messages).toLocaleString()
    : '—'

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <GitBranch size={20} className="text-emerald-400" />
          <h1 className="text-lg font-semibold text-text-primary">Flow</h1>
          <span className="text-xs text-text-muted bg-white/5 px-2 py-0.5 rounded-full">session runs</span>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge className="mr-1" />
          <select value={source} onChange={e => setSource(e.target.value as Source)} className="text-xs bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-text-primary">
            <option value="all">All sources</option>
            <option value="openclaw">OpenClaw</option>
            <option value="hermes">Hermes</option>
          </select>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="text-xs bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-text-primary">
            {[25, 50, 100, 200].map(n => <option key={n} value={n}>Last {n}</option>)}
          </select>
          <button onClick={() => load()} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors">
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {summary && (
        <div className="flex items-center gap-6 px-6 py-3 border-b border-white/5 flex-shrink-0">
          {(['openclaw', 'hermes'] as const).map(src => (
            <div key={src} className="flex items-center gap-2 text-xs text-text-muted">
              <span className={clsx('w-1.5 h-1.5 rounded-full', sourceDot(src))} />
              <span className="capitalize">{src}</span>
              <span className="text-text-primary font-medium">{summary[src].total}</span>
              <span>runs</span>
              <span className="text-slate-600">·</span>
              <span className="text-text-primary font-medium">{summary[src].messages.toLocaleString()}</span>
              <span>msgs</span>
            </div>
          ))}
          <span className="ml-auto text-xs text-text-muted">{totalMessages} total messages</span>
        </div>
      )}

      {error && (
        <div className="mx-6 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400 flex-shrink-0">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Split layout */}
      <div className="flex flex-1 min-h-0">
        {/* Run list */}
        <div className={clsx('flex flex-col', selected ? 'w-1/2' : 'flex-1')}>
          <div className="flex-1 overflow-y-auto">
            {!selected && data && data.runs.length > 0 && (
              <div className="px-6 pt-4"><FlowOverview data={data} summary={summary} /></div>
            )}
            <div className={clsx('bg-bg-secondary border border-white/10 rounded-xl mx-6 overflow-hidden', selected ? 'my-4' : 'mb-4')}>
              {!data || data.runs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3">
                  <Activity size={40} className="opacity-30" />
                  <p className="text-sm">No session runs yet</p>
                  <p className="text-xs opacity-60">Runs appear when agents start sessions via a connected gateway</p>
                </div>
              ) : (
                data.runs.map(run => (
                  <RunRow
                    key={`${run.source}:${run.id}`}
                    run={run}
                    selected={selected?.run.id === run.id}
                    onClick={() => setSelected(selected?.run.id === run.id ? null : { run, source: run.source })}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-1/2 flex flex-col min-h-0 border-l border-white/10">
            <RunDetailPanel
              run={selected.run}
              source={selected.source}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
