import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import {
  Shield, RefreshCw, AlertCircle, CheckCircle, AlertTriangle, ShieldAlert,
  Zap, Wifi, WifiOff, Key, Activity, ShieldCheck, Timer,
} from 'lucide-react'
import { MiniStat, Gauge, HBar, ChartCard } from '../components/charts'
import { isRefreshPaused } from '../lib/refreshBus'
import { apiFetch } from '../lib/apiTransport.js'

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskLevel   = 'ok' | 'warning' | 'critical'
type TokenStatus = 'ok' | 'missing' | 'disabled' | 'auth_error' | 'unreachable' | 'no_url'

interface ConnectorPosture {
  id:           string
  name:         string
  enabled:      boolean
  baseUrl:      string | null
  tokenHint:    string
  tokenStatus:  TokenStatus
  reachable:    boolean
  latencyMs:    number
  version:      string | null
  recentErrors: number
  authErrors:   number
  errorRate:    number
  totalEvents:  number
}

interface PostureResponse {
  connectors:   ConnectorPosture[]
  riskLevel:    RiskLevel
  summary: {
    ok:          number
    warning:     number
    critical:    number
    unreachable: number
  }
  fetchedAt: string
}

interface DiagProbe {
  path:      string
  status:    number | null
  ok:        boolean
  latencyMs: number
  error?:    string
}

interface SecurityEvent {
  id:        string
  source:    string
  eventType: string
  ts:        string
  payload:   Record<string, unknown>
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchPosture(): Promise<PostureResponse> {
  return apiFetch<PostureResponse>('/api/security/posture')
}

async function fetchDiagnostics(source: string): Promise<{ probes: DiagProbe[]; fetchedAt: string }> {
  return apiFetch<{ probes: DiagProbe[]; fetchedAt: string }>(`/api/security/diagnostics/${encodeURIComponent(source)}`)
}

async function fetchSecurityEvents(): Promise<{ events: SecurityEvent[] }> {
  return apiFetch<{ events: SecurityEvent[] }>('/api/security/events')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

function riskBadge(r: RiskLevel) {
  if (r === 'critical') return <span className="flex items-center gap-1 text-xs bg-red-500/10 border border-red-500/30 text-red-400 px-2.5 py-1 rounded-full"><ShieldAlert size={12}/> Critical</span>
  if (r === 'warning')  return <span className="flex items-center gap-1 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 px-2.5 py-1 rounded-full"><AlertTriangle size={12}/> Warning</span>
  return <span className="flex items-center gap-1 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2.5 py-1 rounded-full"><CheckCircle size={12}/> OK</span>
}

function tokenStatusBadge(s: TokenStatus) {
  const map: Record<TokenStatus, { label: string; cls: string }> = {
    ok:          { label: 'OK',          cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    missing:     { label: 'No token',    cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
    disabled:    { label: 'Disabled',    cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
    auth_error:  { label: 'Auth error',  cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
    unreachable: { label: 'Unreachable', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    no_url:      { label: 'No URL',      cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  }
  const { label, cls } = map[s] ?? map.missing
  return <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full border', cls)}>{label}</span>
}

// ─── Posture scoring + overview ────────────────────────────────────────────────

// Per-connector health weight, 0..1, used to compute the aggregate posture score.
function connectorHealth(c: ConnectorPosture): number {
  if (!c.enabled) return 0.3
  switch (c.tokenStatus) {
    case 'ok':          return c.errorRate > 25 ? 0.7 : 1
    case 'unreachable': return 0.4
    case 'missing':
    case 'no_url':      return 0.3
    case 'auth_error':  return 0
    case 'disabled':    return 0.3
    default:            return 0.5
  }
}

function latencyColor(ms: number): string {
  if (ms > 2000) return '#f87171'
  if (ms > 800)  return '#fbbf24'
  return '#4ade80'
}

function SecurityOverview({ posture }: { posture: PostureResponse }) {
  const connectors = posture.connectors
  const enabled    = connectors.filter(c => c.enabled)

  const score = useMemo(() => {
    if (connectors.length === 0) return 0
    const sum = connectors.reduce((n, c) => n + connectorHealth(c), 0)
    return sum / connectors.length
  }, [connectors])

  const totalEvents = connectors.reduce((n, c) => n + c.totalEvents, 0)
  const totalErrors = connectors.reduce((n, c) => n + c.recentErrors, 0)
  const totalAuth   = connectors.reduce((n, c) => n + c.authErrors, 0)
  const reachable   = enabled.filter(c => c.reachable)
  const avgLatency  = reachable.length
    ? Math.round(reachable.reduce((n, c) => n + c.latencyMs, 0) / reachable.length)
    : 0
  const maxLatency  = Math.max(...connectors.map(c => c.latencyMs), 1)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      {/* Posture score gauge */}
      <ChartCard title="Posture score" icon={<ShieldCheck size={13} className="text-cyan-400" />}>
        <div className="flex flex-col items-center py-1">
          <Gauge value={score} label={posture.riskLevel === 'ok' ? 'healthy' : posture.riskLevel} />
          <div className="grid grid-cols-3 gap-2 w-full mt-3 text-center">
            <div>
              <p className="text-lg font-bold text-emerald-400 tabular-nums leading-none">{posture.summary.ok}</p>
              <p className="text-[10px] text-text-muted mt-0.5">OK</p>
            </div>
            <div>
              <p className="text-lg font-bold text-amber-400 tabular-nums leading-none">{posture.summary.warning}</p>
              <p className="text-[10px] text-text-muted mt-0.5">Warning</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-400 tabular-nums leading-none">{posture.summary.critical}</p>
              <p className="text-[10px] text-text-muted mt-0.5">Critical</p>
            </div>
          </div>
        </div>
      </ChartCard>

      {/* Latency + error bars */}
      <ChartCard title="Connector latency" icon={<Timer size={13} className="text-cyan-400" />}>
        {reachable.length > 0 ? (
          <div className="space-y-2.5 pt-1">
            {connectors.filter(c => c.reachable).map(c => (
              <HBar key={c.id} label={<span className="capitalize">{c.name}</span>} value={c.latencyMs} max={maxLatency} color={latencyColor(c.latencyMs)} suffix="ms" />
            ))}
          </div>
        ) : (
          <div className="h-20 flex items-center justify-center text-xs text-text-muted">No reachable connectors</div>
        )}
        <p className="text-[10px] text-text-muted mt-3 pt-3 border-t border-white/5">Avg {avgLatency}ms across {reachable.length} reachable</p>
      </ChartCard>

      {/* Event + error stats */}
      <div className="grid grid-cols-2 gap-3 content-start">
        <MiniStat label="Events (1h)" value={totalEvents.toLocaleString()} sub="across connectors" icon={<Activity size={12} />} />
        <MiniStat label="Errors (1h)" value={totalErrors.toLocaleString()} sub={totalErrors ? 'investigate' : 'none'} icon={<AlertTriangle size={12} />} accent={totalErrors ? 'text-red-400' : 'text-emerald-400'} />
        <MiniStat label="Auth failures" value={totalAuth.toLocaleString()} sub={totalAuth ? 'token issue' : 'clean'} icon={<Key size={12} />} accent={totalAuth ? 'text-red-400' : 'text-emerald-400'} />
        <MiniStat label="Reachable" value={`${reachable.length}/${enabled.length}`} sub="enabled connectors" icon={<Wifi size={12} />} accent="text-cyan-300" />
      </div>
    </div>
  )
}

// ─── Diagnostics panel ───────────────────────────────────────────────────────

function DiagPanel({ source, onClose }: { source: string; onClose: () => void }) {
  useEscapeKey(onClose)
  const [probes, setProbes]   = useState<DiagProbe[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetchDiagnostics(source)
      .then(r => setProbes(r.probes))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [source])

  return (
    <div className="mt-3 bg-bg-primary border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-text-muted font-medium uppercase tracking-wider">Diagnostics — {source}</p>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">✕ Close</button>
      </div>
      {loading && <p className="text-xs text-text-muted">Probing endpoints…</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {probes && (
        <div className="space-y-1">
          {probes.map((p, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5 border-b border-white/5 last:border-0">
              <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', p.ok ? 'bg-emerald-400' : 'bg-red-400')} />
              <span className="text-xs font-mono text-text-muted flex-1 truncate">{p.path}</span>
              <span className={clsx('text-xs font-mono w-12 text-right', p.ok ? 'text-emerald-400' : 'text-red-400')}>
                {p.status ?? '—'}
              </span>
              <span className="text-xs text-text-muted w-16 text-right">{p.latencyMs}ms</span>
              {p.error && <span className="text-[10px] text-red-400 truncate max-w-40">{p.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Connector card ──────────────────────────────────────────────────────────

function ConnectorCard({ c }: { c: ConnectorPosture }) {
  const [showDiag, setShowDiag] = useState(false)

  const riskC = c.tokenStatus === 'auth_error' || c.authErrors > 0 ? 'border-red-500/30 bg-red-500/5'
    : !c.enabled || c.tokenStatus === 'missing' || c.tokenStatus === 'no_url' ? 'border-white/10'
    : c.reachable ? 'border-emerald-500/20' : 'border-amber-500/30 bg-amber-500/5'

  return (
    <div className={clsx('bg-bg-secondary border rounded-xl p-4', riskC)}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-text-primary capitalize">{c.name}</h3>
            {tokenStatusBadge(c.tokenStatus)}
            {c.enabled ? (
              c.reachable
                ? <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Wifi size={10}/> Connected</span>
                : <span className="flex items-center gap-1 text-[10px] text-amber-400"><WifiOff size={10}/> Unreachable</span>
            ) : (
              <span className="text-[10px] text-slate-500">Disabled</span>
            )}
          </div>
          {c.baseUrl && <p className="text-xs text-text-muted font-mono mt-1 truncate">{c.baseUrl}</p>}
        </div>
        <button
          onClick={() => setShowDiag(v => !v)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary border border-white/10 rounded px-2 py-1 ml-3 flex-shrink-0 hover:bg-white/5"
        >
          <Zap size={11} /> Probe
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-text-muted mb-0.5">Token</p>
          <p className="text-text-primary font-mono truncate">{c.tokenHint || '—'}</p>
        </div>
        <div>
          <p className="text-text-muted mb-0.5">Latency</p>
          <p className={clsx(c.latencyMs > 2000 ? 'text-amber-400' : 'text-text-primary')}>
            {c.reachable ? `${c.latencyMs}ms` : '—'}
          </p>
        </div>
        <div>
          <p className="text-text-muted mb-0.5">Version</p>
          <p className="text-text-primary">{c.version || '—'}</p>
        </div>
        <div>
          <p className="text-text-muted mb-0.5">Events</p>
          <p className="text-text-primary">{c.totalEvents.toLocaleString()}</p>
        </div>
      </div>

      {(c.recentErrors > 0 || c.authErrors > 0) && (
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/5 text-xs">
          {c.recentErrors > 0 && (
            <span className="text-red-400 flex items-center gap-1">
              <AlertCircle size={11}/> {c.recentErrors} recent error{c.recentErrors !== 1 ? 's' : ''}
            </span>
          )}
          {c.authErrors > 0 && (
            <span className="text-red-400 flex items-center gap-1">
              <Key size={11}/> {c.authErrors} auth failure{c.authErrors !== 1 ? 's' : ''}
            </span>
          )}
          {c.errorRate > 0 && (
            <span className="text-text-muted ml-auto">{c.errorRate.toFixed(1)}% error rate</span>
          )}
        </div>
      )}

      {showDiag && <DiagPanel source={c.id} onClose={() => setShowDiag(false)} />}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function Security() {
  const [posture, setPosture]               = useState<PostureResponse | null>(null)
  const [events, setEvents]                 = useState<SecurityEvent[]>([])
  const [tab, setTab]                       = useState<'posture' | 'events'>('posture')
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const pollRef                             = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [pR, eR] = await Promise.all([fetchPosture(), fetchSecurityEvents()])
      setPosture(pR); setEvents(eR.events)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    pollRef.current = setInterval(() => { if (!isRefreshPaused()) load() }, 60_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load])

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Shield size={20} className="text-cyan-400" />
          <h1 className="text-lg font-semibold text-text-primary">Security</h1>
          {posture && riskBadge(posture.riskLevel)}
        </div>
        <div className="flex items-center gap-3">
          {posture && (
            <div className="flex items-center gap-4 text-xs text-text-muted">
              <span className="text-emerald-400">{posture.summary.ok} OK</span>
              {posture.summary.warning > 0 && <span className="text-amber-400">{posture.summary.warning} warn</span>}
              {posture.summary.critical > 0 && <span className="text-red-400">{posture.summary.critical} critical</span>}
            </div>
          )}
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-colors">
            <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 pt-3 flex-shrink-0">
        {(['posture', 'events'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx('px-3 py-1.5 text-xs rounded-md transition-colors capitalize',
              tab === t ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-text-muted hover:text-text-primary hover:bg-white/5')}>
            {t === 'posture' ? 'Connector posture' : 'Security events'}
            {t === 'events' && events.length > 0 && (
              <span className="ml-1.5 bg-white/5 text-text-muted text-[10px] px-1.5 rounded-full">{events.length}</span>
            )}
          </button>
        ))}
        {posture && (
          <span className="ml-auto text-xs text-text-muted">
            Last checked {new Date(posture.fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-2 text-sm text-red-400 flex-shrink-0">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto mt-4">

        {/* Posture tab */}
        {tab === 'posture' && (
          <div className="px-6 pb-6">
            {posture && posture.connectors.length > 0 && <SecurityOverview posture={posture} />}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {posture?.connectors.map(c => <ConnectorCard key={c.id} c={c} />)}
            {!posture?.connectors.length && !loading && (
              <div className="col-span-2 flex flex-col items-center justify-center py-20 text-text-muted gap-3 bg-bg-secondary border border-white/10 rounded-xl">
                <Activity size={40} className="opacity-30" />
                <p className="text-sm">No connectors configured</p>
                <p className="text-xs opacity-60">Configure connectors in Settings to see security posture</p>
              </div>
            )}
            </div>
          </div>
        )}

        {/* Events tab */}
        {tab === 'events' && (
          <div className="px-6 pb-6">
            {events.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-text-muted gap-3 bg-bg-secondary border border-white/10 rounded-xl">
                <Shield size={40} className="opacity-30 text-emerald-400" />
                <p className="text-sm text-emerald-400">No security events in the last 24h</p>
              </div>
            ) : (
              <div className="bg-bg-secondary border border-white/10 rounded-xl overflow-hidden">
                {events.map(e => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 last:border-0">
                    <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', e.source === 'openclaw' ? 'bg-cyan-400' : 'bg-violet-400')} />
                    <span className="text-xs text-red-400 font-mono w-32 flex-shrink-0 truncate">{e.eventType}</span>
                    <span className="text-xs text-text-muted w-20 flex-shrink-0 text-right">{fmtAgo(e.ts)}</span>
                    <span className="text-xs text-text-muted truncate flex-1">
                      {(e.payload as any)?.message ?? (e.payload as any)?.error ?? JSON.stringify(e.payload).slice(0, 80)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
