import { useState, useEffect, useCallback, useRef } from 'react'
import { DATA_REFRESH_EVENT, type DataRefreshDetail } from '../lib/dataRefresh'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import {
  Check, X, AlertCircle, GitMerge, Send, ShoppingCart, Zap, Upload,
  Clock, RefreshCw, Loader, Plus, ChevronDown, Trash2, MessageSquare,
  Terminal, FileDiff, Copy, CheckCheck,
} from 'lucide-react'
import { approvals as approvalsApi } from '../lib/api'
import type { LiveApproval, ApprovalStatus, ApprovalType, ApprovalUrgency, ApprovalCreateBody } from '../lib/api'
import {
  APPROVAL_FOCUS_EVENT, APPROVAL_FOCUS_STORAGE_KEY, clearStoredValue, readStoredValue,
} from '../lib/quickActions'
import { isRefreshPaused } from '../lib/refreshBus'

// ─── Config ───────────────────────────────────────────────────────────────────

const typeConfig: Record<ApprovalType, { label: string; icon: React.ReactNode; badge: string }> = {
  publish:  { label: 'Publish',  icon: <Upload       size={11} />, badge: 'bg-green-950/50  border-green-900/50  text-green-400'  },
  send:     { label: 'Send',     icon: <Send         size={11} />, badge: 'bg-blue-950/50   border-blue-900/50   text-blue-400'   },
  merge:    { label: 'Merge',    icon: <GitMerge     size={11} />, badge: 'bg-violet-950/50 border-violet-900/50 text-violet-400' },
  purchase: { label: 'Purchase', icon: <ShoppingCart size={11} />, badge: 'bg-amber-950/50  border-amber-900/50  text-amber-400'  },
  action:   { label: 'Action',   icon: <Zap          size={11} />, badge: 'bg-teal-950/50   border-teal-900/50   text-teal-400'   },
  deploy:   { label: 'Deploy',   icon: <Upload       size={11} />, badge: 'bg-indigo-950/50 border-indigo-900/50 text-indigo-400' },
}

const urgencyConfig: Record<ApprovalUrgency, { dot: string; label: string }> = {
  urgent: { dot: 'bg-red-500 animate-pulse', label: 'Urgent' },
  normal: { dot: 'bg-amber-400',             label: 'Normal' },
  low:    { dot: 'bg-slate-500',             label: 'Low'    },
}

const statusConfig: Record<ApprovalStatus, { label: string; badge: string }> = {
  pending:  { label: 'Pending',  badge: 'bg-card border-border text-text-muted'                    },
  approved: { label: 'Approved', badge: 'bg-green-950/50 border-green-900/50 text-green-400'       },
  rejected: { label: 'Rejected', badge: 'bg-red-950/50   border-red-900/50   text-red-400'         },
}

function agentColor(name: string): string {
  const palette = [
    'from-violet-500 to-indigo-600',
    'from-teal-500   to-cyan-600',
    'from-blue-500   to-sky-600',
    'from-emerald-500 to-green-600',
    'from-amber-500  to-orange-600',
    'from-rose-500   to-pink-600',
  ]
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return palette[h % palette.length]
}

// ─── Note modal ───────────────────────────────────────────────────────────────

interface NoteModalProps {
  action:  'approve' | 'reject'
  onClose: () => void
  onConfirm: (note: string) => void
  loading: boolean
}

function NoteModal({ action, onClose, onConfirm, loading }: NoteModalProps) {
  useEscapeKey(onClose)
  const [note, setNote] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-[100dvh] w-full max-w-none flex-col overflow-y-auto rounded-none border border-border bg-card shadow-2xl safe-top safe-bottom sm:h-auto sm:max-w-md sm:rounded-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className={clsx('text-sm font-semibold', action === 'approve' ? 'text-green-400' : 'text-red-400')}>
            {action === 'approve' ? 'Approve Request' : 'Reject Request'}
          </h2>
          <button aria-label="Close" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted hover:bg-card-hover hover:text-text-secondary sm:min-h-0 sm:min-w-0"><X size={16} /></button>
        </div>
        <div className="flex-1 p-5">
          <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">
            Note <span className="normal-case font-normal">(optional)</span>
          </label>
          <textarea
            ref={ref}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add a note…"
            rows={3}
            className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors resize-none"
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) onConfirm(note) }}
          />
        </div>
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card px-5 py-4 safe-bottom">
          <button onClick={onClose} className="min-h-11 px-4 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
          <button
            onClick={() => onConfirm(note)}
            disabled={loading}
            className={clsx(
              'flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-40',
              action === 'approve' ? 'bg-green-700 hover:bg-green-600' : 'bg-red-700 hover:bg-red-600',
            )}
          >
            {loading ? <Loader size={12} className="animate-spin" /> : action === 'approve' ? <Check size={12} /> : <X size={12} />}
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── New Request Modal ────────────────────────────────────────────────────────

interface NewRequestModalProps {
  onClose: () => void
  onSave:  (body: ApprovalCreateBody) => Promise<void>
}

function NewRequestModal({ onClose, onSave }: NewRequestModalProps) {
  useEscapeKey(onClose)
  const [type, setType]       = useState<ApprovalType>('action')
  const [urgency, setUrgency] = useState<ApprovalUrgency>('normal')
  const [title, setTitle]     = useState('')
  const [desc, setDesc]       = useState('')
  const [payload, setPayload] = useState('')
  const [agent, setAgent]     = useState('')
  const [project, setProject] = useState('')
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async () => {
    if (!title.trim()) { setErr('Title is required'); return }
    setSaving(true)
    try {
      await onSave({ type, urgency, title: title.trim(), description: desc, payload, agentName: agent || undefined, project: project || undefined })
      onClose()
    } catch (e: any) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-[100dvh] w-full max-w-none flex-col overflow-y-auto rounded-none border border-border bg-card shadow-2xl safe-top safe-bottom sm:h-auto sm:max-w-lg sm:rounded-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New Approval Request</h2>
          <button aria-label="Close" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted hover:bg-card-hover hover:text-text-secondary sm:min-h-0 sm:min-w-0"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-1 flex-col gap-4 overflow-y-auto">
          {/* Type + Urgency */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Type</label>
              <div className="relative">
                <select value={type} onChange={e => setType(e.target.value as ApprovalType)}
                  className="w-full min-h-11 appearance-none px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary focus:outline-none focus:border-blue-500/60 transition-colors pr-8">
                  {(Object.keys(typeConfig) as ApprovalType[]).map(t => (
                    <option key={t} value={t}>{typeConfig[t].label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Urgency</label>
              <div className="flex gap-1.5">
                {(['urgent', 'normal', 'low'] as ApprovalUrgency[]).map(u => (
                  <button key={u} onClick={() => setUrgency(u)}
                    className={clsx('min-h-11 flex-1 py-1.5 rounded border text-xxs font-semibold capitalize transition-all sm:min-h-0',
                      urgency === u
                        ? u === 'urgent' ? 'border-red-900/50 bg-red-950/40 text-red-400'
                          : u === 'normal' ? 'border-amber-900/50 bg-amber-950/40 text-amber-400'
                          : 'border-border bg-card-hover text-text-secondary'
                        : 'border-border text-text-muted hover:text-text-secondary')}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Title</label>
            <input ref={inputRef} value={title} onChange={e => { setTitle(e.target.value); setErr('') }}
              placeholder="What needs approval?"
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors" />
            {err && <p className="text-xxs text-red-400 mt-1">{err}</p>}
          </div>

          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Description</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Context and reasoning…" rows={2}
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors resize-none" />
          </div>

          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Payload / Detail</label>
            <textarea value={payload} onChange={e => setPayload(e.target.value)} placeholder="Command, diff, content, or raw data…" rows={3}
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors resize-none font-mono" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Agent</label>
              <input value={agent} onChange={e => setAgent(e.target.value)} placeholder="Agent name…"
                className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors" />
            </div>
            <div>
              <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Project</label>
              <input value={project} onChange={e => setProject(e.target.value)} placeholder="Project name…"
                className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors" />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card px-5 py-4 safe-bottom">
          <button onClick={onClose} className="min-h-11 px-4 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
          <button onClick={submit} disabled={saving || !title.trim()}
            className="flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors">
            {saving ? <Loader size={12} className="animate-spin" /> : <Plus size={12} />}
            Submit Request
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Command / diff block (syntax-highlighted payload) ──────────────────────────
// Destructive requests carry the exact shell command or file diff in `payload`.
// Render it as a real terminal/diff block so it's scannable before approving.

type PayloadKind = 'diff' | 'shell' | 'text'

function detectPayloadKind(payload: string): PayloadKind {
  const lines = payload.split('\n')
  const diffSignals = lines.filter(l => /^(diff --git |@@ |\+\+\+ |--- |index [0-9a-f])/.test(l)).length
  if (diffSignals > 0 || (lines.length > 1 && lines.filter(l => /^[+-]/.test(l)).length >= 2)) return 'diff'
  // Short, command-shaped payloads: starts with $ or a common executable.
  const firstReal = lines.map(l => l.trim()).find(Boolean) ?? ''
  if (/^\$\s/.test(firstReal) || /^(sudo |rm |cp |mv |mkdir |chmod |chown |git |npm |npx |pnpm |yarn |node |python3? |pip |docker |kubectl |curl |wget |ssh |scp |cat |echo |bash |sh |make |cargo |go )/.test(firstReal)) return 'shell'
  return 'text'
}

const SHELL_KEYWORDS = /\b(sudo|rm|cp|mv|mkdir|rmdir|chmod|chown|git|npm|npx|pnpm|yarn|node|python3?|pip|docker|kubectl|curl|wget|ssh|scp|cat|echo|bash|sh|make|cargo|go|tar|gzip|find|grep|sed|awk|kill|systemctl|service)\b/g

function highlightShell(line: string, i: number) {
  const stripped = line.replace(/^\$\s?/, '')
  // Split on flags and keywords, keeping a simple, dependency-free highlighter.
  const parts = stripped.split(/(\s+)/).map((tok, j) => {
    if (/^-{1,2}[\w-]+/.test(tok)) return <span key={j} className="text-amber-300">{tok}</span>
    if (SHELL_KEYWORDS.test(tok)) { SHELL_KEYWORDS.lastIndex = 0; return <span key={j} className="text-emerald-300 font-semibold">{tok}</span> }
    return <span key={j}>{tok}</span>
  })
  return (
    <div key={i} className="flex gap-2">
      <span className="text-text-muted select-none shrink-0">$</span>
      <span className="break-all">{parts}</span>
    </div>
  )
}

function diffLineClass(line: string): string {
  if (/^\+\+\+|^---/.test(line)) return 'text-text-muted'
  if (/^@@/.test(line)) return 'text-cyan-300'
  if (/^diff --git|^index /.test(line)) return 'text-violet-300'
  if (/^\+/.test(line)) return 'text-emerald-300 bg-emerald-950/30'
  if (/^-/.test(line)) return 'text-red-300 bg-red-950/30'
  return 'text-text-muted'
}

function CommandBlock({ payload }: { payload: string }) {
  const [copied, setCopied] = useState(false)
  const kind = detectPayloadKind(payload)
  const lines = payload.replace(/\n$/, '').split('\n')

  const copy = async () => {
    try { await navigator.clipboard.writeText(payload); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  const label = kind === 'diff' ? 'File diff' : kind === 'shell' ? 'Shell command' : 'Payload'
  const icon  = kind === 'diff' ? <FileDiff size={11} /> : kind === 'shell' ? <Terminal size={11} /> : <MessageSquare size={11} />

  return (
    <div className="rounded-lg border border-border-subtle bg-base overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-subtle bg-surface/60">
        <span className={clsx('flex items-center gap-1 text-xxs font-medium', kind === 'diff' ? 'text-violet-300' : kind === 'shell' ? 'text-emerald-300' : 'text-text-muted')}>
          {icon}{label}
        </span>
        <button onClick={copy} className="ml-auto flex items-center gap-1 text-xxs text-text-muted hover:text-text-secondary transition-colors">
          {copied ? <><CheckCheck size={10} className="text-green-400" />copied</> : <><Copy size={10} />copy</>}
        </button>
      </div>
      <div className="px-3 py-2 overflow-x-auto">
        <pre className="text-xxs font-mono leading-relaxed whitespace-pre-wrap break-all">
          {kind === 'shell'
            ? lines.map((l, i) => highlightShell(l, i))
            : kind === 'diff'
              ? lines.map((l, i) => <div key={i} className={clsx('px-1 -mx-1 rounded-sm', diffLineClass(l))}>{l || ' '}</div>)
              : <span className="text-text-muted">{payload}</span>}
        </pre>
      </div>
    </div>
  )
}

// ─── Approval Card ────────────────────────────────────────────────────────────

interface CardAction { id: string; action: 'approve' | 'reject' }

function ApprovalCard({
  item,
  highlighted,
  onAction,
  onDelete,
  acting,
}: {
  item:     LiveApproval
  highlighted: boolean
  onAction: (a: CardAction) => void
  onDelete: (id: string) => void
  acting:   string | null
}) {
  const type      = typeConfig[item.type]
  const urgency   = urgencyConfig[item.urgency]
  const status    = statusConfig[item.status]
  const isPending = item.status === 'pending'
  const isActing  = acting === item.id

  return (
    <div className={clsx(
      'group flex flex-col gap-3.5 p-4 rounded-lg border transition-all',
      isPending ? 'bg-card border-border' : 'bg-surface/60 border-border opacity-60 hover:opacity-80',
      highlighted && 'ring-1 ring-blue-500/60 bg-card-hover opacity-100',
      isActing && 'opacity-50 pointer-events-none',
    )}
    data-approval-id={item.id}>
      {/* Header row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', type.badge)}>
            {type.icon}{type.label}
          </span>
          {isPending ? (
            <span className="flex items-center gap-1 text-xxs text-text-muted">
              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', urgency.dot)} />
              {urgency.label}
            </span>
          ) : (
            <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', status.badge)}>
              {item.status === 'approved' ? <Check size={9} /> : <X size={9} />}
              {status.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-text-muted">
            <Clock size={9} />
            <span className="text-xxs">{item.createdAgo}</span>
          </div>
          {!isPending && (
            <button
              onClick={() => onDelete(item.id)}
              className="flex min-h-11 min-w-11 items-center justify-center text-text-muted opacity-100 transition-all hover:text-red-400 md:min-h-0 md:min-w-0 md:opacity-0 md:group-hover:opacity-100"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Title + description */}
      <div>
        <p className="text-xs font-semibold text-text-primary mb-1">{item.title}</p>
        {item.description && (
          <p className="text-xxs text-text-secondary leading-relaxed">{item.description}</p>
        )}
      </div>

      {/* Payload — syntax-highlighted shell command / file diff */}
      {item.payload && <CommandBlock payload={item.payload} />}

      {/* Resolution note */}
      {item.note && (
        <div className="flex items-start gap-2 px-3 py-2 rounded border border-border-subtle bg-surface/40">
          <MessageSquare size={11} className="text-text-muted shrink-0 mt-0.5" />
          <p className="text-xxs text-text-secondary leading-relaxed">{item.note}</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className={clsx('w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-white text-xxs font-bold bg-gradient-to-br', agentColor(item.agentName))}>
            {item.agentName.charAt(0).toUpperCase()}
          </div>
          <span className="text-xxs text-text-muted truncate">
            {item.agentName}{item.project ? ` · ${item.project}` : ''}
          </span>
        </div>

        {isPending && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => onAction({ id: item.id, action: 'reject' })}
              className="flex min-h-11 items-center gap-1 px-2.5 py-1.5 rounded border border-red-900/40 bg-red-950/30 text-red-400 hover:bg-red-950/50 transition-colors text-xs font-medium sm:min-h-0"
            >
              <X size={11} />Reject
            </button>
            <button
              onClick={() => onAction({ id: item.id, action: 'approve' })}
              className="flex min-h-11 items-center gap-1 px-2.5 py-1.5 rounded border border-green-900/40 bg-green-950/30 text-green-400 hover:bg-green-950/50 transition-colors text-xs font-medium sm:min-h-0"
            >
              <Check size={11} />Approve
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-3.5 p-4 rounded-lg border border-border bg-card animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-5 w-16 rounded bg-base" />
        <div className="h-3 w-10 rounded bg-base" />
      </div>
      <div className="space-y-1.5">
        <div className="h-3 w-3/4 rounded bg-base" />
        <div className="h-2.5 w-full rounded bg-base" />
        <div className="h-2.5 w-2/3 rounded bg-base" />
      </div>
      <div className="h-12 rounded bg-base" />
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 rounded bg-base" />
        <div className="flex gap-2">
          <div className="h-7 w-16 rounded bg-base" />
          <div className="h-7 w-18 rounded bg-base" />
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Approvals() {
  const [data, setData]           = useState<LiveApproval[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [acting, setActing]       = useState<string | null>(null)
  const [noteTarget, setNoteTarget] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const [focusedApprovalId, setFocusedApprovalId] = useState<string | null>(() => readStoredValue(APPROVAL_FOCUS_STORAGE_KEY))

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await approvalsApi.list()
      setData(res.approvals)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const handler = (e: Event) => {
      const { domain } = (e as CustomEvent<DataRefreshDetail>).detail
      if (domain === 'approvals') load(true)
    }
    window.addEventListener(DATA_REFRESH_EVENT, handler)
    return () => window.removeEventListener(DATA_REFRESH_EVENT, handler)
  }, [load])

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ approvalId?: string }>
      if (custom.detail?.approvalId) setFocusedApprovalId(custom.detail.approvalId)
    }
    window.addEventListener(APPROVAL_FOCUS_EVENT, handler as EventListener)
    return () => window.removeEventListener(APPROVAL_FOCUS_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    if (!focusedApprovalId) return
    const match = data.find(entry => entry.id === focusedApprovalId)
    if (!match) {
      if (!loading) {
        clearStoredValue(APPROVAL_FOCUS_STORAGE_KEY)
        setFocusedApprovalId(null)
      }
      return
    }

    clearStoredValue(APPROVAL_FOCUS_STORAGE_KEY)
    if (match.status !== 'pending') setShowResolved(true)
  }, [data, focusedApprovalId, loading])

  useEffect(() => {
    if (!focusedApprovalId) return
    const frame = window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-approval-id="${focusedApprovalId}"]`)
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const timer = window.setTimeout(() => setFocusedApprovalId(current => current === focusedApprovalId ? null : current), 2600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusedApprovalId, showResolved, data])

  // Poll every 15s to pick up new requests submitted by agents
  useEffect(() => {
    const t = setInterval(() => { if (!isRefreshPaused()) load(true) }, 15_000)
    return () => clearInterval(t)
  }, [load])

  const handleAction = ({ id, action }: { id: string; action: 'approve' | 'reject' }) => {
    setNoteTarget({ id, action })
  }

  const confirmAction = async (note: string) => {
    if (!noteTarget) return
    const { id, action } = noteTarget
    setActing(id)
    setNoteTarget(null)
    try {
      const res = action === 'approve'
        ? await approvalsApi.approve(id, note || undefined)
        : await approvalsApi.reject(id, note || undefined)
      setData(prev => prev.map(a => a.id === id ? res.approval : a))
    } catch {
      load(true)
    } finally {
      setActing(null)
    }
  }

  const handleCreate = async (body: ApprovalCreateBody) => {
    const res = await approvalsApi.create(body)
    setData(prev => [res.approval, ...prev])
  }

  const handleDelete = async (id: string) => {
    setData(prev => prev.filter(a => a.id !== id))
    try { await approvalsApi.remove(id) } catch { load(true) }
  }

  const pending  = data.filter(a => a.status === 'pending')
  const resolved = data.filter(a => a.status !== 'pending')
  const urgentCount = pending.filter(a => a.urgency === 'urgent').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border px-4 pt-5 pb-4 shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Approvals</h1>
          {loading ? (
            <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
              <Loader size={11} className="animate-spin" />Loading…
            </p>
          ) : error ? (
            <p className="text-xs text-red-400 mt-0.5">{error}</p>
          ) : pending.length > 0 ? (
            <p className="text-xs text-text-muted mt-0.5">
              <span className="text-amber-400">{pending.length} waiting for review</span>
              {urgentCount > 0 && <>&nbsp;·&nbsp;<span className="text-red-400">{urgentCount} urgent</span></>}
            </p>
          ) : (
            <p className="text-xs text-green-400 mt-0.5">All clear — nothing pending</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {resolved.length > 0 && (
            <button
              onClick={() => setShowResolved(v => !v)}
              className="min-h-11 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-muted hover:text-text-secondary transition-colors text-xs sm:min-h-0"
            >
              {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
            </button>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex min-h-11 items-center gap-1.5 px-2.5 py-1.5 rounded border border-border text-xs text-text-muted hover:text-text-secondary hover:bg-card transition-colors disabled:opacity-40 sm:min-h-0"
          >
            {loading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium sm:min-h-0"
          >
            <Plus size={13} />New Request
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-6 sm:px-6">
        {loading ? (
          <div className="flex flex-col gap-3">
            {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <AlertCircle size={32} className="text-red-400/60" />
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => load()} className="px-3 py-1.5 rounded border border-border text-xs text-text-secondary hover:bg-card transition-colors">Retry</button>
          </div>
        ) : (
          <>
            {/* Pending */}
            {pending.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle size={12} className="text-amber-400" />
                  <span className="text-xxs font-semibold uppercase tracking-wider text-text-muted">
                    Awaiting Your Decision
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {[...pending]
                    .sort((a, b) => {
                      const o: Record<ApprovalUrgency, number> = { urgent: 0, normal: 1, low: 2 }
                      return o[a.urgency] - o[b.urgency]
                    })
                    .map(item => (
                      <ApprovalCard key={item.id} item={item} highlighted={item.id === focusedApprovalId} onAction={handleAction} onDelete={handleDelete} acting={acting} />
                    ))}
                </div>
              </div>
            )}

            {/* Empty pending */}
            {pending.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-card border border-border">
                  <Check size={20} className="text-green-400" />
                </div>
                <p className="text-sm font-medium text-text-secondary">Nothing to review</p>
                <p className="text-xs text-text-muted">Your agents are operating autonomously. Check back later.</p>
              </div>
            )}

            {/* Resolved */}
            {showResolved && resolved.length > 0 && (
              <div>
                <span className="text-xxs font-semibold uppercase tracking-wider text-text-muted block mb-3">Resolved</span>
                <div className="flex flex-col gap-3">
                  {resolved.map(item => (
                    <ApprovalCard key={item.id} item={item} highlighted={item.id === focusedApprovalId} onAction={handleAction} onDelete={handleDelete} acting={acting} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Note modal */}
      {noteTarget && (
        <NoteModal
          action={noteTarget.action}
          onClose={() => setNoteTarget(null)}
          onConfirm={confirmAction}
          loading={acting === noteTarget.id}
        />
      )}

      {/* New request modal */}
      {showModal && (
        <NewRequestModal onClose={() => setShowModal(false)} onSave={handleCreate} />
      )}
    </div>
  )
}
