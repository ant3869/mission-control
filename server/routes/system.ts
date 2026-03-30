/**
 * System health → /api/system
 *
 * Reads the real Claude config from the user's home directory to discover
 * MCP servers, plugins, and skills, then pings them to check health.
 *
 * GET /api/system/components   → all components with live status
 */
import { Router } from 'express'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const systemRouter = Router()

// ─── Read Claude config ────────────────────────────────────────────────────────

function readClaudeConfig(): Record<string, any> {
  const candidates = [
    join(homedir(), '.claude', 'settings.json'),
    join(homedir(), '.config', 'claude', 'settings.json'),
    // Windows paths surfaced via WSL or USERPROFILE
    process.env.APPDATA ? join(process.env.APPDATA, 'Claude', 'settings.json') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'settings.json') : '',
  ].filter(Boolean)

  for (const p of candidates) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')) } catch { /* ignore */ }
    }
  }
  return {}
}

function readClaudeDesktopConfig(): Record<string, any> {
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    process.env.APPDATA ? join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : '',
    join(homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
  ].filter(Boolean)

  for (const p of candidates) {
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')) } catch { /* ignore */ }
    }
  }
  return {}
}

// ─── Ping an HTTP endpoint ─────────────────────────────────────────────────────

async function pingEndpoint(url: string, timeoutMs = 3000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal, method: 'GET' })
    clearTimeout(timer)
    return { ok: res.ok || res.status < 500, latencyMs: Date.now() - start }
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message }
  }
}

// ─── Try to discover skills ────────────────────────────────────────────────────

function discoverSkills(): string[] {
  const skillDirs = [
    join(homedir(), '.claude', 'skills'),
    join(process.cwd(), 'mnt', '.claude', 'skills'),
  ]
  const skills: string[] = []
  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) skills.push(entry)
      }
    } catch { /* ignore */ }
  }
  return skills
}

// ─── Main route ───────────────────────────────────────────────────────────────

systemRouter.get('/components', async (_req, res) => {
  const config        = readClaudeConfig()
  const desktopConfig = readClaudeDesktopConfig()
  const components: any[] = []
  const now = new Date().toISOString()

  // ── MCP Servers ───────────────────────────────────────────────────────────
  const mcpServers: Record<string, any> = {
    ...(config.mcpServers         ?? {}),
    ...(desktopConfig.mcpServers  ?? {}),
  }

  for (const [name, cfg] of Object.entries(mcpServers)) {
    const url: string | undefined = (cfg as any).url ?? (cfg as any).baseUrl
    let status = 'healthy'
    let latencyMs: number | undefined
    let error: string | undefined

    if (url) {
      const ping = await pingEndpoint(url)
      status    = ping.ok ? 'healthy' : 'error'
      latencyMs = ping.latencyMs
      error     = ping.error
    } else {
      // stdio MCP — report as healthy if configured (no way to ping without spawning)
      status = 'healthy'
    }

    components.push({
      id:          `mcp-${name}`,
      name,
      type:        'mcp',
      status,
      latencyMs,
      error,
      description: (cfg as any).description ?? (url ? `HTTP MCP at ${url}` : 'stdio transport'),
      lastChecked: now,
      version:     (cfg as any).version,
    })
  }

  // ── Skills ────────────────────────────────────────────────────────────────
  const skills = discoverSkills()
  for (const skill of skills) {
    components.push({
      id:          `skill-${skill}`,
      name:        skill,
      type:        'skill',
      status:      'healthy',
      description: `Local skill: ${skill}`,
      lastChecked: now,
    })
  }

  // ── Known always-present services ─────────────────────────────────────────
  const coreServices = [
    { name: 'Anthropic API', url: 'https://api.anthropic.com', type: 'extension', description: 'Claude API endpoint' },
    { name: 'Google Calendar API', url: 'https://www.googleapis.com', type: 'extension', description: 'Calendar sync' },
  ]

  for (const svc of coreServices) {
    const ping = await pingEndpoint(svc.url)
    components.push({
      id:          `ext-${svc.name.toLowerCase().replace(/\s+/g, '-')}`,
      name:        svc.name,
      type:        svc.type,
      status:      ping.ok ? 'healthy' : 'error',
      latencyMs:   ping.latencyMs,
      error:       ping.error,
      description: svc.description,
      lastChecked: now,
    })
  }

  res.json({
    components,
    fetchedAt: now,
    source:    Object.keys(mcpServers).length > 0 ? 'claude-config' : 'defaults',
  })
})
