import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { AlertCircle, CheckCircle2, WifiOff, AlertTriangle, RefreshCw, Power } from 'lucide-react'
import { system, type SystemComponentLive } from '../lib/api'
import type { SystemComponentType, SystemStatus } from '../types'

// ─── Config ────────────────────────────────────────────────────────────────────

const statusConfig: Record<SystemStatus, { icon: React.ReactNode; label: string; dot: string; row: string; badge: string }> = {
  healthy: { icon: <CheckCircle2 size={13} />, label: 'Healthy', dot: 'bg-green-500',  row: '',                   badge: 'bg-green-950/50 border-green-900/50 text-green-400'  },
  warning: { icon: <AlertTriangle size={13} />, label: 'Warning', dot: 'bg-amber-400',  row: 'bg-amber-950/10',    badge: 'bg-amber-950/50 border-amber-900/50 text-amber-400'  },
  error:   { icon: <AlertCircle  size={13} />, label: 'Error',   dot: 'bg-red-500',    row: 'bg-red-950/10',      badge: 'bg-red-950/50 border-red-900/50 text-red-400'        },
  offline: { icon: <WifiOff      size={13} />, label: 'Offline', dot: 'bg-text-muted', row: 'bg-red-950/15 opacity-75', badge: 'bg-card border-border text-text-muted'          },
}

const typeLabels: Record<SystemComponentType, string> = { mcp: 'MCP Server', plugin: 'Plugin', skill: 'Skill', extension: 'Extension' }
const typeColors: Record<SystemComponentType, string> = {
  mcp:       'bg-blue-950/50 border-blue-900/50 text-blue-400',
  plugin:    'bg-violet-950/50 border-violet-900/50 text-violet-400',
  skill:     'bg-teal-950/50 border-teal-900/50 text-teal-400',
  extension: 'bg-amber-950/50 border-amber-900/50 text-amber-400',
}

type FilterStatus = SystemStatus | 'all'
type FilterType   = SystemComponentType | 'all'

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 rounded-lg bg-card border border-border">
      <span className="text-xxs text-text-muted uppercase tracking-wider">{label}</span>
      <span className={clsx('text-2xl font-bold tabular-nums', color)}>{value}</span>
    </div>
  )
}

// ─── Component row ─────────────────────────────────────────────────────────────

function ComponentRow({ component, onRecheck }: { component: SystemComponentLive; onRecheck?: () => void }) {
  const s = statusConfig[component.status]
  return (
    <div className={clsx('flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0 transition-colors', s.row)}>
      <div className={clsx('w-2 h-2 rounded-full shrink-0', s.dot,
        component.status === 'healthy' && 'opacity-70',
        (component.status === 'warning' || component.status === 'error') && 'animate-pulse',
      )} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-text-primary">{component.name}</span>
          {component.version && <span className="text-xxs text-text-muted font-mono">v{component.version}</span>}
        </div>
        <p className="text-xxs text-text-muted truncate">{component.description}</p>
        {component.error && <p className="text-xxs text-amber-400 mt-0.5">{component.error}</p>}
      </div>

      <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium shrink-0', typeColors[component.type])}>
        {typeLabels[component.type]}
      </span>

      {component.latencyMs !== undefined && (
        <span className={clsx('text-xxs font-mono tabular-nums shrink-0 w-14 text-right',
          component.latencyMs > 500 ? 'text-amber-400' : 'text-text-muted')}>
          {component.latencyMs}ms
        </span>
      )}

      <span className="text-xxs text-text-muted shrink-0 w-20 text-right">
        {new Date(component.lastChecked).toLocaleTimeString()}
      </span>

      <span className={clsx('flex items-center gap-1 px-2 py-0.5 rounded border text-xxs font-semibold shrink-0', s.badge)}>
        {s.icon}{s.label}
      </span>

      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onRecheck}
          className="p-1.5 rounded hover:bg-card border border-transparent hover:border-border text-text-muted hover:text-text-secondary transition-all" title="Recheck">
          <RefreshCw size={12} />
        </button>
        <button className={clsx(
          'p-1.5 rounded hover:bg-card border border-transparent hover:border-border transition-all',
          component.status === 'offline' ? 'text-green-400 hover:text-green-300' : 'text-text-muted hover:text-red-400',
        )} title={component.status === 'offline' ? 'Enable' : 'Disable'}>
          <Power size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export function System() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [typeFilter,   setTypeFilter]   = useState<FilterType>('all')
  const [components, setComponents]     = useState<SystemComponentLive[]>([])
  const [loading, setLoading]           = useState(true)
  const [fetchedAt, setFetchedAt]       = useState<string | null>(null)
  const [source, setSource]             = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await system.components()
      setComponents(data.components)
      setFetchedAt(data.fetchedAt)
      setSource(data.source)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = {
    healthy: components.filter(c => c.status === 'healthy').length,
    warning: components.filter(c => c.status === 'warning').length,
    error:   components.filter(c => c.status === 'error').length,
    offline: components.filter(c => c.status === 'offline').length,
  }

  const filtered = components.filter(c => {
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    const matchType   = typeFilter   === 'all' || c.type   === typeFilter
    return matchStatus && matchType
  })

  const types: SystemComponentType[] = ['mcp', 'plugin', 'skill', 'extension']
  const groups = types
    .map(type => ({ type, items: filtered.filter(c => c.type === type) }))
    .filter(g => g.items.length > 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">System</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading
              ? <span className="animate-pulse">Checking components…</span>
              : <>
                  <span className="text-text-secondary">{components.length} components</span>
                  {counts.warning > 0 && <>&nbsp;·&nbsp;<span className="text-amber-400">{counts.warning} warning{counts.warning > 1 ? 's' : ''}</span></>}
                  {counts.error > 0   && <>&nbsp;·&nbsp;<span className="text-red-400">{counts.error} error{counts.error > 1 ? 's' : ''}</span></>}
                  {counts.offline > 0 && <>&nbsp;·&nbsp;<span className="text-text-muted">{counts.offline} offline</span></>}
                  {source === 'claude-config' && <>&nbsp;·&nbsp;<span className="text-text-muted opacity-50">from ~/.claude/settings.json</span></>}
                </>
            }
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Checking…' : 'Check All'}
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-border shrink-0">
        <StatCard label="Healthy"  value={counts.healthy} color="text-green-400"  />
        <StatCard label="Warnings" value={counts.warning} color="text-amber-400"  />
        <StatCard label="Errors"   value={counts.error}   color="text-red-400"    />
        <StatCard label="Offline"  value={counts.offline} color="text-text-muted" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          {(['all', 'healthy', 'warning', 'error', 'offline'] as FilterStatus[]).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={clsx('px-2.5 py-1 rounded text-xs font-medium capitalize transition-all',
                statusFilter === f ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {f}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-1">
          {(['all', 'mcp', 'plugin', 'skill', 'extension'] as FilterType[]).map(f => (
            <button key={f} onClick={() => setTypeFilter(f)}
              className={clsx('px-2.5 py-1 rounded text-xs font-medium capitalize transition-all',
                typeFilter === f ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {f === 'mcp' ? 'MCP' : f === 'all' ? 'All Types' : f.charAt(0).toUpperCase() + f.slice(1) + 's'}
            </button>
          ))}
        </div>
        {fetchedAt && (
          <span className="ml-auto text-xxs text-text-muted opacity-50">
            checked {new Date(fetchedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm text-text-muted animate-pulse">Pinging components…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm text-text-muted">No components match filter</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(({ type, items }) => (
              <div key={type} className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border">
                  <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-semibold', typeColors[type])}>
                    {typeLabels[type]}s
                  </span>
                  <span className="text-xxs text-text-muted">{items.length} found</span>
                </div>
                {items.map(c => <ComponentRow key={c.id} component={c} onRecheck={load} />)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
