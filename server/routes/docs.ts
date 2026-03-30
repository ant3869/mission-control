/**
 * Workspace documents → /api/docs
 *
 * Scans the user's workspace (the mounted folder) for markdown, text,
 * and other readable document files.
 *
 * GET /api/docs/files              → list all discovered docs (metadata)
 * GET /api/docs/files/:id          → single doc with full content (base64 encoded id = filepath)
 */
import { Router } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, extname, basename, relative } from 'path'

export const docsRouter = Router()

// ─── Find workspace root ──────────────────────────────────────────────────────

function findWorkspaceDir(): string | null {
  const candidates = [
    process.env.WORKSPACE_DIR ?? '',
    // Parent of the project dir — where .auto-memory, .claude etc live alongside user docs
    join(process.cwd(), '..'),
    join(homedir(), 'Documents'),
    join(homedir(), 'Desktop'),
    join(homedir(), 'Notes'),
    join(homedir(), 'docs'),
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Desktop')   : '',
  ].filter(Boolean)

  return candidates.find(p => {
    try { return p && existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

// ─── File scanner ─────────────────────────────────────────────────────────────

const READABLE_EXTS   = new Set(['.md', '.txt', '.mdx', '.rst'])
const SKIP_DIRS       = new Set([
  'node_modules', '.git', 'dist', '.cache', 'build', '.cache',
  'vendor', 'coverage', '__pycache__', '.venv', 'venv',
  // Mission Control project itself (it's code, not docs)
  'Mission Control',
])
const MAX_DEPTH       = 4
const MAX_FILES       = 200

interface DocFile {
  id:         string     // base64url of relative path
  filename:   string
  path:       string     // relative from workspace root
  ext:        string
  tags:       string[]
  wordCount:  number
  updatedAt:  number
  updatedAgo: string
  preview:    string     // first 200 chars of content
  content?:   string     // only populated in single-file response
}

function tagFromPath(filepath: string): string[] {
  const tags: string[] = []
  const lower = filepath.toLowerCase()
  if (lower.includes('journal')) tags.push('Journal')
  if (lower.includes('newsletter') || lower.includes('email')) tags.push('Newsletter')
  if (lower.includes('note'))    tags.push('Notes')
  if (lower.includes('doc') || lower.includes('readme')) tags.push('Doc')
  if (tags.length === 0) tags.push('Other')
  return tags
}

function scanDir(dir: string, root: string, depth = 0, acc: DocFile[] = []): DocFile[] {
  if (depth > MAX_DEPTH || acc.length >= MAX_FILES) return acc

  let entries: string[]
  try { entries = readdirSync(dir) } catch { return acc }

  for (const entry of entries) {
    if (acc.length >= MAX_FILES) break
    if (entry.startsWith('.') && entry !== '.auto-memory') continue

    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) scanDir(full, root, depth + 1, acc)
      } else if (READABLE_EXTS.has(extname(entry).toLowerCase())) {
        const relPath = relative(root, full)
        const raw     = readFileSync(full, 'utf8')
        // Strip frontmatter for preview/wordcount
        const stripped = raw.startsWith('---')
          ? raw.slice(raw.indexOf('\n---', 3) + 4).trim()
          : raw

        const wordCount = stripped.split(/\s+/).filter(Boolean).length
        const preview   = stripped.slice(0, 200).replace(/\n/g, ' ')

        acc.push({
          id:         Buffer.from(relPath).toString('base64url'),
          filename:   basename(entry),
          path:       relPath,
          ext:        extname(entry).slice(1),
          tags:       tagFromPath(relPath),
          wordCount,
          updatedAt:  stat.mtimeMs,
          updatedAgo: relativeTime(stat.mtimeMs),
          preview,
        })
      }
    } catch { /* skip unreadable */ }
  }
  return acc
}

// ─── Routes ──────────────────────────────────────────────────────────────────

docsRouter.get('/files', (_req, res) => {
  const workspace = findWorkspaceDir()
  if (!workspace) {
    return res.json({
      files:     [],
      fetchedAt: new Date().toISOString(),
      error:     'Workspace directory not found',
    })
  }

  const files = scanDir(workspace, workspace)
  files.sort((a, b) => b.updatedAt - a.updatedAt)

  res.json({ files, workspace, fetchedAt: new Date().toISOString() })
})

docsRouter.get('/files/:id', (req, res) => {
  const workspace = findWorkspaceDir()
  if (!workspace) return res.status(503).json({ error: 'Workspace not found' })

  let relPath: string
  try {
    relPath = Buffer.from(req.params.id, 'base64url').toString('utf8')
  } catch {
    return res.status(400).json({ error: 'Invalid file ID' })
  }

  // Safety: must remain inside workspace
  const absPath = join(workspace, relPath)
  if (!absPath.startsWith(workspace)) return res.status(403).json({ error: 'Forbidden' })

  if (!existsSync(absPath)) return res.status(404).json({ error: 'File not found' })

  try {
    const raw    = readFileSync(absPath, 'utf8')
    const stat   = statSync(absPath)
    const stripped = raw.startsWith('---')
      ? raw.slice(raw.indexOf('\n---', 3) + 4).trim()
      : raw
    const wordCount = stripped.split(/\s+/).filter(Boolean).length

    res.json({
      file: {
        id:         req.params.id,
        filename:   basename(absPath),
        path:       relPath,
        ext:        extname(absPath).slice(1),
        tags:       tagFromPath(relPath),
        wordCount,
        updatedAt:  stat.mtimeMs,
        updatedAgo: relativeTime(stat.mtimeMs),
        preview:    stripped.slice(0, 200).replace(/\n/g, ' '),
        content:    stripped,
      },
      fetchedAt: new Date().toISOString(),
    })
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
