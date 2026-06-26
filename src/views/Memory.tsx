// title: Memory — end-to-end operational view of agent memory
// path: src/views/Memory.tsx
// purpose: Live monitoring + inspection of the OpenClaw/Hermes memory system:
//          a real-time event timeline (the agent deciding to remember things),
//          subsystem health (doctor.memory.status / embeddings / vector DB),
//          metrics over time, the workspace file / daily-dump browser, vector
//          growth, and consolidation/dreaming runs. Token-only live capture via
//          the memory SSE stream; agent-side push enriches it. See
//          docs/memory-redesign.md for the full design.

import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Search, Flame, Brain, RefreshCw, AlertCircle, FolderOpen, ChevronRight,
  Activity as ActivityIcon, HeartPulse, BarChart3, Database, Sparkles, Save, Pencil, Layers, Trash2,
  CircleSlash, Wifi, WifiOff, Pause, Clock, FileText, CalendarDays,
} from 'lucide-react'
import { TabHub, type HubTab } from '../components/layout/TabHub'
import { MiniStat, ChartCard, Histogram, HBar, fmtNum } from '../components/charts'
import { usePaused } from '../lib/refreshBus'
import {
  memoryOps, MEMORY_STREAM_URL,
  type MemorySource, type MemoryEvent, type MemoryEventType,
  type MemoryOpsOverview, type MemoryHealth, type MemoryFileInfo,
  type DailyLogMeta, type DreamMeta, type DreamEvent, type RecallSummary,
  type DailySearchHit, type DailyIndexMeta, type MemoryDiskSummary,
  type RagSearchHit,
} from '../lib/api'

// ─── Shared config ──────────────────────────────────────────────────────────────


// Live memory-event lanes (color-coded for fast scanning).
const EVENT_CONFIG: Record<MemoryEventType, { label: string; icon: React.ReactNode; color: string; border: string }> = {
  created:      { label: 'Created',      icon: <Save        size={12} />, color: 'text-violet-300', border: 'border-l-violet-500' },
  updated:      { label: 'Updated',      icon: <Pencil      size={12} />, color: 'text-blue-300',   border: 'border-l-blue-500'   },
  retrieved:    { label: 'Retrieved',    icon: <Search      size={12} />, color: 'text-teal-300',   border: 'border-l-teal-500'   },
  embedded:     { label: 'Embedded',     icon: <Layers      size={12} />, color: 'text-slate-300',  border: 'border-l-slate-500'  },
  consolidated: { label: 'Consolidated', icon: <Sparkles    size={12} />, color: 'text-amber-300',  border: 'border-l-amber-500'  },
  skipped:      { label: 'Skipped',      icon: <CircleSlash size={12} />, color: 'text-text-muted', border: 'border-l-slate-700'  },
  deleted:      { label: 'Deleted',      icon: <Trash2      size={12} />, color: 'text-rose-300',   border: 'border-l-rose-500'   },
  error:        { label: 'Error',        icon: <AlertCircle size={12} />, color: 'text-red-300',    border: 'border-l-red-500'    },
}
const EVENT_TYPES = Object.keys(EVENT_CONFIG) as MemoryEventType[]

// (conversation/source chips use CHANNEL_CFG above)

// ─── Helpers ─────────────────────────────────────────────────────────────────────

function timeAgo(ts: string | number): string {
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime()
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec < 5)  return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}
function fmtBytes(n: number): string {
  if (!n) return '0 B'
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`
  return `${n} B`
}

// ─── Markdown-lite renderer (shared by the Memories browser) ─────────────────────

function renderContent(content: string) {
  return content.split('\n').map((line, i) => {
    if (line === '') return <div key={i} className="h-2" />
    if (line.startsWith('# '))  return <p key={i} className="text-sm font-bold text-text-primary mt-4 mb-2">{line.slice(2)}</p>
    if (line.startsWith('## ')) return <p key={i} className="text-xs font-bold text-text-primary mt-3 mb-1.5">{line.slice(3)}</p>
    if (line.startsWith('### ')) return <p key={i} className="text-xs font-semibold text-text-secondary mt-2 mb-1">{line.slice(4)}</p>
    if (line.startsWith('- ') || line.startsWith('* '))
      return (
        <div key={i} className="flex gap-2 mb-0.5">
          <span className="text-text-muted mt-[3px] shrink-0">·</span>
          <span className="text-xs text-text-secondary leading-relaxed">{inlineFmt(line.slice(2))}</span>
        </div>
      )
    return <p key={i} className="text-xs text-text-secondary leading-relaxed mb-1">{inlineFmt(line)}</p>
  })
}
function inlineFmt(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="font-mono text-xxs bg-base border border-border-subtle px-1 py-0.5 rounded text-accent-blue">{part.slice(1, -1)}</code>
        return part
      })}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 1 — Activity (live event timeline)
// ══════════════════════════════════════════════════════════════════════════════

function EventRow({ e }: { e: MemoryEvent }) {
  const [open, setOpen] = useState(false)
  const [dream, setDream] = useState<string | null>(null)
  const [dreamLoading, setDreamLoading] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const cfg = EVENT_CONFIG[e.type] ?? EVENT_CONFIG.created
  const fresh = Date.now() - new Date(e.ts).getTime() < 8_000
  const p: any = e.payload ?? {}
  const isDream = p?.type === 'memory.dream.completed' && typeof p.reportPath === 'string'
  const dreamDate = isDream ? (String(p.reportPath).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '') : ''

  const toggle = () => {
    const next = !open; setOpen(next)
    if (next && isDream && dream === null && !dreamLoading && p.phase && dreamDate) {
      setDreamLoading(true)
      memoryOps.disk.dream(p.phase, dreamDate).then(r => setDream(r.content)).catch(() => setDream('')).finally(() => setDreamLoading(false))
    }
  }

  return (
    <div className={clsx('border-l-2 rounded-r', cfg.border, open && 'bg-card/40')}>
      {/* Compact one-line row */}
      <button onClick={toggle} className="w-full flex items-center gap-2 pl-3 pr-2 py-1.5 text-left hover:bg-card/50 rounded-r">
        <span className={clsx('shrink-0', cfg.color, fresh && 'animate-pulse')}>{cfg.icon}</span>
        <span className={clsx('text-xs font-semibold shrink-0', cfg.color)}>{cfg.label}</span>
        <span className="text-xs text-text-secondary truncate min-w-0">{e.summary || e.title}</span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {e.status === 'fail' && <span className="text-xxs text-red-400">failed</span>}
          {e.trigger === 'cron' && <span className="text-xxs text-text-muted">cron</span>}
          <span className="text-xxs text-text-muted tabular-nums">{timeAgo(e.ts)}</span>
          <ChevronRight size={11} className={clsx('text-text-muted transition-transform', open && 'rotate-90')} />
        </span>
      </button>

      {/* Expanded: the actual content, not raw JSON */}
      {open && (
        <div className="ml-6 mr-3 mb-2 mt-0.5">
          {isDream ? (
            dreamLoading ? <p className="text-xxs text-text-muted animate-pulse py-1">Loading dream report…</p>
            : dream ? <div className="text-xs bg-base rounded p-3 border border-border-subtle max-h-80 overflow-y-auto">{renderContent(dream)}</div>
            : <p className="text-xxs text-text-muted py-1">Dream report not found on disk.</p>
          ) : p?.type === 'memory.recall.recorded' ? (
            <p className="text-xs text-text-secondary py-1">Searched <span className="font-mono text-text-primary">{String(p.query ?? '').replace(/^__dreaming_\w+__:/, '') || '(internal)'}</span> → {p.resultCount ?? 0} hits across the memory store.</p>
          ) : p?.type === 'memory.promotion.applied' ? (
            <div className="text-xs space-y-1 py-1">
              <p className="text-text-secondary">Promoted {p.applied ?? p.candidates?.length ?? 0} fact(s) into long-term MEMORY.md:</p>
              {(p.candidates ?? []).map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2 pl-3"><span className="font-mono text-xxs text-text-muted">{String(c.path).replace(/^memory\//, '')}</span><span className="text-xxs text-emerald-400">score {Number(c.score).toFixed(2)}</span></div>
              ))}
            </div>
          ) : (
            <div className="text-xxs text-text-muted space-y-1 py-1">
              {e.sessionKey && <p className="font-mono break-all">session: {e.sessionKey}</p>}
              {e.tool && <p>tool: <span className="font-mono">{e.tool}</span></p>}
              {e.latencyMs != null && <p>latency: {e.latencyMs}ms</p>}
              <button onClick={() => setShowRaw(r => !r)} className="text-text-muted hover:text-text-secondary underline-offset-2 hover:underline">{showRaw ? 'hide' : 'show'} raw payload</button>
              {showRaw && <pre className="font-mono bg-base rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-all border border-border-subtle">{JSON.stringify(e.payload ?? {}, null, 2)}</pre>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Render the dreaming pipeline's own event log (recall / dream / promotion) as
// memory events, so Activity reflects real memory-system activity — not just the
// (usually quiet) live tool-call detection.
function diskEventToMemory(e: DreamEvent, i: number): MemoryEvent {
  let type: MemoryEventType = 'retrieved', title = e.type, summary = ''
  if (e.type === 'memory.recall.recorded') { type = 'retrieved'; title = 'Recall'; summary = `${(e.query ?? '').replace(/^__dreaming_\w+__:/, '')} — ${e.resultCount ?? 0} hits` }
  else if (e.type === 'memory.dream.completed') { type = 'consolidated'; title = 'Dream cycle'; summary = `${e.phase ?? ''} sleep${e.lineCount ? ` · ${e.lineCount} lines` : ''}` }
  else if (e.type === 'memory.promotion.applied') { type = 'created'; title = 'Promotion → MEMORY.md'; summary = `promoted ${e.applied ?? e.candidates?.length ?? 0} candidate(s)` }
  return { id: `disk-${e.type}-${e.timestamp}-${i}`, source: 'openclaw', type, trigger: 'cron', status: 'ok', objectId: null, sessionKey: null, tool: null, title, summary, latencyMs: null, origin: 'push', payload: e, ts: e.timestamp }
}

function ActivityTab({ source, seed }: { source: MemorySource; seed: MemoryEvent[] }) {
  const [events, setEvents] = useState<MemoryEvent[]>(seed)
  const [diskEvents, setDiskEvents] = useState<MemoryEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [typeFilter, setTypeFilter] = useState<MemoryEventType | 'all'>('all')
  const [search, setSearch] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const paused = usePaused()
  const seen = useRef(new Set<string>(seed.map(e => e.id)))

  useEffect(() => { setEvents(seed); seen.current = new Set(seed.map(e => e.id)) }, [source]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    memoryOps.disk.events(250).then(r => setDiskEvents(r.events.map((e, i) => diskEventToMemory(e, i)))).catch(() => setDiskEvents([]))
  }, [source])

  useEffect(() => {
    if (paused) { setConnected(false); return }
    const es = new EventSource(MEMORY_STREAM_URL)
    es.onmessage = ev => {
      try {
        const e = JSON.parse(ev.data) as MemoryEvent
        if (!e?.id || seen.current.has(e.id)) return
        seen.current.add(e.id)
        setEvents(prev => [e, ...prev].slice(0, 300))
      } catch { /* ignore */ }
    }
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    return () => es.close()
  }, [paused])

  const merged = [...events, ...diskEvents].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  const filtered = merged.filter(e => {
    if (e.source !== source) return false
    if (!showRaw && (e.type === 'skipped' || e.type === 'embedded')) return false
    if (typeFilter !== 'all' && e.type !== typeFilter) return false
    const q = search.toLowerCase()
    if (q && !`${e.summary} ${e.tool ?? ''} ${e.title}`.toLowerCase().includes(q)) return false
    return true
  })
  const newestTs = merged[0]?.ts
  const staleDays = newestTs ? (Date.now() - new Date(newestTs).getTime()) / 86_400_000 : Infinity

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Controls */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-card border border-border min-w-[180px]">
          <Search size={11} className="text-text-muted shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search events…"
            className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none" />
        </div>
        <button onClick={() => setTypeFilter('all')}
          className={clsx('px-2 py-0.5 rounded text-xxs font-medium', typeFilter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>All</button>
        {EVENT_TYPES.filter(t => merged.some(e => e.source === source && e.type === t)).map(t => (
          <button key={t} onClick={() => setTypeFilter(t === typeFilter ? 'all' : t)}
            className={clsx('px-2 py-0.5 rounded text-xxs font-medium', typeFilter === t ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            {EVENT_CONFIG[t].label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xxs text-text-muted cursor-pointer select-none">
          <input type="checkbox" checked={showRaw} onChange={e => setShowRaw(e.target.checked)} className="accent-amber-500" />
          Raw (all lanes)
        </label>
        <span className={clsx('flex items-center gap-1 text-xxs font-medium', paused ? 'text-amber-400' : connected ? 'text-green-400' : 'text-red-400')}>
          {paused ? <><Pause size={11} /> paused</> : connected ? <><Wifi size={11} /> live</> : <><WifiOff size={11} /> offline</>}
        </span>
      </div>
      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <ActivityIcon size={20} className="text-text-muted mb-2" />
            <p className="text-sm text-text-muted">No memory events</p>
            <p className="text-xxs text-text-muted mt-1 max-w-sm">
              Live memory tool-calls appear here in real time, and the dreaming-pipeline log (recall / dream / promotion) is loaded below it.
              If both are empty, the agent's memory subsystem isn't producing events.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-w-3xl">
            {Number.isFinite(staleDays) && staleDays > 3 && (
              <div className="flex items-start gap-2 mb-2 px-3 py-2 rounded-lg border border-amber-900/50 bg-amber-950/30 text-amber-200">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <p className="text-xxs leading-relaxed">
                  No live memory activity — showing the dreaming-pipeline log. The newest memory-system event was <strong>{timeAgo(newestTs!)}</strong>; the nightly dream/embed job appears paused (see Health).
                </p>
              </div>
            )}
            {filtered.map(e => <EventRow key={e.id} e={e} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 2 — Daily (every conversation grouped by day) + memory files
// ══════════════════════════════════════════════════════════════════════════════

function DailyTab({ source }: { source: MemorySource }) {
  const [mode, setMode] = useState<'daily' | 'files'>('daily')
  const [logs, setLogs] = useState<DailyLogMeta[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsErr, setLogsErr] = useState<string | null>(null)
  const [files, setFiles] = useState<MemoryFileInfo[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesLoaded, setFilesLoaded] = useState(false)
  const [sel, setSel] = useState<{ kind: 'log' | 'file'; id: string; sub: string } | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyErr, setBodyErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<DailySearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [indexMeta, setIndexMeta] = useState<DailyIndexMeta | null>(null)

  const loadLogs = useCallback(() => {
    setLogsLoading(true); setLogsErr(null)
    memoryOps.disk.daily().then(d => setLogs(d.logs)).catch(e => setLogsErr(e.message)).finally(() => setLogsLoading(false))
  }, [])

  useEffect(() => { setSel(null); setBody(null); loadLogs() }, [loadLogs])
  // Warm the local full-text index on mount (one SSH bulk pull → memory.db).
  useEffect(() => {
    memoryOps.disk.index().then(m => {
      setIndexMeta(m)
      if (m.count === 0) memoryOps.disk.sync().then(() => memoryOps.disk.index().then(setIndexMeta)).catch(() => {})
    }).catch(() => {})
  }, [])
  useEffect(() => {
    if (mode !== 'files' || filesLoaded) return
    setFilesLoading(true)
    memoryOps.files(source).then(r => { setFiles(r.files ?? []); setFilesLoaded(true) })
      .catch(() => setFilesLoaded(true)).finally(() => setFilesLoading(false))
  }, [mode, filesLoaded, source])

  // Debounced content search across every indexed day.
  const queryStr = search.trim()
  useEffect(() => {
    if (mode !== 'daily' || queryStr.length < 2) { setHits(null); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      memoryOps.disk.search(queryStr).then(r => { setHits(r.results); setIndexMeta(r.index) }).catch(() => setHits([])).finally(() => setSearching(false))
    }, 280)
    return () => clearTimeout(t)
  }, [queryStr, mode])

  const openLog = (l: DailyLogMeta) => {
    setSel({ kind: 'log', id: l.date, sub: `${fmtBytes(l.size)}${l.mtime ? ` · updated ${timeAgo(l.mtime)}` : ''}` })
    setBody(null); setBodyErr(null); setBodyLoading(true)
    memoryOps.disk.dailyContent(l.date).then(r => setBody(r.content)).catch(e => setBodyErr(e.message)).finally(() => setBodyLoading(false))
  }
  const openDate = (date: string, size: number) => openLog(logs.find(l => l.date === date) ?? { date, size, mtime: '', preview: '' })
  const openFile = (f: MemoryFileInfo) => {
    setSel({ kind: 'file', id: f.name, sub: fmtBytes(f.size) })
    setBody(null); setBodyErr(null); setBodyLoading(true)
    memoryOps.file(source, f.name).then(r => setBody(r.content)).catch(e => setBodyErr(e.message)).finally(() => setBodyLoading(false))
  }

  const visibleFiles = queryStr ? files.filter(f => f.name.toLowerCase().includes(queryStr.toLowerCase())) : files
  const fmtDay = (d: string) => new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + (d.length > 10 ? ' (midday)' : '')

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left list */}
      <div className="flex flex-col w-[300px] min-w-[300px] border-r border-border bg-surface overflow-hidden">
        <div className="flex items-center gap-1 px-3 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-0.5 rounded-lg bg-card border border-border p-0.5 flex-1">
            <button onClick={() => setMode('daily')}
              className={clsx('flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xxs font-medium', mode === 'daily' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              <CalendarDays size={11} /> Daily logs
            </button>
            <button onClick={() => setMode('files')}
              className={clsx('flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-xxs font-medium', mode === 'files' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              <Flame size={11} /> Files
            </button>
          </div>
          <button onClick={mode === 'daily' ? loadLogs : () => setFilesLoaded(false)} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary">
            <RefreshCw size={11} className={(mode === 'daily' ? logsLoading : filesLoading) ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="px-3 pb-2 shrink-0">
          <p className="text-xxs text-text-muted mb-1.5">
            {mode === 'daily'
              ? (logsLoading ? <span className="animate-pulse">Reading daily logs…</span>
                 : hits !== null ? <>{searching ? 'searching…' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`} &middot; across {indexMeta?.count ?? logs.length} days</>
                 : <>{logs.length} daily logs &middot; search spans {indexMeta?.count ?? 0}</>)
              : (filesLoading ? <span className="animate-pulse">Loading files…</span> : <>{files.length} memory files</>)}
          </p>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-card border border-border">
            <Search size={11} className="text-text-muted shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={mode === 'daily' ? 'Search every day…' : 'Search files…'}
              className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none" />
          </div>
        </div>
        {logsErr && mode === 'daily' && (
          <div className="flex items-start gap-2 mx-3 mb-2 px-3 py-2 rounded border border-amber-900/40 bg-amber-950/20 text-amber-300">
            <AlertCircle size={11} className="shrink-0 mt-0.5" /><p className="text-xxs leading-snug">{logsErr}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {mode === 'daily' ? (
            logsLoading ? <p className="text-xxs text-text-muted text-center py-6 animate-pulse">Reading the agent's daily logs over SSH…</p>
            : hits !== null ? (
                searching ? <p className="text-xxs text-text-muted text-center py-6 animate-pulse">Searching all days…</p>
                : hits.length === 0 ? <p className="text-xxs text-text-muted text-center py-6">No days mention “{queryStr}”</p>
                : <div className="flex flex-col gap-0.5">
                    {hits.map(h => {
                      const active = sel?.kind === 'log' && sel.id === h.date
                      return (
                        <button key={h.date} onClick={() => openDate(h.date, h.size)}
                          className={clsx('w-full text-left px-3 py-2 rounded transition-colors', active ? 'bg-card-hover' : 'hover:bg-card')}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Search size={10} className="text-cyan-400 shrink-0" />
                            <span className={clsx('text-xs font-semibold', active ? 'text-text-primary' : 'text-text-secondary')}>{fmtDay(h.date)}</span>
                            <span className="ml-auto text-xxs text-text-muted shrink-0">{fmtBytes(h.size)}</span>
                          </div>
                          <p className="text-xxs text-text-muted leading-snug line-clamp-2 pl-4">{h.snippet}</p>
                        </button>
                      )
                    })}
                  </div>
              )
            : logs.length === 0 ? <p className="text-xxs text-text-muted text-center py-6">No daily logs found</p>
            : <div className="flex flex-col gap-0.5">
                {logs.map(l => {
                  const active = sel?.kind === 'log' && sel.id === l.date
                  return (
                    <button key={l.date} onClick={() => openLog(l)}
                      className={clsx('w-full text-left px-3 py-2 rounded transition-colors', active ? 'bg-card-hover' : 'hover:bg-card')}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <CalendarDays size={11} className="text-text-muted shrink-0" />
                        <span className={clsx('text-xs font-semibold', active ? 'text-text-primary' : 'text-text-secondary')}>{fmtDay(l.date)}</span>
                        <span className="ml-auto text-xxs text-text-muted shrink-0">{fmtBytes(l.size)}</span>
                      </div>
                      {l.preview && <p className="text-xxs text-text-muted leading-snug line-clamp-2 pl-4">{l.preview}</p>}
                    </button>
                  )
                })}
              </div>
          ) : (
            filesLoading ? <p className="text-xxs text-text-muted text-center py-6 animate-pulse">Reading memory files…</p>
            : visibleFiles.length === 0 ? <p className="text-xxs text-text-muted text-center py-6">No memory files</p>
            : <div className="flex flex-col gap-0.5">
                {visibleFiles.map(f => {
                  const active = sel?.kind === 'file' && sel.id === f.name
                  return (
                    <button key={f.name} onClick={() => openFile(f)}
                      className={clsx('w-full text-left px-3 py-2 rounded transition-colors', active ? 'bg-card-hover' : 'hover:bg-card')}>
                      <div className="flex items-center gap-1.5">
                        <FileText size={11} className="text-text-muted shrink-0" />
                        <span className={clsx('text-xs font-medium truncate', active ? 'text-text-primary' : 'text-text-secondary')}>{f.name}</span>
                      </div>
                      <p className="text-xxs text-text-muted mt-0.5 pl-4">{fmtBytes(f.size)}{f.updatedAt ? ` · ${timeAgo(f.updatedAt)}` : ''}</p>
                    </button>
                  )
                })}
              </div>
          )}
        </div>
      </div>

      {/* Right detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!sel ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <CalendarDays size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">{mode === 'daily' ? 'Select a day' : 'Select a memory file'}</span>
            <p className="text-xxs text-text-muted mt-1 max-w-xs">
              {mode === 'daily'
                ? "OpenClaw's own daily journal — a clean, curated summary of what happened each day. Read live from the agent machine."
                : 'The agent’s curated memory files (SOUL, USER, MEMORY, …) from its workspace.'}
            </p>
          </div>
        ) : (
          <>
            <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2 mb-1">
                {sel.kind === 'log' ? <CalendarDays size={14} className="text-text-muted" /> : <FileText size={14} className="text-text-muted" />}
                <h1 className="text-base font-semibold text-text-primary">{sel.kind === 'log' ? fmtDay(sel.id) : sel.id}</h1>
              </div>
              <p className="text-xxs text-text-muted">{sel.sub}</p>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {bodyLoading ? <Centered>Loading…</Centered>
                : bodyErr ? <Note>{bodyErr}</Note>
                : <div className="max-w-3xl">{body ? renderContent(body) : <Note>Empty.</Note>}</div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 3 — Health (doctor.memory.status / embedding / vector)
// ══════════════════════════════════════════════════════════════════════════════

function HealthTab({ source }: { source: MemorySource }) {
  const [health, setHealth] = useState<MemoryHealth | null>(null)
  const [summary, setSummary] = useState<MemoryDiskSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    let on = true; setLoading(true)
    Promise.all([memoryOps.health(source).catch(() => null), memoryOps.disk.summary().catch(() => null)])
      .then(([h, s]) => { if (on) { setHealth(h); setSummary(s) } }).finally(() => on && setLoading(false))
    return () => { on = false }
  }, [source])

  if (loading) return <Centered>Reading memory subsystem…</Centered>

  const emb = health?.embedding
  const embStatus = summary?.embedding ?? (health ? embLabel(emb, health.vector, health.reachable) : 'unknown')
  const embAccent = embStatus === 'active' || embStatus === 'ok' ? 'text-green-400' : embStatus === 'error' ? 'text-red-400' : 'text-amber-400'
  const storeBytes = summary?.bytes ?? health?.store?.bytes ?? null
  const f = summary?.freshness

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5">
      {summary?.stale && f && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-amber-900/50 bg-amber-950/30 text-amber-200">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed">
            <strong>Dreaming pipeline looks paused.</strong> Last consolidation ran {f.lastDream ? timeAgo(f.lastDream) : 'never'}; the recall index hasn't updated since {f.lastRecallUpdate ? new Date(f.lastRecallUpdate).toLocaleDateString() : '—'} — that's why recall &amp; concepts read weeks old. The agent itself is active (newest daily log {f.lastDailyLog ? timeAgo(f.lastDailyLog) : '—'}); it's the nightly dream/embed job that stopped. Restart it on the box to refresh.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Memory store" value={storeBytes != null ? fmtBytes(storeBytes) : '—'} icon={<Database size={12} />} />
        <MiniStat label="Daily logs" value={summary ? String(summary.dailyLogs) : '—'} icon={<CalendarDays size={12} />} />
        <MiniStat label="Recall chunks" value={summary ? fmtNum(summary.recallChunks) : '—'} icon={<Layers size={12} />} />
        <MiniStat label="Embedding" value={embStatus} accent={embAccent} icon={<Layers size={12} />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Dream reports" value={summary ? String(summary.dreamReports) : '—'} icon={<Sparkles size={12} />} />
        <MiniStat label="Promotions" value={summary ? String(summary.promotions) : '—'} icon={<Save size={12} />} />
        <MiniStat label="Recall events" value={summary ? fmtNum(summary.recallEvents) : '—'} icon={<Search size={12} />} />
        <MiniStat label="Workspace files" value={String(health?.store?.files ?? '—')} icon={<FolderOpen size={12} />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Vector store — LanceDB" icon={<Database size={13} className="text-text-muted" />}>
          {summary?.vectorStore?.present ? (
            <>
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs mb-2">
                <Kv k="store" v="memories.lance" />
                <Kv k="size" v={fmtBytes(summary.vectorStore.bytes)} />
                <Kv k="last write" v={summary.vectorStore.lastWrite ? timeAgo(summary.vectorStore.lastWrite) : '—'} />
                <Kv k="live plugin" v={<span className={summary.plugin === 'ok' ? 'text-green-400' : 'text-amber-400'}>{summary.plugin}</span>} />
              </div>
              <p className="text-xxs text-text-muted">The on-disk vector store exists and holds embeddings. The gateway's <em>live recall plugin</em> is <strong>{summary.plugin}</strong> — restart the agent's memory plugin to resume real-time embedding/recall.</p>
            </>
          ) : (
            <p className="text-xs text-text-muted">No LanceDB store found on the agent.</p>
          )}
        </ChartCard>

        {f && (
          <ChartCard title="Pipeline freshness" icon={<Clock size={13} className="text-text-muted" />}>
            <div className="space-y-1.5">
              <FreshRow label="Daily log written" ts={f.lastDailyLog} />
              <FreshRow label="Dream cycle ran" ts={f.lastDream} />
              <FreshRow label="Recall index updated" ts={f.lastRecallUpdate} />
              <FreshRow label="LanceDB written" ts={summary?.vectorStore?.lastWrite ?? null} />
            </div>
          </ChartCard>
        )}
      </div>

      {emb && Object.keys(emb).some(k => typeof (emb as any)[k] !== 'object') && (
        <ChartCard title="doctor.memory.status — embedding" icon={<Layers size={13} className="text-text-muted" />}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
            {Object.entries(emb).filter(([, v]) => typeof v !== 'object').map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs border-b border-border-subtle py-1">
                <span className="text-text-muted">{k}</span><span className="text-text-primary font-mono truncate ml-2">{String(v)}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {health?.doctorRaw && (
        <div>
          <button onClick={() => setShowRaw(r => !r)} className="text-xxs text-text-muted hover:text-text-secondary flex items-center gap-1">
            <ChevronRight size={11} className={clsx('transition-transform', showRaw && 'rotate-90')} /> Raw doctor.memory.status
          </button>
          {showRaw && (
            <pre className="mt-2 text-xxs font-mono text-text-muted bg-base rounded p-3 overflow-x-auto max-h-80 whitespace-pre-wrap break-all border border-border">
              {JSON.stringify(health.doctorRaw, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 4 — Metrics
// ══════════════════════════════════════════════════════════════════════════════

function MetricsTab() {
  const [logs, setLogs] = useState<DailyLogMeta[]>([])
  const [events, setEvents] = useState<DreamEvent[]>([])
  const [recall, setRecall] = useState<RecallSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true; setLoading(true)
    Promise.all([memoryOps.disk.daily(), memoryOps.disk.events(400), memoryOps.disk.recall()])
      .then(([d, e, r]) => { if (on) { setLogs(d.logs); setEvents(e.events); setRecall(r) } })
      .catch(() => {}).finally(() => on && setLoading(false))
    return () => { on = false }
  }, [])

  if (loading) return <Centered>Crunching memory metrics…</Centered>
  if (logs.length === 0) return <div className="p-6"><Note>No data — the agent's memory dir couldn't be read over SSH. Check the host/key in Settings.</Note></div>

  const chron = [...logs].sort((a, b) => a.date.localeCompare(b.date))
  const totalBytes = logs.reduce((s, l) => s + l.size, 0)
  const dreams = events.filter(e => e.type === 'memory.dream.completed')
  const promos = events.filter(e => e.type === 'memory.promotion.applied')
  const recalls = events.filter(e => e.type === 'memory.recall.recorded')

  const byMonth = new Map<string, number>()
  for (const l of logs) { const m = l.date.slice(0, 7); byMonth.set(m, (byMonth.get(m) ?? 0) + l.size) }
  const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const maxMonth = Math.max(...months.map(m => m[1]), 1)

  const phaseCount: Record<string, number> = { light: 0, deep: 0, rem: 0 }
  for (const d of dreams) { if (d.phase && phaseCount[d.phase] != null) phaseCount[d.phase]++ }
  const maxPhase = Math.max(...Object.values(phaseCount), 1)

  const recallByDay = new Map<string, number>()
  for (const e of recalls) { const day = (e.timestamp || '').slice(0, 10); if (day) recallByDay.set(day, (recallByDay.get(day) ?? 0) + 1) }
  const recallDays = [...recallByDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const tags = (recall?.topTags ?? []).filter(t => !TAG_STOP.has(t.tag.toLowerCase()) && t.tag.length > 2).slice(0, 12)
  const maxTag = Math.max(...tags.map(t => t.count), 1)

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <MiniStat label="Days logged" value={String(logs.length)} icon={<CalendarDays size={12} />} />
        <MiniStat label="Memory size" value={fmtBytes(totalBytes)} icon={<Database size={12} />} />
        <MiniStat label="Dream cycles" value={String(dreams.length)} icon={<Sparkles size={12} />} />
        <MiniStat label="Promotions" value={String(promos.length)} icon={<Save size={12} />} />
        <MiniStat label="Recall chunks" value={recall ? fmtNum(recall.total) : '—'} icon={<Layers size={12} />} />
        <MiniStat label="Recall events" value={fmtNum(recalls.length)} icon={<Search size={12} />} />
      </div>

      <ChartCard title="Memory captured per day" icon={<CalendarDays size={13} className="text-text-muted" />}
        right={<span className="text-xxs text-text-muted">{chron[0]?.date} → {chron[chron.length - 1]?.date}</span>}>
        <Histogram bars={chron.map(l => ({ value: l.size, color: '#a78bfa', label: `${l.date}: ${fmtBytes(l.size)}` }))} height={80} />
        <p className="text-xxs text-text-muted mt-2">Taller bars = busier days. Avg {fmtBytes(Math.round(totalBytes / logs.length))}/day.</p>
      </ChartCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartCard title="Volume by month" icon={<BarChart3 size={13} className="text-text-muted" />}>
          <div className="space-y-1.5">
            {months.map(([m, v]) => <HBar key={m} label={m} value={Math.round(v / 1024)} max={Math.round(maxMonth / 1024)} color="#818cf8" suffix=" KB" />)}
          </div>
        </ChartCard>
        <ChartCard title="Dream phases run" icon={<Sparkles size={13} className="text-text-muted" />}>
          <div className="space-y-1.5">
            <HBar label="Light" value={phaseCount.light} max={maxPhase} color="#38bdf8" />
            <HBar label="Deep" value={phaseCount.deep} max={maxPhase} color="#818cf8" />
            <HBar label="REM" value={phaseCount.rem} max={maxPhase} color="#a78bfa" />
          </div>
          <p className="text-xxs text-text-muted mt-2">{promos.length} promotions into long-term memory.</p>
        </ChartCard>
      </div>

      {recallDays.length > 1 && (
        <ChartCard title="Recall activity (events / day)" icon={<Search size={13} className="text-text-muted" />}>
          <Histogram bars={recallDays.map(([d, c]) => ({ value: c, color: '#2dd4bf', label: `${d}: ${c} recalls` }))} height={64} />
        </ChartCard>
      )}

      {tags.length > 0 && (
        <ChartCard title="Top concepts (recall frequency)" icon={<Layers size={13} className="text-text-muted" />}>
          <div className="space-y-1.5">{tags.map(t => <HBar key={t.tag} label={t.tag} value={t.count} max={maxTag} color="#22d3ee" />)}</div>
        </ChartCard>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 5 — Vector DB
// ══════════════════════════════════════════════════════════════════════════════

// Concept-tag noise: OpenClaw tokenizes the "<relevant-memories> Treat … untrusted"
// recall-prompt boilerplate into tags, so strip those + tiny stopwords.
const TAG_STOP = new Set(['user', 'assistant', 'treat', 'below', 'memories', 'relevant', 'relevant-memories', 'untrusted', 'the', 'and', 'for', 'with', 'this', 'that', 'memory', 'historical', 'data', 'context', 'only'])

function VectorTab() {
  const [recall, setRecall] = useState<RecallSummary | null>(null)
  const [recallEvents, setRecallEvents] = useState<DreamEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let on = true; setLoading(true)
    Promise.all([memoryOps.disk.recall(), memoryOps.disk.events(400)])
      .then(([r, e]) => { if (on) { setRecall(r); setRecallEvents(e.events.filter(x => x.type === 'memory.recall.recorded')) } })
      .catch(e => on && setErr(e.message)).finally(() => on && setLoading(false))
    return () => { on = false }
  }, [])

  if (loading) return <Centered>Reading semantic recall store…</Centered>
  if (err || !recall) return <div className="p-6"><Note>Couldn't read the recall store over SSH{err ? `: ${err}` : ''}. Check the agent host in Settings.</Note></div>

  const tags = recall.topTags.filter(t => !TAG_STOP.has(t.tag.toLowerCase()) && t.tag.length > 2).slice(0, 16)
  const maxTag = Math.max(...tags.map(t => t.count), 1)

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Memory chunks" value={fmtNum(recall.total)} icon={<Database size={12} />} />
        <MiniStat label="Recall events" value={fmtNum(recallEvents.length)} icon={<Search size={12} />} />
        <MiniStat label="Concept tags" value={fmtNum(recall.topTags.length)} icon={<Layers size={12} />} />
        <MiniStat label="Updated" value={recall.updatedAt ? timeAgo(recall.updatedAt) : '—'} icon={<Clock size={12} />} />
      </div>
      {recall.updatedAt && (Date.now() - new Date(recall.updatedAt).getTime()) > 7 * 86_400_000 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-900/50 bg-amber-950/30 text-amber-200">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          <p className="text-xxs leading-relaxed">Recall data is <strong>stale</strong> — last updated {timeAgo(recall.updatedAt)}. The dreaming pipeline that refreshes it appears paused, so these chunks reflect activity from weeks ago. Restart the dream/embed job on the agent to refresh.</p>
        </div>
      )}
      <Note>This is OpenClaw's <strong>semantic recall</strong> layer: every memory chunk (a daily-log line range) with how often it's been recalled during dreaming and its similarity score. Embedding-scored over a LanceDB store — recall scores come from real embeddings.</Note>

      {tags.length > 0 && (
        <ChartCard title="Top concepts (by recall frequency)" icon={<Layers size={13} className="text-text-muted" />}>
          <div className="space-y-1.5">
            {tags.map(t => <HBar key={t.tag} label={t.tag} value={t.count} max={maxTag} color="#22d3ee" />)}
          </div>
        </ChartCard>
      )}

      <ChartCard title="Most-recalled memories" icon={<Search size={13} className="text-text-muted" />}>
        <div className="space-y-2">
          {recall.topChunks.slice(0, 20).map((c, i) => (
            <div key={i} className="border-l-2 border-l-cyan-700 pl-3 py-1">
              <div className="flex items-center gap-2 text-xxs text-text-muted mb-0.5">
                <span className="font-mono">{c.path.replace(/^memory\//, '')}:{c.startLine}</span>
                <span className="px-1 rounded bg-cyan-950/40 border border-cyan-900/40 text-cyan-300">recalled ×{c.recallCount}</span>
                <span>score {c.totalScore.toFixed(1)}</span>
                {c.lastRecalledAt && <span className="ml-auto">{timeAgo(c.lastRecalledAt)}</span>}
              </div>
              <p className="text-xs text-text-secondary leading-snug line-clamp-2">{c.snippet}</p>
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 6 — Dreaming (sleep-cycle consolidation: light/deep/rem → MEMORY.md)
// ══════════════════════════════════════════════════════════════════════════════

const PHASE_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  light: { label: 'Light', cls: 'text-sky-300 bg-sky-950/40 border-sky-900/40',       dot: 'bg-sky-400' },
  deep:  { label: 'Deep',  cls: 'text-indigo-300 bg-indigo-950/40 border-indigo-900/40', dot: 'bg-indigo-400' },
  rem:   { label: 'REM',   cls: 'text-violet-300 bg-violet-950/40 border-violet-900/40', dot: 'bg-violet-400' },
}

function ConsolidationTab() {
  const [dreams, setDreams] = useState<DreamMeta[]>([])
  const [events, setEvents] = useState<DreamEvent[]>([])
  const [longterm, setLongterm] = useState<string | null>(null)
  const [sel, setSel] = useState<{ phase: string; date: string } | null>(null)
  const [body, setBody] = useState<string | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let on = true; setLoading(true)
    Promise.all([
      memoryOps.disk.dreams(),
      memoryOps.disk.events(400),
      memoryOps.disk.longterm().catch(() => ({ content: null as string | null })),
    ]).then(([d, e, lt]) => { if (on) { setDreams(d.dreams); setEvents(e.events); setLongterm(lt.content) } })
      .catch(() => {}).finally(() => on && setLoading(false))
    return () => { on = false }
  }, [])

  const openDream = (phase: string, date: string) => {
    setSel({ phase, date }); setBody(null); setBodyLoading(true)
    memoryOps.disk.dream(phase, date).then(r => setBody(r.content)).catch(() => setBody(null)).finally(() => setBodyLoading(false))
  }

  if (loading) return <Centered>Reading the dreaming pipeline…</Centered>

  // Group dream reports into nights (date → {phase: present}).
  const byDate = new Map<string, Set<string>>()
  for (const d of dreams) { const s = byDate.get(d.date) ?? new Set(); s.add(d.phase); byDate.set(d.date, s) }
  const nights = [...byDate.entries()].map(([date, phases]) => ({ date, phases })).sort((a, b) => b.date.localeCompare(a.date))
  const promotions = events.filter(e => e.type === 'memory.promotion.applied')
  const completed = events.filter(e => e.type === 'memory.dream.completed')

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: nights */}
      <div className="flex flex-col w-[230px] min-w-[230px] border-r border-border bg-surface overflow-hidden">
        <div className="px-3 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-1.5"><Sparkles size={13} className="text-amber-400" /><span className="text-xs font-semibold text-text-primary">Sleep cycles</span></div>
          <p className="text-xxs text-text-muted mt-0.5">{nights.length} nights · {completed.length} dreams · {promotions.length} promotions</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <button onClick={() => setSel(null)}
            className={clsx('w-full text-left px-2.5 py-2 rounded mb-1 text-xs font-medium', !sel ? 'bg-card-hover text-text-primary' : 'text-text-secondary hover:bg-card')}>
            Overview &amp; long-term memory
          </button>
          {nights.map(n => (
            <div key={n.date} className="px-2.5 py-1.5 rounded hover:bg-card">
              <p className="text-xs text-text-secondary mb-1">{new Date(n.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
              <div className="flex gap-1">
                {['light', 'deep', 'rem'].filter(p => n.phases.has(p)).map(p => {
                  const active = sel?.date === n.date && sel.phase === p
                  return (
                    <button key={p} onClick={() => openDream(p, n.date)}
                      className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium', active ? PHASE_CFG[p].cls + ' ring-1 ring-current' : PHASE_CFG[p].cls)}>
                      {PHASE_CFG[p].label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: dream report OR overview */}
      <div className="flex-1 overflow-y-auto">
        {sel ? (
          <div className="px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium', PHASE_CFG[sel.phase]?.cls)}>{PHASE_CFG[sel.phase]?.label} sleep</span>
              <h1 className="text-base font-semibold text-text-primary">{new Date(sel.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h1>
            </div>
            {bodyLoading ? <Centered>Loading dream…</Centered> : <div className="max-w-3xl">{body ? renderContent(body) : <Note>Empty dream report.</Note>}</div>}
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Dream cycles" value={String(completed.length)} icon={<Sparkles size={12} />} />
              <MiniStat label="Promotions" value={String(promotions.length)} icon={<Save size={12} />} />
              <MiniStat label="Nights" value={String(nights.length)} icon={<CalendarDays size={12} />} />
            </div>
            <Note>OpenClaw consolidates memory in a nightly <strong>sleep cycle</strong>: <span className="text-sky-300">Light</span> stages candidate facts from the day, <span className="text-indigo-300">Deep</span> ranks &amp; promotes the strongest into long-term <code className="font-mono">MEMORY.md</code>, <span className="text-violet-300">REM</span> synthesizes connections. Pick a night on the left to read a dream.</Note>

            {promotions.length > 0 && (
              <ChartCard title="Promoted to long-term memory" icon={<Save size={13} className="text-text-muted" />}>
                <div className="space-y-2">
                  {promotions.map((p, i) => (
                    <div key={i} className="text-xs">
                      <div className="flex items-center gap-2 text-xxs text-text-muted mb-1">
                        <Sparkles size={11} className="text-amber-400" /> {new Date(p.timestamp).toLocaleDateString()} · applied {p.applied ?? p.candidates?.length ?? 0}
                      </div>
                      {(p.candidates ?? []).map((c, j) => (
                        <div key={j} className="flex items-center gap-2 pl-4 text-text-secondary">
                          <span className="font-mono text-xxs">{c.path.replace(/^memory\//, '')}</span>
                          <span className="text-xxs text-emerald-400">score {c.score.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </ChartCard>
            )}

            {longterm && (
              <ChartCard title="Long-term memory (MEMORY.md)" icon={<Brain size={13} className="text-text-muted" />}>
                <div className="max-w-3xl max-h-[420px] overflow-y-auto">{renderContent(longterm)}</div>
              </ChartCard>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 7 — RAG Playground (query the LanceDB recall store)
// ══════════════════════════════════════════════════════════════════════════════

function scoreColor(score: number): string {
  if (score >= 0.66) return '#34d399'
  if (score >= 0.33) return '#fbbf24'
  return '#60a5fa'
}

function PlaygroundTab() {
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(8)
  const [results, setResults] = useState<RagSearchHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [ranAt, setRanAt] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const run = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults(null); setErr(null); return }
    setLoading(true); setErr(null)
    try {
      const r = await memoryOps.disk.ragSearch(trimmed, limit)
      setResults(r.results)
      setRanAt(r.updatedAt ? `store updated ${timeAgo(r.updatedAt)}` : '')
      if (r.error) setErr(r.error)
    } catch (e: any) { setErr(e.message); setResults([]) }
    finally { setLoading(false) }
  }, [limit])

  const examples = ['When did I adopt my cat?', 'project deadlines', 'hardware inventory', 'agent preferences']

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="px-6 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1 px-3 py-2 rounded-lg bg-card border border-border focus-within:border-blue-500/60 transition-colors">
            <Search size={14} className="text-text-muted shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') run(query) }}
              placeholder="Ask what the agent remembers… e.g. “When did I adopt my cat?”"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
            />
            {query && <button onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus() }}><CircleSlash size={13} className="text-text-muted hover:text-text-secondary" /></button>}
          </div>
          <div className="relative">
            <select value={limit} onChange={e => setLimit(Number(e.target.value))}
              className="appearance-none pl-3 pr-7 py-2 rounded-lg border border-border bg-card text-xs text-text-secondary outline-none focus:border-blue-500/60">
              {[5, 8, 12, 20].map(n => <option key={n} value={n}>Top {n}</option>)}
            </select>
            <ChevronRight size={11} className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-text-muted pointer-events-none" />
          </div>
          <button onClick={() => run(query)} disabled={loading || query.trim().length < 2}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors">
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
            Search
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-xxs text-text-muted">Try:</span>
          {examples.map(ex => (
            <button key={ex} onClick={() => { setQuery(ex); run(ex) }}
              className="px-2 py-0.5 rounded border border-border-subtle bg-card text-xxs text-text-secondary hover:bg-card-hover hover:text-text-primary transition-colors">
              {ex}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {err && (
          <div className="flex items-start gap-2 mb-3 px-3 py-2 rounded border border-amber-900/40 bg-amber-950/20 text-amber-300 max-w-3xl">
            <AlertCircle size={12} className="shrink-0 mt-0.5" /><p className="text-xxs leading-snug">{err}</p>
          </div>
        )}
        {results === null ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Database size={22} className="text-text-muted mb-2" />
            <p className="text-sm text-text-muted">Search the agent's vector memory</p>
            <p className="text-xxs text-text-muted mt-1 max-w-md">
              Queries the LanceDB-backed semantic recall store and returns the top matching memory chunks, each with its source file and a match score. Matches are ranked lexically against the indexed recall chunks.
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Search size={20} className="text-text-muted mb-2" />
            <p className="text-sm text-text-muted">No memory chunks matched “{query.trim()}”</p>
            <p className="text-xxs text-text-muted mt-1">Try broader terms — the recall store only holds what the agent has consolidated.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xxs text-text-muted">{results.length} chunk{results.length === 1 ? '' : 's'} retrieved</p>
              {ranAt && <p className="text-xxs text-text-muted opacity-60">{ranAt}</p>}
            </div>
            {results.map((hit, i) => (
              <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface/40">
                  <FileText size={11} className="text-text-muted shrink-0" />
                  <span className="text-xxs font-mono text-text-secondary truncate">
                    {hit.source}{hit.startLine != null ? `:${hit.startLine}` : ''}
                  </span>
                  {hit.recallCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-cyan-950/40 border border-cyan-900/40 text-cyan-300 text-xxs shrink-0">recalled ×{hit.recallCount}</span>
                  )}
                  <div className="ml-auto flex items-center gap-1.5 shrink-0">
                    <div className="w-16 h-1.5 rounded-full bg-base overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(hit.score * 100, 3)}%`, backgroundColor: scoreColor(hit.score) }} />
                    </div>
                    <span className="text-xxs font-semibold tabular-nums" style={{ color: scoreColor(hit.score) }}>{hit.score.toFixed(2)}</span>
                  </div>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{hit.snippet || '(empty chunk)'}</p>
                  {hit.conceptTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {hit.conceptTags.map(t => (
                        <span key={t} className="px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Small shared bits ───────────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center h-full text-sm text-text-muted">{children}</div>
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-border bg-card text-text-secondary max-w-3xl">
      <AlertCircle size={13} className="shrink-0 mt-0.5 text-text-muted" />
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  )
}
function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return <span className="flex items-center gap-1.5"><span className="text-text-muted">{k}</span><span className="text-text-primary font-medium">{v}</span></span>
}
// A "last happened" row: green if fresh (<3d), amber if stale, red if very old.
function FreshRow({ label, ts }: { label: string; ts: string | null }) {
  const days = ts ? (Date.now() - new Date(ts).getTime()) / 86_400_000 : Infinity
  const tone = days > 14 ? 'text-red-400' : days > 3 ? 'text-amber-400' : 'text-green-400'
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className={clsx('tabular-nums', tone)}>{ts ? timeAgo(ts) : 'never'}</span>
    </div>
  )
}
// "off" (plugin disabled/unavailable) is distinct from "error" (broken) — the
// memory subsystem can simply be turned off, which shouldn't read as red.
function embLabel(emb: any, vector?: { status: string } | null, reachable?: boolean): string {
  if (emb?.ok === true) return 'ok'
  if (emb?.ok === false) return /unavail|disabl|not enabled|\boff\b|missing/i.test(String(emb.error ?? '')) ? 'off' : 'error'
  return vector?.status ?? (reachable ? 'ok' : '—')
}

// ══════════════════════════════════════════════════════════════════════════════
// Hub
// ══════════════════════════════════════════════════════════════════════════════

const SOURCES: { id: MemorySource; label: string }[] = [
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'hermes',   label: 'Hermes' },
]

export function Memory() {
  const [source, setSource] = useState<MemorySource>('openclaw')
  const [overview, setOverview] = useState<MemoryOpsOverview | null>(null)
  const [summary, setSummary] = useState<MemoryDiskSummary | null>(null)

  const load = useCallback((src: MemorySource) => {
    memoryOps.overview(src).then(setOverview).catch(() => setOverview(null))
    memoryOps.disk.summary().then(setSummary).catch(() => setSummary(null))
  }, [])
  useEffect(() => {
    load(source)
    const t = setInterval(() => load(source), 30_000)
    return () => clearInterval(t)
  }, [source, load])

  const s = summary

  const tabs: HubTab[] = [
    { id: 'activity', label: 'Activity', icon: <ActivityIcon size={13} />, render: () => <ActivityTab source={source} seed={overview?.recentEvents ?? []} /> },
    { id: 'daily',    label: 'Daily',    icon: <CalendarDays size={13} />, render: () => <DailyTab source={source} /> },
    { id: 'health',   label: 'Health',   icon: <HeartPulse size={13} />,   render: () => <HealthTab source={source} /> },
    { id: 'metrics',  label: 'Metrics',  icon: <BarChart3 size={13} />,    render: () => <MetricsTab /> },
    { id: 'recall',   label: 'Recall',   icon: <Database size={13} />,    render: () => <VectorTab /> },
    { id: 'playground', label: 'Playground', icon: <Search size={13} />,   render: () => <PlaygroundTab /> },
    { id: 'dreaming', label: 'Dreaming', icon: <Sparkles size={13} />,     render: () => <ConsolidationTab /> },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header: source toggle + KPI chips */}
      <div className="flex items-center gap-3 px-6 pt-4 pb-3 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Brain size={15} className="text-accent-amber" />
          <h1 className="text-sm font-semibold text-text-primary">Memory</h1>
        </div>
        <div className="flex items-center gap-0.5 rounded-lg bg-card border border-border p-0.5">
          {SOURCES.map(s => (
            <button key={s.id} onClick={() => setSource(s.id)}
              className={clsx('px-2.5 py-1 rounded text-xxs font-medium transition-colors', source === s.id ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          <Chip icon={<CalendarDays size={11} />} label="days" value={s ? fmtNum(s.dailyLogs) : '—'} />
          <Chip icon={<Layers size={11} />} label="chunks" value={s ? fmtNum(s.recallChunks) : '—'} />
          <Chip icon={<Search size={11} />} label="recalls" value={s ? fmtNum(s.recallEvents) : '—'} />
          <Chip icon={<Sparkles size={11} />} label="dreams" value={s ? fmtNum(s.dreams) : '—'} />
          <Chip icon={<Save size={11} />} label="promoted" value={s ? String(s.promotions) : '—'} />
          <Chip icon={<Database size={11} />} label="store" value={s ? fmtBytes(s.bytes) : '—'} />
        </div>
      </div>
      {summary?.plugin === 'off' && (
        <div className="flex items-center gap-3 px-6 py-2.5 bg-amber-950/30 border-b border-amber-800/40 shrink-0">
          <AlertCircle size={13} className="text-amber-400 shrink-0" />
          <p className="text-xs text-amber-300/90 flex-1">
            <span className="font-semibold">Memory plugin is disabled</span> — live capture and embeddings are off.
            Enable the memory plugin in your OpenClaw settings to start recording events.
          </p>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <TabHub view="memory" tabs={tabs} />
      </div>
    </div>
  )
}

function Chip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border">
      <span className="text-text-muted">{icon}</span>
      <span className="text-xxs text-text-muted uppercase tracking-wide">{label}</span>
      <span className={clsx('text-xs font-semibold tabular-nums', tone === 'good' ? 'text-green-400' : tone === 'bad' ? 'text-red-400' : 'text-text-primary')}>{value}</span>
    </div>
  )
}
