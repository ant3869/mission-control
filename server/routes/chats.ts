/**
 * Claude session history → /api/chats
 *
 * Reads real Claude Code JSONL session files from the user's .claude/projects/
 * directory and parses them into a structured conversation format.
 *
 * GET /api/chats/sessions?limit=50       → list of sessions (metadata only)
 * GET /api/chats/sessions/:id            → single session with full transcript
 */
import { Router } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { createInterface } from 'readline'
import { createReadStream } from 'fs'

export const chatsRouter = Router()

// ─── Session file discovery ───────────────────────────────────────────────────

function findClaudeProjectsDir(): string | null {
  const candidates = [
    // Parent of project dir (Cowork: Mission Control/../.claude/projects)
    join(process.cwd(), '..', '.claude', 'projects'),
    // Standard home-based location
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
    // Sub-paths
    join(process.cwd(), '.claude', 'projects'),
    join(process.cwd(), 'mnt', '.claude', 'projects'),
    // Windows
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude', 'projects') : '',
    process.env.APPDATA     ? join(process.env.APPDATA,     'claude', 'projects') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'projects') : '',
  ].filter(Boolean)

  return candidates.find(p => {
    if (!p) return false
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

function collectJsonlFiles(projectsDir: string): Array<{ path: string; projectSlug: string; sessionId: string; mtime: number }> {
  const files: Array<{ path: string; projectSlug: string; sessionId: string; mtime: number }> = []
  try {
    for (const entry of readdirSync(projectsDir)) {
      const full = join(projectsDir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) {
          // Recurse one level — project slug directories
          for (const child of readdirSync(full)) {
            if (!child.endsWith('.jsonl')) continue
            const childPath = join(full, child)
            try {
              files.push({
                path:        childPath,
                projectSlug: entry,
                sessionId:   child.replace('.jsonl', ''),
                mtime:       statSync(childPath).mtimeMs,
              })
            } catch { /* skip unreadable */ }
          }
        } else if (entry.endsWith('.jsonl')) {
          files.push({
            path:        full,
            projectSlug: basename(projectsDir),
            sessionId:   entry.replace('.jsonl', ''),
            mtime:       stat.mtimeMs,
          })
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return files.sort((a, b) => b.mtime - a.mtime)
}

// ─── JSONL parsing ────────────────────────────────────────────────────────────

interface ParsedMessage {
  role:      'user' | 'assistant'
  content:   string
  timestamp: string
  tokens?:   number
}

interface ParsedSession {
  id:           string
  projectSlug:  string
  title:        string
  firstMessage: string
  messages:     ParsedMessage[]
  messageCount: number
  startedAt:    string
  lastActiveAt: string
  cwd:          string
  inputTokens:  number
  outputTokens: number
}

function extractTextFromContent(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text ?? '')
      .join('\n')
      .trim()
  }
  return ''
}

function parseJsonlFile(path: string, full = false): ParsedSession | null {
  try {
    const raw = readFileSync(path, 'utf8')
    const lines = raw.split('\n').filter(l => l.trim().startsWith('{'))

    const messages: ParsedMessage[] = []
    let cwd        = ''
    let startedAt  = ''
    let lastActive = ''
    let inputTok   = 0
    let outputTok  = 0

    for (const line of lines) {
      let entry: any
      try { entry = JSON.parse(line) } catch { continue }

      if (!startedAt && entry.timestamp) startedAt = entry.timestamp
      if (entry.timestamp) lastActive = entry.timestamp
      if (entry.cwd && !cwd) cwd = entry.cwd

      // Skip non-conversation entries
      if (entry.type !== 'user' && entry.type !== 'assistant') continue
      if (!entry.message) continue

      const { role, content } = entry.message

      // User messages: skip tool_result arrays (only keep plain text)
      if (role === 'user') {
        const text = extractTextFromContent(content)
        if (!text || text.length < 2) continue
        // Skip system-injected context messages (compaction summaries etc.)
        if (text.startsWith('This session is being continued from')) continue
        if (full || messages.length < 2) {
          messages.push({ role: 'user', content: text, timestamp: entry.timestamp ?? '' })
        } else {
          messages.push({ role: 'user', content: text, timestamp: entry.timestamp ?? '' })
        }
      }

      // Assistant messages: extract text blocks only
      if (role === 'assistant') {
        const text = extractTextFromContent(content)
        if (!text) continue
        // Accumulate token usage from assistant entries
        if (entry.usage) {
          inputTok  += entry.usage.input_tokens  ?? 0
          outputTok += entry.usage.output_tokens ?? 0
        }
        messages.push({ role: 'assistant', content: text, timestamp: entry.timestamp ?? '', tokens: entry.usage?.output_tokens })
      }
    }

    if (messages.length === 0) return null

    const firstUser  = messages.find(m => m.role === 'user')
    const title      = (firstUser?.content ?? '').slice(0, 80).replace(/\n/g, ' ')
    const sessionId  = basename(path).replace('.jsonl', '')

    return {
      id:           sessionId,
      projectSlug:  '',
      title,
      firstMessage: title,
      messages:     full ? messages : [],
      messageCount: messages.length,
      startedAt,
      lastActiveAt: lastActive,
      cwd,
      inputTokens:  inputTok,
      outputTokens: outputTok,
    }
  } catch {
    return null
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

chatsRouter.get('/sessions', (req, res) => {
  const projectsDir = findClaudeProjectsDir()
  if (!projectsDir) {
    return res.json({
      sessions:   [],
      fetchedAt:  new Date().toISOString(),
      error:      'Could not locate ~/.claude/projects directory',
    })
  }

  const limit = Math.min(Number(req.query.limit ?? 50), 200)
  const files  = collectJsonlFiles(projectsDir).slice(0, limit * 3) // over-fetch since some may parse to null

  const sessions = files
    .map(f => {
      const parsed = parseJsonlFile(f.path, false)
      if (!parsed) return null
      return { ...parsed, projectSlug: f.projectSlug }
    })
    .filter((s): s is ParsedSession => s !== null)
    .slice(0, limit)

  res.json({ sessions, fetchedAt: new Date().toISOString(), projectsDir })
})

chatsRouter.get('/sessions/:id', (req, res) => {
  const { id } = req.params
  const projectsDir = findClaudeProjectsDir()
  if (!projectsDir) return res.status(503).json({ error: 'Cannot locate .claude/projects' })

  const files = collectJsonlFiles(projectsDir)
  const file  = files.find(f => f.sessionId === id)
  if (!file) return res.status(404).json({ error: 'Session not found' })

  const parsed = parseJsonlFile(file.path, true)
  if (!parsed) return res.status(500).json({ error: 'Failed to parse session' })

  res.json({ session: { ...parsed, projectSlug: file.projectSlug }, fetchedAt: new Date().toISOString() })
})
