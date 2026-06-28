/**
 * Long-term memory → /api/memory
 *
 * Reads real memory files from the .auto-memory/ directory used by Claude Code.
 * Files have YAML frontmatter (name, description, type) followed by markdown content.
 *
 * GET /api/memory/entries         → all memory entries with full content
 * GET /api/memory/index           → raw MEMORY.md index content
 */
import { Router } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, extname } from 'path'
import { getMemory } from '../lib/agentSources.js'

export const memoryRouter = Router()

// ─── Find memory directory ────────────────────────────────────────────────────

function findMemoryDir(): string | null {
  const candidates = [
    // Parent of project dir (Cowork: Mission Control/../.auto-memory)
    join(process.cwd(), '..', '.auto-memory'),
    // Home-based (standard Claude Code location)
    join(homedir(), '.auto-memory'),
    join(homedir(), '.claude', 'memory'),
    // Workspace sub-paths
    join(process.cwd(), '.auto-memory'),
    join(process.cwd(), 'mnt', '.auto-memory'),
    // Windows
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude', 'memory') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'memory') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.auto-memory') : '',
  ].filter(Boolean)

  return candidates.find(p => {
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

interface MemoryMeta {
  name:        string
  description: string
  type:        'user' | 'feedback' | 'project' | 'reference' | 'other'
}

function parseFrontmatter(raw: string): { meta: MemoryMeta; content: string } {
  const DEFAULT: MemoryMeta = { name: '', description: '', type: 'other' }
  if (!raw.startsWith('---')) return { meta: DEFAULT, content: raw }

  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { meta: DEFAULT, content: raw }

  const fmRaw  = raw.slice(3, end).trim()
  const content = raw.slice(end + 4).trim()
  const meta: MemoryMeta = { ...DEFAULT }

  for (const line of fmRaw.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
    if (key === 'name')        meta.name        = val
    if (key === 'description') meta.description = val
    if (key === 'type')        meta.type        = val as MemoryMeta['type']
  }

  if (!meta.name) meta.name = content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60)
  return { meta, content }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

memoryRouter.get('/entries', async (_req, res) => {
  const dir = findMemoryDir()
  const entries: any[] = []

  // ── Source 1: .auto-memory files ──────────────────────────────────────────
  if (dir) {
    try {
      const files = readdirSync(dir).filter(f =>
        extname(f) === '.md' && f !== 'MEMORY.md'
      )

      for (const filename of files) {
        const filepath = join(dir, filename)
        try {
          const raw  = readFileSync(filepath, 'utf8')
          const stat = statSync(filepath)
          const { meta, content } = parseFrontmatter(raw)

          const wordCount = content.split(/\s+/).filter(Boolean).length

          entries.push({
            id:          filename.replace('.md', ''),
            filename,
            name:        meta.name || filename.replace('.md', '').replace(/_/g, ' '),
            description: meta.description,
            type:        meta.type,
            content,
            wordCount,
            updatedAt:   stat.mtimeMs,
            updatedAgo:  relativeTime(stat.mtimeMs),
          })
        } catch { /* skip unreadable */ }
      }
    } catch { /* ignore */ }
  }

  // ── Source 2: OpenClaw + Hermes conversation memory ───────────────────────
  try {
    const [oc, hm] = await Promise.all([getMemory('openclaw'), getMemory('hermes')])
    entries.push(...oc, ...hm)
  } catch { /* ignore */ }

  if (entries.length === 0) {
    return res.json({
      entries:   [],
      fetchedAt: new Date().toISOString(),
      error:     'No memory sources found. Waiting for .auto-memory files or OpenClaw conversation data.',
    })
  }

  // Sort: most recently updated first
  entries.sort((a, b) => b.updatedAt - a.updatedAt)

  res.json({ entries, dir, fetchedAt: new Date().toISOString() })
})

memoryRouter.get('/index', (_req, res) => {
  const dir = findMemoryDir()
  if (!dir) return res.json({ content: null })

  const indexPath = join(dir, 'MEMORY.md')
  try {
    const content = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
    res.json({ content, dir, fetchedAt: new Date().toISOString() })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const mins  = Math.floor(diff / 60_000)
  const hrs   = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs  < 24) return `${hrs}h ago`
  if (days < 7)  return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}
