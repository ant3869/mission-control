// title: To-Do backend route
// path: server/routes/todos.ts
// purpose: Personal quick-capture to-do list (stored in data/todos.json) with
//          severity + short/long-term horizon, plus agent-driven research that
//          attaches links, steps, and key facts to a task.

import { Router } from 'express'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { researchTodo, type TodoResearchResult } from '../lib/research.js'

export const todosRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type TodoSeverity = 'low' | 'medium' | 'high' | 'critical'
export type TodoHorizon  = 'short' | 'long'

export interface TodoResearch extends TodoResearchResult {
  status:      'idle' | 'pending' | 'done' | 'failed'
  requestedAt: string   // ISO or empty
  completedAt: string   // ISO or empty
  error:       string
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
  research:    TodoResearch
}

const SEVERITIES: TodoSeverity[] = ['low', 'medium', 'high', 'critical']
const HORIZONS:   TodoHorizon[]  = ['short', 'long']

const emptyResearch = (): TodoResearch => ({ status: 'idle', requestedAt: '', completedAt: '', error: '' })

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
    // Rows written before dueDate existed lack the field.
    return parsed.map(t => ({ dueDate: '', ...t }))
  } catch { return [] }
}

function parseDueDate(v: unknown): string {
  if (!v) return ''
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function saveTodos(todos: Todo[]): void {
  writeFileSync(todosPath(), JSON.stringify(todos, null, 2), 'utf8')
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

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/todos
todosRouter.get('/', (_req, res) => {
  res.json({ todos: loadTodos(), fetchedAt: new Date().toISOString() })
})

// POST /api/todos
todosRouter.post('/', (req, res) => {
  const body = req.body ?? {}
  if (!String(body.title ?? '').trim()) return res.status(400).json({ error: 'title is required' })
  const todo: Todo = {
    id:          randomUUID(),
    title:       String(body.title).trim(),
    notes:       String(body.notes ?? ''),
    severity:    SEVERITIES.includes(body.severity) ? body.severity : 'medium',
    horizon:     HORIZONS.includes(body.horizon) ? body.horizon : 'short',
    dueDate:     parseDueDate(body.dueDate),
    done:        false,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    completedAt: '',
    research:    emptyResearch(),
  }
  const todos = loadTodos()
  todos.unshift(todo)
  saveTodos(todos)
  res.status(201).json({ todo })
})

// PATCH /api/todos/:id
todosRouter.patch('/:id', (req, res) => {
  const todos = loadTodos()
  const todo  = todos.find(t => t.id === req.params.id)
  if (!todo) return res.status(404).json({ error: 'not found' })

  const { title, notes, severity, horizon, dueDate, done } = req.body ?? {}
  if (title !== undefined && String(title).trim()) todo.title = String(title).trim()
  if (notes !== undefined)                         todo.notes = String(notes)
  if (SEVERITIES.includes(severity))               todo.severity = severity
  if (HORIZONS.includes(horizon))                  todo.horizon = horizon
  if (dueDate !== undefined)                       todo.dueDate = parseDueDate(dueDate)
  if (done !== undefined) {
    todo.done = Boolean(done)
    todo.completedAt = todo.done ? new Date().toISOString() : ''
  }
  todo.updatedAt = new Date().toISOString()
  saveTodos(todos)
  res.json({ todo })
})

// POST /api/todos/clear-done — remove all completed todos
todosRouter.post('/clear-done', (_req, res) => {
  const todos = loadTodos()
  const kept = todos.filter(t => !t.done)
  saveTodos(kept)
  res.json({ removed: todos.length - kept.length })
})

// DELETE /api/todos/:id
todosRouter.delete('/:id', (req, res) => {
  const todos = loadTodos()
  const filtered = todos.filter(t => t.id !== req.params.id)
  if (filtered.length === todos.length) return res.status(404).json({ error: 'not found' })
  saveTodos(filtered)
  res.json({ ok: true })
})

// POST /api/todos/:id/research — ask a connected agent to research the task (async)
todosRouter.post('/:id/research', (req, res) => {
  const todos = loadTodos()
  const todo  = todos.find(t => t.id === req.params.id)
  if (!todo) return res.status(404).json({ error: 'not found' })
  if (todo.research?.status === 'pending') return res.status(409).json({ error: 'research already in progress' })

  const source = req.body?.source === 'hermes' ? 'hermes' : 'openclaw'
  todo.research = { ...emptyResearch(), status: 'pending', requestedAt: new Date().toISOString() }
  todo.updatedAt = new Date().toISOString()
  saveTodos(todos)

  // Fire-and-forget: the client polls GET /api/todos for status transitions.
  researchTodo(todo, source).then(r => {
    const cur = loadTodos()
    const t = cur.find(x => x.id === todo.id)
    if (!t) return
    t.research = { ...t.research, ...r, status: 'done', completedAt: new Date().toISOString(), error: '' }
    t.updatedAt = new Date().toISOString()
    saveTodos(cur)
  }).catch(err => {
    const cur = loadTodos()
    const t = cur.find(x => x.id === todo.id)
    if (!t) return
    t.research = { ...t.research, status: 'failed', error: String(err?.message ?? err).slice(0, 200) }
    t.updatedAt = new Date().toISOString()
    saveTodos(cur)
  })

  res.status(202).json({ todo })
})
