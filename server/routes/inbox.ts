import { Router } from 'express'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export const inboxRouter = Router()

type InboxKind = 'approval' | 'task' | 'todo'
type InboxStatus = 'active' | 'snoozed' | 'done'
type InboxPriority = 'critical' | 'high' | 'medium' | 'low'

interface InboxOverlay {
  id: string
  status: InboxStatus
  snoozedUntil: string
  reviewedAt: string
  convertedTo: { kind: 'task' | 'note' | 'link'; id: string } | null
  updatedAt: string
}

interface InboxTodo {
  id: string
  title: string
  notes: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  dueDate: string
  done: boolean
}

interface InboxTask {
  id: string
  title: string
  description: string
  status: 'active' | 'queued' | 'blocked' | 'completed'
  priority: 'urgent' | 'high' | 'medium' | 'low'
  createdAt: string
  dueDate: string
  project: string
}

interface InboxApproval {
  id: string
  title: string
  description: string
  status: 'pending' | 'approved' | 'rejected'
  urgency: 'urgent' | 'normal' | 'low'
  createdAt: string
  agentName: string
  project?: string
}

interface InboxItem {
  id: string
  kind: InboxKind
  itemId: string
  title: string
  summary: string
  content: string
  priority: InboxPriority
  status: InboxStatus
  source: 'local' | 'openclaw' | 'hermes'
  sourceLabel: string
  routeView: 'tasks' | 'todos'
  routeTab: 'tasks' | 'approvals' | 'inbox' | ''
  eventAt: string
  eventAgo: string
  snoozedUntil: string
  reviewedAt: string
  convertedTo: { kind: 'task' | 'note' | 'link'; id: string } | null
  badges: string[]
}

function inboxPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'inbox.json')
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function readOverlay(): InboxOverlay[] {
  return readJson<InboxOverlay[]>(inboxPath(), [])
}

function writeOverlay(entries: InboxOverlay[]): void {
  writeFileSync(inboxPath(), JSON.stringify(entries, null, 2), 'utf8')
}

function todosPath(): string {
  return join(process.cwd(), 'data', 'todos.json')
}

function tasksPath(): string {
  return join(process.cwd(), 'data', 'tasks.json')
}

function approvalsPath(): string {
  return join(process.cwd(), '..', 'approvals.json')
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function daysUntil(iso: string): number {
  const due = new Date(iso)
  due.setHours(0, 0, 0, 0)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - now.getTime()) / 86_400_000)
}

function sourceLabel(source: InboxItem['source']): string {
  if (source === 'openclaw') return 'OpenClaw'
  if (source === 'hermes') return 'Hermes'
  return 'Local'
}

function overlayFor(id: string, entries: InboxOverlay[]): InboxOverlay | null {
  return entries.find(entry => entry.id === id) ?? null
}

function normalizeStatus(overlay: InboxOverlay | null): InboxStatus {
  if (!overlay) return 'active'
  if (overlay.status === 'snoozed' && overlay.snoozedUntil && new Date(overlay.snoozedUntil).getTime() <= Date.now()) {
    return 'active'
  }
  return overlay.status
}

function makeId(kind: InboxKind, source: InboxItem['source'], itemId: string): string {
  return `${kind}:${source}:${itemId}`
}

function priorityOrder(priority: InboxPriority): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[priority]
}

function statusOrder(status: InboxStatus): number {
  return { active: 0, snoozed: 1, done: 2 }[status]
}

function aggregateItems(): InboxItem[] {
  const overlay = readOverlay()
  const todos = readJson<InboxTodo[]>(todosPath(), [])
  const tasks = readJson<InboxTask[]>(tasksPath(), [])
  const approvals = readJson<InboxApproval[]>(approvalsPath(), [])
  const items: InboxItem[] = []

  for (const approval of approvals) {
    if (approval.status !== 'pending') continue
    const id = makeId('approval', 'local', approval.id)
    const state = overlayFor(id, overlay)
    const status = normalizeStatus(state)
    items.push({
      id,
      kind: 'approval',
      itemId: approval.id,
      title: approval.title,
      summary: approval.description || `${approval.agentName} requested approval`,
      content: approval.description || '',
      priority: approval.urgency === 'urgent' ? 'critical' : approval.urgency === 'normal' ? 'high' : 'medium',
      status,
      source: 'local',
      sourceLabel: sourceLabel('local'),
      routeView: 'tasks',
      routeTab: 'approvals',
      eventAt: approval.createdAt,
      eventAgo: timeAgo(approval.createdAt),
      snoozedUntil: state?.snoozedUntil ?? '',
      reviewedAt: state?.reviewedAt ?? '',
      convertedTo: state?.convertedTo ?? null,
      badges: [approval.urgency, approval.project || approval.agentName].filter(Boolean),
    })
  }

  for (const task of tasks) {
    const qualifies = task.status === 'blocked' || (task.status !== 'completed' && task.priority === 'urgent')
    if (!qualifies) continue
    const id = makeId('task', 'local', task.id)
    const state = overlayFor(id, overlay)
    const status = normalizeStatus(state)
    items.push({
      id,
      kind: 'task',
      itemId: task.id,
      title: task.title,
      summary: task.description || `${task.status} task`,
      content: task.description || '',
      priority: task.status === 'blocked' ? 'high' : 'critical',
      status,
      source: 'local',
      sourceLabel: sourceLabel('local'),
      routeView: 'tasks',
      routeTab: 'tasks',
      eventAt: task.createdAt,
      eventAgo: timeAgo(task.createdAt),
      snoozedUntil: state?.snoozedUntil ?? '',
      reviewedAt: state?.reviewedAt ?? '',
      convertedTo: state?.convertedTo ?? null,
      badges: [task.status, task.priority, task.project].filter(Boolean),
    })
  }

  for (const todo of todos) {
    const overdue = todo.dueDate ? daysUntil(todo.dueDate) < 0 : false
    const qualifies = !todo.done && (overdue || todo.severity === 'critical' || todo.severity === 'high')
    if (!qualifies) continue
    const id = makeId('todo', 'local', todo.id)
    const state = overlayFor(id, overlay)
    const status = normalizeStatus(state)
    items.push({
      id,
      kind: 'todo',
      itemId: todo.id,
      title: todo.title,
      summary: todo.notes || (overdue ? 'Overdue to-do' : `${todo.severity} priority to-do`),
      content: todo.notes || '',
      priority: overdue || todo.severity === 'critical' ? 'critical' : 'high',
      status,
      source: 'local',
      sourceLabel: sourceLabel('local'),
      routeView: 'todos',
      routeTab: '',
      eventAt: todo.updatedAt || todo.createdAt,
      eventAgo: timeAgo(todo.updatedAt || todo.createdAt),
      snoozedUntil: state?.snoozedUntil ?? '',
      reviewedAt: state?.reviewedAt ?? '',
      convertedTo: state?.convertedTo ?? null,
      badges: [todo.severity, todo.dueDate ? (overdue ? 'overdue' : 'scheduled') : ''].filter(Boolean),
    })
  }

  return items.sort((a, b) => {
    const statusDiff = statusOrder(a.status) - statusOrder(b.status)
    if (statusDiff !== 0) return statusDiff
    const priorityDiff = priorityOrder(a.priority) - priorityOrder(b.priority)
    if (priorityDiff !== 0) return priorityDiff
    return new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime()
  })
}

inboxRouter.get('/', (_req, res) => {
  const items = aggregateItems()
  const counts = items.reduce(
    (acc, item) => {
      acc.total += 1
      acc[item.status] += 1
      acc.byKind[item.kind] = (acc.byKind[item.kind] ?? 0) + 1
      return acc
    },
    {
      total: 0,
      active: 0,
      snoozed: 0,
      done: 0,
      byKind: {} as Record<InboxKind, number>,
    },
  )

  res.json({ items, counts, fetchedAt: new Date().toISOString() })
})

inboxRouter.patch('/:id', (req, res) => {
  const id = req.params.id
  const body = req.body ?? {}
  const entries = readOverlay()
  const now = new Date().toISOString()
  const idx = entries.findIndex(entry => entry.id === id)
  const current: InboxOverlay = idx === -1
    ? { id, status: 'active', snoozedUntil: '', reviewedAt: '', convertedTo: null, updatedAt: now }
    : entries[idx]

  const next: InboxOverlay = {
    ...current,
    updatedAt: now,
  }

  if (body.status === 'active' || body.status === 'snoozed' || body.status === 'done') next.status = body.status
  if (typeof body.snoozedUntil === 'string') next.snoozedUntil = body.snoozedUntil
  if (next.status === 'done' && !next.reviewedAt) next.reviewedAt = now
  if (next.status === 'active') {
    next.reviewedAt = body.clearReviewed ? '' : next.reviewedAt
    next.snoozedUntil = ''
  }
  if (body.convertedTo && typeof body.convertedTo === 'object' && body.convertedTo.kind && body.convertedTo.id) {
    next.convertedTo = { kind: body.convertedTo.kind, id: body.convertedTo.id }
  }

  if (idx === -1) entries.push(next)
  else entries[idx] = next

  writeOverlay(entries)
  res.json({ item: next })
})