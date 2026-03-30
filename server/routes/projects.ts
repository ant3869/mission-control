/**
 * Projects — /api/projects
 *
 * Merges two sources:
 *  1. Auto-discovered: every directory under .claude/projects/ → one project
 *     (same slug parsing used in agents.ts)
 *  2. Manual: projects.json stored at <workspace>/../projects.json
 *     for user-created projects not backed by Claude sessions.
 *
 * GET    /api/projects         → LiveProject[]
 * POST   /api/projects         → create manual project
 * PATCH  /api/projects/:id     → update any project (stored in projects.json)
 * DELETE /api/projects/:id     → delete a stored project
 */
import { Router, Request, Response } from 'express'
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { createHash } from 'crypto'

export const projectsRouter = Router()

// ─── Helpers: paths ───────────────────────────────────────────────────────────

function findClaudeProjectsDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
    join(process.cwd(), '.claude', 'projects'),
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude',  'projects') : '',
    process.env.APPDATA     ? join(process.env.APPDATA,     'claude',  'projects') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'projects') : '',
  ].filter(Boolean)

  return candidates.find(p => {
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

function storeFile(): string {
  // Persist manual project overrides alongside the workspace
  return join(process.cwd(), '..', 'projects.json')
}

// ─── Helpers: slug → name ─────────────────────────────────────────────────────

function slugToName(slug: string): string {
  // e.g. "-home-ant-code-my-app" → "my-app" (last segment)
  const parts = slug.replace(/^[-/\\]+/, '').split(/[-/\\]+/)
  // Walk backwards, skip generic segments
  const SKIP = new Set(['home', 'users', 'ant', 'user', 'root', 'documents', 'code', 'projects', 'dev'])
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] && !SKIP.has(parts[i].toLowerCase())) {
      // Title-case the segment (replace hyphens with spaces)
      return parts[i].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }
  }
  return slug.slice(0, 30)
}

function slugToCwd(slug: string): string {
  // Reverse the slug encoding: leading hyphens = path separators
  return '/' + slug.replace(/^-+/, '').replace(/-/g, '/')
}

// ─── Helpers: JSONL parsing ───────────────────────────────────────────────────

interface SessionMeta {
  mtimeMs:     number
  inputTokens: number
  outputTokens: number
  messageCount: number
  cwd:         string
  model:       string
}

function parseSessionMeta(filePath: string): SessionMeta | null {
  try {
    const stat = statSync(filePath)
    let inputTokens = 0, outputTokens = 0, messageCount = 0
    let cwd = '', model = ''
    const raw = readFileSync(filePath, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.cwd)   cwd   = obj.cwd
        if (obj.model) model = obj.model
        if (obj.message?.usage) {
          inputTokens  += obj.message.usage.input_tokens  ?? 0
          outputTokens += obj.message.usage.output_tokens ?? 0
        }
        if (obj.usage) {
          inputTokens  += obj.usage.input_tokens  ?? 0
          outputTokens += obj.usage.output_tokens ?? 0
        }
        if (obj.type === 'user' || obj.type === 'assistant') messageCount++
      } catch { /* skip malformed line */ }
    }
    return { mtimeMs: stat.mtimeMs, inputTokens, outputTokens, messageCount, cwd, model }
  } catch { return null }
}

// ─── Helpers: derive project fields ──────────────────────────────────────────

type ProjectStatus   = 'active' | 'planning' | 'paused' | 'completed'
type ProjectPriority = 'high' | 'medium' | 'low'

export interface LiveProject {
  id:          string
  name:        string
  description: string
  status:      ProjectStatus
  priority:    ProjectPriority
  progress:    number          // 0–100
  assignee:    string
  tags:        string[]
  sessionCount: number
  totalTokens: number
  cwd:         string
  model:       string
  updatedAgo:  string
  updatedAt:   string          // ISO
  createdAt:   string          // ISO
  source:      'discovered' | 'manual'
}

function timeAgo(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000)
  if (sec < 60)              return 'just now'
  if (sec < 3600)            return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400)           return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 30)      return `${Math.floor(sec / 86400)}d ago`
  return `${Math.floor(sec / (86400 * 30))}mo ago`
}

function deriveStatus(latestMtimeMs: number, sessionCount: number): ProjectStatus {
  const ageH = (Date.now() - latestMtimeMs) / 3_600_000
  if (ageH < 2)    return 'active'
  if (ageH < 24)   return 'paused'
  if (ageH < 168)  return sessionCount > 3 ? 'paused' : 'planning'
  return sessionCount > 10 ? 'paused' : 'planning'
}

function deriveProgress(sessionCount: number, status: ProjectStatus): number {
  if (status === 'completed') return 100
  // Loosely: 0 sessions = 0%, 1 = 10%, 5 = 40%, 20 = 75%, 50+ ≈ 90%
  const raw = Math.min(90, Math.round(Math.log2(sessionCount + 1) * 18))
  return raw
}

// ─── Manual store ─────────────────────────────────────────────────────────────

interface StoredProject {
  id:          string
  name?:       string
  description?: string
  status?:     ProjectStatus
  priority?:   ProjectPriority
  progress?:   number
  assignee?:   string
  tags?:       string[]
  source?:     'manual'
  createdAt?:  string
  // for manual-only projects
  cwd?:        string
}

function readStore(): Record<string, StoredProject> {
  try {
    const f = storeFile()
    if (!existsSync(f)) return {}
    return JSON.parse(readFileSync(f, 'utf8')) as Record<string, StoredProject>
  } catch { return {} }
}

function writeStore(store: Record<string, StoredProject>) {
  try {
    writeFileSync(storeFile(), JSON.stringify(store, null, 2), 'utf8')
  } catch (e) {
    console.error('[projects] write store error', e)
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildProjects(): { projects: LiveProject[]; error?: string } {
  const store    = readStore()
  const projects: LiveProject[] = []
  const seenIds  = new Set<string>()

  const projectsDir = findClaudeProjectsDir()

  if (projectsDir) {
    let slugDirs: string[] = []
    try { slugDirs = readdirSync(projectsDir) } catch { /* skip */ }

    for (const slug of slugDirs) {
      const slugPath = join(projectsDir, slug)
      try {
        if (!statSync(slugPath).isDirectory()) continue
      } catch { continue }

      let jsonlFiles: string[] = []
      try {
        jsonlFiles = readdirSync(slugPath)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => join(slugPath, f))
      } catch { continue }

      if (!jsonlFiles.length) continue

      const metas = jsonlFiles
        .map(parseSessionMeta)
        .filter((m): m is SessionMeta => m !== null)

      if (!metas.length) continue

      metas.sort((a, b) => b.mtimeMs - a.mtimeMs)
      const latest  = metas[0]
      const totalIn = metas.reduce((s, m) => s + m.inputTokens, 0)
      const totalOut= metas.reduce((s, m) => s + m.outputTokens, 0)

      const id      = createHash('sha1').update(slug).digest('hex').slice(0, 12)
      seenIds.add(id)

      const overrides  = store[id] ?? {}
      const autoStatus = deriveStatus(latest.mtimeMs, metas.length)
      const status     = overrides.status ?? autoStatus
      const progress   = overrides.progress ?? deriveProgress(metas.length, status)
      const name       = overrides.name ?? slugToName(slug)
      const cwd        = latest.cwd || slugToCwd(slug)

      projects.push({
        id,
        name,
        description: overrides.description ?? `${metas.length} session${metas.length !== 1 ? 's' : ''}  ·  ${cwd}`,
        status,
        priority:    overrides.priority ?? (autoStatus === 'active' ? 'high' : 'medium'),
        progress,
        assignee:    overrides.assignee ?? 'Claude',
        tags:        overrides.tags ?? [],
        sessionCount: metas.length,
        totalTokens: totalIn + totalOut,
        cwd,
        model:       latest.model,
        updatedAgo:  timeAgo(latest.mtimeMs),
        updatedAt:   new Date(latest.mtimeMs).toISOString(),
        createdAt:   new Date(Math.min(...metas.map(m => m.mtimeMs))).toISOString(),
        source:      'discovered',
      })
    }
  }

  // Add manual-only projects (those not discovered above)
  for (const [id, stored] of Object.entries(store)) {
    if (seenIds.has(id)) continue
    if (!stored.source || stored.source !== 'manual') continue
    const status = stored.status ?? 'planning'
    projects.push({
      id,
      name:        stored.name ?? 'Unnamed Project',
      description: stored.description ?? '',
      status,
      priority:    stored.priority ?? 'medium',
      progress:    stored.progress ?? 0,
      assignee:    stored.assignee ?? 'Unassigned',
      tags:        stored.tags ?? [],
      sessionCount: 0,
      totalTokens: 0,
      cwd:         stored.cwd ?? '',
      model:       '',
      updatedAgo:  'unknown',
      updatedAt:   stored.createdAt ?? new Date().toISOString(),
      createdAt:   stored.createdAt ?? new Date().toISOString(),
      source:      'manual',
    })
  }

  // Sort: active first, then by updatedAt desc
  const ORDER: Record<ProjectStatus, number> = { active: 0, paused: 1, planning: 2, completed: 3 }
  projects.sort((a, b) => {
    const sd = ORDER[a.status] - ORDER[b.status]
    if (sd !== 0) return sd
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  const error = !projectsDir ? 'Claude projects directory not found — no auto-discovered projects' : undefined
  return { projects, error }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

projectsRouter.get('/', (_req: Request, res: Response) => {
  const { projects, error } = buildProjects()
  res.json({ projects, fetchedAt: new Date().toISOString(), error })
})

projectsRouter.post('/', (req: Request, res: Response) => {
  const { name, description, status, priority, progress, assignee, tags, cwd } = req.body as Partial<LiveProject>
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const id    = createHash('sha1').update(name + Date.now()).digest('hex').slice(0, 12)
  const store = readStore()
  const now   = new Date().toISOString()
  const stored: StoredProject = {
    id, name, description, status, priority, progress,
    assignee, tags, cwd, source: 'manual', createdAt: now,
  }
  store[id] = stored
  writeStore(store)

  const project: LiveProject = {
    id, name: name!, description: description ?? '',
    status: status ?? 'planning', priority: priority ?? 'medium',
    progress: progress ?? 0, assignee: assignee ?? 'Unassigned',
    tags: tags ?? [], sessionCount: 0, totalTokens: 0, cwd: cwd ?? '',
    model: '', updatedAgo: 'just now', updatedAt: now, createdAt: now,
    source: 'manual',
  }
  res.status(201).json({ project })
})

projectsRouter.patch('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const store  = readStore()
  const existing = store[id] ?? {}
  const merged: StoredProject = { ...existing, id, ...req.body }
  store[id] = merged
  writeStore(store)

  // Re-build to return the full merged project
  const { projects } = buildProjects()
  const project = projects.find(p => p.id === id)
  if (!project) {
    res.status(404).json({ error: 'Project not found' })
    return
  }
  res.json({ project })
})

projectsRouter.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const store  = readStore()
  delete store[id]
  writeStore(store)
  res.json({ ok: true })
})
