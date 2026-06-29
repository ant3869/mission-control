// title: To-Do backend route
// path: server/routes/todos.ts
// purpose: Personal quick-capture to-do list (stored in data/todos.json) with
//          severity + short/long-term horizon, plus agent-driven research that
//          attaches links, steps, and key facts to a task.

import { Router } from 'express'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { researchTodo, type TodoResearchResult } from '../lib/research.js'
import { discordNotifier } from '../lib/discordNotifier.js'
import { emitDataChanged } from '../lib/dataEvents.js'
import { saveJson } from '../lib/jsonStore.js'
import {
  syncTodoCalendar, removeTodoFromCalendar, defaultSyncFields,
  type TodoCalendarSyncStatus,
} from '../lib/todoCalendarSync.js'

export const todosRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type TodoSeverity = 'low' | 'medium' | 'high' | 'critical'
export type TodoHorizon  = 'short' | 'long'

export interface TodoResearch extends TodoResearchResult {
  status:      'idle' | 'pending' | 'done' | 'failed'
  requestedAt: string   // ISO or empty
  completedAt: string   // ISO or empty
  error:       string
  guidance:    string   // extra context the user gave for a re-run (or empty)
}

export interface TodoDetails {
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

export interface Todo {
  id:          string
  title:       string
  notes:       string
  severity:    TodoSeverity
  horizon:     TodoHorizon
  dueDate:     string   // ISO or empty
  done:        boolean
  createdAt:   string
  updatedAt:   string
  completedAt: string   // ISO or empty
  details:     TodoDetails
  rawInput:    string
  research:    TodoResearch
  // Google Calendar sync metadata (added v0.7.59 — backfilled for old rows)
  calendarSyncEnabled:   boolean
  googleCalendarEventId: string
  calendarSyncStatus:    TodoCalendarSyncStatus
  lastCalendarSyncAt:    string
  calendarSyncError:     string
}

const SEVERITIES: TodoSeverity[] = ['low', 'medium', 'high', 'critical']
const HORIZONS:   TodoHorizon[]  = ['short', 'long']

const emptyResearch = (): TodoResearch => ({ status: 'idle', requestedAt: '', completedAt: '', error: '', guidance: '' })
const emptyDetails  = (): TodoDetails  => ({ date: '', time: '', location: '', phone: '', cost: '', url: '', contact: '', category: '', customFields: {} })

// ─── Persistence ──────────────────────────────────────────────────────────────

function todosPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'todos.json')
}

function loadTodos(): Todo[] {
  const path = todosPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Todo[]
    // Backfill fields added after rows were first written (dueDate, details, rawInput).
    return parsed.map(t => ({
      ...defaultSyncFields(),
      ...t,
      dueDate: t.dueDate ?? '',
      rawInput: t.rawInput ?? '',
      details: { ...emptyDetails(), ...(t.details ?? {}), customFields: { ...((t.details as any)?.customFields ?? {}) } },
    }))
  } catch { return [] }
}

// Coerce an arbitrary body.details into a clean TodoDetails (strings only).
function sanitizeDetails(v: unknown): TodoDetails {
  const out = emptyDetails()
  if (!v || typeof v !== 'object') return out
  const src = v as Record<string, unknown>
  for (const k of ['date', 'time', 'location', 'phone', 'cost', 'url', 'contact', 'category'] as const) {
    if (src[k] !== undefined && src[k] !== null) out[k] = String(src[k]).slice(0, 500)
  }
  if (src.customFields && typeof src.customFields === 'object') {
    for (const [k, val] of Object.entries(src.customFields as Record<string, unknown>)) {
      const key = String(k).trim().slice(0, 60)
      if (key) out.customFields[key] = String(val ?? '').slice(0, 500)
    }
  }
  return out
}

function parseDueDate(v: unknown): string {
  if (!v) return ''
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function saveTodos(todos: Todo[]): void {
  saveJson(todosPath(), todos)
}

// Research marked 'pending' from a previous server run is orphaned (its promise
// is gone). Reset so it can be retried.
{
  const todos = loadTodos()
  let dirty = false
  for (const t of todos) {
    if (t.research?.status === 'pending') {
      t.research = { ...t.research, status: 'failed', error: 'Reset: server restarted while research was in progress' }
      dirty = true
    }
  }
  if (dirty) saveTodos(todos)
}

// ─── Calendar sync ──────────────────────────────────────────────────────────
// Reconcile a todo with Google Calendar and persist the resulting sync metadata.
// Reloads before writing so it never clobbers a concurrent edit. Never throws —
// any Google failure is captured into calendarSyncError by the sync helper.
async function runCalendarSync(todoId: string): Promise<Todo | null> {
  const pending = loadTodos()
  const target = pending.find(t => t.id === todoId)
  if (!target) return null
  if (target.calendarSyncEnabled) { target.calendarSyncStatus = 'pending'; saveTodos(pending) }

  const fields = await syncTodoCalendar(target)

  const fresh = loadTodos()
  const t = fresh.find(x => x.id === todoId)
  if (!t) return null
  Object.assign(t, fields)
  t.updatedAt = new Date().toISOString()
  saveTodos(fresh)
  return t
}

// Body keys that, when changed, mean the linked calendar event needs reconciling.
const CAL_KEYS = ['title', 'notes', 'dueDate', 'details', 'severity', 'calendarSyncEnabled'] as const

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/todos
todosRouter.get('/', (_req, res) => {
  res.json({ todos: loadTodos(), fetchedAt: new Date().toISOString() })
})

// POST /api/todos
todosRouter.post('/', async (req, res) => {
  const body = req.body as Record<string, unknown>
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return res.status(400).json({ error: 'title is required' })

  const severity: TodoSeverity = SEVERITIES.includes(body.severity as TodoSeverity)
    ? (body.severity as TodoSeverity) : 'medium'
  const horizon: TodoHorizon = HORIZONS.includes(body.horizon as TodoHorizon)
    ? (body.horizon as TodoHorizon) : 'short'
  const notes    = typeof body.notes    === 'string' ? body.notes    : ''
  const dueDate  = typeof body.dueDate  === 'string' ? body.dueDate  : ''
  const rawInput = typeof body.rawInput === 'string' ? body.rawInput : ''
  const calendarSyncEnabled = body.calendarSyncEnabled === true
  const todo: Todo = {
    id:          randomUUID(),
    title,
    notes,
    severity,
    horizon,
    dueDate:     parseDueDate(dueDate),
    done:        false,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    completedAt: '',
    details:     sanitizeDetails(body.details),
    rawInput:    rawInput.slice(0, 2000),
    research:    emptyResearch(),
    ...defaultSyncFields(),
    calendarSyncEnabled,
  }
  const todos = loadTodos()
  todos.unshift(todo)
  saveTodos(todos)
  // Opt-in: only touch Google Calendar when the user enabled sync on create.
  const result = todo.calendarSyncEnabled ? (await runCalendarSync(todo.id)) ?? todo : todo
  emitDataChanged('todos')
  res.status(201).json({ todo: result })
})

// PATCH /api/todos/:id
todosRouter.patch('/:id', async (req, res) => {
  const todos = loadTodos()
  const todo  = todos.find(t => t.id === req.params.id)
  if (!todo) return res.status(404).json({ error: 'not found' })

  const body = req.body as Record<string, unknown>
  const updates: Partial<Todo> = {}
  if (typeof body.title === 'string') updates.title = body.title.trim()
  if (typeof body.notes === 'string') updates.notes = body.notes
  if (SEVERITIES.includes(body.severity as TodoSeverity)) updates.severity = body.severity as TodoSeverity
  if (HORIZONS.includes(body.horizon as TodoHorizon))     updates.horizon  = body.horizon  as TodoHorizon
  if (typeof body.dueDate === 'string')                   updates.dueDate  = parseDueDate(body.dueDate)
  if (body.details !== undefined)                         updates.details  = sanitizeDetails(body.details)
  if (typeof body.rawInput === 'string')                  updates.rawInput = body.rawInput.slice(0, 2000)
  if (typeof body.calendarSyncEnabled === 'boolean')      updates.calendarSyncEnabled = body.calendarSyncEnabled
  if (typeof body.done === 'boolean')                     updates.done     = body.done
  if (updates.done !== undefined) updates.completedAt = updates.done ? new Date().toISOString() : ''
  Object.assign(todo, updates)
  todo.updatedAt = new Date().toISOString()
  saveTodos(todos)

  // Reconcile the calendar only when a calendar-relevant field changed and the
  // task is (or was) calendar-linked — a plain "done" toggle skips Google.
  const calendarTouched = CAL_KEYS.some(k => body[k] !== undefined)
  const result = (calendarTouched && (todo.calendarSyncEnabled || todo.googleCalendarEventId))
    ? (await runCalendarSync(todo.id)) ?? todo
    : todo
  res.json({ todo: result })
})

// POST /api/todos/clear-done — remove all completed todos (and their events)
todosRouter.post('/clear-done', async (_req, res) => {
  const todos = loadTodos()
  const done  = todos.filter(t => t.done)
  for (const t of done) {
    if (t.googleCalendarEventId || t.calendarSyncEnabled) await removeTodoFromCalendar(t)
  }
  const kept = todos.filter(t => !t.done)
  saveTodos(kept)
  res.json({ removed: todos.length - kept.length })
})

// DELETE /api/todos/:id — also deletes the linked calendar event
todosRouter.delete('/:id', async (req, res) => {
  const todos = loadTodos()
  const todo  = todos.find(t => t.id === req.params.id)
  if (!todo) return res.status(404).json({ error: 'not found' })
  await removeTodoFromCalendar(todo)
  saveTodos(todos.filter(t => t.id !== req.params.id))
  res.json({ ok: true })
})

// POST /api/todos/:id/research — ask a connected agent to research the task (async)
todosRouter.post('/:id/research', (req, res) => {
  const todos = loadTodos()
  const todo  = todos.find(t => t.id === req.params.id)
  if (!todo) return res.status(404).json({ error: 'not found' })
  if (todo.research?.status === 'pending') return res.status(409).json({ error: 'research already in progress' })

  const source = req.body?.source === 'hermes' ? 'hermes' : 'openclaw'
  const guidance = String(req.body?.guidance ?? '').trim().slice(0, 1000)
  todo.research = { ...emptyResearch(), status: 'pending', requestedAt: new Date().toISOString(), guidance }
  todo.updatedAt = new Date().toISOString()
  saveTodos(todos)

  // Fire-and-forget: the client polls GET /api/todos for status transitions.
  researchTodo(todo, source, guidance).then(r => {
    const cur = loadTodos()
    const t = cur.find(x => x.id === todo.id)
    if (!t) return
    t.research = { ...t.research, ...r, status: 'done', completedAt: new Date().toISOString(), error: '' }
    t.updatedAt = new Date().toISOString()
    saveTodos(cur)
    discordNotifier.notify({ kind: 'research_done', itemType: 'todo', id: todo.id, title: todo.title, success: true, summary: r.summary })
  }).catch(err => {
    const cur = loadTodos()
    const t = cur.find(x => x.id === todo.id)
    if (!t) return
    t.research = { ...t.research, status: 'failed', error: String(err?.message ?? err).slice(0, 200) }
    t.updatedAt = new Date().toISOString()
    saveTodos(cur)
    discordNotifier.notify({ kind: 'research_done', itemType: 'todo', id: todo.id, title: todo.title, success: false, error: String(err?.message ?? err).slice(0, 200) })
  })

  res.status(202).json({ todo })
})
