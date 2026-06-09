import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { CheckCircle2, AlertCircle, WifiOff, Clock, RefreshCw, AlertTriangle, Loader2, Plug, ChevronDown } from 'lucide-react'
import { office } from '../lib/api'
import type { LiveIntegration, IntegrationCategory, IntegrationStatus } from '../lib/api'
import { usePersistedState } from '../hooks/usePersistedState'

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_CATEGORIES: IntegrationCategory[] = [
  'auth', 'ai', 'plugin', 'productivity', 'communication', 'development', 'analytics', 'storage',
]

const catLabels: Record<IntegrationCategory, string> = {
  auth:          'Authentication',
  ai:            'AI & Models',
  plugin:        'Plugins',
  productivity:  'Productivity',
  communication: 'Communication',
  development:   'Development',
  analytics:     'Analytics',
  storage:       'Storage',
}

const statusMeta: Record<IntegrationStatus, { label: string; icon: React.ReactNode; color: string; dot: string }> = {
  connected:    { label: 'Connected',    icon: <CheckCircle2 size={12} />, color: 'text-green-400',  dot: 'bg-green-400'  },
  error:        { label: 'Error',        icon: <AlertCircle  size={12} />, color: 'text-red-400',    dot: 'bg-red-500'    },
  disconnected: { label: 'Disconnected', icon: <WifiOff      size={12} />, color: 'text-text-muted', dot: 'bg-slate-600'  },
  pending:      { label: 'Pending',      icon: <Clock        size={12} />, color: 'text-amber-400',  dot: 'bg-amber-400'  },
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function IntegrationRow({ item }: { item: LiveIntegration }) {
  const [open, setOpen] = useState(false)
  const sm = statusMeta[item.status]
  // Full diagnostic details to reveal on expand (the inline line truncates these).
  const details: Array<[string, string]> = [
    ['Status', sm.label],
    ['Category', item.category],
    ...(item.version    ? [['Version', `v${item.version}`] as [string, string]] : []),
    ...(item.connectedAs ? [['Connected as', item.connectedAs] as [string, string]] : []),
    ...(item.lastSync   ? [['Last sync', item.lastSync] as [string, string]] : []),
  ]
  const hasMore = details.length > 2 || !!item.error || !!item.detail

  return (
    <div className="border-b border-border-subtle last:border-0">
      <button
        type="button"
        onClick={() => hasMore && setOpen(o => !o)}
        aria-expanded={hasMore ? open : undefined}
        className={clsx('w-full flex items-center gap-3 px-4 py-3 text-left transition-colors', hasMore ? 'hover:bg-base/40 cursor-pointer' : 'cursor-default')}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-base border border-border shrink-0 text-base select-none">
          {item.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{item.name}</span>
            {item.version && (
              <span className="text-xxs text-text-muted bg-base px-1.5 py-0.5 rounded border border-border-subtle">v{item.version}</span>
            )}
            {item.status === 'error' && (
              <span className="flex items-center gap-1 text-xxs text-red-400"><AlertTriangle size={9} />Error</span>
            )}
          </div>

          {item.connectedAs ? (
            <p className="text-xxs text-text-muted mt-0.5 truncate">{item.connectedAs}</p>
          ) : item.detail ? (
            <p className="text-xxs text-text-muted mt-0.5 truncate">{item.detail}</p>
          ) : item.error ? (
            <p className="text-xxs text-red-400/80 mt-0.5 truncate">{item.error}</p>
          ) : item.status === 'disconnected' ? (
            <p className="text-xxs text-text-muted mt-0.5">Not connected</p>
          ) : item.status === 'pending' ? (
            <p className="text-xxs text-amber-400/80 mt-0.5">Awaiting configuration</p>
          ) : null}
        </div>

        {item.lastSync && (
          <div className="flex items-center gap-1 text-xxs text-text-muted shrink-0 hidden sm:flex">
            <RefreshCw size={9} />{item.lastSync}
          </div>
        )}

        <div className={clsx('flex items-center gap-1.5 text-xxs font-medium shrink-0', sm.color)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full', sm.dot)} />
          {sm.label}
        </div>

        {hasMore && <ChevronDown size={14} className={clsx('text-text-muted shrink-0 transition-transform', open && 'rotate-180')} />}
      </button>

      {open && hasMore && (
        <div className="px-4 pb-3 pl-[3.75rem] grid grid-cols-2 gap-x-6 gap-y-1.5 text-xxs">
          {details.map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <span className="text-text-muted shrink-0">{k}</span>
              <span className="text-text-secondary truncate" title={v}>{v}</span>
            </div>
          ))}
          {item.error && (
            <div className="col-span-2 mt-1">
              <span className="text-text-muted">Error</span>
              <pre className="whitespace-pre-wrap break-words text-red-300/90 font-mono mt-0.5 bg-red-950/20 border border-red-900/40 rounded p-2">{item.error}</pre>
            </div>
          )}
          {!item.error && item.detail && (
            <div className="col-span-2 text-text-secondary"><span className="text-text-muted mr-2">Detail</span>{item.detail}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle bg-base/40">
        <div className="h-3 w-24 rounded bg-base animate-pulse" />
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0">
          <div className="w-8 h-8 rounded-lg bg-base animate-pulse shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-base animate-pulse" />
            <div className="h-2.5 w-48 rounded bg-base animate-pulse" />
          </div>
          <div className="h-4 w-16 rounded-full bg-base animate-pulse" />
        </div>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Office() {
  const [data, setData]       = useState<LiveIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState<string>('')
  const [activeCategory, setActiveCategory] = usePersistedState<IntegrationCategory | 'all'>('mc:office:category', 'all')

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await office.integrations()
      setData(res.integrations)
      setRefreshed(new Date(res.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (e: any) {
      setError(e.message ?? 'Failed to load integrations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const connected    = data.filter(i => i.status === 'connected').length
  const errors       = data.filter(i => i.status === 'error').length
  const inactive     = data.filter(i => i.status === 'disconnected' || i.status === 'pending').length
  const total        = data.length || 1

  // Only show categories that have items
  const presentCats  = ALL_CATEGORIES.filter(cat => data.some(i => i.category === cat))

  const filtered = activeCategory === 'all'
    ? data
    : data.filter(i => i.category === activeCategory)

  const grouped = presentCats.reduce<Record<IntegrationCategory, LiveIntegration[]>>((acc, cat) => {
    acc[cat] = filtered.filter(i => i.category === cat)
    return acc
  }, {} as Record<IntegrationCategory, LiveIntegration[]>)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Office</h1>
          <p className="text-xs text-text-muted mt-0.5">Integrations &amp; connected services</p>
        </div>
        <div className="flex items-center gap-4">
          {!loading && data.length > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                <span className="text-xs text-text-muted">{connected} connected</span>
              </div>
              {errors > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span className="text-xs text-red-400">{errors} error{errors > 1 ? 's' : ''}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                <span className="text-xs text-text-muted">{inactive} inactive</span>
              </div>
            </>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border text-xs text-text-muted hover:text-text-secondary hover:bg-card transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Refresh
          </button>
        </div>
      </div>

      {/* Health bar */}
      {!loading && data.length > 0 && (
        <div className="px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xxs text-text-muted">Overall health</span>
            <span className={clsx('text-xxs font-semibold', errors > 0 ? 'text-amber-400' : 'text-green-400')}>
              {errors > 0 ? 'Degraded' : 'All systems operational'}
            </span>
            {refreshed && (
              <span className="text-xxs text-text-muted ml-auto">Updated {refreshed}</span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-base overflow-hidden flex gap-0.5">
            <div className="bg-green-500 h-full rounded-full transition-all" style={{ width: `${(connected / total) * 100}%` }} />
            <div className="bg-red-500   h-full rounded-full transition-all" style={{ width: `${(errors   / total) * 100}%` }} />
            <div className="bg-amber-500 h-full rounded-full transition-all" style={{ width: `${(inactive / total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Category tabs */}
      {!loading && data.length > 0 && (
        <div className="flex items-center gap-1 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveCategory('all')}
            className={clsx('px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-all',
              activeCategory === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
          >
            All <span className="ml-1 text-xxs opacity-60">{data.length}</span>
          </button>
          {presentCats.map(cat => {
            const count = data.filter(i => i.category === cat).length
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat === activeCategory ? 'all' : cat)}
                className={clsx('px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap transition-all',
                  activeCategory === cat ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
              >
                {catLabels[cat]} <span className="ml-1 text-xxs opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <AlertCircle size={32} className="text-red-400/60" />
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => load()} className="px-3 py-1.5 rounded border border-border text-xs text-text-secondary hover:bg-card transition-colors">
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-4">
            <SkeletonRows />
            <SkeletonRows />
          </div>
        ) : data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Plug size={32} className="text-text-muted/40" />
            <p className="text-sm text-text-muted">No integrations found</p>
            <p className="text-xs text-text-muted max-w-sm">
              Install plugins or configure MCPs in Claude settings to see connected services here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {presentCats.map(cat => {
              const items = grouped[cat]
              if (!items?.length) return null
              return (
                <div key={cat} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border-subtle bg-base/40">
                    <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                      {catLabels[cat]}
                    </span>
                  </div>
                  {items.map(item => <IntegrationRow key={item.id} item={item} />)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
