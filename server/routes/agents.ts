/**
 * Live Claude agent sessions → /api/agents
 *
 * Groups JSONL session files by project slug, derives per-project "agent"
 * state from the last tool_use block in the most recent session, and
 * aggregates token/cost totals across all sessions in the project.
 *
 * GET /api/agents/projects   → array of LiveAgent
 */
import { Router } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { getAgents } from '../lib/agentSources.js'

export const agentsRouter = Router()

// ─── Paths ────────────────────────────────────────────────────────────────────

function findClaudeProjectsDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
    join(process.cwd(), '.claude', 'projects'),
    join(process.cwd(), 'mnt', '.claude', 'projects'),
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude',  'projects') : '',
    process.env.APPDATA     ? join(process.env.APPDATA,     'claude',  'projects') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'projects') : '',
  ].filter(Boolean)

  return candidates.find(p => {
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

// ─── State inference ──────────────────────────────────────────────────────────

export type AgentState =
  | 'thinking' | 'coding' | 'writing' | 'searching'
  | 'planning'  | 'reading' | 'sleeping' | 'idle' | 'error'

const TOOL_STATE_MAP: Record<string, AgentState> = {
  // Coding / file manipulation
  Bash:        'coding',
  Write:       'coding',
  Edit:        'coding',
  MultiEdit:   'coding',
  NotebookEdit:'coding',
  // Reading
  Read:        'reading',
  Glob:        'reading',
  Grep:        'reading',
  // Searching / web
  WebSearch:   'searching',
  WebFetch:    'searching',
  // Planning / orchestration
  Agent:       'planning',
  TodoWrite:   'planning',
  ExitPlanMode:'planning',
  // Writing / docs
  Skill:       'writing',
}

function toolToState(toolName: string): AgentState {
  if (TOOL_STATE_MAP[toolName]) return TOOL_STATE_MAP[toolName]
  if (toolName.startsWith('mcp__')) {
    const lower = toolName.toLowerCase()
    if (lower.includes('search') || lower.includes('fetch') || lower.includes('web')) return 'searching'
    if (lower.includes('calendar') || lower.includes('schedule') || lower.includes('task')) return 'planning'
    if (lower.includes('read') || lower.includes('file') || lower.includes('list')) return 'reading'
    return 'thinking'
  }
  return 'thinking'
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

const PRICE_PER_MTok: Record<string, { in: number; out: number }> = {
  'claude-opus-4-5':       { in: 15.00, out: 75.00 },
  'claude-opus-4':         { in: 15.00, out: 75.00 },
  'claude-sonnet-4-5':     { in:  3.00, out: 15.00 },
  'claude-sonnet-4-6':     { in:  3.00, out: 15.00 },
  'claude-sonnet-4':       { in:  3.00, out: 15.00 },
  'claude-3-5-sonnet':     { in:  3.00, out: 15.00 },
  'claude-haiku-4-5':      { in:  0.80, out:  4.00 },
  'claude-haiku-4':        { in:  0.80, out:  4.00 },
  'claude-3-5-haiku':      { in:  0.80, out:  4.00 },
  'claude-3-haiku':        { in:  0.25, out:  1.25 },
  'claude-3-opus':         { in: 15.00, out: 75.00 },
}

function calcCost(model: string, inputTok: number, outputTok: number): number {
  const key = Object.keys(PRICE_PER_MTok).find(k => model.includes(k)) ?? ''
  const p   = PRICE_PER_MTok[key] ?? { in: 3.00, out: 15.00 }
  return (inputTok / 1_000_000) * p.in + (outputTok / 1_000_000) * p.out
}

// ─── JSONL parsing ────────────────────────────────────────────────────────────

interface SessionSummary {
  sessionId:    string
  mtime:        number
  lastTool:     string | null
  lastToolInput: string
  lastUserMsg:  string
  systemPrompt: string
  model:        string
  cwd:          string
  inputTokens:  number
  outputTokens: number
  startedAt:    string
  lastActiveAt: string
  messageCount: number
}

function parseSession(filePath: string): SessionSummary | null {
  try {
    const raw   = readFileSync(filePath, 'utf8')
    const lines = raw.split('\n').filter(l => l.trim().startsWith('{'))

    let lastTool      = null as string | null
    let lastToolInput = ''
    let lastUserMsg   = ''
    let systemPrompt  = ''
    let model         = ''
    let cwd           = ''
    let inputTok      = 0
    let outputTok     = 0
    let startedAt     = ''
    let lastActive    = ''
    let msgCount      = 0

    for (const line of lines) {
      let e: any
      try { e = JSON.parse(line) } catch { continue }

      if (!startedAt && e.timestamp) startedAt = e.timestamp
      if (e.timestamp) lastActive = e.timestamp
      if (e.cwd && !cwd) cwd = e.cwd

      // Accumulate usage from any entry that has it
      if (e.usage) {
        inputTok  += e.usage.input_tokens  ?? 0
        outputTok += e.usage.output_tokens ?? 0
      }

      // Track model from assistant entries
      if (e.message?.model) model = e.message.model

      // Extract system prompt from the first system entry
      if (!systemPrompt && e.type === 'system' && typeof e.content === 'string') {
        systemPrompt = e.content.slice(0, 300)
      }

      if (e.type !== 'user' && e.type !== 'assistant') continue
      if (!e.message) continue

      const { role, content } = e.message
      msgCount++

      if (role === 'user') {
        const text = typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
            : ''
        if (text && text.length > 2 && !text.startsWith('This session is being continued')) {
          lastUserMsg = text.slice(0, 120).replace(/\n/g, ' ')
        }
      }

      if (role === 'assistant' && Array.isArray(content)) {
        // Accumulate usage if on the message itself
        if (e.message.usage) {
          inputTok  += e.message.usage.input_tokens  ?? 0
          outputTok += e.message.usage.output_tokens ?? 0
        }
        for (const block of content) {
          if (block.type === 'tool_use') {
            lastTool = block.name ?? null
            // Build a short description from the tool input
            const inp = block.input ?? {}
            if (inp.command)   lastToolInput = String(inp.command).slice(0, 80)
            else if (inp.query)    lastToolInput = String(inp.query).slice(0, 80)
            else if (inp.pattern)  lastToolInput = String(inp.pattern).slice(0, 80)
            else if (inp.file_path)lastToolInput = String(inp.file_path).slice(0, 80)
            else if (inp.prompt)   lastToolInput = String(inp.prompt).slice(0, 80)
            else                   lastToolInput = ''
          }
        }
      }
    }

    if (!startedAt && !lastActive) return null

    return {
      sessionId:    basename(filePath).replace('.jsonl', ''),
      mtime:        statSync(filePath).mtimeMs,
      lastTool,
      lastToolInput,
      lastUserMsg,
      systemPrompt,
      model,
      cwd,
      inputTokens:  inputTok,
      outputTokens: outputTok,
      startedAt,
      lastActiveAt: lastActive,
      messageCount: msgCount,
    }
  } catch {
    return null
  }
}

// ─── Relative time ────────────────────────────────────────────────────────────

function relAgo(iso: string): string {
  if (!iso) return 'unknown'
  const diff = Date.now() - new Date(iso).getTime()
  const sec  = Math.floor(diff / 1000)
  if (sec < 60)  return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60)  return `${min}m ago`
  const hr  = Math.floor(min / 60)
  if (hr  < 24)  return `${hr}h ago`
  const day = Math.floor(hr  / 24)
  return `${day}d ago`
}

function slugToName(slug: string): string {
  // Convert path-like slugs: -home-user-projects-my-app → My App
  return slug
    .replace(/^-+/, '')
    .split('-')
    .filter(Boolean)
    .slice(-3) // last 3 segments (avoid deeply nested paths)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

// ─── Route ────────────────────────────────────────────────────────────────────

export interface LiveAgent {
  id:            string
  name:          string
  cwd:           string
  state:         AgentState
  currentTask:   string
  lastTool:      string | null
  lastToolInput: string
  model:         string
  systemPrompt:  string
  sessionCount:  number
  inputTokens:   number
  outputTokens:  number
  totalTokens:   number
  cost:          number
  lastActiveAt:  string
  lastActiveAgo: string
  startedAt:     string
}

agentsRouter.get('/projects', async (_req, res) => {
  const projectsDir = findClaudeProjectsDir()
  if (!projectsDir) {
    return res.json({ agents: [], fetchedAt: new Date().toISOString(), error: 'Could not locate ~/.claude/projects' })
  }

  // Collect all JSONL files grouped by project slug
  const projectMap = new Map<string, Array<{ path: string; mtime: number }>>()

  try {
    for (const entry of readdirSync(projectsDir)) {
      const full = join(projectsDir, entry)
      try {
        const stat = statSync(full)
        if (stat.isDirectory()) {
          const files = readdirSync(full)
            .filter(c => c.endsWith('.jsonl'))
            .map(c => {
              const p = join(full, c)
              try { return { path: p, mtime: statSync(p).mtimeMs } } catch { return null }
            })
            .filter((f): f is { path: string; mtime: number } => f !== null)
          if (files.length > 0) projectMap.set(entry, files.sort((a, b) => b.mtime - a.mtime))
        }
      } catch { /* skip */ }
    }
  } catch {
    return res.json({ agents: [], fetchedAt: new Date().toISOString(), error: 'Failed to read projects directory' })
  }

  const agents: LiveAgent[] = []

  for (const [slug, files] of projectMap) {
    // Parse the most recent session fully for state detection
    const latestSession = parseSession(files[0].path)
    if (!latestSession) continue

    // Lightweight token summation across all sessions in this project
    let totalIn  = latestSession.inputTokens
    let totalOut = latestSession.outputTokens
    let earliestStart = latestSession.startedAt

    for (let i = 1; i < files.length; i++) {
      try {
        const raw = readFileSync(files[i].path, 'utf8')
        for (const line of raw.split('\n')) {
          if (!line.includes('"usage"')) continue
          try {
            const e = JSON.parse(line)
            if (e.usage) { totalIn += e.usage.input_tokens ?? 0; totalOut += e.usage.output_tokens ?? 0 }
          } catch { /* skip */ }
        }
        // Track earliest session start for uptime calc
        const raw2 = readFileSync(files[i].path, 'utf8')
        const firstLine = raw2.split('\n').find(l => l.trim().startsWith('{'))
        if (firstLine) {
          try {
            const e = JSON.parse(firstLine)
            if (e.timestamp && (!earliestStart || e.timestamp < earliestStart)) earliestStart = e.timestamp
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    // Determine state
    const ageMs    = Date.now() - new Date(latestSession.lastActiveAt || files[0].mtime).getTime()
    const ageMin   = ageMs / 60_000
    let state: AgentState

    if (ageMin > 60) {
      state = 'idle'
    } else if (ageMin > 15) {
      state = 'sleeping'
    } else if (latestSession.lastTool) {
      state = toolToState(latestSession.lastTool)
    } else {
      state = ageMin < 5 ? 'thinking' : 'idle'
    }

    const cost = calcCost(latestSession.model, totalIn, totalOut)

    agents.push({
      id:            slug,
      name:          slugToName(slug),
      cwd:           latestSession.cwd || slug,
      state,
      currentTask:   latestSession.lastUserMsg,
      lastTool:      latestSession.lastTool,
      lastToolInput: latestSession.lastToolInput,
      model:         latestSession.model || 'claude-sonnet-4-6',
      systemPrompt:  latestSession.systemPrompt,
      sessionCount:  files.length,
      inputTokens:   totalIn,
      outputTokens:  totalOut,
      totalTokens:   totalIn + totalOut,
      cost,
      lastActiveAt:  latestSession.lastActiveAt,
      lastActiveAgo: relAgo(latestSession.lastActiveAt),
      startedAt:     earliestStart,
    })
  }

  // Sort by most recently active
  agents.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())

  // Merge OpenClaw + Hermes agents (captured events and/or live gateway pull)
  try {
    const [oc, hm] = await Promise.all([getAgents('openclaw'), getAgents('hermes')])
    for (const ca of [...oc, ...hm]) agents.push(ca as any)
    agents.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
  } catch (err) {
    console.error('Failed to load agent-platform agents:', err)
  }

  res.json({ agents, fetchedAt: new Date().toISOString(), projectsDir })
})
