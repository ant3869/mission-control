import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Search, Flame, Brain, RefreshCw, AlertCircle, User, MessageSquare, FolderOpen, Link, ChevronRight } from 'lucide-react'
import { memory, type LiveMemoryEntry, type MemoryEntryType } from '../lib/api'

// ─── Type config ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<MemoryEntryType, { label: string; icon: React.ReactNode; color: string; dot: string }> = {
  user:      { label: 'User',      icon: <User         size={11} />, color: 'text-violet-400 bg-violet-950/40 border-violet-900/40', dot: 'bg-violet-400' },
  feedback:  { label: 'Feedback',  icon: <MessageSquare size={11} />, color: 'text-blue-400 bg-blue-950/40 border-blue-900/40',       dot: 'bg-blue-400'   },
  project:   { label: 'Project',   icon: <FolderOpen   size={11} />, color: 'text-teal-400 bg-teal-950/40 border-teal-900/40',       dot: 'bg-teal-400'   },
  reference: { label: 'Reference', icon: <Link         size={11} />, color: 'text-amber-400 bg-amber-950/40 border-amber-900/40',    dot: 'bg-amber-400'  },
  other:     { label: 'Other',     icon: <Brain        size={11} />, color: 'text-text-muted bg-base border-border',                 dot: 'bg-slate-500'  },
}

const ALL_TYPES: MemoryEntryType[] = ['user', 'feedback', 'project', 'reference', 'other']

// Where the memory came from — keeps local files distinct from agent-platform entries.
const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  local:    { label: 'Local',    cls: 'text-text-muted bg-base border-border' },
  openclaw: { label: 'OpenClaw', cls: 'text-amber-300 bg-amber-950/40 border-amber-900/40' },
  hermes:   { label: 'Hermes',   cls: 'text-purple-300 bg-purple-950/40 border-purple-900/40' },
}

function sourceKeyOf(entry: LiveMemoryEntry): 'local' | 'openclaw' | 'hermes' {
  return (entry.source as 'openclaw' | 'hermes' | undefined) ?? 'local'
}

function SourceBadge({ entry }: { entry: LiveMemoryEntry }) {
  const cfg = SOURCE_BADGE[sourceKeyOf(entry)]
  return (
    <span className={clsx('px-1 py-0.5 rounded border text-xxs font-medium', cfg.cls)}>{cfg.label}</span>
  )
}

// ─── Markdown-lite renderer ───────────────────────────────────────────────────

function renderContent(content: string) {
  const lines = content.split('\n')
  return lines.map((line, i) => {
    if (line === '') return <div key={i} className="h-2" />
    if (line.startsWith('# '))  return <p key={i} className="text-sm font-bold text-text-primary mt-4 mb-2">{line.slice(2)}</p>
    if (line.startsWith('## ')) return <p key={i} className="text-xs font-bold text-text-primary mt-3 mb-1.5">{line.slice(3)}</p>
    if (line.startsWith('### ')) return <p key={i} className="text-xs font-semibold text-text-secondary mt-2 mb-1">{line.slice(4)}</p>
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return (
        <div key={i} className="flex gap-2 mb-0.5">
          <span className="text-text-muted mt-[3px] shrink-0">·</span>
          <span className="text-xs text-text-secondary leading-relaxed">{inlineFmt(line.slice(2))}</span>
        </div>
      )
    }
    if (/^\d+\.\s/.test(line)) {
      const [num, ...rest] = line.split('. ')
      return (
        <div key={i} className="flex gap-2 mb-0.5">
          <span className="text-text-muted text-xs shrink-0 tabular-nums font-mono">{num}.</span>
          <span className="text-xs text-text-secondary leading-relaxed">{inlineFmt(rest.join('. '))}</span>
        </div>
      )
    }
    return <p key={i} className="text-xs text-text-secondary leading-relaxed mb-1">{inlineFmt(line)}</p>
  })
}

function inlineFmt(text: string): React.ReactNode {
  // Bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} className="font-semibold text-text-primary">{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="font-mono text-xxs bg-base border border-border-subtle px-1 py-0.5 rounded text-accent-blue">{part.slice(1, -1)}</code>
        return part
      })}
    </>
  )
}

// ─── Left panel item ──────────────────────────────────────────────────────────

function EntryItem({ entry, isActive, onClick }: {
  entry: LiveMemoryEntry; isActive: boolean; onClick: () => void
}) {
  const tc = TYPE_CONFIG[entry.type]
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3 py-2.5 rounded transition-all',
        isActive ? 'bg-card-hover text-text-primary' : 'hover:bg-card text-text-secondary',
      )}
    >
      <div className="flex items-start justify-between gap-1 mb-0.5">
        <span className={clsx('text-xs font-semibold leading-snug', isActive ? 'text-text-primary' : 'text-text-secondary')}>
          {entry.name}
        </span>
        {isActive && <ChevronRight size={11} className="text-text-muted shrink-0 mt-0.5" />}
      </div>
      {entry.description && (
        <p className="text-xxs text-text-muted leading-relaxed line-clamp-2 mb-1">{entry.description}</p>
      )}
      <div className="flex items-center gap-1.5">
        <span className={clsx('flex items-center gap-0.5 px-1 py-0.5 rounded border text-xxs font-medium', tc.color)}>
          {tc.icon}{tc.label}
        </span>
        <SourceBadge entry={entry} />
        <span className="text-xxs text-text-muted ml-auto">{entry.updatedAgo}</span>
      </div>
    </button>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function Memory() {
  const [entries,  setEntries]  = useState<LiveMemoryEntry[]>([])
  const [selected, setSelected] = useState<LiveMemoryEntry | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [search,   setSearch]   = useState('')
  const [typeFilter, setTypeFilter] = useState<MemoryEntryType | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await memory.entries()
      setEntries(data.entries)
      if (data.entries.length > 0 && !selected) setSelected(data.entries[0])
      if (data.error) setError(data.error)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = entries.filter(e => {
    const matchType = typeFilter === 'all' || e.type === typeFilter
    const q = search.toLowerCase()
    const matchSearch = !q || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
    return matchType && matchSearch
  })

  const counts = Object.fromEntries(
    ALL_TYPES.map(t => [t, entries.filter(e => e.type === t).length])
  ) as Record<MemoryEntryType, number>

  const totalWords = entries.reduce((s, e) => s + e.wordCount, 0)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel ── */}
      <div className="flex flex-col w-[260px] min-w-[260px] border-r border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="px-3 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Flame size={13} className="text-accent-amber" />
            <span className="text-xs font-semibold text-text-primary">Memory</span>
            <button onClick={load} disabled={loading}
              className="ml-auto p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary transition-colors">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-xxs text-text-muted">
            {loading ? <span className="animate-pulse">Loading…</span>
              : <>{entries.length} memories &middot; {totalWords.toLocaleString()} words</>
            }
          </p>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-card border border-border">
            <Search size={11} className="text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Search memories…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none"
            />
          </div>
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 flex-wrap">
          <button
            onClick={() => setTypeFilter('all')}
            className={clsx('px-2 py-0.5 rounded text-xxs font-medium transition-all',
              typeFilter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            All
          </button>
          {ALL_TYPES.filter(t => counts[t] > 0).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t === typeFilter ? 'all' : t)}
              className={clsx('px-2 py-0.5 rounded text-xxs font-medium transition-all capitalize',
                typeFilter === t ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {TYPE_CONFIG[t].label}
              <span className="ml-1 opacity-50">{counts[t]}</span>
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 mx-3 mt-2 px-3 py-2 rounded border border-amber-900/40 bg-amber-950/20 text-amber-300">
            <AlertCircle size={11} className="shrink-0 mt-0.5" />
            <p className="text-xxs leading-snug">{error}</p>
          </div>
        )}

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {loading
            ? <p className="text-xxs text-text-muted text-center py-6 animate-pulse">Reading memory files…</p>
            : filtered.length === 0
            ? <p className="text-xxs text-text-muted text-center py-6">No memories found</p>
            : <div className="flex flex-col gap-0.5">
                {filtered.map(e => (
                  <EntryItem key={e.id} entry={e} isActive={e.id === selected?.id} onClick={() => setSelected(e)} />
                ))}
              </div>
          }
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Brain size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">Select a memory</span>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h1 className="text-base font-semibold text-text-primary">{selected.name}</h1>
                  <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-medium', TYPE_CONFIG[selected.type].color)}>
                    {TYPE_CONFIG[selected.type].icon}
                    {TYPE_CONFIG[selected.type].label}
                  </span>
                  <SourceBadge entry={selected} />
                </div>
                {selected.description && (
                  <p className="text-xs text-text-muted">{selected.description}</p>
                )}
                <p className="text-xxs text-text-muted mt-1 opacity-60">
                  {selected.wordCount} words &middot; {selected.filename} &middot; updated {selected.updatedAgo}
                </p>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="max-w-2xl">
                {renderContent(selected.content)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
