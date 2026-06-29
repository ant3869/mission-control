import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NextFunction, Request, Response } from 'express'

export interface JsonChange {
  path: string
  existed: boolean
  before: unknown
  after: unknown
}

interface JournalInput {
  method: string
  path: string
  status: number
  changes: JsonChange[]
}

export interface JournalEntry {
  id: string
  createdAt: string
  method: string
  path: string
  status: number
  undoable: boolean
  undoneAt: string | null
  changes: Array<Omit<JsonChange, 'path'> & { path: string }>
}

interface RequestContext { method: string; path: string; changes: JsonChange[] }
const activeRequest = new AsyncLocalStorage<RequestContext>()

const SECRET_KEY = /token|secret|password|authorization|cookie|credential/i
function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redact(child, childKey)]))
  }
  return value
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.undo.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

export class JournalStore {
  private db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations_journal (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        changes_json TEXT NOT NULL,
        undone_at TEXT
      )
    `)
  }

  record(input: JournalInput): string {
    const id = randomUUID()
    this.db.prepare(`INSERT INTO operations_journal (id, created_at, method, path, status, changes_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, new Date().toISOString(), input.method, input.path, input.status, JSON.stringify(input.changes))
    return id
  }

  list(limit = 100): JournalEntry[] {
    const rows = this.db.prepare(`SELECT * FROM operations_journal ORDER BY created_at DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 500))) as unknown as Array<Record<string, unknown>>
    return rows.map((row) => {
      const changes = JSON.parse(String(row.changes_json)) as JsonChange[]
      return {
        id: String(row.id), createdAt: String(row.created_at), method: String(row.method), path: String(row.path),
        status: Number(row.status), undoneAt: row.undone_at ? String(row.undone_at) : null,
        undoable: changes.length > 0 && !row.undone_at,
        changes: changes.map((change) => ({ ...change, path: basename(change.path), before: redact(change.before), after: redact(change.after) })),
      }
    })
  }

  undo(id: string): void {
    const row = this.db.prepare(`SELECT changes_json, undone_at FROM operations_journal WHERE id = ?`).get(id) as unknown as { changes_json: string; undone_at: string | null } | undefined
    if (!row) throw new Error('Journal entry not found')
    if (row.undone_at) throw new Error('Journal entry already undone')
    const changes = JSON.parse(row.changes_json) as JsonChange[]
    if (changes.length === 0) throw new Error('Journal entry is not undoable')
    for (const change of [...changes].reverse()) {
      if (change.existed) atomicWrite(change.path, change.before)
      else if (existsSync(change.path)) unlinkSync(change.path)
    }
    this.db.prepare(`UPDATE operations_journal SET undone_at = ? WHERE id = ?`).run(new Date().toISOString(), id)
  }

  close(): void {
    this.db.close()
  }
}

export function captureJsonChange(change: JsonChange): void {
  const context = activeRequest.getStore()
  if (!context) return
  const existing = context.changes.find((item) => item.path === change.path)
  if (existing) existing.after = change.after
  else context.changes.push(change)
}

export function createJournalMiddleware(store: JournalStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    const context: RequestContext = { method: req.method, path: req.originalUrl, changes: [] }
    activeRequest.run(context, () => {
      res.once('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) store.record({ ...context, status: res.statusCode })
      })
      next()
    })
  }
}

let defaultStore: JournalStore | null = null
export function getJournalStore(): JournalStore {
  if (!defaultStore) defaultStore = new JournalStore(join(process.cwd(), 'data', 'operations.db'))
  return defaultStore
}
