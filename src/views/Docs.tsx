import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Search, FileText, Clock, Hash, RefreshCw, AlertCircle, ChevronRight } from 'lucide-react'
import { docs as docsApi, type LiveDocFile } from '../lib/api'
import {
  clearStoredValue, DOCS_FILE_EVENT, DOCS_FILE_STORAGE_KEY, readStoredValue,
} from '../lib/quickActions'

// ─── Tag config ────────────────────────────────────────────────────────────────

type DocTag = 'Journal' | 'Newsletter' | 'Doc' | 'Notes' | 'Other'

const TAG_COLORS: Record<DocTag, string> = {
  Journal:    'bg-blue-950/50 border-blue-900/50 text-blue-400',
  Newsletter: 'bg-violet-950/50 border-violet-900/50 text-violet-400',
  Doc:        'bg-green-950/50 border-green-900/50 text-green-400',
  Notes:      'bg-amber-950/50 border-amber-900/50 text-amber-400',
  Other:      'bg-card border-border text-text-muted',
}
const ALL_TAGS: DocTag[] = ['Journal', 'Newsletter', 'Doc', 'Notes', 'Other']

// ─── Markdown renderer ────────────────────────────────────────────────────────

function inlineFmt(text: string): React.ReactNode {
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

function renderMarkdown(content: string) {
  return content.split('\n').map((line, i) => {
    if (line === '') return <div key={i} className="h-3" />
    if (line === '---') return <hr key={i} className="border-border my-4" />
    if (line.startsWith('# '))   return <h1 key={i} className="text-base font-semibold text-text-primary mb-1 mt-4 first:mt-0">{line.slice(2)}</h1>
    if (line.startsWith('## '))  return <h2 key={i} className="text-sm font-semibold text-text-primary mt-4 mb-1">{line.slice(3)}</h2>
    if (line.startsWith('### ')) return <h3 key={i} className="text-xs font-semibold text-text-secondary mt-3 mb-1 uppercase tracking-wide">{line.slice(4)}</h3>
    if (line.startsWith('> '))   return <blockquote key={i} className="border-l-2 border-border pl-3 my-1 text-xs text-text-muted italic">{inlineFmt(line.slice(2))}</blockquote>
    if (line.startsWith('- ') || line.startsWith('* '))
      return (
        <div key={i} className="flex gap-2 mb-1">
          <span className="text-text-muted mt-[3px] shrink-0 text-xs">·</span>
          <span className="text-xs text-text-secondary leading-relaxed">{inlineFmt(line.slice(2))}</span>
        </div>
      )
    if (/^\d+\.\s/.test(line)) {
      const dot = line.indexOf('. ')
      return (
        <div key={i} className="flex gap-2 mb-1">
          <span className="text-xs text-text-muted font-mono tabular-nums shrink-0">{line.slice(0, dot)}.</span>
          <span className="text-xs text-text-secondary leading-relaxed">{inlineFmt(line.slice(dot + 2))}</span>
        </div>
      )
    }
    return <p key={i} className="text-xs text-text-secondary leading-relaxed mb-1">{inlineFmt(line)}</p>
  })
}

// ─── Left panel item ──────────────────────────────────────────────────────────

function DocItem({ file, isActive, onClick }: {
  file: LiveDocFile; isActive: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3 py-2.5 rounded transition-all border',
        isActive
          ? 'bg-card-hover border-border text-text-primary'
          : 'border-transparent hover:bg-card text-text-secondary',
      )}
    >
      <div className="flex items-start gap-2">
        <FileText size={13} className={clsx('mt-0.5 shrink-0', isActive ? 'text-accent-blue' : 'text-text-muted')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <p className={clsx('text-xs font-medium truncate leading-tight', isActive ? 'text-text-primary' : 'text-text-secondary')}>
              {file.filename}
            </p>
            {isActive && <ChevronRight size={11} className="text-text-muted shrink-0" />}
          </div>
          {file.preview && (
            <p className="text-xxs text-text-muted leading-relaxed line-clamp-2 mb-1">{file.preview}</p>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {file.tags.map(tag => (
              <span key={tag} className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium', TAG_COLORS[tag as DocTag] ?? TAG_COLORS.Other)}>
                {tag}
              </span>
            ))}
            <span className="text-xxs text-text-muted flex items-center gap-0.5 ml-auto">
              <Clock size={8} />{file.updatedAgo}
            </span>
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function Docs() {
  const [files,    setFiles]    = useState<LiveDocFile[]>([])
  const [selected, setSelected] = useState<LiveDocFile | null>(null)
  const [content,  setContent]  = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [search,   setSearch]   = useState('')
  const [activeTag, setActiveTag] = useState<DocTag | null>(null)
  const [requestedFileId, setRequestedFileId] = useState<string | null>(() => readStoredValue(DOCS_FILE_STORAGE_KEY))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await docsApi.files()
      setFiles(data.files)
      if (data.files.length > 0 && !selected) setSelected(data.files[0])
      if (data.error) setError(data.error)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openDoc = useCallback(async (file: LiveDocFile) => {
    setSelected(file)
    setContent(null)
    setLoadingDoc(true)
    try {
      const data = await docsApi.file(file.id)
      setContent(data.file.content ?? null)
    } catch (err: any) {
      setContent(`Error loading file: ${err.message}`)
    } finally {
      setLoadingDoc(false)
    }
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ fileId?: string }>
      if (custom.detail?.fileId) setRequestedFileId(custom.detail.fileId)
    }
    window.addEventListener(DOCS_FILE_EVENT, handler as EventListener)
    return () => window.removeEventListener(DOCS_FILE_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    if (!requestedFileId) return
    const file = files.find(entry => entry.id === requestedFileId)
    if (!file) {
      if (!loading) {
        clearStoredValue(DOCS_FILE_STORAGE_KEY)
        setRequestedFileId(null)
      }
      return
    }

    clearStoredValue(DOCS_FILE_STORAGE_KEY)
    setRequestedFileId(null)
    setSearch('')
    setActiveTag(null)
    void openDoc(file)
  }, [files, loading, openDoc, requestedFileId])

  // Auto-load first doc
  useEffect(() => {
    if (selected && content === null && !loadingDoc) {
      openDoc(selected)
    }
  }, [selected])

  const filtered = files.filter(f => {
    const q = search.toLowerCase()
    const matchSearch = !q || f.filename.toLowerCase().includes(q) || f.preview.toLowerCase().includes(q)
    const matchTag = !activeTag || f.tags.includes(activeTag)
    return matchSearch && matchTag
  })

  const tagCounts = ALL_TAGS.reduce<Record<DocTag, number>>((acc, tag) => {
    acc[tag] = files.filter(f => f.tags.includes(tag)).length
    return acc
  }, {} as Record<DocTag, number>)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel ── */}
      <div className="flex flex-col w-[260px] min-w-[260px] border-r border-border bg-surface overflow-hidden">
        {/* Header */}
        <div className="px-3 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-1.5 mb-1">
            <FileText size={13} className="text-accent-blue" />
            <span className="text-xs font-semibold text-text-primary">Docs</span>
            <button onClick={load} disabled={loading}
              className="ml-auto p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary transition-colors">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-xxs text-text-muted">
            {loading
              ? <span className="animate-pulse">Scanning files…</span>
              : <>{files.length} documents</>
            }
          </p>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-card border border-border">
            <Search size={11} className="text-text-muted shrink-0" />
            <input
              type="text"
              placeholder="Search documents…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none"
            />
          </div>
        </div>

        {/* Tag filters */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 flex-wrap">
          <button
            onClick={() => setActiveTag(null)}
            className={clsx('flex items-center gap-1 px-2 py-0.5 rounded text-xxs font-medium transition-all',
              !activeTag ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            <Hash size={9} />All
          </button>
          {ALL_TAGS.filter(t => tagCounts[t] > 0).map(tag => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={clsx('px-2 py-0.5 rounded border text-xxs font-medium transition-all',
                activeTag === tag ? TAG_COLORS[tag] : 'border-transparent text-text-muted hover:text-text-secondary')}>
              {tag}<span className="ml-1 opacity-50">{tagCounts[tag]}</span>
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

        {/* File list */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          {loading
            ? <p className="text-xxs text-text-muted text-center py-6 animate-pulse">Scanning files…</p>
            : filtered.length === 0
            ? <p className="text-xxs text-text-muted text-center py-6">No documents found</p>
            : <div className="flex flex-col gap-0.5">
                {filtered.map(f => (
                  <DocItem key={f.id} file={f} isActive={f.id === selected?.id} onClick={() => openDoc(f)} />
                ))}
              </div>
          }
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full">
            <FileText size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">Select a document</span>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <FileText size={15} className="text-text-muted shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-sm font-semibold text-text-primary font-mono truncate mb-1">
                    {selected.filename}
                  </h1>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selected.tags.map(tag => (
                      <span key={tag} className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium', TAG_COLORS[tag as DocTag] ?? TAG_COLORS.Other)}>
                        {tag}
                      </span>
                    ))}
                    <span className="text-xxs text-text-muted">{selected.wordCount.toLocaleString()} words</span>
                    <span className="text-xxs text-text-muted opacity-60">{selected.path}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loadingDoc
                ? <p className="text-xs text-text-muted animate-pulse">Loading…</p>
                : content !== null
                ? <div className="max-w-2xl">{renderMarkdown(content)}</div>
                : null
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}
