// title: To-Do view
// path: src/views/Todos.tsx
// purpose: Personal quick-capture to-do list — compact rows click to open a
//          side drawer (same pattern as Inventory). Natural-language quick add,
//          severity + horizon + due dates, inline research via OpenClaw/Hermes.

import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  ListTodo, RefreshCw, AlertCircle, Plus, Trash2, Sparkles, Loader2,
  Circle, CheckCircle2, ExternalLink, Pencil, Check, X, CalendarDays,
  ChevronDown, MapPin, Phone, DollarSign, Clock, Link2, User, Tag, Wand2,
  CalendarCheck,
} from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'
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
  guidance?:   string
  summary?:    string
  steps?:      string[]
  links?:      Array<{ title: string; url: string }>
  data?:       Record<string, string>
}

interface TodoDetails {
  date:         string
  time:         string
  location:     string
  phone:        string
  cost:         string
  url:          string
  contact:      string
  category:     string
  customFields: Record<string, string>
}

const emptyDetails = (): TodoDetails => ({ date: '', time: '', location: '', phone: '', cost: '', url: '', contact: '', category: '', customFields: {} })

function withDetails(d?: Partial<TodoDetails> | null): TodoDetails {
  return { ...emptyDetails(), ...(d ?? {}), customFields: { ...(d?.customFields ?? {}) } }
}

function hasAnyDetail(d?: TodoDetails | null): boolean {
  if (!d) return false
  return Boolean(d.date || d.time || d.location || d.phone || d.cost || d.url || d.contact || d.category || Object.keys(d.customFields ?? {}).length)
}

type CalendarSyncStatus = 'idle' | 'synced' | 'pending' | 'error' | 'disabled'

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
  details:     TodoDetails
  rawInput:    string
  research:    TodoResearch
  // Google Calendar sync metadata (backfilled server-side for old rows)
  calendarSyncEnabled?:   boolean
  googleCalendarEventId?: string
  calendarSyncStatus?:    CalendarSyncStatus
  lastCalendarSyncAt?:    string
  calendarSyncError?:     string
}

type TodoPatch = Partial<Pick<Todo, 'title' | 'notes' | 'severity' | 'horizon' | 'dueDate' | 'done' | 'details' | 'rawInput' | 'calendarSyncEnabled'>>

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchTodos(): Promise<{ todos: Todo[] }> {
  const res = await fetch('/api/todos')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function createTodo(body: { title: string; severity: Severity; horizon: Horizon; dueDate?: string; details?: TodoDetails; rawInput?: string }): Promise<{ todo: Todo }> {
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

type ResearchSource = 'openclaw' | 'hermes'

async function startResearch(id: string, source: ResearchSource, guidance?: string): Promise<{ todo: Todo }> {
  const res = await fetch(`/api/todos/${id}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, guidance: guidance ?? '' }) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Quick-add parsing ────────────────────────────────────────────────────────

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
    d.setHours(23, 59, 0, 0)
    const kw = m[1].toLowerCase()
    if (kw === 'tomorrow')  d.setDate(d.getDate() + 1)
    if (kw === 'next week') d.setDate(d.getDate() + 7)
    dueDate = d.toISOString()
    title = title.slice(0, m.index)
  }

  return { title: title.replace(/\s{2,}/g, ' ').trim(), severity, horizon, dueDate }
}

// ─── Smart detail extraction ──────────────────────────────────────────────────
// Best-effort scan of free text for structured fields. A *helper*, never the
// required input path — it only fills fields the user left blank, and never
// rewrites the title. e.g. "Eye exam 06/17/2026, 406 S Walton Blvd, 11:40AM,
// $100, 479-271-0301" → date/location/time/cost/phone.

const STREET_SUFFIX = 'St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Pl|Place|Ter|Terrace|Trl|Trail|Sq|Square'

function parseDetails(raw: string): Partial<TodoDetails> {
  const text = ` ${raw} `
  const found: Partial<TodoDetails> = {}

  const date = text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/)
    || text.match(/\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)\b/i)
  if (date) found.date = date[1].trim()

  const time = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\b/i)
    || text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)
  if (time) found.time = time[1].trim().replace(/\s+/g, '')

  const phone = text.match(/(\(\d{3}\)\s*\d{3}[-.\s]\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/)
  if (phone) found.phone = phone[1].trim()

  const cost = text.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/)
  if (cost) found.cost = `$${cost[1]}`

  const url = text.match(/\b(https?:\/\/[^\s,]+|www\.[^\s,]+)\b/i)
  if (url) found.url = url[1].trim()

  const addr = text.match(new RegExp(`(\\d{1,6}\\s+(?:[NSEW]\\.?\\s+)?[A-Za-z0-9][\\w'.-]*(?:\\s+[A-Za-z0-9][\\w'.-]*){0,4}?\\s+(?:${STREET_SUFFIX})\\b)`, 'i'))
  if (addr) found.location = addr[1].replace(/\s{2,}/g, ' ').trim()

  return found
}

// True if the text plausibly carries structured detail worth offering to extract.
function looksDetailRich(raw: string): boolean {
  const d = parseDetails(raw)
  return Object.values(d).some(Boolean)
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

function isoToDateInput(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateInputToIso(v: string): string {
  if (!v) return ''
  const d = new Date(`${v}T23:59:00`)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

// ─── Agent source picker ──────────────────────────────────────────────────────

function AgentSourcePicker({ value, onChange }: { value: ResearchSource; onChange: (s: ResearchSource) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-violet-900/40 bg-violet-950/20 p-0.5 text-[10px]">
      {(['openclaw', 'hermes'] as ResearchSource[]).map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={clsx(
            'px-2 py-0.5 rounded transition-colors',
            value === s ? 'bg-violet-500/25 text-violet-100' : 'text-violet-400/60 hover:text-violet-300',
          )}
        >
          {s === 'openclaw' ? 'OpenClaw' : 'Hermes'}
        </button>
      ))}
    </div>
  )
}

// ─── Research refine box ──────────────────────────────────────────────────────

function RefineBox({ value, onChange, onRun, onCancel, placeholder }: {
  value: string
  onChange: (s: string) => void
  onRun: () => void
  onCancel: () => void
  placeholder: string
}) {
  return (
    <div className="animate-rise-in flex flex-col gap-2 rounded-lg border border-violet-900/40 bg-violet-950/25 p-2.5">
      <textarea
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-violet-500/50 resize-none"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onRun() }}
      />
      <div className="flex items-center gap-2">
        <button onClick={onRun}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-500/40 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30 text-xs">
          <Sparkles size={11} /> Re-run research
        </button>
        <button onClick={onCancel}
                className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-text-muted">⌘↵</span>
      </div>
    </div>
  )
}

// ─── Additional details ───────────────────────────────────────────────────────

type DetailKey = 'date' | 'time' | 'location' | 'phone' | 'cost' | 'url' | 'contact' | 'category'

const DETAIL_FIELDS: Array<{ key: DetailKey; label: string; icon: typeof MapPin; placeholder: string; wide?: boolean; type?: string }> = [
  { key: 'date',     label: 'Date',     icon: CalendarDays, placeholder: 'e.g. 06/17/2026',     type: 'text' },
  { key: 'time',     label: 'Time',     icon: Clock,        placeholder: 'e.g. 11:40 AM',        type: 'text' },
  { key: 'location', label: 'Location', icon: MapPin,       placeholder: '406 S Walton Blvd',    wide: true },
  { key: 'phone',    label: 'Phone',    icon: Phone,        placeholder: '479-271-0301',         type: 'tel' },
  { key: 'cost',     label: 'Cost',     icon: DollarSign,   placeholder: '$100',                 type: 'text' },
  { key: 'contact',  label: 'Contact',  icon: User,         placeholder: 'Person / office name' },
  { key: 'category', label: 'Category', icon: Tag,          placeholder: 'Appointment, errand…' },
  { key: 'url',      label: 'URL',      icon: Link2,        placeholder: 'https://…',  wide: true, type: 'url' },
]

const detailFieldCls = 'w-full pl-7 pr-2 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50'

// Editable grid of optional fields + custom key/value pairs. Used in quick-add
// and the drawer editor. Lightweight by design — collapsed by default elsewhere.
function DetailsForm({ value, onChange, parseSource }: {
  value: TodoDetails
  onChange: (d: TodoDetails) => void
  parseSource?: string   // text to offer auto-detect from (the live title input)
}) {
  const set = (k: DetailKey, v: string) => onChange({ ...value, [k]: v })

  const suggestions = parseSource ? parseDetails(parseSource) : {}
  const fillable = (Object.entries(suggestions) as Array<[DetailKey, string]>)
    .filter(([k, v]) => v && !value[k])

  function applyDetected() {
    const next = { ...value }
    for (const [k, v] of fillable) next[k] = v
    onChange(next)
  }

  // Custom fields
  const customEntries = Object.entries(value.customFields)
  function setCustom(oldKey: string, key: string, val: string) {
    const cf = { ...value.customFields }
    if (oldKey !== key) delete cf[oldKey]
    if (key.trim()) cf[key] = val
    onChange({ ...value, customFields: cf })
  }
  function addCustom() {
    if (Object.prototype.hasOwnProperty.call(value.customFields, '')) return
    onChange({ ...value, customFields: { ...value.customFields, '': '' } })
  }
  function removeCustom(key: string) {
    const cf = { ...value.customFields }; delete cf[key]
    onChange({ ...value, customFields: cf })
  }

  return (
    <div className="flex flex-col gap-2.5">
      {fillable.length > 0 && (
        <button onClick={applyDetected}
                className="animate-rise-in flex items-center gap-1.5 self-start px-2 py-1 rounded-lg border border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25 text-[11px]">
          <Wand2 size={11} /> Detected {fillable.length} field{fillable.length > 1 ? 's' : ''} — apply
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {DETAIL_FIELDS.map(f => {
          const Icon = f.icon
          return (
            <label key={f.key} className={clsx('flex flex-col gap-1 min-w-0', f.wide && 'col-span-2')}>
              <span className="flex items-center gap-1 text-xxs font-semibold uppercase tracking-wide text-text-muted">
                <Icon size={10} /> {f.label}
              </span>
              <div className="relative">
                <Icon size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                <input
                  type={f.type ?? 'text'}
                  value={value[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  className={detailFieldCls}
                />
              </div>
            </label>
          )
        })}
      </div>

      {/* Custom key/value fields */}
      {customEntries.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {customEntries.map(([k, v], i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={k}
                onChange={e => setCustom(k, e.target.value, v)}
                placeholder="Label"
                className="w-28 shrink-0 px-2 py-1.5 rounded-lg bg-base border border-border text-xs text-text-secondary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
              />
              <input
                value={v}
                onChange={e => setCustom(k, k, e.target.value)}
                placeholder="Value"
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
              />
              <button onClick={() => removeCustom(k)} className="shrink-0 p-1 text-text-muted hover:text-red-400" aria-label="Remove field">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button onClick={addCustom} className="flex items-center gap-1 self-start text-[11px] text-text-muted hover:text-text-secondary">
        <Plus size={11} /> Custom field
      </button>
    </div>
  )
}

// The muted second line for a row. Composes the most useful detail fields into
// a single readable subtext (like the subtitles in the status dashboard), with
// graceful fallbacks so every row has a consistent two-line rhythm.
function rowSubtext(todo: Todo): string {
  const d = todo.details
  const parts: string[] = []
  if (d.time)     parts.push(d.time)
  if (d.date)     parts.push(d.date)
  if (d.location) parts.push(d.location)
  if (d.cost)     parts.push(d.cost)
  if (d.phone)    parts.push(d.phone)
  if (d.contact)  parts.push(d.contact)
  if (d.category) parts.push(d.category)
  if (parts.length) return parts.join('  ·  ')

  if (todo.notes.trim()) return todo.notes.trim().split('\n')[0]

  // Quiet fallback so plain tasks still carry a subtext line.
  return `${HORIZON_LABEL[todo.horizon]}  ·  added ${fmtAgo(todo.createdAt)}`
}

// ─── Todo row ─────────────────────────────────────────────────────────────────

function TodoRow({ todo, active, onToggle, onClick }: {
  todo:     Todo
  active:   boolean
  onToggle: (t: Todo) => void
  onClick:  () => void
}) {
  const r    = todo.research
  const due  = todo.dueDate && !todo.done ? dueBadge(todo.dueDate) : null
  const over = todo.dueDate && !todo.done && daysUntil(todo.dueDate) < 0

  return (
    <div className={clsx(
      'group/row relative flex items-center gap-2.5 w-full transition-colors',
      'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:transition-colors',
      over
        ? 'before:bg-red-500/50'
        : active ? 'before:bg-emerald-400' : 'before:bg-transparent',
      active ? 'bg-card-hover' : 'bg-card hover:bg-card-hover',
    )}>
      {/* Circle toggle — independent quick action */}
      <button
        onClick={e => { e.stopPropagation(); onToggle(todo) }}
        className="shrink-0 pl-3 py-2.5 text-text-muted hover:text-emerald-400 transition-colors"
        title={todo.done ? 'Mark as open' : 'Mark as done'}
      >
        {todo.done
          ? <CheckCircle2 size={16} className="text-emerald-400" />
          : <Circle size={16} />
        }
      </button>

      {/* Row body — clicking opens the drawer. Two-line item (title + muted
          subtext) on the left; a uniform, right-aligned badge column on the
          right so priority pills line up cleanly down the list. */}
      <button
        onClick={onClick}
        className="flex flex-1 min-w-0 items-center gap-3 pr-4 py-2.5 text-left"
      >
        {/* Left text column */}
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className={clsx(
            'text-sm truncate leading-tight',
            todo.done ? 'line-through text-text-muted' : 'text-text-primary',
          )}>
            {todo.title}
          </span>
          <span className="text-[11px] text-text-muted truncate leading-tight">
            {rowSubtext(todo)}
          </span>
        </div>

        {/* Right badge column — fixed slots keep everything aligned */}
        <div className="shrink-0 flex items-center gap-2">
          {due && (
            <span className={clsx('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border', due.cls)}>
              <CalendarDays size={10} /> {due.label}
            </span>
          )}
          <span className={clsx(
            'inline-flex justify-center min-w-[68px] text-[10px] px-1.5 py-0.5 rounded border capitalize',
            SEVERITY_STYLE[todo.severity],
          )}>
            {todo.severity}
          </span>
          {todo.calendarSyncEnabled && (
            <span className="w-4 flex justify-center shrink-0"
                  title={todo.calendarSyncStatus === 'error' ? (todo.calendarSyncError || 'Calendar sync error') : 'Synced to Google Calendar'}>
              {todo.calendarSyncStatus === 'pending' && <Loader2 size={11} className="animate-spin text-accent-blue" />}
              {todo.calendarSyncStatus === 'synced'  && <CalendarCheck size={12} className="text-emerald-400/80" />}
              {todo.calendarSyncStatus === 'error'   && <CalendarDays size={12} className="text-red-400/70" />}
            </span>
          )}
          <span className="w-4 flex justify-center shrink-0">
            {r.status === 'pending' && <Loader2 size={12} className="text-violet-400 animate-spin" />}
            {r.status === 'done'    && <Sparkles size={12} className="text-violet-400" />}
            {r.status === 'failed'  && <Sparkles size={12} className="text-text-muted/40" />}
          </span>
        </div>
      </button>
    </div>
  )
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function TodoDrawer({ todo, onClose, onToggle, onSave, onDelete, onResearch }: {
  todo:       Todo
  onClose:    () => void
  onToggle:   (t: Todo) => void
  onSave:     (t: Todo, patch: TodoPatch) => void
  onDelete:   (t: Todo) => void
  onResearch: (t: Todo, source: ResearchSource, guidance?: string) => void
}) {
  useEscapeKey(onClose)

  const [editing, setEditing]   = useState(false)
  const [title, setTitle]       = useState(todo.title)
  const [notes, setNotes]       = useState(todo.notes)
  const [severity, setSeverity] = useState<Severity>(todo.severity)
  const [horizon, setHorizon]   = useState<Horizon>(todo.horizon)
  const [due, setDue]           = useState(isoToDateInput(todo.dueDate))
  const [details, setDetails]   = useState<TodoDetails>(withDetails(todo.details))
  const [source, setSource]     = useState<ResearchSource>('openclaw')
  const [refining, setRefining] = useState(false)
  const [guidance, setGuidance] = useState('')

  function runResearch() {
    onResearch(todo, source, guidance.trim() || undefined)
    setRefining(false)
    setGuidance('')
  }

  // Sync local state when the selected todo changes
  useEffect(() => {
    setTitle(todo.title)
    setNotes(todo.notes)
    setSeverity(todo.severity)
    setHorizon(todo.horizon)
    setDue(isoToDateInput(todo.dueDate))
    setDetails(withDetails(todo.details))
    setRefining(false)
    setGuidance('')
    setEditing(false)
  }, [todo.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    if (!title.trim()) return
    onSave(todo, { title: title.trim(), notes, severity, horizon, dueDate: dateInputToIso(due), details })
    setEditing(false)
  }

  const r        = todo.research
  const dueBadgeVal = todo.dueDate && !todo.done ? dueBadge(todo.dueDate) : null
  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50'

  return (
    <div className={clsx(
      'animate-drawer-in flex flex-col h-full border-l border-border bg-surface overflow-y-auto',
      // Narrow (half-screen): overlay the list instead of crushing it.
      'absolute inset-y-0 right-0 z-30 w-full max-w-[440px] shadow-2xl shadow-black/40',
      // Wide: sit side-by-side as a static panel.
      'lg:static lg:w-[380px] lg:min-w-[380px] lg:max-w-none lg:shadow-none lg:z-auto',
    )}>

      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0 gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            onClick={() => onToggle(todo)}
            className="shrink-0 text-text-muted hover:text-emerald-400 transition-colors"
            title={todo.done ? 'Mark as open' : 'Mark as done'}
          >
            {todo.done
              ? <CheckCircle2 size={18} className="text-emerald-400" />
              : <Circle size={18} />
            }
          </button>
          <p className={clsx('text-sm font-semibold leading-snug min-w-0', todo.done ? 'line-through text-text-muted' : 'text-text-primary')}>
            {todo.title}
          </p>
        </div>
        <button aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-primary shrink-0">
          <X size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">

        {/* Property chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border capitalize', SEVERITY_STYLE[todo.severity])}>
            {todo.severity}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-base text-text-muted">
            {HORIZON_LABEL[todo.horizon]}
          </span>
          {dueBadgeVal && (
            <span className={clsx('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border', dueBadgeVal.cls)}>
              <CalendarDays size={10} /> {dueBadgeVal.label}
            </span>
          )}
          <span className="ml-auto text-[10px] text-text-muted" title={todo.createdAt}>
            {fmtAgo(todo.createdAt)}
          </span>
        </div>

        {/* Edit form */}
        {editing ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Title</span>
              <input value={title} onChange={e => setTitle(e.target.value)} autoFocus className={inputCls}
                     onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Notes</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                        className={clsx(inputCls, 'resize-none')} placeholder="Additional context…" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Severity</span>
                <select value={severity} onChange={e => setSeverity(e.target.value as Severity)} className={inputCls}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Horizon</span>
                <select value={horizon} onChange={e => setHorizon(e.target.value as Horizon)} className={inputCls}>
                  <option value="short">Short term</option>
                  <option value="long">Long term</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Due date</span>
              <div className="flex items-center gap-2">
                <input type="date" value={due} onChange={e => setDue(e.target.value)} className={clsx(inputCls, 'flex-1')} />
                {due && (
                  <button onClick={() => setDue('')} className="text-[10px] text-text-muted hover:text-text-secondary">
                    clear
                  </button>
                )}
              </div>
            </label>

            <div className="pt-1 border-t border-border">
              <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">Additional details</p>
              <DetailsForm value={details} onChange={setDetails} parseSource={title} />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={save} disabled={!title.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium disabled:opacity-40">
                <Check size={12} /> Save
              </button>
              <button onClick={() => setEditing(false)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {hasAnyDetail(todo.details) && (
              <div>
                <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Details</p>
                <div className="flex flex-col rounded-lg border border-border overflow-hidden">
                  {DETAIL_FIELDS.filter(f => todo.details[f.key]).map((f, i) => {
                    const Icon = f.icon
                    const val = todo.details[f.key]
                    const isUrl = f.key === 'url'
                    return (
                      <div key={f.key} className={clsx('flex items-center gap-2 px-3 py-1.5 text-xs', i % 2 ? 'bg-base' : 'bg-card')}>
                        <Icon size={12} className="shrink-0 text-text-muted" />
                        <span className="text-text-muted w-20 shrink-0">{f.label}</span>
                        {isUrl ? (
                          <a href={val.startsWith('http') ? val : `https://${val}`} target="_blank" rel="noopener noreferrer"
                             className="text-accent-blue hover:underline truncate">{val}</a>
                        ) : (
                          <span className="text-text-secondary break-words">{val}</span>
                        )}
                      </div>
                    )
                  })}
                  {Object.entries(todo.details.customFields).map(([k, v], i) => (
                    <div key={k} className={clsx('flex items-center gap-2 px-3 py-1.5 text-xs', (DETAIL_FIELDS.filter(f => todo.details[f.key]).length + i) % 2 ? 'bg-base' : 'bg-card')}>
                      <Tag size={12} className="shrink-0 text-text-muted" />
                      <span className="text-text-muted w-20 shrink-0 truncate" title={k}>{k}</span>
                      <span className="text-text-secondary break-words">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {todo.notes && (
              <div>
                <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Notes</p>
                <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{todo.notes}</p>
              </div>
            )}

            {todo.rawInput && todo.rawInput !== todo.title && (
              <div>
                <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Original input</p>
                <p className="text-[11px] text-text-muted leading-relaxed whitespace-pre-wrap font-mono break-words">{todo.rawInput}</p>
              </div>
            )}
          </>
        )}

        {/* Calendar sync — opt-in per task; only enable-able once a date exists */}
        {(() => {
          const canSync = Boolean(todo.details?.date || todo.dueDate)
          const enabled = Boolean(todo.calendarSyncEnabled)
          const st      = todo.calendarSyncStatus
          return (
            <div className="rounded-lg border border-border bg-base/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                  {enabled && st === 'synced'
                    ? <CalendarCheck size={13} className="text-emerald-400" />
                    : <CalendarDays size={13} className="text-accent-blue" />}
                  Google Calendar
                </span>
                <button
                  role="switch" aria-checked={enabled}
                  onClick={() => onSave(todo, { calendarSyncEnabled: !enabled })}
                  disabled={!enabled && !canSync}
                  title={!canSync && !enabled ? 'Add a date to enable calendar sync' : enabled ? 'Stop syncing' : 'Sync to calendar'}
                  className={clsx('relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-40',
                    enabled ? 'bg-emerald-500/70' : 'bg-card border border-border')}
                >
                  <span className={clsx('absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform', enabled && 'translate-x-4')} />
                </button>
              </div>
              <p className={clsx('text-[11px] mt-2 leading-snug',
                st === 'error' ? 'text-red-400' : st === 'synced' ? 'text-emerald-400/90' : 'text-text-muted')}>
                {!enabled
                  ? (canSync ? 'Off — turn on to add this task to your Google Calendar.' : 'Add a date or due date to enable calendar sync.')
                  : st === 'pending' ? 'Syncing to Google Calendar…'
                  : st === 'synced'  ? `On your calendar${todo.lastCalendarSyncAt ? ` · synced ${fmtAgo(todo.lastCalendarSyncAt)}` : ''}.`
                  : st === 'error'   ? friendlyError(todo.calendarSyncError, 'Google Calendar')
                  : 'Will sync when you save a date.'}
              </p>
            </div>
          )
        })()}

        {/* Research section */}
        <div className="rounded-lg border border-violet-900/30 bg-violet-950/15 p-3">
          {r.status === 'pending' ? (
            <div className="flex items-center gap-2 text-xs text-violet-200">
              <Loader2 size={13} className="animate-spin text-violet-400" />
              Agent is researching… (~1–2 min)
            </div>
          ) : r.status === 'done' ? (
            <div className="animate-rise-in flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-violet-200">
                  <Sparkles size={13} className="text-violet-400" /> Research
                </span>
                <div className="flex items-center gap-2">
                  <AgentSourcePicker value={source} onChange={setSource} />
                  <button onClick={() => setRefining(v => !v)} className="text-[10px] text-violet-400/70 hover:text-violet-300">
                    {refining ? 'close' : 're-run'}
                  </button>
                </div>
              </div>
              {refining && (
                <RefineBox
                  value={guidance}
                  onChange={setGuidance}
                  onRun={runResearch}
                  onCancel={() => { setRefining(false); setGuidance('') }}
                  placeholder="What should the agent do differently? e.g. focus on free options, official sources only, NWA-local results…"
                />
              )}
              {r.guidance && (
                <p className="text-[10px] text-violet-300/70 italic leading-snug">Refined with: “{r.guidance}”</p>
              )}
              {r.summary && (
                <p className="text-xs text-text-secondary leading-relaxed">{r.summary}</p>
              )}
              {r.steps && r.steps.length > 0 && (
                <div>
                  <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Suggested steps</p>
                  <ol className="list-decimal list-inside flex flex-col gap-0.5 text-xs text-text-secondary">
                    {r.steps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}
              {r.links && r.links.length > 0 && (
                <div>
                  <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Links</p>
                  <div className="flex flex-col gap-1">
                    {r.links.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                         className="flex items-center gap-1.5 text-xs text-accent-blue hover:underline w-fit">
                        <ExternalLink size={11} className="shrink-0" />
                        {l.title || l.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {r.data && Object.keys(r.data).length > 0 && (
                <div>
                  <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Key facts</p>
                  <div className="flex flex-col rounded-lg border border-border overflow-hidden">
                    {Object.entries(r.data).map(([k, v], i) => (
                      <div key={k} className={clsx('flex gap-2 px-3 py-1.5 text-xxs', i % 2 ? 'bg-base' : 'bg-card')}>
                        <span className="text-text-muted w-28 shrink-0">{k}</span>
                        <span className="text-text-secondary break-words">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : refining ? (
            <RefineBox
              value={guidance}
              onChange={setGuidance}
              onRun={runResearch}
              onCancel={() => { setRefining(false); setGuidance('') }}
              placeholder="What should the agent do differently? e.g. focus on free options, official sources only, NWA-local results…"
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              <button onClick={() => onResearch(todo, source)} className="flex items-center gap-2 text-xs text-violet-200 hover:text-violet-100 w-full text-left">
                <Sparkles size={13} className="text-violet-400 shrink-0" />
                {r.status === 'failed' ? 'Research failed — click to retry' : 'Ask an agent to research this task'}
              </button>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted">via</span>
                  <AgentSourcePicker value={source} onChange={setSource} />
                </div>
                <button onClick={() => setRefining(true)} className="text-[10px] text-violet-400/70 hover:text-violet-300">
                  {r.status === 'failed' ? 'refine & retry' : 'add guidance'}
                </button>
              </div>
            </div>
          )}
          {r.status === 'failed' && r.error && (
            <p className="text-[10px] text-red-400 mt-1.5">{r.error}</p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          {!editing && (
            <button onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary text-xs">
              <Pencil size={12} /> Edit
            </button>
          )}
          <button onClick={() => onDelete(todo)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-900/40 bg-red-950/20 text-red-400 hover:bg-red-950/40 text-xs">
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
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
  const [showDetails, setShowDetails]   = useState(false)
  const [quickDetails, setQuickDetails] = useState<TodoDetails>(emptyDetails())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null) }
    try { setTodos((await fetchTodos()).todos) }
    catch (e: any) { if (!silent) setError(e.message) }
    finally { if (!silent) setLoading(false) }
  }, [])

  const anyPending = todos.some(t => t.research?.status === 'pending')
  useEffect(() => { load() }, [load])
  useEffect(() => {
    pollRef.current = setInterval(() => { if (!isRefreshPaused()) load(true) }, anyPending ? 5_000 : 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load, anyPending])

  async function handleAdd() {
    const parsed = parseQuickAdd(title, { severity, horizon })
    if (!parsed.title || adding) return
    setAdding(true); setError(null)
    // If the user opened details but left fields blank, fall back to auto-detect
    // from the typed text so pasted appointments still capture structure.
    const details = hasAnyDetail(quickDetails)
      ? quickDetails
      : withDetails(parseDetails(title))
    try {
      const r = await createTodo({
        ...parsed,
        details,
        rawInput: title.trim(),
      })
      setTodos(ts => [r.todo, ...ts])
      setTitle('')
      setQuickDetails(emptyDetails())
      setShowDetails(false)
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
      setSelectedId(null)
    } catch (e: any) { setError(e.message) }
  }

  async function handleClearDone() {
    const n = todos.filter(t => t.done).length
    if (!n || !confirm(`Remove ${n} completed to-do${n > 1 ? 's' : ''}?`)) return
    setClearing(true)
    try {
      await clearDone()
      setTodos(ts => ts.filter(t => !t.done))
      setSelectedId(null)
    } catch (e: any) { setError(e.message) }
    finally { setClearing(false) }
  }

  async function handleResearch(todo: Todo, source: ResearchSource, guidance?: string) {
    try {
      const r = await startResearch(todo.id, source, guidance)
      setTodos(ts => ts.map(t => t.id === todo.id ? r.todo : t))
    } catch (e: any) { setError(e.message) }
  }

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

  const selected = todos.find(t => t.id === selectedId) ?? null

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* ── Main column ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 lg:px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <ListTodo size={18} className="text-emerald-400" />
            <h1 className="text-base font-semibold text-text-primary">To-Do</h1>
            {openCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 tabular-nums">
                {openCount} open
              </span>
            )}
          </div>
          <button onClick={() => load()} disabled={loading}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-card hover:bg-card-hover border border-border rounded text-text-secondary transition-colors disabled:opacity-50">
            <RefreshCw size={11} className={clsx(loading && 'animate-spin')} /> Refresh
          </button>
        </div>

        {/* Quick add + filters */}
        <div className="shrink-0 px-4 lg:px-6 py-3 border-b border-border space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <p className="text-xs leading-snug">{friendlyError(error, 'the to-do API')}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder='Add a to-do… ("renew passport tomorrow !high @long")'
              className="flex-1 min-w-0 bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border"
            />
            <select value={severity} onChange={e => setSeverity(e.target.value as Severity)}
                    className="bg-base border border-border rounded-lg px-2 py-2 text-xs text-text-secondary focus:outline-none" title="Severity">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <select value={horizon} onChange={e => setHorizon(e.target.value as Horizon)}
                    className="bg-base border border-border rounded-lg px-2 py-2 text-xs text-text-secondary focus:outline-none" title="Time horizon">
              <option value="short">Short</option>
              <option value="long">Long</option>
            </select>
            <button onClick={handleAdd} disabled={!title.trim() || adding}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg text-emerald-400 transition-colors disabled:opacity-40">
              {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
            </button>
          </div>

          {/* Additional details toggle — keeps simple tasks simple */}
          <div className="flex items-center gap-2 -mt-1">
            <button onClick={() => setShowDetails(v => !v)}
                    className={clsx(
                      'flex items-center gap-1 text-[11px] transition-colors',
                      showDetails ? 'text-text-secondary' : 'text-text-muted hover:text-text-secondary',
                    )}>
              <ChevronDown size={12} className={clsx('transition-transform', showDetails && 'rotate-180')} />
              {showDetails ? 'Additional details' : '+ Additional details'}
              {hasAnyDetail(quickDetails) && !showDetails && (
                <span className="ml-1 px-1 rounded bg-accent-blue/15 text-accent-blue tabular-nums">
                  {DETAIL_FIELDS.filter(f => quickDetails[f.key]).length + Object.keys(quickDetails.customFields).length}
                </span>
              )}
            </button>
            {!showDetails && title.trim() && looksDetailRich(title) && !hasAnyDetail(quickDetails) && (
              <button onClick={() => setShowDetails(true)}
                      className="flex items-center gap-1 text-[11px] text-violet-300/80 hover:text-violet-200">
                <Wand2 size={11} /> details found in text
              </button>
            )}
          </div>

          {showDetails && (
            <div className="animate-rise-in rounded-lg border border-border bg-base/40 p-3">
              <DetailsForm value={quickDetails} onChange={setQuickDetails} parseSource={title} />
            </div>
          )}

          <div className="flex items-center gap-1">
            {(['open', 'short', 'long', 'done'] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                      className={clsx(
                        'px-2.5 py-1 rounded text-xs transition-colors',
                        filter === f ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-card',
                      )}>
                {f === 'short' ? 'Short term' : f === 'long' ? 'Long term' : f.charAt(0).toUpperCase() + f.slice(1)}
                <span className="ml-1.5 tabular-nums opacity-60">{counts[f]}</span>
              </button>
            ))}
            {filter === 'done' && counts.done > 0 && (
              <button onClick={handleClearDone} disabled={clearing}
                      className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-red-400 hover:bg-card transition-colors disabled:opacity-50">
                {clearing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Clear completed
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-text-muted">
              <ListTodo size={22} className="opacity-30" />
              <p className="text-xs">{filter === 'done' ? 'Nothing completed yet.' : 'Nothing here — add a to-do above.'}</p>
              {filter !== 'done' && (
                <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-xs">
                  <span className="text-[10px] text-text-muted/70">Try tokens:</span>
                  {['!high', '@long', 'tomorrow'].map(t => (
                    <code key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-base text-text-secondary font-mono">{t}</code>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {visible.map(t => (
                <TodoRow
                  key={t.id}
                  todo={t}
                  active={t.id === selectedId}
                  onToggle={handleToggle}
                  onClick={() => setSelectedId(prev => prev === t.id ? null : t.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail drawer ── (overlay on narrow widths, side panel when wide) */}
      {selected && (
        <>
          <div
            onClick={() => setSelectedId(null)}
            className="absolute inset-0 z-20 bg-black/40 lg:hidden"
            aria-hidden
          />
          <TodoDrawer
            todo={selected}
            onClose={() => setSelectedId(null)}
            onToggle={handleToggle}
            onSave={handleSave}
            onDelete={handleDelete}
            onResearch={handleResearch}
          />
        </>
      )}
    </div>
  )
}
