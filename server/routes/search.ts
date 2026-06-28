// title: Global search route
// path: server/routes/search.ts
// purpose: Single GET /api/search?q=<query> endpoint that fans out to all local
//          JSON stores and the inventory SQLite DB, returning categorised results
//          for the Ctrl+K palette.

import { Router } from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const searchRouter = Router()

const dataDir = join(process.cwd(), 'data')

function readJson<T>(file: string): T[] {
  try {
    const p = join(dataDir, file)
    if (!existsSync(p)) return []
    return JSON.parse(readFileSync(p, 'utf8')) as T[]
  } catch { return [] }
}

function readJsonObj<T>(file: string): Record<string, T> {
  try {
    const p = join(dataDir, file)
    if (!existsSync(p)) return {}
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, T>
  } catch { return {} }
}

function matches(term: string, ...fields: (string | undefined | null)[]): boolean {
  return fields.some(f => f?.toLowerCase().includes(term))
}

let _inventoryDb: DatabaseSync | null = null
function getInventoryDb(): DatabaseSync | null {
  if (_inventoryDb) return _inventoryDb
  try {
    _inventoryDb = new DatabaseSync(join(dataDir, 'inventory.db'))
    return _inventoryDb
  } catch { return null }
}

searchRouter.get('/', (req, res) => {
  try {
    const raw = String(req.query.q ?? '').trim()
    if (!raw || raw.length < 2) return res.json({ q: raw, results: {}, fetchedAt: new Date().toISOString() })
    const term = raw.toLowerCase()

    const tasks = readJson<any>('tasks.json')
      .filter(t => matches(term, t.title, t.description, t.project))
      .slice(0, 8)
      .map(t => ({ id: t.id, label: t.title, sub: t.status ?? '', kind: 'task' }))

    const todos = readJson<any>('todos.json')
      .filter(t => !t.done && matches(term, t.title, t.notes))
      .slice(0, 8)
      .map(t => ({ id: t.id, label: t.title, sub: t.severity ?? '', kind: 'todo' }))

    const links = readJson<any>('links.json')
      .filter(l => !l.archived && matches(term, l.title, l.url, l.note, ...(l.tags ?? [])))
      .slice(0, 8)
      .map(l => ({ id: l.id, label: l.title || l.url, sub: l.domain ?? '', kind: 'link', url: l.url }))

    const tobuy = readJson<any>('tobuy.json')
      .filter(i => !i.purchased && matches(term, i.title, i.notes))
      .slice(0, 5)
      .map(i => ({ id: i.id, label: i.title, sub: i.priority ?? '', kind: 'tobuy' }))

    const projects: any[] = (() => {
      const store = readJsonObj<any>('projects.json')
      return Object.values(store)
        .filter((pr: any) => matches(term, pr.name, pr.description))
        .slice(0, 5)
        .map((pr: any) => ({ id: pr.id, label: pr.name, sub: pr.status ?? '', kind: 'project' }))
    })()

    // Notes pages — from <workspace>/../notes.json
    const notes: any[] = (() => {
      try {
        const notesPath = join(process.cwd(), '..', 'notes.json')
        if (!existsSync(notesPath)) return []
        const store = JSON.parse(readFileSync(notesPath, 'utf8')) as { pages?: any[] }
        return (store.pages ?? [])
          .filter((p: any) => matches(term, p.title, p.content, ...(p.tags ?? [])))
          .slice(0, 5)
          .map((p: any) => ({ id: p.id, label: p.title, sub: (p.tags ?? []).join(', '), kind: 'note' }))
      } catch { return [] }
    })()

    // Inventory — SQLite
    const inventory: any[] = (() => {
      try {
        const db = getInventoryDb()
        if (!db) return []
        const rows = db.prepare(
          `SELECT id, name, category, manufacturer, model, notes
           FROM items
           WHERE name LIKE ? OR manufacturer LIKE ? OR model LIKE ? OR notes LIKE ?
           LIMIT 6`
        ).all(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`) as any[]
        return rows.map(r => ({
          id: r.id,
          label: r.name,
          sub: [r.manufacturer, r.model].filter(Boolean).join(' · ') || r.category || '',
          kind: 'inventory',
        }))
      } catch { return [] }
    })()

    res.json({
      q:         raw,
      results:   { tasks, todos, links, tobuy, projects, notes, inventory },
      fetchedAt: new Date().toISOString(),
    })
  } catch (err) {
    res.status(500).json({ error: 'Search failed', detail: (err as Error).message })
  }
})
