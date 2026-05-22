import { useState, useEffect, useRef } from 'react'
import { Search, Bell, Loader2, X, FileText } from 'lucide-react'

interface TopBarProps {
  title: string
}

// ─── Global search overlay ────────────────────────────────────────────────────

interface SearchResult {
  id:         string
  title:      string
  updatedAgo: string
  tags:       string[]
}

function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [q, setQ]               = useState('')
  const [results, setResults]   = useState<SearchResult[]>([])
  const [loading, setLoading]   = useState(false)
  const inputRef                = useRef<HTMLInputElement>(null)
  const debounce                = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!q.trim()) { setResults([]); return }

    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res  = await fetch(`/api/notes/pages?search=${encodeURIComponent(q.trim())}`)
        const data = await res.json()
        setResults(data.pages ?? [])
      } catch { setResults([]) }
      finally  { setLoading(false) }
    }, 280)

    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={14} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search notes…"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
          />
          {loading
            ? <Loader2 size={13} className="animate-spin text-text-muted shrink-0" />
            : q
              ? <button onClick={() => setQ('')}><X size={13} className="text-text-muted hover:text-text-secondary" /></button>
              : <kbd className="text-xxs text-text-muted bg-base px-1.5 py-0.5 rounded border border-border shrink-0">ESC</kbd>
          }
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto">
          {!q.trim() ? (
            <p className="text-xs text-text-muted text-center py-8">Start typing to search notes…</p>
          ) : loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={16} className="animate-spin text-text-muted" />
            </div>
          ) : results.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-8">No results for "{q}"</p>
          ) : (
            results.map(r => (
              <button
                key={r.id}
                onClick={onClose}
                className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-card-hover transition-colors border-b border-border/50 last:border-0"
              >
                <FileText size={13} className="text-text-muted mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{r.title || 'Untitled'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xxs text-text-muted">{r.updatedAgo}</span>
                    {r.tags.slice(0, 3).map(t => (
                      <span key={t} className="text-xxs text-text-muted bg-base border border-border-subtle px-1 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

export function TopBar({ title }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handlePing = () => {
    if (!('Notification' in window)) return

    const send = () => {
      new Notification('Mission Control', {
        body: '👋 You pinged yourself!',
        icon: '/favicon.ico',
      })
    }

    if (Notification.permission === 'granted') {
      send()
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') send()
      })
    }
  }

  return (
    <>
      <header className="flex items-center justify-between h-12 px-5 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{title}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs"
          >
            <Search size={12} />
            <span>Search</span>
            <span className="flex items-center justify-center px-1 rounded bg-border text-text-muted font-mono text-xxs">
              ⌘K
            </span>
          </button>

          {/* Pause */}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs"
          >
            <span>Pause</span>
          </button>

          {/* Ping */}
          <button
            onClick={handlePing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs"
          >
            <Bell size={12} />
            <span>Ping Ant</span>
          </button>

          {/* Avatar */}
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shrink-0 cursor-pointer" />
        </div>
      </header>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </>
  )
}
