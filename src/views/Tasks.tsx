import { useState, useEffect, useCallback, useRef } from 'react'
import { DATA_REFRESH_EVENT, type DataRefreshDetail } from '../lib/dataRefresh'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import { Plus, Clock, AlertCircle, ChevronRight, Tag, Loader2, Trash2, X, Check } from 'lucide-react'
import { tasks as tasksApi } from '../lib/api'
import type { LiveTask, TaskStatus, TaskPriority } from '../lib/api'
import {
  clearStoredValue, readStoredValue, TASK_FOCUS_EVENT, TASK_FOCUS_STORAGE_KEY,
} from '../lib/quickActions'

// ─── Config ────────────────────────────────────────────────────────────────────

const priorityConfig: Record<TaskPriority, { label: string; dot: string; badge: string; order: number }> = {
  urgent: { label: 'Urgent', dot: 'bg-red-500',    badge: 'bg-red-950/50 border-red-900/50 text-red-400',       order: 0 },
  high:   { label: 'High',   dot: 'bg-amber-400',  badge: 'bg-amber-950/50 border-amber-900/50 text-amber-400', order: 1 },
  medium: { label: 'Medium', dot: 'bg-blue-400',   badge: 'bg-blue-950/40 border-blue-900/40 text-blue-400',    order: 2 },
  low:    { label: 'Low',    dot: 'bg-text-muted', badge: 'bg-card border-border text-text-muted',              order: 3 },
}

const statusConfig: Record<TaskStatus, { label: string; col: string; headerColor: string }> = {
  active:    { label: 'Active Missions',  col: 'border-blue-900/40',   headerColor: 'text-blue-400'  },
  queued:    { label: 'Queue',            col: 'border-border',        headerColor: 'text-text-muted' },
  blocked:   { label: 'Blocked',          col: 'border-red-900/40',    headerColor: 'text-red-400'   },
  completed: { label: 'Completed',        col: 'border-green-900/40',  headerColor: 'text-green-400' },
}

function agentColor(name?: string) {
  const map: Record<string, string> = {
    Claude: 'from-violet-500 to-indigo-600',
    Scout:  'from-teal-500 to-cyan-600',
    Quill:  'from-blue-500 to-sky-600',
    Forge:  'from-emerald-500 to-green-600',
  }
  return name ? (map[name] ?? 'from-slate-600 to-slate-700') : 'from-slate-700 to-slate-800'
}

// ─── Add Task modal ───────────────────────────────────────────────────────────

interface AddTaskModalProps {
  onClose: () => void
  onSave:  (title: string, priority: TaskPriority, description: string, tags: string[]) => Promise<void>
}

function AddTaskModal({ onClose, onSave }: AddTaskModalProps) {
  useEscapeKey(onClose)
  const [title, setTitle]       = useState('')
  const [desc, setDesc]         = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags]         = useState<string[]>([])
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const addTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }

  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      await onSave(title.trim(), priority, desc, tags)
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-[100dvh] w-full max-w-none flex-col overflow-y-auto rounded-none border border-border bg-card shadow-2xl safe-top safe-bottom sm:h-auto sm:max-w-md sm:rounded-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New Task</h2>
          <button aria-label="Close" onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center rounded text-text-muted hover:bg-card-hover hover:text-text-secondary transition-colors sm:min-h-0 sm:min-w-0"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-1 flex-col gap-4 overflow-y-auto">
          {/* Title */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Title</label>
            <input
              ref={inputRef}
              value={title}
              onChange={e => { setTitle(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Task title…"
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
            />
            {error && <p className="text-xxs text-red-400 mt-1">{error}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Description</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Optional description…"
              rows={2}
              className="w-full min-h-11 px-3 py-2 rounded-lg border border-border bg-base text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors resize-none"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Priority</label>
            <div className="flex gap-2">
              {(['urgent', 'high', 'medium', 'low'] as TaskPriority[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={clsx('min-h-11 flex-1 px-2 py-1.5 rounded border text-xxs font-semibold capitalize transition-all sm:min-h-0',
                    priority === p ? priorityConfig[p].badge : 'border-border text-text-muted hover:text-text-secondary')}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Tags</label>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
                placeholder="Add tag…"
                className="min-h-11 flex-1 px-3 py-2 sm:py-1.5 rounded-lg border border-border bg-base text-base sm:text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
              />
              <button onClick={addTag} className="min-h-11 px-3 py-2 sm:py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-card-hover transition-colors sm:min-h-0">Add</button>
            </div>
            {tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                {tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">
                    <Tag size={8} />{tag}
                    <button onClick={() => setTags(prev => prev.filter(t => t !== tag))} className="ml-0.5 hover:text-text-primary"><X size={8} /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-card px-5 py-4 safe-bottom">
          <button onClick={onClose} className="min-h-11 px-4 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !title.trim()}
            className="flex min-h-11 items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Create Task
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Task card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  highlighted,
  onMove,
  onDelete,
}: {
  task:     LiveTask
  highlighted: boolean
  onMove:   (id: string, status: TaskStatus) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const p         = priorityConfig[task.priority]
  const isActive  = task.status === 'active'
  const isBlocked = task.status === 'blocked'
  const [moving, setMoving] = useState(false)

  const move = async (status: TaskStatus) => {
    setMoving(true)
    await onMove(task.id, status).finally(() => setMoving(false))
  }

  return (
    <div className={clsx(
      'group flex flex-col gap-2.5 p-3.5 rounded-lg border bg-card hover:bg-card-hover cursor-pointer transition-all',
      isBlocked ? 'border-red-900/30 opacity-80' : 'border-border',
      highlighted && 'ring-1 ring-blue-500/60 bg-card-hover',
      moving && 'opacity-50 pointer-events-none',
    )}
    data-task-id={task.id}>
      {/* Priority row */}
      <div className="flex items-center justify-between gap-2">
        <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', p.badge)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', p.dot, isActive && task.priority === 'urgent' && 'animate-pulse')} />
          {p.label}
        </span>
        <div className="flex flex-wrap items-center gap-2 opacity-100 transition-opacity md:gap-1.5 md:opacity-0 md:group-hover:opacity-100">
          {task.status !== 'active'    && <button onClick={() => move('active')}    className="min-h-11 rounded border border-blue-900/30 px-2.5 text-xxs text-blue-400 hover:bg-blue-950/20 md:min-h-0 md:border-0 md:px-0 md:hover:bg-transparent md:hover:underline">Activate</button>}
          {task.status !== 'queued'    && <button onClick={() => move('queued')}    className="min-h-11 rounded border border-border px-2.5 text-xxs text-text-muted hover:bg-card-hover md:min-h-0 md:border-0 md:px-0 md:hover:bg-transparent md:hover:underline">Queue</button>}
          {task.status !== 'blocked'   && <button onClick={() => move('blocked')}   className="min-h-11 rounded border border-red-900/30 px-2.5 text-xxs text-red-400 hover:bg-red-950/20 md:min-h-0 md:border-0 md:px-0 md:hover:bg-transparent md:hover:underline">Block</button>}
          {task.status !== 'completed' && <button onClick={() => move('completed')} className="min-h-11 rounded border border-green-900/30 px-2.5 text-xxs text-green-400 hover:bg-green-950/20 md:min-h-0 md:border-0 md:px-0 md:hover:bg-transparent md:hover:underline">Done</button>}
          <button onClick={() => onDelete(task.id)} className="flex min-h-11 min-w-11 items-center justify-center rounded border border-border text-xxs text-text-muted hover:text-red-400 transition-colors md:ml-0.5 md:min-h-0 md:min-w-0 md:border-0">
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* Title */}
      <p className={clsx('text-xs font-semibold leading-snug', isBlocked ? 'text-text-secondary' : 'text-text-primary')}>
        {isBlocked && <AlertCircle size={11} className="text-red-400 inline mr-1 -mt-0.5" />}
        {task.title}
      </p>

      {/* Description */}
      {task.description && (
        <p className="text-xxs text-text-muted leading-relaxed line-clamp-2">{task.description}</p>
      )}

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {task.tags.map(tag => (
            <span key={tag} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">
              <Tag size={8} />{tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border-subtle">
        <div className="flex items-center gap-1.5 min-w-0">
          {task.agentName ? (
            <>
              <div className={clsx('w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-white text-xxs font-bold bg-gradient-to-br', agentColor(task.agentName))}>
                {task.agentName[0]}
              </div>
              <span className="text-xxs text-text-muted truncate">{task.agentName}</span>
            </>
          ) : (
            <span className="text-xxs text-text-muted italic">Unassigned</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {task.dueDate && (
            <span className={clsx('flex items-center gap-0.5 text-xxs',
              task.dueDate === 'Overdue' ? 'text-red-400' : isBlocked ? 'text-red-400' : 'text-text-muted')}>
              <Clock size={9} />{task.dueDate}
            </span>
          )}
          {task.project && (
            <span className="text-xxs text-text-muted truncate max-w-[80px]">{task.project}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Column ────────────────────────────────────────────────────────────────────

function Column({
  status,
  tasks,
  focusedTaskId,
  onMove,
  onDelete,
}: {
  status:   TaskStatus
  tasks:    LiveTask[]
  focusedTaskId: string | null
  onMove:   (id: string, s: TaskStatus) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const cfg    = statusConfig[status]
  const sorted = [...tasks].sort((a, b) => priorityConfig[a.priority].order - priorityConfig[b.priority].order)

  return (
    <div className={clsx('flex w-full min-w-0 flex-col rounded-xl border bg-surface/40 md:min-w-[280px] md:flex-1', cfg.col)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className={clsx('text-xs font-semibold', cfg.headerColor)}>{cfg.label}</span>
          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-card border border-border text-xxs text-text-muted tabular-nums font-semibold">
            {tasks.length}
          </span>
        </div>
        {status === 'active' && (
          <span className="flex items-center gap-1 text-xxs text-blue-400">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />Live
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-20">
            <span className="text-xxs text-text-muted">No tasks</span>
          </div>
        ) : (
          sorted.map(task => (
            <TaskCard key={task.id} task={task} highlighted={task.id === focusedTaskId} onMove={onMove} onDelete={onDelete} />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export function Tasks() {
  const [taskList, setTaskList]       = useState<LiveTask[]>([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [showModal, setShowModal]     = useState(false)
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>('active')
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(() => readStoredValue(TASK_FOCUS_STORAGE_KEY))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await tasksApi.list()
      setTaskList(res.tasks)
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
      if (domain === 'tasks') load()
    }
    window.addEventListener(DATA_REFRESH_EVENT, handler)
    return () => window.removeEventListener(DATA_REFRESH_EVENT, handler)
  }, [load])

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ taskId?: string }>
      if (custom.detail?.taskId) setFocusedTaskId(custom.detail.taskId)
    }
    window.addEventListener(TASK_FOCUS_EVENT, handler as EventListener)
    return () => window.removeEventListener(TASK_FOCUS_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    if (!focusedTaskId) return
    const task = taskList.find(entry => entry.id === focusedTaskId)
    if (!task) {
      if (!loading) {
        clearStoredValue(TASK_FOCUS_STORAGE_KEY)
        setFocusedTaskId(null)
      }
      return
    }

    clearStoredValue(TASK_FOCUS_STORAGE_KEY)
    setMobileStatus(task.status)
    if (task.status === 'completed') setShowCompleted(true)
  }, [focusedTaskId, loading, taskList])

  useEffect(() => {
    if (!focusedTaskId) return
    const frame = window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-task-id="${focusedTaskId}"]`)
      node?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    })
    const timer = window.setTimeout(() => {
      setFocusedTaskId(current => current === focusedTaskId ? null : current)
    }, 2600)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [focusedTaskId, showCompleted, taskList])

  const handleMove = async (id: string, newStatus: TaskStatus) => {
    // Optimistic update
    setTaskList(prev => prev.map(t => t.id === id ? { ...t, status: newStatus } : t))
    try {
      const res = await tasksApi.update(id, { status: newStatus })
      setTaskList(prev => prev.map(t => t.id === id ? res.task : t))
    } catch {
      load() // revert on failure
    }
  }

  const handleDelete = async (id: string) => {
    setTaskList(prev => prev.filter(t => t.id !== id))
    try {
      await tasksApi.remove(id)
    } catch {
      load()
    }
  }

  const handleCreate = async (title: string, priority: TaskPriority, description: string, tags: string[]) => {
    const res = await tasksApi.create({ title, priority, description, tags, status: 'queued' })
    setTaskList(prev => [res.task, ...prev])
  }

  const columns: TaskStatus[] = showCompleted
    ? ['active', 'queued', 'blocked', 'completed']
    : ['active', 'queued', 'blocked']

  const activeCount    = taskList.filter(t => t.status === 'active').length
  const blockedCount   = taskList.filter(t => t.status === 'blocked').length
  const completedCount = taskList.filter(t => t.status === 'completed').length
  const queuedCount    = taskList.filter(t => t.status === 'queued').length
  const statusCounts: Record<TaskStatus, number> = {
    active: activeCount,
    queued: queuedCount,
    blocked: blockedCount,
    completed: completedCount,
  }
  const mobileStatuses: TaskStatus[] = ['active', 'queued', 'blocked', 'completed']

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border px-4 pt-5 pb-4 shrink-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Tasks</h1>
          {loading ? (
            <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />Loading…
            </p>
          ) : error ? (
            <p className="text-xs text-red-400 mt-0.5">{error}</p>
          ) : (
            <p className="text-xs text-text-muted mt-0.5">
              <span className="text-blue-400">{activeCount} active</span>
              {blockedCount > 0 && <>&nbsp;·&nbsp;<span className="text-red-400">{blockedCount} blocked</span></>}
              &nbsp;·&nbsp;<span className="text-text-secondary">{queuedCount} queued</span>
              &nbsp;·&nbsp;<span className="text-text-secondary">{completedCount} done</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-muted hover:text-text-secondary transition-colors text-xs sm:min-h-0"
          >
            <ChevronRight size={12} className={clsx('transition-transform', showCompleted && 'rotate-90')} />
            {showCompleted ? 'Hide' : 'Show'} completed
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium sm:min-h-0"
          >
            <Plus size={13} />New Task
          </button>
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-4 py-3 md:hidden">
        <div className="flex gap-2 overflow-x-auto whitespace-nowrap">
          {mobileStatuses.map(status => (
            <button
              key={status}
              onClick={() => setMobileStatus(status)}
              className={clsx(
                'flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors',
                mobileStatus === status
                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-300'
                  : 'border-border bg-card text-text-muted hover:bg-card-hover hover:text-text-secondary',
              )}
            >
              {statusConfig[status].label}
              <span className="rounded bg-base px-1.5 py-0.5 text-xxs tabular-nums">{statusCounts[status]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-4 md:flex-row md:overflow-x-auto md:overflow-y-hidden md:px-6">
            {(['active', 'queued', 'blocked'] as TaskStatus[]).map(s => (
              <div key={s} className={clsx('flex w-full min-w-0 flex-col rounded-xl border bg-surface/40 animate-pulse md:min-w-[280px] md:flex-1', statusConfig[s].col)}>
                <div className="px-4 py-3 border-b border-border">
                  <div className="h-3.5 w-24 rounded bg-base" />
                </div>
                <div className="flex flex-col gap-2 p-3">
                  {[...Array(s === 'active' ? 2 : 1)].map((_, i) => (
                    <div key={i} className="h-24 rounded-lg bg-base" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="h-full overflow-y-auto px-4 py-4 md:hidden">
              <Column
                status={mobileStatus}
                tasks={taskList.filter(t => t.status === mobileStatus)}
                focusedTaskId={focusedTaskId}
                onMove={handleMove}
                onDelete={handleDelete}
              />
            </div>
            <div className="hidden h-full overflow-x-auto overflow-y-hidden px-6 py-4 md:block">
              <div className="flex gap-3 h-full min-w-0">
                {columns.map(status => (
                  <Column
                    key={status}
                    status={status}
                    tasks={taskList.filter(t => t.status === status)}
                    focusedTaskId={focusedTaskId}
                    onMove={handleMove}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {showModal && (
        <AddTaskModal onClose={() => setShowModal(false)} onSave={handleCreate} />
      )}
    </div>
  )
}
