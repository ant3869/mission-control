/**
 * Notes — /api/notes
 *
 * Three-tier hierarchy: Notebooks → Sections → Pages
 * Persisted in <workspace>/../notes.json
 *
 * GET    /api/notes/notebooks              → all notebooks
 * POST   /api/notes/notebooks              → create notebook
 * PATCH  /api/notes/notebooks/:id          → update notebook
 * DELETE /api/notes/notebooks/:id          → delete (cascades to sections + pages)
 *
 * GET    /api/notes/sections               → all sections (?notebookId=)
 * POST   /api/notes/sections              → create section
 * PATCH  /api/notes/sections/:id           → update section
 * DELETE /api/notes/sections/:id           → delete (cascades to pages)
 *
 * GET    /api/notes/pages                  → page list (?sectionId= | ?notebookId= | ?search= | ?pinned=true)
 * GET    /api/notes/pages/:id              → single page with content
 * POST   /api/notes/pages                  → create page
 * PATCH  /api/notes/pages/:id              → update page (title/content/tags/pinned)
 * DELETE /api/notes/pages/:id              → delete page
 */
import { Router, Request, Response } from 'express'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { saveJson } from '../lib/jsonStore.js'

export const notesRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NoteNotebook {
  id:        string
  name:      string
  color:     string    // hex or tailwind color name used for accent
  icon:      string    // emoji
  createdAt: string
  updatedAt: string
}

export interface NoteSection {
  id:         string
  notebookId: string
  name:       string
  color:      string
  createdAt:  string
  updatedAt:  string
}

export interface NotePage {
  id:         string
  sectionId:  string
  notebookId: string
  title:      string
  content:    string
  tags:       string[]
  pinned:     boolean
  wordCount:  number
  createdAt:  string
  updatedAt:  string
  updatedAgo: string
}

interface NotesStore {
  notebooks: NoteNotebook[]
  sections:  NoteSection[]
  pages:     NotePage[]
}

// ─── Store ────────────────────────────────────────────────────────────────────

function storeFile(): string {
  return join(process.cwd(), '..', 'notes.json')
}

function readStore(): NotesStore {
  try {
    const f = storeFile()
    if (!existsSync(f)) return { notebooks: [], sections: [], pages: [] }
    return JSON.parse(readFileSync(f, 'utf8')) as NotesStore
  } catch {
    return { notebooks: [], sections: [], pages: [] }
  }
}

function writeStore(store: NotesStore) {
  try {
    saveJson(storeFile(), store)
  } catch (e) {
    console.error('[notes] write error', e)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return createHash('sha1').update(Math.random().toString() + Date.now()).digest('hex').slice(0, 12)
}

function timeAgo(isoStr: string): string {
  const sec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (sec < 60)         return 'just now'
  if (sec < 3600)       return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400)      return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d ago`
  return `${Math.floor(sec / (86400 * 30))}mo ago`
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function hydratePage(p: NotePage): NotePage {
  return { ...p, updatedAgo: timeAgo(p.updatedAt), wordCount: countWords(p.content) }
}

function pageList(p: NotePage): Omit<NotePage, 'content'> & { content?: undefined } {
  const { content: _content, ...rest } = hydratePage(p)
  return rest as any
}

// ─── Default notebook seed ────────────────────────────────────────────────────

function seedIfEmpty(store: NotesStore): NotesStore {
  if (store.notebooks.length > 0) return store
  const now = new Date().toISOString()
  const nbId = uid()
  const secId = uid()
  const notebook: NoteNotebook = {
    id: nbId, name: 'Personal', color: '#6366f1', icon: '📓',
    createdAt: now, updatedAt: now,
  }
  const section: NoteSection = {
    id: secId, notebookId: nbId, name: 'General',
    color: '#6366f1', createdAt: now, updatedAt: now,
  }
  const welcome: NotePage = {
    id: uid(), sectionId: secId, notebookId: nbId,
    title: 'Welcome to Notes',
    content: `# Welcome to Notes\n\nThis is your personal notes space inside Mission Control.\n\n## What you can do\n\n- Create **notebooks** to organize by topic or project\n- Add **sections** within each notebook\n- Write **pages** with full markdown support\n- **Pin** important pages to the top\n- **Tag** pages for quick filtering\n- **Search** across all your notes instantly\n\n## Markdown support\n\nPages support **bold**, *italic*, \`inline code\`, headings, lists, blockquotes, and code blocks.\n\n> Start writing and your notes auto-save after a short pause.\n\nPress ⌘K to search, ⌘N to create a new page.`,
    tags: ['welcome', 'guide'], pinned: true,
    wordCount: 0, createdAt: now, updatedAt: now, updatedAgo: 'just now',
  }
  const updated: NotesStore = {
    notebooks: [notebook],
    sections:  [section],
    pages:     [welcome],
  }
  writeStore(updated)
  return updated
}

// ─── Routes: Notebooks ────────────────────────────────────────────────────────

notesRouter.get('/notebooks', (_req: Request, res: Response) => {
  let store = readStore()
  store = seedIfEmpty(store)
  // Attach counts
  const notebooks = store.notebooks.map(nb => ({
    ...nb,
    sectionCount: store.sections.filter(s => s.notebookId === nb.id).length,
    pageCount:    store.pages.filter(p => p.notebookId === nb.id).length,
  }))
  res.json({ notebooks, fetchedAt: new Date().toISOString() })
})

notesRouter.post('/notebooks', (req: Request, res: Response) => {
  const { name, color = '#6366f1', icon = '📓' } = req.body as Partial<NoteNotebook>
  if (!name?.trim()) { res.status(400).json({ error: 'name required' }); return }
  const now = new Date().toISOString()
  const nb: NoteNotebook = { id: uid(), name: name!, color, icon, createdAt: now, updatedAt: now }
  const store = readStore()
  store.notebooks.push(nb)
  writeStore(store)
  res.status(201).json({ notebook: nb })
})

notesRouter.patch('/notebooks/:id', (req: Request, res: Response) => {
  const store = readStore()
  const idx = store.notebooks.findIndex(n => n.id === req.params.id)
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return }
  store.notebooks[idx] = { ...store.notebooks[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() }
  writeStore(store)
  res.json({ notebook: store.notebooks[idx] })
})

notesRouter.delete('/notebooks/:id', (req: Request, res: Response) => {
  const store = readStore()
  const id = req.params.id
  store.notebooks = store.notebooks.filter(n => n.id !== id)
  store.sections  = store.sections.filter(s => s.notebookId !== id)
  store.pages     = store.pages.filter(p => p.notebookId !== id)
  writeStore(store)
  res.json({ ok: true })
})

// ─── Routes: Sections ─────────────────────────────────────────────────────────

notesRouter.get('/sections', (req: Request, res: Response) => {
  const store = readStore()
  let sections = store.sections
  if (req.query.notebookId) sections = sections.filter(s => s.notebookId === req.query.notebookId)
  const result = sections.map(s => ({
    ...s,
    pageCount: store.pages.filter(p => p.sectionId === s.id).length,
  }))
  res.json({ sections: result, fetchedAt: new Date().toISOString() })
})

notesRouter.post('/sections', (req: Request, res: Response) => {
  const { notebookId, name, color = '#6366f1' } = req.body as Partial<NoteSection>
  if (!notebookId || !name?.trim()) { res.status(400).json({ error: 'notebookId and name required' }); return }
  const store = readStore()
  if (!store.notebooks.find(n => n.id === notebookId)) { res.status(404).json({ error: 'Notebook not found' }); return }
  const now = new Date().toISOString()
  const section: NoteSection = { id: uid(), notebookId: notebookId!, name: name!, color, createdAt: now, updatedAt: now }
  store.sections.push(section)
  writeStore(store)
  res.status(201).json({ section })
})

notesRouter.patch('/sections/:id', (req: Request, res: Response) => {
  const store = readStore()
  const idx = store.sections.findIndex(s => s.id === req.params.id)
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return }
  store.sections[idx] = { ...store.sections[idx], ...req.body, id: req.params.id, updatedAt: new Date().toISOString() }
  writeStore(store)
  res.json({ section: store.sections[idx] })
})

notesRouter.delete('/sections/:id', (req: Request, res: Response) => {
  const store = readStore()
  const id = req.params.id
  store.sections = store.sections.filter(s => s.id !== id)
  store.pages    = store.pages.filter(p => p.sectionId !== id)
  writeStore(store)
  res.json({ ok: true })
})

// ─── Routes: Pages ────────────────────────────────────────────────────────────

notesRouter.get('/pages', (req: Request, res: Response) => {
  const store = readStore()
  let pages = store.pages

  if (req.query.sectionId)  pages = pages.filter(p => p.sectionId === req.query.sectionId)
  if (req.query.notebookId) pages = pages.filter(p => p.notebookId === req.query.notebookId)
  if (req.query.pinned === 'true') pages = pages.filter(p => p.pinned)

  const search = (req.query.search as string | undefined)?.toLowerCase()
  if (search) {
    pages = pages.filter(p =>
      p.title.toLowerCase().includes(search) ||
      p.content.toLowerCase().includes(search) ||
      p.tags.some(t => t.toLowerCase().includes(search))
    )
  }

  // Sort: pinned first, then updatedAt desc
  pages = [...pages].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  res.json({ pages: pages.map(pageList), total: pages.length, fetchedAt: new Date().toISOString() })
})

notesRouter.get('/pages/:id', (req: Request, res: Response) => {
  const store = readStore()
  const page = store.pages.find(p => p.id === req.params.id)
  if (!page) { res.status(404).json({ error: 'Not found' }); return }
  res.json({ page: hydratePage(page), fetchedAt: new Date().toISOString() })
})

notesRouter.post('/pages', (req: Request, res: Response) => {
  const { sectionId, notebookId, title = 'Untitled', content = '', tags = [], pinned = false } = req.body as Partial<NotePage>
  if (!sectionId || !notebookId) { res.status(400).json({ error: 'sectionId and notebookId required' }); return }
  const now = new Date().toISOString()
  const page: NotePage = {
    id: uid(), sectionId: sectionId!, notebookId: notebookId!,
    title: title!, content: content!,
    tags: tags ?? [], pinned: pinned ?? false,
    wordCount: countWords(content!),
    createdAt: now, updatedAt: now, updatedAgo: 'just now',
  }
  const store = readStore()
  store.pages.unshift(page)
  writeStore(store)
  res.status(201).json({ page: hydratePage(page) })
})

notesRouter.patch('/pages/:id', (req: Request, res: Response) => {
  const store = readStore()
  const idx = store.pages.findIndex(p => p.id === req.params.id)
  if (idx === -1) { res.status(404).json({ error: 'Not found' }); return }
  const now = new Date().toISOString()
  const updated: NotePage = {
    ...store.pages[idx],
    ...req.body,
    id:        req.params.id,
    updatedAt: now,
    wordCount: countWords(req.body.content ?? store.pages[idx].content),
  }
  store.pages[idx] = updated
  writeStore(store)
  res.json({ page: hydratePage(updated) })
})

notesRouter.delete('/pages/:id', (req: Request, res: Response) => {
  const store = readStore()
  store.pages = store.pages.filter(p => p.id !== req.params.id)
  writeStore(store)
  res.json({ ok: true })
})
