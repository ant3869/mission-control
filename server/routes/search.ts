// title: Global search route
// path: server/routes/search.ts
// purpose: Single GET /api/search?q=<query> endpoint that fans out to all local
//          JSON stores and returns categorised results for the Ctrl+K palette.

import { Router } from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const searchRouter = Router()

const dataDir = join(process.cwd(), 'data')

function readJson<T>(file: string): T[] {
  try {
    const p = join(dataDir, file)
    if (!existsSync(p)) return []
    return JSON.parse(readFileSync(p, 'utf8')) as T[]
  } catch { return [] }
}

function matches(term: string, ...fields: (string | undefined)[]): boolean {
  return fields.some(f => f?.toLowerCase().includes(term))
}

searchRouter.get('/', (req, res) => {
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

  const projects: any[] = (() => {
    try {
      const p = join(dataDir, 'projects.json')
      if (!existsSync(p)) return []
      const store = JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>
      return Object.values(store)
        .filter((pr: any) => matches(term, pr.name, pr.description))
        .slice(0, 5)
        .map((pr: any) => ({ id: pr.id, label: pr.name, sub: pr.status ?? '', kind: 'project' }))
    } catch { return [] }
  })()

  res.json({
    q:         raw,
    results:   { tasks, todos, links, projects },
    fetchedAt: new Date().toISOString(),
  })
})
