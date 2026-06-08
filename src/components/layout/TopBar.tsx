// title: Top bar + global command palette
// path: src/components/layout/TopBar.tsx
// purpose: Header with a real ⌘K command palette — jump to any page and search
//          notes / docs / tasks, with keyboard navigation. (Previously a notes-
//          only search whose results didn't navigate anywhere.)

import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, Bell, Loader2, X, FileText, BookOpen, CheckSquare, CornerDownLeft, ArrowRight, Pause, Play } from 'lucide-react'
import type { View } from '../../types'
import { usePaused, toggleRefreshPaused } from '../../lib/refreshBus'

interface NavView { id: View; label: string }
interface TopBarProps {
  title: string
  onNavigate: (view: View) => void
  views: NavView[]
}

// A flat, selectable palette row.
type Row =
  | { kind: 'view'; id: string; label: string; view: View }
  | { kind: 'note'; id: string; label: string; sub: string; view: View }
  | { kind: 'doc';  id: string; label: string; sub: string; view: View }
  | { kind: 'task'; id: string; label: string; sub: string; view: View }

const KIND_ICON = {
  view: ArrowRight, note: FileText, doc: BookOpen, task: CheckSquare,
} as const

function GlobalSearch({ onClose, onNavigate, views }: { onClose: () => void; onNavigate: (v: View) => void; views: NavView[] }) {
  const [q, setQ]             = useState('')
  const [notes, setNotes]     = useState<Row[]>([])
  const [docs, setDocs]       = useState<Row[]>([])
  const [tasks, setTasks]     = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel]         = useState(0)
  const inputRef              = useRef<HTMLInputElement>(null)
  const debounce              = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Notes (server search) + docs/tasks (fetch once, filter client-side).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!q.trim()) { setNotes([]); setDocs([]); setTasks([]); return }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      const term = q.trim().toLowerCase()
      try {
        const [n, d, t] = await Promise.allSettled([
          fetch(`/api/notes/pages?search=${encodeURIComponent(q.trim())}`).then(r => r.json()),
          fetch('/api/docs/files').then(r => r.json()),
          fetch('/api/tasks').then(r => r.json()),
        ])
        setNotes(n.status === 'fulfilled' ? (n.value.pages ?? []).slice(0, 5).map((p: any): Row => ({ kind: 'note', id: p.id, label: p.title || 'Untitled', sub: p.updatedAgo ?? 'note', view: 'docs' })) : [])
        setDocs(d.status === 'fulfilled' ? (d.value.files ?? []).filter((f: any) => (f.filename ?? '').toLowerCase().includes(term) || (f.preview ?? '').toLowerCase().includes(term)).slice(0, 5).map((f: any): Row => ({ kind: 'doc', id: f.id, label: f.filename || 'Doc', sub: f.updatedAgo ?? 'doc', view: 'docs' })) : [])
        setTasks(t.status === 'fulfilled' ? (t.value.tasks ?? []).filter((x: any) => (x.title ?? '').toLowerCase().includes(term)).slice(0, 5).map((x: any): Row => ({ kind: 'task', id: x.id, label: x.title, sub: x.status ?? 'task', view: 'tasks' })) : [])
      } catch { setNotes([]); setDocs([]); setTasks([]) }
      finally { setLoading(false) }
    }, 240)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [q])

  // "Go to" view matches.
  const viewRows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase()
    const matched = term ? views.filter(v => v.label.toLowerCase().includes(term)) : views
    return matched.map(v => ({ kind: 'view', id: v.id, label: v.label, view: v.id }))
  }, [q, views])

  // Flat ordered list for keyboard nav.
  const rows: Row[] = useMemo(() => [...viewRows, ...notes, ...docs, ...tasks], [viewRows, notes, docs, tasks])
  useEffect(() => { setSel(0) }, [q])

  const activate = (row?: Row) => {
    const r = row ?? rows[sel]
    if (!r) return
    onNavigate(r.view)
    onClose()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, rows.length - 1)) }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
      else if (e.key === 'Enter')     { e.preventDefault(); activate() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, rows, sel])

  const section = (label: string, items: Row[], startIdx: number) => items.length > 0 && (
    <div>
      <p className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-text-muted font-semibold">{label}</p>
      {items.map((r, i) => {
        const idx = startIdx + i
        const Icon = KIND_ICON[r.kind]
        return (
          <button key={`${r.kind}-${r.id}`} onClick={() => activate(r)} onMouseEnter={() => setSel(idx)}
            className={clsxRow(idx === sel)}>
            <Icon size={13} className={idx === sel ? 'text-accent-blue shrink-0' : 'text-text-muted shrink-0'} />
            <span className="text-sm text-text-primary truncate flex-1">{r.label}</span>
            {'sub' in r && <span className="text-xxs text-text-muted shrink-0">{r.sub}</span>}
            {idx === sel && <CornerDownLeft size={11} className="text-text-muted shrink-0" />}
          </button>
        )
      })}
    </div>
  )

  // index offsets for each section
  const oViews = 0, oNotes = viewRows.length, oDocs = oNotes + notes.length, oTasks = oDocs + docs.length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={14} className="text-text-muted shrink-0" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Jump to a page, or search notes, docs, tasks…"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted" />
          {loading
            ? <Loader2 size={13} className="animate-spin text-text-muted shrink-0" />
            : q ? <button onClick={() => setQ('')}><X size={13} className="text-text-muted hover:text-text-secondary" /></button>
                : <kbd className="text-xxs text-text-muted bg-base px-1.5 py-0.5 rounded border border-border shrink-0">ESC</kbd>}
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {rows.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-8">{q.trim() ? `No results for "${q}"` : 'Type to search…'}</p>
          ) : (
            <>
              {section(q.trim() ? 'Go to' : 'Pages', viewRows, oViews)}
              {section('Notes', notes, oNotes)}
              {section('Docs',  docs,  oDocs)}
              {section('Tasks', tasks, oTasks)}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-xxs text-text-muted">
          <span className="flex items-center gap-1"><kbd className="bg-base px-1 rounded border border-border">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-base px-1 rounded border border-border">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="bg-base px-1 rounded border border-border">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}

function clsxBtn(active: boolean): string {
  return [
    'flex items-center gap-1.5 px-3 py-1.5 rounded border transition-colors text-xs',
    active
      ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
      : 'border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary',
  ].join(' ')
}

function clsxRow(active: boolean): string {
  return [
    'w-full text-left flex items-center gap-3 px-4 py-2 transition-colors',
    active ? 'bg-card-hover' : 'hover:bg-card-hover/60',
  ].join(' ')
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

export function TopBar({ title, onNavigate, views }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const paused = usePaused()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handlePing = () => {
    if (!('Notification' in window)) return
    const send = () => new Notification('Mission Control', { body: '👋 You pinged yourself!', icon: '/favicon.ico' })
    if (Notification.permission === 'granted') send()
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') send() })
  }

  return (
    <>
      <header className="flex items-center justify-between h-12 px-5 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{title}</span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
            <Search size={12} />
            <span>Search</span>
            <span className="flex items-center justify-center px-1 rounded bg-border text-text-muted font-mono text-xxs">⌘K</span>
          </button>

          <button
            onClick={toggleRefreshPaused}
            title={paused ? 'Auto-refresh paused — resume background polling' : 'Pause all background auto-refresh'}
            className={clsxBtn(paused)}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            <span>{paused ? 'Paused' : 'Pause'}</span>
          </button>

          <button onClick={handlePing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
            <Bell size={12} />
            <span>Ping Ant</span>
          </button>

          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shrink-0 cursor-pointer" />
        </div>
      </header>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} onNavigate={onNavigate} views={views} />}
    </>
  )
}
