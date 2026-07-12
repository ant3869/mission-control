import { useCallback, useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  BellRing, Check, Clock3,
  Inbox as InboxIcon, ListTodo, RefreshCw, Search,
  Undo2, CheckSquare,
} from 'lucide-react'
import { inbox, type InboxItem, type InboxKind, type InboxStatus } from '../lib/api'
import {
  focusApprovalRequest,
  focusTaskCard,
  clearStoredValue, INBOX_ITEM_EVENT, INBOX_ITEM_STORAGE_KEY,
  openHubTab, readStoredValue,
} from '../lib/quickActions'
import { friendlyError } from '../lib/friendlyError'

const KIND_META: Record<InboxKind, { label: string; icon: React.ReactNode; badge: string }> = {
  approval:    { label: 'Approval',    icon: <BellRing size={12} />,     badge: 'bg-violet-950/40 border-violet-900/40 text-violet-300' },
  task:        { label: 'Task',        icon: <CheckSquare size={12} />,  badge: 'bg-blue-950/40 border-blue-900/40 text-blue-300' },
  todo:        { label: 'To-Do',       icon: <ListTodo size={12} />,     badge: 'bg-amber-950/40 border-amber-900/40 text-amber-300' },
}

const PRIORITY_BADGE: Record<InboxItem['priority'], string> = {
  critical: 'bg-red-950/30 border-red-900/30 text-red-300',
  high: 'bg-amber-950/30 border-amber-900/30 text-amber-300',
  medium: 'bg-blue-950/30 border-blue-900/30 text-blue-300',
  low: 'bg-card border-border text-text-muted',
}

function snoozeUntil(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

export function Inbox() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | InboxStatus>('active')
  const [kindFilter, setKindFilter] = useState<'all' | InboxKind>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [focusedItemId, setFocusedItemId] = useState<string | null>(() => readStoredValue(INBOX_ITEM_STORAGE_KEY))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await inbox.list()
      setItems(response.items)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ itemId?: string }>
      if (custom.detail?.itemId) setFocusedItemId(custom.detail.itemId)
    }
    window.addEventListener(INBOX_ITEM_EVENT, handler as EventListener)
    return () => window.removeEventListener(INBOX_ITEM_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    if (!focusedItemId) return
    const match = items.find(entry => entry.id === focusedItemId)
    if (!match) {
      if (!loading) {
        clearStoredValue(INBOX_ITEM_STORAGE_KEY)
        setFocusedItemId(null)
      }
      return
    }

    clearStoredValue(INBOX_ITEM_STORAGE_KEY)
    setQuery('')
    setKindFilter('all')
    setStatusFilter('all')
  }, [focusedItemId, items, loading])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(item => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false
      if (!q) return true
      return (
        item.title.toLowerCase().includes(q)
        || item.summary.toLowerCase().includes(q)
        || item.content.toLowerCase().includes(q)
        || item.badges.some(badge => badge.toLowerCase().includes(q))
      )
    })
  }, [items, kindFilter, query, statusFilter])

  const counts = items.reduce(
    (acc, item) => {
      acc[item.status] += 1
      acc[item.kind] += 1
      return acc
    },
    {
      active: 0,
      snoozed: 0,
      done: 0,
      approval: 0,
      task: 0,
      todo: 0,
    } as Record<InboxStatus | InboxKind, number>,
  )

  useEffect(() => {
    if (!focusedItemId) return
    const frame = window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-inbox-id="${focusedItemId}"]`)
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const timer = window.setTimeout(() => setFocusedItemId(current => current === focusedItemId ? null : current), 2600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusedItemId, items, kindFilter, query, statusFilter])

  async function patchItem(id: string, body: Parameters<typeof inbox.update>[1]) {
    setBusyId(id)
    try {
      await inbox.update(id, body)
      await load()
    } catch (err: any) {
      setError(err?.message ?? 'Could not update inbox item')
    } finally {
      setBusyId(null)
    }
  }

  function openSource(item: InboxItem) {
    if (item.kind === 'approval') {
      focusApprovalRequest(item.itemId)
    }
    if (item.kind === 'task') {
      focusTaskCard(item.itemId)
    }
    // To-Do / Tasks / Approvals are tabs of the combined 'todos' page now.
    const tab = item.kind === 'approval' ? 'approvals' : item.kind === 'task' ? 'tasks' : 'todo'
    openHubTab('todos', tab)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-4 pt-5 pb-4 shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Inbox</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            {loading ? 'Loading…' : `${counts.active} active · ${counts.snoozed} snoozed · ${counts.done} reviewed`}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="flex min-h-11 items-center gap-1.5 self-start rounded border border-border bg-card px-3 py-1.5 text-xs text-text-secondary hover:bg-card-hover hover:text-text-primary sm:min-h-0 sm:self-auto">
          <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      <div className="flex flex-col items-stretch gap-3 border-b border-border px-4 py-3 shrink-0 sm:flex-row sm:items-center sm:overflow-x-auto sm:px-6">
        <div className="relative w-full sm:max-w-sm sm:shrink-0">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search inbox…"
            className="w-full min-h-11 rounded border border-border bg-card py-2 pl-7 pr-3 text-base text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border sm:min-h-0 sm:py-1.5 sm:text-xs" />
        </div>
        <div className="flex gap-1 overflow-x-auto whitespace-nowrap">
          {(['all', 'active', 'snoozed', 'done'] as const).map(status => (
            <button key={status} onClick={() => setStatusFilter(status)} className={clsx('min-h-11 shrink-0 rounded px-2.5 py-1 text-xs font-medium capitalize sm:min-h-0', statusFilter === status ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-4 py-2.5 shrink-0 overflow-x-auto sm:px-6">
        <button onClick={() => setKindFilter('all')} className={clsx('min-h-11 shrink-0 rounded px-2.5 py-1 text-xs font-medium sm:min-h-0', kindFilter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
          All
        </button>
        {(Object.keys(KIND_META) as InboxKind[]).map(kind => (
          <button key={kind} onClick={() => setKindFilter(kind)} className={clsx('min-h-11 shrink-0 rounded px-2.5 py-1 text-xs font-medium sm:min-h-0', kindFilter === kind ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            {KIND_META[kind].label} <span className="ml-1 text-xxs opacity-60">{counts[kind]}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {error && (
          <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {friendlyError(error, 'the inbox')}
          </div>
        )}

        {loading ? (
          <div className="flex max-w-4xl flex-col gap-2">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-24 rounded-lg border border-border bg-card animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <InboxIcon size={22} className="text-text-muted" />
            <p className="text-sm text-text-secondary">No inbox items in this filter</p>
            <p className="max-w-sm text-xs text-text-muted">Critical approvals, blocked work, important feedback, and fresh publications surface here for quick triage.</p>
          </div>
        ) : (
          <div className="flex max-w-4xl flex-col gap-2">
            {filtered.map(item => (
              <div key={item.id} data-inbox-id={item.id} className={clsx('rounded-lg border bg-card p-3 transition-colors hover:bg-card-hover sm:p-4', item.id === focusedItemId && 'ring-1 ring-blue-500/60 bg-card-hover', busyId === item.id && 'opacity-60')}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 flex-wrap">
                      <span className={clsx('flex items-center gap-1 rounded border px-1.5 py-0.5 text-xxs font-medium', KIND_META[item.kind].badge)}>{KIND_META[item.kind].icon}{KIND_META[item.kind].label}</span>
                      <span className={clsx('rounded border px-1.5 py-0.5 text-xxs font-medium capitalize', PRIORITY_BADGE[item.priority])}>{item.priority}</span>
                      <span className="rounded border border-border bg-base px-1.5 py-0.5 text-xxs text-text-muted">{item.sourceLabel}</span>
                      <span className="flex w-full items-center gap-1 text-xxs text-text-muted sm:ml-auto sm:w-auto"><Clock3 size={10} />{item.eventAgo}</span>
                    </div>
                    <p className="text-sm font-semibold text-text-primary break-words">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">{item.summary}</p>
                    {item.badges.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.badges.map(badge => <span key={badge} className="rounded border border-border-subtle bg-base px-1.5 py-0.5 text-xxs text-text-muted">{badge}</span>)}
                      </div>
                    )}
                    {item.convertedTo && (
                      <p className="mt-2 text-xxs text-emerald-300">Converted to {item.convertedTo.kind}.</p>
                    )}
                  </div>
                  <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:max-w-[260px] sm:justify-end">
                    <button onClick={() => openSource(item)} className="min-h-11 rounded border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-card-hover sm:min-h-0 sm:text-xxs">Open</button>
                    {item.status === 'active' && (
                      <button onClick={() => patchItem(item.id, { status: 'snoozed', snoozedUntil: snoozeUntil(1) })} className="min-h-11 rounded border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-card-hover sm:min-h-0 sm:text-xxs"><Clock3 size={11} className="inline mr-1" />Snooze</button>
                    )}
                    {item.status !== 'done' && (
                      <button onClick={() => patchItem(item.id, { status: 'done' })} className="min-h-11 rounded border border-emerald-900/40 bg-emerald-950/20 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-950/35 sm:min-h-0 sm:text-xxs"><Check size={11} className="inline mr-1" />Reviewed</button>
                    )}
                    {item.status !== 'active' && (
                      <button onClick={() => patchItem(item.id, { status: 'active', clearReviewed: true })} className="min-h-11 rounded border border-border px-2.5 py-1 text-xs text-text-secondary hover:bg-card-hover sm:min-h-0 sm:text-xxs"><Undo2 size={11} className="inline mr-1" />Reopen</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
