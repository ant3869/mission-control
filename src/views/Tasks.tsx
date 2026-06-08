import { useState, useEffect, useCallback, useRef } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import { Plus, Clock, AlertCircle, ChevronRight, Tag, Loader2, Trash2, X, Check } from 'lucide-react'
import { tasks as tasksApi } from '../lib/api'
import type { LiveTask, TaskStatus, TaskPriority } from '../lib/api'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">New Task</h2>
          <button aria-label="Close" onClick={onClose} className="text-text-muted hover:text-text-secondary transition-colors"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Title */}
          <div>
            <label className="text-xxs text-text-muted uppercase tracking-wide font-medium mb-1.5 block">Title</label>
            <input
              ref={inputRef}
              value={title}
              onChange={e => { setTitle(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && submit()}
              placeholder="Task title…"
              className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
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
              className="w-full px-3 py-2 rounded-lg border border-border bg-base text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors resize-none"
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
                  className={clsx('flex-1 px-2 py-1.5 rounded border text-xxs font-semibold capitalize transition-all',
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
                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-base text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60 transition-colors"
              />
              <button onClick={addTag} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-secondary hover:bg-card-hover transition-colors">Add</button>
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

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-xs text-text-muted hover:text-text-secondary transition-colors">Cancel</button>
          <button
            onClick={submit}
            disabled={saving || !title.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors"
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
  onMove,
  onDelete,
}: {
  task:     LiveTask
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
      moving && 'opacity-50 pointer-events-none',
    )}>
      {/* Priority row */}
      <div className="flex items-center justify-between gap-2">
        <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', p.badge)}>
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', p.dot, isActive && task.priority === 'urgent' && 'animate-pulse')} />
          {p.label}
        </span>
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {task.status !== 'active'    && <button onClick={() => move('active')}    className="text-xxs text-blue-400 hover:underline">Activate</button>}
          {task.status !== 'queued'    && <button onClick={() => move('queued')}    className="text-xxs text-text-muted hover:underline">Queue</button>}
          {task.status !== 'blocked'   && <button onClick={() => move('blocked')}   className="text-xxs text-red-400 hover:underline">Block</button>}
          {task.status !== 'completed' && <button onClick={() => move('completed')} className="text-xxs text-green-400 hover:underline">Done</button>}
          <button onClick={() => onDelete(task.id)} className="text-xxs text-text-muted hover:text-red-400 transition-colors ml-0.5">
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
  onMove,
  onDelete,
}: {
  status:   TaskStatus
  tasks:    LiveTask[]
  onMove:   (id: string, s: TaskStatus) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const cfg    = statusConfig[status]
  const sorted = [...tasks].sort((a, b) => priorityConfig[a.priority].order - priorityConfig[b.priority].order)

  return (
    <div className={clsx('flex flex-col min-w-[280px] flex-1 rounded-xl border bg-surface/40', cfg.col)}>
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
            <TaskCard key={task.id} task={task} onMove={onMove} onDelete={onDelete} />
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-muted hover:text-text-secondary transition-colors text-xs"
          >
            <ChevronRight size={12} className={clsx('transition-transform', showCompleted && 'rotate-90')} />
            {showCompleted ? 'Hide' : 'Show'} completed
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium"
          >
            <Plus size={13} />New Task
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-4">
        {loading ? (
          <div className="flex gap-3 h-full">
            {(['active', 'queued', 'blocked'] as TaskStatus[]).map(s => (
              <div key={s} className={clsx('flex flex-col min-w-[280px] flex-1 rounded-xl border bg-surface/40 animate-pulse', statusConfig[s].col)}>
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
          <div className="flex gap-3 h-full min-w-0">
            {columns.map(status => (
              <Column
                key={status}
                status={status}
                tasks={taskList.filter(t => t.status === status)}
                onMove={handleMove}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <AddTaskModal onClose={() => setShowModal(false)} onSave={handleCreate} />
      )}
    </div>
  )
}
