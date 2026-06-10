// title: To-Do view
// path: src/views/Todos.tsx
// purpose: Personal quick-capture to-do list. Natural-language quick add
//          ("pay water bill tomorrow !high @long"), severity + horizon + due
//          dates with overdue badges, inline editing, and per-task agent
//          research that attaches a summary, action steps, links, and facts.

import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  ListTodo, RefreshCw, AlertCircle, Plus, Trash2, Sparkles, Loader2,
  Circle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Link2,
  Pencil, Check, X, CalendarDays,
} from 'lucide-react'
import { isRefreshPaused } from '../lib/refreshBus'
import { friendlyError } from '../lib/friendlyError'

// ─── Types (mirror server/routes/todos.ts) ────────────────────────────────────

type Severity = 'low' | 'medium' | 'high' | 'critical'
type Horizon  = 'short' | 'long'

interface TodoResearch {
  status:      'idle' | 'pending' | 'done' | 'failed'
  requestedAt: string
  completedAt: string
  error:       string
  summary?:    string
  steps?:      string[]
  links?:      Array<{ title: string; url: string }>
  data?:       Record<string, string>
}

interface Todo {
  id:          string
  title:       string
  notes:       string
  severity:    Severity
  horizon:     Horizon
  dueDate:     string
  done:        boolean
  createdAt:   string
  updatedAt:   string
  completedAt: string
  research:    TodoResearch
}

type TodoPatch = Partial<Pick<Todo, 'title' | 'notes' | 'severity' | 'horizon' | 'dueDate' | 'done'>>

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchTodos(): Promise<{ todos: Todo[] }> {
  const res = await fetch('/api/todos')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function createTodo(body: { title: string; severity: Severity; horizon: Horizon; dueDate?: string }): Promise<{ todo: Todo }> {
  const res = await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function patchTodo(id: string, body: TodoPatch): Promise<{ todo: Todo }> {
  const res = await fetch(`/api/todos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function deleteTodo(id: string): Promise<void> {
  const res = await fetch(`/api/todos/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

async function clearDone(): Promise<{ removed: number }> {
  const res = await fetch('/api/todos/clear-done', { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function startResearch(id: string): Promise<{ todo: Todo }> {
  const res = await fetch(`/api/todos/${id}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Quick-add parsing ────────────────────────────────────────────────────────
// Todoist-style tokens: "!high" / "!crit" sets severity, "@long" / "@short"
// sets horizon, and a trailing "today" / "tomorrow" / "next week" sets the due
// date. Everything else stays in the title.

const SEV_TOKEN: Record<string, Severity> = {
  low: 'low', med: 'medium', medium: 'medium', high: 'high', crit: 'critical', critical: 'critical',
}

function parseQuickAdd(raw: string, defaults: { severity: Severity; horizon: Horizon }) {
  let title    = raw.trim()
  let severity = defaults.severity
  let horizon  = defaults.horizon
  let dueDate  = ''

  title = title.replace(/(^|\s)!(low|med|medium|high|crit|critical)\b/gi, (_m, _sp, s) => {
    severity = SEV_TOKEN[s.toLowerCase()]
    return ' '
  })
  title = title.replace(/(^|\s)@(short|long)\b/gi, (_m, _sp, h) => {
    horizon = h.toLowerCase() as Horizon
    return ' '
  })

  const m = title.match(/(?:^|\s)(today|tomorrow|next week)\s*$/i)
  if (m) {
    const d = new Date()
    d.setHours(23, 59, 0, 0)   // end of day, so "today" isn't instantly overdue
    const kw = m[1].toLowerCase()
    if (kw === 'tomorrow')  d.setDate(d.getDate() + 1)
    if (kw === 'next week') d.setDate(d.getDate() + 7)
    dueDate = d.toISOString()
    title = title.slice(0, m.index)
  }

  return { title: title.replace(/\s{2,}/g, ' ').trim(), severity, horizon, dueDate }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'bg-red-500/10 border-red-500/30 text-red-400',
  high:     'bg-orange-500/10 border-orange-500/30 text-orange-400',
  medium:   'bg-amber-500/10 border-amber-500/30 text-amber-400',
  low:      'bg-white/5 border-white/10 text-text-muted',
}

const HORIZON_LABEL: Record<Horizon, string> = { short: 'Short term', long: 'Long term' }

function fmtAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

/** Whole days from today to the due date (negative = overdue). */
function daysUntil(iso: string): number {
  const due = new Date(iso); due.setHours(0, 0, 0, 0)
  const now = new Date();    now.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - now.getTime()) / 86400_000)
}

function dueBadge(iso: string): { label: string; cls: string } {
  const days = daysUntil(iso)
  if (days < 0)   return { label: days === -1 ? 'Overdue 1d' : `Overdue ${-days}d`, cls: 'bg-red-500/10 border-red-500/30 text-red-400' }
  if (days === 0) return { label: 'Due today',    cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400' }
  if (days === 1) return { label: 'Due tomorrow', cls: 'bg-amber-500/10 border-amber-500/30 text-amber-400' }
  if (days <= 7)  return { label: `Due in ${days}d`, cls: 'bg-white/5 border-white/10 text-text-secondary' }
  return { label: new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: 'bg-white/5 border-white/10 text-text-muted' }
}

/** ISO → value for <input type="date">, local time. */
function isoToDateInput(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** <input type="date"> value → ISO at local end-of-day ('' clears). */
function dateInputToIso(v: string): string {
  if (!v) return ''
  const d = new Date(`${v}T23:59:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

// ─── Research panel ───────────────────────────────────────────────────────────

function ResearchPanel({ r }: { r: TodoResearch }) {
  return (
    <div className="mt-2 ml-9 mr-2 mb-1 rounded border border-violet-500/20 bg-violet-500/5 p-3 flex flex-col gap-3 text-xs">
      {r.summary && <p className="text-text-secondary leading-relaxed">{r.summary}</p>}

      {r.steps && r.steps.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Suggested steps</div>
          <ol className="list-decimal list-inside flex flex-col gap-0.5 text-text-secondary">
            {r.steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}

      {r.links && r.links.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Links</div>
          <div className="flex flex-col gap-1">
            {r.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-1.5 text-accent-blue hover:underline w-fit">
                <ExternalLink size={11} className="shrink-0" />
                <span className="truncate">{l.title || l.url}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {r.data && Object.keys(r.data).length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1">Key facts</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {Object.entries(r.data).map(([k, v]) => (
              <div key={k} className="contents">
                <span className="text-text-muted">{k}</span>
                <span className="text-text-secondary">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Inline edit form ─────────────────────────────────────────────────────────

function EditForm({ todo, onSave, onCancel }: {
  todo: Todo
  onSave: (patch: TodoPatch) => void
  onCancel: () => void
}) {
  const [title, setTitle]       = useState(todo.title)
  const [notes, setNotes]       = useState(todo.notes)
  const [severity, setSeverity] = useState<Severity>(todo.severity)
  const [horizon, setHorizon]   = useState<Horizon>(todo.horizon)
  const [due, setDue]           = useState(isoToDateInput(todo.dueDate))

  function save() {
    if (!title.trim()) return
    onSave({ title: title.trim(), notes, severity, horizon, dueDate: dateInputToIso(due) })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter')  save()
    if (e.key === 'Escape') onCancel()
  }

  const inputCls = 'bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-emerald-500/50'

  return (
    <div className="flex flex-col gap-1.5 flex-1 min-w-0" onKeyDown={onKeyDown}>
      <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
             className={clsx(inputCls, 'w-full')} placeholder="Title" />
      <input value={notes} onChange={e => setNotes(e.target.value)}
             className={clsx(inputCls, 'w-full')} placeholder="Notes (optional)" />
      <div className="flex items-center gap-1.5 flex-wrap">
        <select value={severity} onChange={e => setSeverity(e.target.value as Severity)} className={inputCls} title="Severity">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
        <select value={horizon} onChange={e => setHorizon(e.target.value as Horizon)} className={inputCls} title="Time horizon">
          <option value="short">Short term</option>
          <option value="long">Long term</option>
        </select>
        <input type="date" value={due} onChange={e => setDue(e.target.value)} className={inputCls} title="Due date" />
        {due && (
          <button onClick={() => setDue('')} className="text-[10px] text-text-muted hover:text-text-secondary" title="Clear due date">
            clear date
          </button>
        )}
        <button onClick={save} disabled={!title.trim()}
                className="flex items-center gap-1 px-2 py-1.5 text-xs bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded text-emerald-400 transition-colors disabled:opacity-40">
          <Check size={12} /> Save
        </button>
        <button onClick={onCancel}
                className="flex items-center gap-1 px-2 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded text-text-secondary transition-colors">
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Todo row ─────────────────────────────────────────────────────────────────

function TodoRow({ todo, onToggle, onDelete, onResearch, onSave }: {
  todo: Todo
  onToggle: (t: Todo) => void
  onDelete: (t: Todo) => void
  onResearch: (t: Todo) => void
  onSave: (t: Todo, patch: TodoPatch) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing]   = useState(false)
  const r = todo.research
  const hasResearch = r.status === 'done'
  const due = todo.dueDate && !todo.done ? dueBadge(todo.dueDate) : null

  return (
    <div className="rounded border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors px-3 py-2">
      <div className="flex items-center gap-2.5">
        <button onClick={() => onToggle(todo)} className="shrink-0 self-start mt-0.5 text-text-muted hover:text-emerald-400 transition-colors" title={todo.done ? 'Mark as open' : 'Mark as done'}>
          {todo.done ? <CheckCircle2 size={17} className="text-emerald-400" /> : <Circle size={17} />}
        </button>

        {editing ? (
          <EditForm todo={todo} onCancel={() => setEditing(false)}
                    onSave={patch => { onSave(todo, patch); setEditing(false) }} />
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <span className={clsx('text-sm', todo.done ? 'line-through text-text-muted' : 'text-text-primary')}>
                {todo.title}
              </span>
              {todo.notes && <span className="ml-2 text-xs text-text-muted truncate">{todo.notes}</span>}
            </div>

            {due && (
              <span className={clsx('shrink-0 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border', due.cls)}>
                <CalendarDays size={10} /> {due.label}
              </span>
            )}
            <span className={clsx('shrink-0 text-[10px] px-1.5 py-0.5 rounded border capitalize', SEVERITY_STYLE[todo.severity])}>
              {todo.severity}
            </span>
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-text-muted">
              {HORIZON_LABEL[todo.horizon]}
            </span>
            <span className="shrink-0 text-[10px] text-text-muted tabular-nums hidden sm:block" title={todo.createdAt}>
              {fmtAgo(todo.createdAt)}
            </span>

            {/* Research control */}
            {r.status === 'pending' ? (
              <span className="shrink-0 flex items-center gap-1 text-[10px] text-violet-400" title="Agent is researching this task">
                <Loader2 size={12} className="animate-spin" /> researching…
              </span>
            ) : hasResearch ? (
              <button onClick={() => setExpanded(e => !e)}
                      className="shrink-0 flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
                      title="Show research">
                <Sparkles size={12} />
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : (
              <button onClick={() => onResearch(todo)}
                      className="shrink-0 flex items-center gap-1 text-[10px] text-text-muted hover:text-violet-400 transition-colors"
                      title={r.status === 'failed' ? `Research failed: ${r.error} — click to retry` : 'Ask an agent to research this task'}>
                {r.status === 'failed' && <AlertCircle size={12} className="text-red-400" />}
                <Sparkles size={12} />
                <span className="hidden md:inline">{r.status === 'failed' ? 'retry' : 'research'}</span>
              </button>
            )}

            <button onClick={() => setEditing(true)} className="shrink-0 text-text-muted hover:text-text-primary transition-colors" title="Edit">
              <Pencil size={13} />
            </button>
            <button onClick={() => onDelete(todo)} className="shrink-0 text-text-muted hover:text-red-400 transition-colors" title="Delete">
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      {hasResearch && expanded && !editing && <ResearchPanel r={r} />}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

type Filter = 'open' | 'short' | 'long' | 'done'

export default function Todos() {
  const [todos, setTodos]       = useState<Todo[]>([])
  const [filter, setFilter]     = useState<Filter>('open')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [title, setTitle]       = useState('')
  const [severity, setSeverity] = useState<Severity>('medium')
  const [horizon, setHorizon]   = useState<Horizon>('short')
  const [adding, setAdding]     = useState(false)
  const [clearing, setClearing] = useState(false)
  const pollRef                 = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef                = useRef<HTMLInputElement>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null) }
    try { setTodos((await fetchTodos()).todos) }
    catch (e: any) { if (!silent) setError(e.message) }
    finally { if (!silent) setLoading(false) }
  }, [])

  // Poll fast while research is pending so results appear without a manual refresh.
  const anyPending = todos.some(t => t.research?.status === 'pending')
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    pollRef.current = setInterval(() => { if (!isRefreshPaused()) load(true) }, anyPending ? 5_000 : 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load, anyPending])

  async function handleAdd() {
    const parsed = parseQuickAdd(title, { severity, horizon })
    if (!parsed.title || adding) return
    setAdding(true); setError(null)
    try {
      const r = await createTodo(parsed)
      setTodos(ts => [r.todo, ...ts])
      setTitle('')
      inputRef.current?.focus()
    } catch (e: any) { setError(e.message) }
    finally { setAdding(false) }
  }

  async function handleToggle(todo: Todo) {
    try {
      const r = await patchTodo(todo.id, { done: !todo.done })
      setTodos(ts => ts.map(t => t.id === todo.id ? r.todo : t))
    } catch (e: any) { setError(e.message) }
  }

  async function handleSave(todo: Todo, patch: TodoPatch) {
    try {
      const r = await patchTodo(todo.id, patch)
      setTodos(ts => ts.map(t => t.id === todo.id ? r.todo : t))
    } catch (e: any) { setError(e.message) }
  }

  async function handleDelete(todo: Todo) {
    if (!confirm(`Delete "${todo.title}"?`)) return
    try {
      await deleteTodo(todo.id)
      setTodos(ts => ts.filter(t => t.id !== todo.id))
    } catch (e: any) { setError(e.message) }
  }

  async function handleClearDone() {
    const n = todos.filter(t => t.done).length
    if (!n || !confirm(`Remove ${n} completed to-do${n > 1 ? 's' : ''}?`)) return
    setClearing(true)
    try {
      await clearDone()
      setTodos(ts => ts.filter(t => !t.done))
    } catch (e: any) { setError(e.message) }
    finally { setClearing(false) }
  }

  async function handleResearch(todo: Todo) {
    try {
      const r = await startResearch(todo.id)
      setTodos(ts => ts.map(t => t.id === todo.id ? r.todo : t))
    } catch (e: any) { setError(e.message) }
  }

  // Open tabs: overdue first, then severity, then nearest due date, then newest.
  const dueRank = (t: Todo) => t.dueDate ? new Date(t.dueDate).getTime() : Infinity
  const overdue = (t: Todo) => t.dueDate && daysUntil(t.dueDate) < 0 ? 0 : 1

  const visible = todos
    .filter(t => {
      if (filter === 'done')  return t.done
      if (t.done)             return false
      if (filter === 'short') return t.horizon === 'short'
      if (filter === 'long')  return t.horizon === 'long'
      return true
    })
    .sort((a, b) =>
      filter === 'done'
        ? (b.completedAt || '').localeCompare(a.completedAt || '')
        : overdue(a) - overdue(b)
          || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
          || dueRank(a) - dueRank(b)
          || b.createdAt.localeCompare(a.createdAt))

  const openCount = todos.filter(t => !t.done).length
  const counts: Record<Filter, number> = {
    open:  openCount,
    short: todos.filter(t => !t.done && t.horizon === 'short').length,
    long:  todos.filter(t => !t.done && t.horizon === 'long').length,
    done:  todos.filter(t => t.done).length,
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <ListTodo size={20} className="text-emerald-400" />
          <h1 className="text-lg font-semibold text-text-primary">To-Do</h1>
          {openCount > 0 && (
            <span className="bg-emerald-500/20 text-emerald-400 text-xs px-2 py-0.5 rounded-full border border-emerald-500/30">
              {openCount} open
            </span>
          )}
        </div>
        <button onClick={() => load()} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded text-text-secondary transition-colors disabled:opacity-50">
          <RefreshCw size={12} className={clsx(loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4 flex flex-col gap-4">
        {error && (
          <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <p className="text-xs leading-snug">{friendlyError(error, 'the to-do API')}</p>
          </div>
        )}

        {/* Quick add */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder="Add a to-do and press Enter…"
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-emerald-500/50"
            />
            <select value={severity} onChange={e => setSeverity(e.target.value as Severity)}
                    className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs text-text-secondary focus:outline-none"
                    title="Severity">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select value={horizon} onChange={e => setHorizon(e.target.value as Horizon)}
                    className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs text-text-secondary focus:outline-none"
                    title="Time horizon">
              <option value="short">Short term</option>
              <option value="long">Long term</option>
            </select>
            <button onClick={handleAdd} disabled={!title.trim() || adding}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded text-emerald-400 transition-colors disabled:opacity-40">
              {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
            </button>
          </div>
          <p className="text-[10px] text-text-muted px-1 select-none">
            Tip: type <span className="text-text-secondary">"renew passport tomorrow !high @long"</span> — !low/!high/!crit sets severity, @short/@long sets horizon, trailing today/tomorrow/next week sets the due date.
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {(['open', 'short', 'long', 'done'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
                    className={clsx(
                      'px-2.5 py-1 rounded text-xs capitalize transition-colors',
                      filter === f ? 'bg-white/10 text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-white/5',
                    )}>
              {f === 'short' ? 'Short term' : f === 'long' ? 'Long term' : f}
              <span className="ml-1.5 tabular-nums opacity-60">{counts[f]}</span>
            </button>
          ))}
          {filter === 'done' && counts.done > 0 && (
            <button onClick={handleClearDone} disabled={clearing}
                    className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-red-400 hover:bg-white/5 transition-colors disabled:opacity-50">
              {clearing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Clear completed
            </button>
          )}
        </div>

        {/* List */}
        <div className="flex flex-col gap-1.5 pb-6">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-text-muted">
              <Link2 size={20} className="opacity-40" />
              <p className="text-xs">{filter === 'done' ? 'Nothing completed yet.' : 'Nothing here — add a to-do above.'}</p>
            </div>
          ) : visible.map(t => (
            <TodoRow key={t.id} todo={t} onToggle={handleToggle} onDelete={handleDelete}
                     onResearch={handleResearch} onSave={handleSave} />
          ))}
        </div>
      </div>
    </div>
  )
}
