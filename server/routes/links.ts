import { Router } from 'express'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export const linksRouter = Router()

export interface StoredLink {
  id: string
  url: string
  title: string
  domain: string
  note: string
  tags: string[]
  pinned: boolean
  archived: boolean
  source: 'manual' | 'launcher' | 'inbox'
  createdAt: string
  updatedAt: string
  openedAt: string
}

function linksPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'links.json')
}

function readLinks(): StoredLink[] {
  const path = linksPath()
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredLink[]
  } catch {
    return []
  }
}

function writeLinks(links: StoredLink[]): void {
  writeFileSync(linksPath(), JSON.stringify(links, null, 2), 'utf8')
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

function normalizeUrl(raw: string): string | null {
  const candidate = raw.trim()
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '')
    const lastSegment = path.split('/').filter(Boolean).pop() ?? parsed.hostname
    const label = decodeURIComponent(lastSegment).replace(/[-_]+/g, ' ').trim()
    return label || parsed.hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function hydrate(link: StoredLink) {
  return {
    ...link,
    updatedAgo: timeAgo(link.updatedAt),
    openedAgo: link.openedAt ? timeAgo(link.openedAt) : '',
  }
}

linksRouter.get('/', (req, res) => {
  const query = String(req.query.search ?? '').trim().toLowerCase()
  const archived = req.query.archived === 'true'
  const links = readLinks()
    .filter(link => link.archived === archived)
    .filter(link => {
      if (!query) return true
      return (
        link.title.toLowerCase().includes(query)
        || link.url.toLowerCase().includes(query)
        || link.note.toLowerCase().includes(query)
        || link.tags.some(tag => tag.toLowerCase().includes(query))
      )
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

  res.json({ links: links.map(hydrate), fetchedAt: new Date().toISOString() })
})

linksRouter.post('/', (req, res) => {
  const body = req.body ?? {}
  const normalizedUrl = normalizeUrl(String(body.url ?? ''))
  if (!normalizedUrl) return res.status(400).json({ error: 'valid http(s) URL required' })

  const now = new Date().toISOString()
  const links = readLinks()
  const existing = links.find(link => link.url === normalizedUrl)
  if (existing) {
    existing.updatedAt = now
    existing.archived = false
    if (typeof body.title === 'string' && body.title.trim()) existing.title = body.title.trim()
    if (typeof body.note === 'string') existing.note = body.note
    if (Array.isArray(body.tags)) existing.tags = body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
    if (typeof body.pinned === 'boolean') existing.pinned = body.pinned
    writeLinks(links)
    return res.status(200).json({ link: hydrate(existing), deduped: true })
  }

  const link: StoredLink = {
    id: randomUUID(),
    url: normalizedUrl,
    title: String(body.title ?? '').trim() || titleFromUrl(normalizedUrl),
    domain: domainOf(normalizedUrl),
    note: typeof body.note === 'string' ? body.note : '',
    tags: Array.isArray(body.tags) ? body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean) : [],
    pinned: Boolean(body.pinned),
    archived: false,
    source: body.source === 'launcher' || body.source === 'inbox' ? body.source : 'manual',
    createdAt: now,
    updatedAt: now,
    openedAt: '',
  }

  links.unshift(link)
  writeLinks(links)
  res.status(201).json({ link: hydrate(link) })
})

linksRouter.patch('/:id', (req, res) => {
  const links = readLinks()
  const link = links.find(entry => entry.id === req.params.id)
  if (!link) return res.status(404).json({ error: 'not found' })

  const body = req.body ?? {}
  if (typeof body.url === 'string') {
    const normalizedUrl = normalizeUrl(body.url)
    if (!normalizedUrl) return res.status(400).json({ error: 'valid http(s) URL required' })
    link.url = normalizedUrl
    link.domain = domainOf(normalizedUrl)
    if (!link.title) link.title = titleFromUrl(normalizedUrl)
  }
  if (typeof body.title === 'string') link.title = body.title.trim()
  if (typeof body.note === 'string') link.note = body.note
  if (Array.isArray(body.tags)) link.tags = body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
  if (typeof body.pinned === 'boolean') link.pinned = body.pinned
  if (typeof body.archived === 'boolean') link.archived = body.archived
  if (typeof body.openedAt === 'string') link.openedAt = body.openedAt
  link.updatedAt = new Date().toISOString()

  writeLinks(links)
  res.json({ link: hydrate(link) })
})

linksRouter.delete('/:id', (req, res) => {
  const links = readLinks()
  const filtered = links.filter(link => link.id !== req.params.id)
  if (filtered.length === links.length) return res.status(404).json({ error: 'not found' })
  writeLinks(filtered)
  res.json({ ok: true })
})