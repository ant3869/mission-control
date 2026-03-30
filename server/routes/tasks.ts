import { Router } from 'express'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const tasksRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'
export type TaskStatus   = 'active' | 'queued' | 'blocked' | 'completed'

export interface StoredTask {
  id:          string
  title:       string
  description: string
  status:      TaskStatus
  priority:    TaskPriority
  agentName:   string
  project:     string
  createdAt:   string   // ISO
  dueDate:     string   // ISO or empty string
  tags:        string[]
  completedAt: string   // ISO or empty string
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function tasksPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'tasks.json')
}

const SEED_TASKS: StoredTask[] = [
  {
    id: randomUUID(), title: 'Review and merge pipeline route PR', description: 'Check the new pipeline stages logic and confirm token aggregation is correct.',
    status: 'active', priority: 'high', agentName: 'Claude', project: 'Mission Control',
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), dueDate: '', tags: ['backend', 'review'], completedAt: '',
  },
  {
    id: randomUUID(), title: 'Add dark mode support to Office view', description: 'Ensure all integration cards respect the dark theme CSS variables.',
    status: 'active', priority: 'medium', agentName: 'Claude', project: 'Mission Control',
    createdAt: new Date(Date.now() - 5 * 3600_000).toISOString(), dueDate: '', tags: ['frontend', 'ui'], completedAt: '',
  },
  {
    id: randomUUID(), title: 'Implement persistent task storage', description: 'Replace in-memory mock data with a JSON-backed CRUD API.',
    status: 'queued', priority: 'urgent', agentName: '', project: 'Mission Control',
    createdAt: new Date(Date.now() - 24 * 3600_000).toISOString(), dueDate: new Date(Date.now() + 24 * 3600_000).toISOString(), tags: ['backend'], completedAt: '',
  },
  {
    id: randomUUID(), title: 'Write unit tests for radar route', description: 'Cover JSONL token aggregation edge cases — empty files, malformed JSON lines.',
    status: 'queued', priority: 'medium', agentName: '', project: 'Mission Control',
    createdAt: new Date(Date.now() - 2 * 86400_000).toISOString(), dueDate: '', tags: ['testing'], completedAt: '',
  },
  {
    id: randomUUID(), title: 'Google OAuth refresh token expired', description: 'Token stored in .env has expired. Need to re-authorise via /api/auth/google.',
    status: 'blocked', priority: 'urgent', agentName: '', project: 'Mission Control',
    createdAt: new Date(Date.now() - 3600_000).toISOString(), dueDate: '', tags: ['auth', 'bug'], completedAt: '',
  },
]

function loadTasks(): StoredTask[] {
  const path = tasksPath()
  if (!existsSync(path)) {
    const seeded = SEED_TASKS.map(t => ({ ...t, id: randomUUID() }))
    writeFileSync(path, JSON.stringify(seeded, null, 2), 'utf8')
    return seeded
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredTask[]
  } catch {
    return []
  }
}

function saveTasks(tasks: StoredTask[]): void {
  writeFileSync(tasksPath(), JSON.stringify(tasks, null, 2), 'utf8')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diffMs  = Date.now() - new Date(iso).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)   return 'just now'
  if (diffMin < 60)  return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)    return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d ago`
}

function dueDateLabel(iso: string): string {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - Date.now()
  const days = Math.floor(diff / 86400_000)
  if (days < 0)   return 'Overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days}d`
}

function toResponse(t: StoredTask) {
  return {
    id:          t.id,
    title:       t.title,
    description: t.description || undefined,
    status:      t.status,
    priority:    t.priority,
    agentName:   t.agentName  || undefined,
    project:     t.project    || undefined,
    createdAgo:  timeAgo(t.createdAt),
    createdAt:   t.createdAt,
    dueDate:     t.dueDate ? dueDateLabel(t.dueDate) : undefined,
    dueDateIso:  t.dueDate || undefined,
    tags:        t.tags.length ? t.tags : undefined,
    completedAt: t.completedAt || undefined,
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/tasks
tasksRouter.get('/', (_req, res) => {
  try {
    const tasks = loadTasks()
    res.json({
      tasks:     tasks.map(toResponse),
      fetchedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/tasks
tasksRouter.post('/', (req, res) => {
  try {
    const { title, description = '', priority = 'medium', status = 'queued', agentName = '', project = '', dueDate = '', tags = [] } = req.body as Partial<StoredTask>
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' })

    const task: StoredTask = {
      id: randomUUID(),
      title: title.trim(),
      description,
      status,
      priority,
      agentName,
      project,
      createdAt: new Date().toISOString(),
      dueDate,
      tags,
      completedAt: '',
    }
    const tasks = loadTasks()
    tasks.unshift(task)
    saveTasks(tasks)
    res.status(201).json({ task: toResponse(task) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/tasks/:id
tasksRouter.patch('/:id', (req, res) => {
  try {
    const tasks  = loadTasks()
    const idx    = tasks.findIndex(t => t.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Task not found' })

    const { title, description, status, priority, agentName, project, dueDate, tags } = req.body as Partial<StoredTask>
    const task = tasks[idx]

    if (title       !== undefined) task.title       = title.trim()
    if (description !== undefined) task.description = description
    if (status      !== undefined) {
      task.status = status
      if (status === 'completed' && !task.completedAt) task.completedAt = new Date().toISOString()
      if (status !== 'completed') task.completedAt = ''
    }
    if (priority    !== undefined) task.priority    = priority
    if (agentName   !== undefined) task.agentName   = agentName
    if (project     !== undefined) task.project     = project
    if (dueDate     !== undefined) task.dueDate     = dueDate
    if (tags        !== undefined) task.tags        = tags

    saveTasks(tasks)
    res.json({ task: toResponse(task) })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/tasks/:id
tasksRouter.delete('/:id', (req, res) => {
  try {
    const tasks   = loadTasks()
    const idx     = tasks.findIndex(t => t.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Task not found' })
    tasks.splice(idx, 1)
    saveTasks(tasks)
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
