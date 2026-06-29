import { useState, useEffect, useCallback, useRef } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import {
  Plus, MoreHorizontal, TrendingUp, Clock, User, Loader2,
  RefreshCw, AlertCircle, FolderOpen, X, Check, ChevronDown,
} from 'lucide-react'
import { projects as projectsApi } from '../lib/api'
import type { LiveProject, ProjectStatus, ProjectPriority, ProjectCreateBody } from '../lib/api'

// ─── Config ───────────────────────────────────────────────────────────────────

const statusConfig: Record<ProjectStatus, { label: string; dot: string; badge: string }> = {
  active:    { label: 'Active',    dot: 'bg-green-400',   badge: 'bg-green-950/60 border-green-900/50 text-green-400'  },
  planning:  { label: 'Planning',  dot: 'bg-amber-400',   badge: 'bg-amber-950/60 border-amber-900/50 text-amber-400'  },
  paused:    { label: 'Paused',    dot: 'bg-slate-500',   badge: 'bg-card border-border text-text-secondary'            },
  completed: { label: 'Completed', dot: 'bg-blue-400',    badge: 'bg-blue-950/60 border-blue-900/50 text-blue-400'     },
}

const priorityConfig: Record<ProjectPriority, { label: string; cls: string }> = {
  high:   { label: 'High',   cls: 'text-red-400   bg-red-950/40   border-red-900/40'   },
  medium: { label: 'Medium', cls: 'text-amber-400 bg-amber-950/40 border-amber-900/40' },
  low:    { label: 'Low',    cls: 'text-text-muted bg-card border-border'               },
}

const progressBarColor: Record<ProjectStatus, string> = {
  active:    'bg-green-500',
  planning:  'bg-amber-500',
  paused:    'bg-slate-500',
  completed: 'bg-blue-500',
}

type FilterTab = 'all' | ProjectStatus

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',       label: 'All'       },
  { id: 'active',    label: 'Active'    },
  { id: 'planning',  label: 'Planning'  },
  { id: 'paused',    label: 'Paused'    },
  { id: 'completed', label: 'Completed' },
]

function avatarColor(name: string): string {
  const palette = [
    'bg-violet-600',
    'bg-blue-600',
    'bg-emerald-600',
    'bg-rose-600',
    'bg-amber-600',
    'bg-sky-600',
    'bg-fuchsia-600',
  ]
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return palette[h % palette.length]
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

// ─── New Project Modal ────────────────────────────────────────────────────────

interface NewProjectModalProps {
  onClose: () => void
  onSave:  (body: ProjectCreateBody) => Promise<void>
}

function NewProjectModal({ onClose, onSave }: NewProjectModalProps) {
  useEscapeKey(onClose)
  const [name, setName]           = useState('')
  const [desc, setDesc]           = useState('')
  const [status, setStatus]       = useState<ProjectStatus>('planning')
  const [priority, setPriority]   = useState<ProjectPriority>('medium')
  const [assignee, setAssignee]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [err, setErr]             = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return }
    setSaving(true)
    try {
      await onSave({ name: name.trim(), description: desc, status, priority, assignee: assignee || undefined })
      onClose()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 " onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card " onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New Project</h2>
          <button aria-label="Close" onClick={onClose} className="text-text-muted hover:text-text-secondary"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Name</label>
            <input
              ref={inputRef}
              value={name}
              onChange={e => { setName(e.target.value); setErr('') }}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Project name…"
              className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
            />
            {err && <p className="text-xxs text-red-400 mt-1">{err}</p>}
          </div>

          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional description…"
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Status</label>
              <div className="relative">
                <select
                  value={status}
                  onChange={e => setStatus(e.target.value as ProjectStatus)}
                  className="w-full appearance-none px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary focus:outline-none focus:border-blue-500/60 transition-colors pr-8"
                >
                  {(['active', 'planning', 'paused', 'completed'] as ProjectStatus[]).map(s => (
                    <option key={s} value={s}>{statusConfig[s].label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Priority</label>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as ProjectPriority[]).map(p => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={clsx('flex-1 py-1.5 rounded border text-xxs font-semibold capitalize transition-all',
                      priority === p ? priorityConfig[p].cls : 'border-border text-text-muted hover:text-text-secondary')}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Assignee</label>
            <input
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              placeholder="Assignee name (default: Unassigned)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Project Card ─────────────────────────────────────────────────────────────

interface CardMenuProps { project: LiveProject; onStatusChange: (id: string, s: ProjectStatus) => void }

function CardMenu({ project, onStatusChange }: CardMenuProps) {
  const [open, setOpen] = useState(false)
  const statuses: ProjectStatus[] = ['active', 'planning', 'paused', 'completed']

  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        className="p-0.5 rounded hover:bg-border text-text-muted hover:text-text-secondary transition-colors"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-36 rounded-lg border border-border bg-card  overflow-hidden">
            <p className="px-3 py-1.5 text-xxs text-text-muted font-semibold uppercase tracking-wide border-b border-border">Set Status</p>
            {statuses.filter(s => s !== project.status).map(s => (
              <button
                key={s}
                onClick={() => { onStatusChange(project.id, s); setOpen(false) }}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-text-secondary hover:bg-card-hover transition-colors"
              >
                <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', statusConfig[s].dot)} />
                {statusConfig[s].label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  onStatusChange,
}: {
  project: LiveProject
  onStatusChange: (id: string, s: ProjectStatus) => void
}) {
  const st  = statusConfig[project.status]
  const pri = priorityConfig[project.priority]
  const bar = progressBarColor[project.status]
  const isUnassigned = !project.assignee || project.assignee === 'Unassigned'

  return (
    <div className="group flex flex-col bg-card border border-border rounded-lg p-4 hover:bg-card-hover transition-all duration-150 cursor-pointer">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={clsx('flex items-center justify-center w-7 h-7 rounded shrink-0 text-xs font-semibold text-white', avatarColor(project.name))}>
            {project.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-semibold text-text-primary truncate leading-tight">{project.name}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', st.badge)}>
            <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', st.dot, project.status === 'active' && 'animate-pulse')} />
            {st.label}
          </span>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <CardMenu project={project} onStatusChange={onStatusChange} />
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-text-secondary leading-relaxed line-clamp-2 mb-3 flex-1">
        {project.description || <span className="text-text-muted italic">No description</span>}
      </p>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1 text-text-muted">
            <TrendingUp size={10} />
            <span className="text-xxs">Progress</span>
          </div>
          <span className="text-xxs font-medium text-text-secondary tabular-nums">{project.progress}%</span>
        </div>
        <div className="h-1 w-full bg-border rounded-full overflow-hidden">
          <div
            className={clsx('h-full rounded-full transition-all', bar)}
            style={{ width: `${Math.max(project.progress > 0 ? 3 : 0, project.progress)}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-border-subtle">
        <div className="flex items-center gap-1.5 min-w-0">
          {isUnassigned ? (
            <div className="w-5 h-5 rounded-full border border-dashed border-border flex items-center justify-center">
              <User size={9} className="text-text-muted" />
            </div>
          ) : (
            <div className={clsx('w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-white text-xxs font-semibold', avatarColor(project.assignee))}>
              {project.assignee.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-xxs text-text-secondary truncate">{isUnassigned ? 'Unassigned' : project.assignee}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {project.sessionCount > 0 && (
            <span className="text-xxs text-text-muted tabular-nums">
              {project.sessionCount} session{project.sessionCount !== 1 ? 's' : ''}
            </span>
          )}
          {project.totalTokens > 0 && (
            <span className="text-xxs text-text-muted tabular-nums">{fmtTokens(project.totalTokens)} tok</span>
          )}
          <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium', pri.cls)}>{pri.label}</span>
          <div className="flex items-center gap-1 text-text-muted">
            <Clock size={9} />
            <span className="text-xxs">{project.updatedAgo}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="flex flex-col bg-card border border-border rounded-lg p-4 gap-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded bg-base shrink-0" />
        <div className="h-3.5 w-32 rounded bg-base" />
      </div>
      <div className="space-y-1.5">
        <div className="h-2.5 w-full rounded bg-base" />
        <div className="h-2.5 w-3/4 rounded bg-base" />
      </div>
      <div className="h-1 w-full rounded bg-base" />
      <div className="flex items-center justify-between pt-1 border-t border-border-subtle">
        <div className="h-2.5 w-16 rounded bg-base" />
        <div className="h-2.5 w-20 rounded bg-base" />
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Projects() {
  const [data, setData]       = useState<LiveProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [filter, setFilter]   = useState<FilterTab>('all')
  const [showModal, setShowModal] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await projectsApi.list()
      setData(res.projects)
      if (res.error && res.projects.length === 0) setError(res.error)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (body: ProjectCreateBody) => {
    const res = await projectsApi.create(body)
    setData(prev => [res.project, ...prev])
  }

  const handleStatusChange = async (id: string, status: ProjectStatus) => {
    setData(prev => prev.map(p => p.id === id ? { ...p, status } : p))
    try {
      const res = await projectsApi.update(id, { status })
      setData(prev => prev.map(p => p.id === id ? res.project : p))
    } catch {
      load(true)
    }
  }

  const counts: Record<FilterTab, number> = {
    all:       data.length,
    active:    data.filter(p => p.status === 'active').length,
    planning:  data.filter(p => p.status === 'planning').length,
    paused:    data.filter(p => p.status === 'paused').length,
    completed: data.filter(p => p.status === 'completed').length,
  }

  const filtered = filter === 'all' ? data : data.filter(p => p.status === filter)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Projects</h1>
          {loading ? (
            <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />Loading…
            </p>
          ) : error && data.length === 0 ? (
            <p className="text-xs text-text-muted mt-0.5">{error}</p>
          ) : (
            <p className="text-xs text-text-muted mt-0.5">
              <span className="text-text-secondary">{counts.all} total</span>
              &nbsp;·&nbsp;<span className="text-green-400">{counts.active} active</span>
              &nbsp;·&nbsp;<span className="text-amber-400">{counts.planning} planning</span>
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border text-xs text-text-muted hover:text-text-secondary hover:bg-card transition-colors disabled:opacity-40"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium"
          >
            <Plus size={13} />New Project
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      {!loading && data.length > 0 && (
        <div className="flex items-center gap-1 px-6 py-3 border-b border-border shrink-0">
          {TABS.map(tab => {
            const count = counts[tab.id]
            if (count === 0 && tab.id !== 'all') return null
            return (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all',
                  filter === tab.id ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-card',
                )}
              >
                {tab.label}
                <span className={clsx('text-xxs tabular-nums px-1 rounded', filter === tab.id ? 'text-text-secondary' : 'text-text-muted')}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error && data.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <AlertCircle size={32} className="text-red-400/60" />
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => load()} className="px-3 py-1.5 rounded border border-border text-xs text-text-secondary hover:bg-card transition-colors">
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <FolderOpen size={28} className="text-text-muted/40" />
            <p className="text-sm text-text-muted">
              {data.length === 0 ? 'No projects found' : 'No projects match this filter'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(p => (
              <ProjectCard key={p.id} project={p} onStatusChange={handleStatusChange} />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <NewProjectModal onClose={() => setShowModal(false)} onSave={handleCreate} />
      )}
    </div>
  )
}
