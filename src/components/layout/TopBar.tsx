// title: Top bar + global command palette
// path: src/components/layout/TopBar.tsx
// purpose: Header with a real ⌘K command palette — jump to any page and search
//          notes / docs / tasks, with keyboard navigation. (Previously a notes-
//          only search whose results didn't navigate anywhere.)

import { useState, useEffect, useRef, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Search, Loader2, X, FileText, BookOpen, CheckSquare, CornerDownLeft,
  ArrowRight, Pause, Play, Inbox as InboxIcon, Link2, ListTodo, NotebookPen,
  ShieldCheck, Plus, Check, FolderOpen, ShoppingCart, Package,
} from 'lucide-react'
import type { View } from '../../types'
import { approvals, inbox, links, tasks as tasksApi, todosApi, system, type ConnectivityIndicator } from '../../lib/api'
import {
  createQuickNotePage, focusApprovalRequest, focusTaskCard, looksLikeUrl,
  openDocFile, openDocsTab, openInboxItem, openNotePage, openTasksTab,
} from '../../lib/quickActions'
import { usePaused, toggleRefreshPaused, isRefreshPaused } from '../../lib/refreshBus'
import { apiFetch } from '../../lib/apiTransport.js'

interface NavView { id: View; label: string }
interface TopBarProps {
  title: string
  onNavigate: (view: View) => void
  views: NavView[]
}

type Row = {
  kind: 'action' | 'view' | 'note' | 'doc' | 'task' | 'approval' | 'inbox' | 'todo' | 'project' | 'link' | 'tobuy' | 'inventory'
  id: string
  label: string
  sub?: string
  icon: React.ReactNode
  onSelect: () => Promise<void> | void
}

function GlobalSearch({ onClose, onNavigate, views }: { onClose: () => void; onNavigate: (v: View) => void; views: NavView[] }) {
  const [q, setQ]             = useState('')
  const [notes, setNotes]     = useState<Row[]>([])
  const [docs, setDocs]       = useState<Row[]>([])
  const [taskRows, setTaskRows] = useState<Row[]>([])
  const [approvalRows, setApprovalRows] = useState<Row[]>([])
  const [inboxRows, setInboxRows] = useState<Row[]>([])
  const [todoRows, setTodoRows] = useState<Row[]>([])
  const [projectRows, setProjectRows] = useState<Row[]>([])
  const [linkRows, setLinkRows] = useState<Row[]>([])
  const [tobuyRows, setTobuyRows] = useState<Row[]>([])
  const [inventoryRows, setInventoryRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [actioning, setActioning] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [sel, setSel]         = useState(0)
  const inputRef              = useRef<HTMLInputElement>(null)
  const debounce              = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qTrimmed              = q.trim()

  useEffect(() => { inputRef.current?.focus() }, [])

  // Notes (server search) + docs/tasks (fetch once, filter client-side).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (!qTrimmed) { setNotes([]); setDocs([]); setTaskRows([]); setApprovalRows([]); setInboxRows([]); setTodoRows([]); setProjectRows([]); setLinkRows([]); setTobuyRows([]); setInventoryRows([]); return }
    debounce.current = setTimeout(async () => {
      setLoading(true)
      const term = qTrimmed.toLowerCase()
      try {
        const [n, d, t, a, i, s] = await Promise.allSettled([
          apiFetch<{ pages?: any[] }>(`/api/notes/pages?search=${encodeURIComponent(qTrimmed)}`),
          apiFetch<{ files?: any[] }>('/api/docs/files'),
          apiFetch<{ tasks?: any[] }>('/api/tasks'),
          approvals.list(),
          inbox.list(),
          apiFetch<{ results?: Record<string, any[]> }>(`/api/search?q=${encodeURIComponent(qTrimmed)}`),
        ])
        setNotes(n.status === 'fulfilled'
          ? (n.value.pages ?? []).slice(0, 5).map((p: any): Row => ({
              kind: 'note',
              id: p.id,
              label: p.title || 'Untitled',
              sub: p.updatedAgo ?? 'note',
              icon: <FileText size={13} />,
              onSelect: () => { openNotePage(p.id); openDocsTab('notes'); onNavigate('docs') },
            }))
          : [])
        setDocs(d.status === 'fulfilled'
          ? (d.value.files ?? []).filter((f: any) => (f.filename ?? '').toLowerCase().includes(term) || (f.preview ?? '').toLowerCase().includes(term)).slice(0, 5).map((f: any): Row => ({
              kind: 'doc',
              id: f.id,
              label: f.filename || 'Doc',
              sub: f.updatedAgo ?? 'doc',
              icon: <BookOpen size={13} />,
              onSelect: () => { openDocFile(f.id); openDocsTab('docs'); onNavigate('docs') },
            }))
          : [])
        setTaskRows(t.status === 'fulfilled'
          ? (t.value.tasks ?? []).filter((x: any) => (x.title ?? '').toLowerCase().includes(term)).slice(0, 5).map((x: any): Row => ({
              kind: 'task',
              id: x.id,
              label: x.title,
              sub: x.status ?? 'task',
              icon: <CheckSquare size={13} />,
              onSelect: () => { focusTaskCard(x.id); openTasksTab('tasks') },
            }))
          : [])
        setApprovalRows(a.status === 'fulfilled'
          ? (a.value.approvals ?? [])
              .filter((entry: any) => (entry.title ?? '').toLowerCase().includes(term) || (entry.description ?? '').toLowerCase().includes(term))
              .slice(0, 5)
              .map((entry: any): Row => ({
                kind: 'approval',
                id: entry.id,
                label: entry.title,
                sub: entry.status === 'pending' ? `${entry.urgency} · pending` : `${entry.status} · ${entry.createdAgo ?? 'approval'}`,
                icon: <ShieldCheck size={13} />,
                onSelect: () => { focusApprovalRequest(entry.id); openTasksTab('approvals') },
              }))
          : [])
        setInboxRows(i.status === 'fulfilled'
          ? (i.value.items ?? [])
              .filter((entry: any) =>
                (entry.title ?? '').toLowerCase().includes(term)
                || (entry.summary ?? '').toLowerCase().includes(term)
                || (entry.content ?? '').toLowerCase().includes(term),
              )
              .slice(0, 5)
              .map((entry: any): Row => ({
                kind: 'inbox',
                id: entry.id,
                label: entry.title,
                sub: `${entry.kind} · ${entry.status} · ${entry.eventAgo}`,
                icon: <InboxIcon size={13} />,
                onSelect: () => { openInboxItem(entry.id); openTasksTab('inbox') },
              }))
          : [])
        const sr = s.status === 'fulfilled' ? s.value.results ?? {} : {}
        setTodoRows((sr.todos ?? []).map((x: any): Row => ({
          kind: 'todo', id: x.id, label: x.label, sub: x.sub ?? 'todo',
          icon: <ListTodo size={13} />,
          onSelect: () => { openTasksTab('tasks'); onNavigate('todos') },
        })))
        setProjectRows((sr.projects ?? []).map((x: any): Row => ({
          kind: 'project' as any, id: x.id, label: x.label, sub: x.sub ?? 'project',
          icon: <FolderOpen size={13} />,
          onSelect: () => onNavigate('projects'),
        })))
        setLinkRows((sr.links ?? []).map((x: any): Row => ({
          kind: 'link' as any, id: x.id, label: x.label, sub: x.sub ?? 'link',
          icon: <Link2 size={13} />,
          onSelect: () => onNavigate('links'),
        })))
        setTobuyRows((sr.tobuy ?? []).map((x: any): Row => ({
          kind: 'tobuy' as any, id: x.id, label: x.label, sub: x.sub ?? 'to-buy',
          icon: <ShoppingCart size={13} />,
          onSelect: () => onNavigate('tobuy'),
        })))
        setInventoryRows((sr.inventory ?? []).map((x: any): Row => ({
          kind: 'inventory' as any, id: x.id, label: x.label, sub: x.sub ?? 'inventory',
          icon: <Package size={13} />,
          onSelect: () => onNavigate('inventory'),
        })))
      } catch { setNotes([]); setDocs([]); setTaskRows([]); setApprovalRows([]); setInboxRows([]); setTodoRows([]); setProjectRows([]); setLinkRows([]); setTobuyRows([]); setInventoryRows([]) }
      finally { setLoading(false) }
    }, 240)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [onNavigate, qTrimmed])

  const actionRows: Row[] = useMemo(() => {
    const rows: Row[] = [
      {
        kind: 'action',
        id: 'open-inbox',
        label: 'Open Inbox',
        sub: 'Tasks & Approvals',
        icon: <InboxIcon size={13} />,
        onSelect: () => { openTasksTab('inbox') },
      },
      {
        kind: 'action',
        id: 'open-links',
        label: 'Open Links',
        sub: 'Saved bookmarks',
        icon: <Link2 size={13} />,
        onSelect: () => onNavigate('links'),
      },
    ]

    if (!qTrimmed) {
      rows.push({
        kind: 'action',
        id: 'new-note',
        label: 'New Note',
        sub: 'Quick capture into Notes',
        icon: <NotebookPen size={13} />,
        onSelect: async () => {
          const created = await createQuickNotePage({ title: 'Untitled', content: '' })
          openNotePage(created.page.id)
          openDocsTab('notes')
          onNavigate('docs')
        },
      })
      return rows
    }

    rows.push(
      {
        kind: 'action',
        id: 'new-todo',
        label: `Add To-Do: ${qTrimmed}`,
        sub: 'Personal quick capture',
        icon: <ListTodo size={13} />,
        onSelect: async () => {
          await todosApi.create({ title: qTrimmed, severity: 'medium', horizon: 'short' })
          onNavigate('todos')
        },
      },
      {
        kind: 'action',
        id: 'new-task',
        label: `Create Task: ${qTrimmed}`,
        sub: 'Add to shared work queue',
        icon: <CheckSquare size={13} />,
        onSelect: async () => {
          await tasksApi.create({ title: qTrimmed, status: 'queued', priority: 'medium' })
          openTasksTab('tasks')
        },
      },
      {
        kind: 'action',
        id: 'new-note-from-query',
        label: `Create Note: ${qTrimmed}`,
        sub: 'Capture current query as a note',
        icon: <NotebookPen size={13} />,
        onSelect: async () => {
          const created = await createQuickNotePage({ title: qTrimmed.slice(0, 80), content: qTrimmed })
          openNotePage(created.page.id)
          openDocsTab('notes')
          onNavigate('docs')
        },
      },
      {
        kind: 'action',
        id: 'new-approval',
        label: `Create Approval: ${qTrimmed}`,
        sub: 'Request a decision',
        icon: <ShieldCheck size={13} />,
        onSelect: async () => {
          await approvals.create({ title: qTrimmed, type: 'action', urgency: 'normal' })
          openTasksTab('approvals')
        },
      },
    )

    if (looksLikeUrl(qTrimmed)) {
      rows.unshift({
        kind: 'action',
        id: 'save-link',
        label: `Save Link: ${qTrimmed}`,
        sub: 'Add to your reading and reference queue',
        icon: <Link2 size={13} />,
        onSelect: async () => {
          await links.create({ url: qTrimmed, source: 'launcher' })
          openDocsTab('links')
          onNavigate('docs')
        },
      })
    }

    return rows
  }, [onNavigate, qTrimmed])

  // "Go to" view matches.
  const viewRows: Row[] = useMemo(() => {
    const term = qTrimmed.toLowerCase()
    const matched = term ? views.filter(v => v.label.toLowerCase().includes(term)) : views
    return matched.map(v => ({
      kind: 'view',
      id: v.id,
      label: v.label,
      icon: <ArrowRight size={13} />,
      onSelect: () => onNavigate(v.id),
    }))
  }, [onNavigate, qTrimmed, views])

  // Flat ordered list for keyboard nav.
  const rows: Row[] = useMemo(() => [...actionRows, ...viewRows, ...notes, ...docs, ...taskRows, ...todoRows, ...approvalRows, ...inboxRows, ...projectRows, ...linkRows, ...tobuyRows, ...inventoryRows], [actionRows, viewRows, notes, docs, taskRows, todoRows, approvalRows, inboxRows, projectRows, linkRows, tobuyRows, inventoryRows])
  useEffect(() => { setSel(0); setError(null) }, [q])

  const emptyMessage = qTrimmed
    ? looksLikeUrl(qTrimmed)
      ? 'No direct matches. Press Enter to save this link or convert it into work.'
      : `No results for "${qTrimmed}"`
    : 'Run an action, jump to a page, or search notes, docs, tasks, todos, projects, links, inventory, and shopping list.'

  const activate = async (row?: Row) => {
    const r = row ?? rows[sel]
    if (!r || actioning) return
    setActioning(r.id)
    setError(null)
    try {
      await r.onSelect()
      onClose()
    } catch (err: any) {
      setError(err?.message ?? 'Action failed')
    } finally {
      setActioning(null)
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, rows.length - 1)) }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
      else if (e.key === 'Enter')     { e.preventDefault(); void activate() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [actioning, onClose, rows, sel])

  const section = (label: string, items: Row[], startIdx: number) => items.length > 0 && (
    <div>
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">{label}</p>
        <span className="text-[10px] text-text-muted tabular-nums">{items.length}</span>
      </div>
      {items.map((r, i) => {
        const idx = startIdx + i
        return (
          <button key={`${r.kind}-${r.id}`} onClick={() => { void activate(r) }} onMouseEnter={() => setSel(idx)}
            className={clsxRow(idx === sel)}>
            <span className={idx === sel ? 'text-accent-blue shrink-0' : 'text-text-muted shrink-0'}>{r.icon}</span>
            <span className="text-sm text-text-primary truncate flex-1">{r.label}</span>
            {r.sub && <span className="text-xxs text-text-muted shrink-0">{r.sub}</span>}
            {actioning === r.id && <Loader2 size={11} className="animate-spin text-text-muted shrink-0" />}
            {idx === sel && <CornerDownLeft size={11} className="text-text-muted shrink-0" />}
          </button>
        )
      })}
    </div>
  )

  // index offsets for each section
  const oActions = 0
  const oViews = oActions + actionRows.length
  const oNotes = oViews + viewRows.length
  const oDocs = oNotes + notes.length
  const oTasks = oDocs + docs.length
  const oTodos = oTasks + taskRows.length
  const oApprovals = oTodos + todoRows.length
  const oInbox = oApprovals + approvalRows.length
  const oProjects = oInbox + inboxRows.length
  const oLinks = oProjects + projectRows.length
  const oTobuy = oLinks + linkRows.length
  const oInventory = oTobuy + tobuyRows.length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={14} className="text-text-muted shrink-0" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search notes, tasks, todos, projects, links, inventory, shopping list…"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted" />
          {loading
            ? <Loader2 size={13} className="animate-spin text-text-muted shrink-0" />
            : q ? <button onClick={() => setQ('')}><X size={13} className="text-text-muted hover:text-text-secondary" /></button>
                : <kbd className="text-xxs text-text-muted bg-base px-1.5 py-0.5 rounded border border-border shrink-0">ESC</kbd>}
        </div>

        {error && (
          <div className="border-b border-red-900/40 bg-red-950/20 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="max-h-80 overflow-y-auto py-1">
          {rows.length === 0 ? (
            <p className="px-8 py-8 text-xs text-text-muted text-center">{emptyMessage}</p>
          ) : (
            <>
              {section('Actions', actionRows, oActions)}
              {section(qTrimmed ? 'Go to' : 'Pages', viewRows, oViews)}
              {section('Notes', notes, oNotes)}
              {section('Docs',  docs,  oDocs)}
              {section('Tasks', taskRows, oTasks)}
              {section('To-Dos', todoRows, oTodos)}
              {section('Approvals', approvalRows, oApprovals)}
              {section('Inbox', inboxRows, oInbox)}
              {section('Projects', projectRows, oProjects)}
              {section('Links', linkRows, oLinks)}
              {section('To-Buy', tobuyRows, oTobuy)}
              {section('Inventory', inventoryRows, oInventory)}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-border text-xxs text-text-muted">
          <span className="flex items-center gap-1"><kbd className="bg-base px-1 rounded border border-border">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="bg-base px-1 rounded border border-border">↵</kbd> run</span>
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

// ─── Global connectivity strip ──────────────────────────────────────────────────
// Three compact dots — Tailscale node, Gateway WS, LanceDB — polled from
// /api/system/connectivity. Hover any dot for its live detail.

const DOT_COLOR: Record<ConnectivityIndicator['status'], string> = {
  ok:       'bg-green-500',
  degraded: 'bg-amber-400',
  down:     'bg-red-500',
}
const DOT_LABEL: Record<ConnectivityIndicator['status'], string> = {
  ok: 'online', degraded: 'degraded', down: 'offline',
}

function ConnectivityStrip() {
  const [indicators, setIndicators] = useState<ConnectivityIndicator[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let on = true
    const load = () => {
      if (isRefreshPaused()) return
      system.connectivity().then(r => { if (on) setIndicators(r.indicators) }).catch(() => { if (on) setIndicators(null) })
    }
    load()
    const t = setInterval(load, 20_000)
    return () => { on = false; clearInterval(t) }
  }, [])

  const dots = indicators ?? [
    { id: 'tailscale', label: 'Tailscale Node', status: 'down' as const, detail: 'checking…' },
    { id: 'gateway',   label: 'Gateway WS',     status: 'down' as const, detail: 'checking…' },
    { id: 'lancedb',   label: 'LanceDB',        status: 'down' as const, detail: 'checking…' },
  ]
  const worst: ConnectivityIndicator['status'] =
    dots.some(d => d.status === 'down') ? 'down' : dots.some(d => d.status === 'degraded') ? 'degraded' : 'ok'

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        className={clsx('flex items-center gap-1.5 px-2 py-1.5 rounded border transition-colors',
          worst === 'down' ? 'border-red-900/40 bg-red-950/20' : worst === 'degraded' ? 'border-amber-900/40 bg-amber-950/20' : 'border-border bg-card hover:bg-card-hover')}
        aria-label="Connectivity status"
      >
        {dots.map(d => (
          <span key={d.id} className={clsx('w-2 h-2 rounded-full', DOT_COLOR[d.status],
            (d.status === 'down' || d.status === 'degraded') && !indicators && 'animate-pulse',
            d.status === 'ok' && 'opacity-90')} />
        ))}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-64 rounded-lg border border-border bg-card shadow-2xl p-2">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-semibold px-1.5 pb-1.5">Connectivity</p>
          {dots.map(d => (
            <div key={d.id} className="flex items-start gap-2 px-1.5 py-1.5 rounded hover:bg-card-hover">
              <span className={clsx('w-2 h-2 rounded-full shrink-0 mt-1', DOT_COLOR[d.status])} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-text-primary">{d.label}</span>
                  <span className={clsx('text-[10px] font-semibold ml-auto',
                    d.status === 'ok' ? 'text-green-400' : d.status === 'degraded' ? 'text-amber-400' : 'text-red-400')}>
                    {DOT_LABEL[d.status]}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted leading-snug mt-0.5">{d.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Quick todo capture ────────────────────────────────────────────────────────

function QuickTodoCapture({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const submit = async () => {
    const title = text.trim()
    if (!title || saving || done) return
    setSaving(true)
    try {
      await todosApi.create({ title, severity: 'medium', horizon: 'short' })
      setDone(true)
      setTimeout(onClose, 700)
    } catch { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3">
          {done
            ? <Check size={14} className="text-accent-green shrink-0" />
            : <ListTodo size={14} className="text-accent-blue shrink-0" />}
          <input
            ref={inputRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
            placeholder="Quick to-do… (Enter to save)"
            className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            disabled={done}
          />
          {saving && !done && <Loader2 size={13} className="animate-spin text-text-muted shrink-0" />}
          {done && <span className="text-xs text-accent-green shrink-0">Saved</span>}
          {!saving && !done && <kbd className="text-xxs text-text-muted bg-base px-1.5 py-0.5 rounded border border-border shrink-0">ESC</kbd>}
        </div>
      </div>
    </div>
  )
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

export function TopBar({ title, onNavigate, views }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [quickTodo, setQuickTodo]   = useState(false)
  const paused = usePaused()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(v => !v) }
      if ((e.metaKey || e.ctrlKey) && e.key === 't') { e.preventDefault(); setQuickTodo(v => !v) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <>
      <header className="flex items-center justify-between h-12 px-5 border-b border-border bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{title}</span>
        </div>

        <div className="flex items-center gap-2">
          <ConnectivityStrip />

          <button onClick={() => setQuickTodo(true)}
            title="Quick add to-do (Ctrl+T)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
            <Plus size={12} />
            <span className="hidden sm:inline">To-do</span>
            <span className="flex items-center justify-center px-1 rounded bg-border text-text-muted font-mono text-xxs hidden sm:flex">^T</span>
          </button>

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

        </div>
      </header>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} onNavigate={onNavigate} views={views} />}
      {quickTodo && <QuickTodoCapture onClose={() => setQuickTodo(false)} />}
    </>
  )
}
