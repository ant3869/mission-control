/**
 * Integrations hub → /api/office
 *
 * Reads real integration data from:
 *  - .env credentials (Google OAuth, Anthropic API key)
 *  - .remote-plugins/ (installed Cowork plugins + their MCP connectors)
 *  - ~/.claude/settings.json (direct MCP server configs)
 *
 * GET /api/office/integrations   → all integrations with live status
 */
import { Router } from 'express'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'

export const officeRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntegrationStatus   = 'connected' | 'error' | 'disconnected' | 'pending'
export type IntegrationCategory = 'auth' | 'plugin' | 'productivity' | 'communication' | 'development' | 'ai' | 'analytics' | 'storage'

export interface LiveIntegration {
  id:           string
  name:         string
  description:  string
  category:     IntegrationCategory
  status:       IntegrationStatus
  icon:         string
  connectedAs?: string
  error?:       string
  lastSync?:    string
  version?:     string
  detail?:      string
  source:       'auth' | 'plugin' | 'mcp' | 'system'
  url?:         string
}

// ─── Known service metadata ───────────────────────────────────────────────────

const SERVICE_META: Record<string, { icon: string; category: IntegrationCategory; description: string }> = {
  'google-calendar': { icon: '📅', category: 'productivity',    description: 'Calendar events & scheduling' },
  'gmail':           { icon: '✉️', category: 'communication',   description: 'Email management' },
  'slack':           { icon: '💬', category: 'communication',   description: 'Team messaging & channels' },
  'notion':          { icon: '📝', category: 'productivity',    description: 'Documents & wikis' },
  'linear':          { icon: '📐', category: 'development',     description: 'Issue tracking & sprints' },
  'asana':           { icon: '✅', category: 'productivity',    description: 'Project & task management' },
  'atlassian':       { icon: '🔷', category: 'development',     description: 'Jira & Confluence' },
  'ms365':           { icon: '🪟', category: 'productivity',    description: 'Microsoft 365 suite' },
  'monday':          { icon: '📋', category: 'productivity',    description: 'Work OS & project tracking' },
  'clickup':         { icon: '⬆️', category: 'productivity',   description: 'Tasks & project management' },
  'github':          { icon: '🐙', category: 'development',     description: 'Code repositories & PRs' },
  'figma':           { icon: '🎨', category: 'development',     description: 'Design & prototyping' },
  'intercom':        { icon: '💭', category: 'communication',   description: 'Customer messaging' },
  'snowflake':       { icon: '❄️', category: 'analytics',       description: 'Data warehouse' },
  'databricks':      { icon: '🧱', category: 'analytics',       description: 'Data & AI platform' },
  'bigquery':        { icon: '📊', category: 'analytics',       description: 'Cloud data warehouse' },
  'anthropic':       { icon: '🤖', category: 'ai',              description: 'Claude AI models' },
  'google':          { icon: '🔑', category: 'auth',             description: 'Google account' },
  'mcp-registry':    { icon: '📦', category: 'development',     description: 'MCP server registry' },
  'filesystem':      { icon: '📁', category: 'storage',         description: 'Local file system' },
  'desktop':         { icon: '🖥️', category: 'development',    description: 'Desktop automation' },
  'session_info':    { icon: '🔍', category: 'ai',              description: 'Claude session inspector' },
  'scheduled-tasks': { icon: '⏰', category: 'productivity',    description: 'Scheduled task runner' },
}

function svcMeta(key: string) {
  const lower = key.toLowerCase()
  for (const [k, v] of Object.entries(SERVICE_META)) {
    if (lower.includes(k)) return v
  }
  return { icon: '🔌', category: 'development' as IntegrationCategory, description: 'Integration' }
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

function findPluginsDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.remote-plugins'),
    join(process.cwd(), 'mnt', '.remote-plugins'),
    join(process.cwd(), '.remote-plugins'),
  ]
  return candidates.find(p => {
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

function findClaudeSettingsPath(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.json'),
    join(homedir(), '.config', 'claude', 'settings.json'),
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude', 'settings.json') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'settings.json') : '',
  ].filter(Boolean)
  return candidates.find(p => {
    try { return existsSync(p) } catch { return false }
  }) ?? null
}

function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// ─── Build integrations list ──────────────────────────────────────────────────

officeRouter.get('/integrations', (_req, res) => {
  const integrations: LiveIntegration[] = []
  const now = new Date().toISOString()
  const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // ── 1. Auth connections from .env ─────────────────────────────────────────
  const hasGoogle    = !!(process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID)
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY

  integrations.push({
    id:          'auth-google',
    name:        'Google',
    description: 'Google account authentication',
    category:    'auth',
    status:      hasGoogle ? 'connected' : 'disconnected',
    icon:        '🔑',
    connectedAs: hasGoogle ? process.env.GOOGLE_EMAIL ?? 'OAuth configured' : undefined,
    detail:      hasGoogle ? 'Calendar, Gmail access enabled' : 'Not authenticated',
    source:      'auth',
    lastSync:    hasGoogle ? nowLabel : undefined,
  })

  integrations.push({
    id:          'auth-anthropic',
    name:        'Anthropic API',
    description: 'Claude AI models access',
    category:    'ai',
    status:      hasAnthropic ? 'connected' : 'disconnected',
    icon:        '🤖',
    connectedAs: hasAnthropic ? 'API key configured' : undefined,
    detail:      'claude-sonnet-4-6, claude-opus-4',
    source:      'auth',
    lastSync:    hasAnthropic ? nowLabel : undefined,
  })

  // ── 2. Installed plugins ──────────────────────────────────────────────────
  const pluginsDir = findPluginsDir()
  const pluginMcpMap: Record<string, string[]> = {}  // pluginId → connector names

  if (pluginsDir) {
    try {
      for (const entry of readdirSync(pluginsDir)) {
        if (entry === 'manifest.json') continue
        const pluginDir = join(pluginsDir, entry)
        try {
          if (!statSync(pluginDir).isDirectory()) continue

          const pluginJsonPath = join(pluginDir, '.claude-plugin', 'plugin.json')
          const mcpJsonPath    = join(pluginDir, '.mcp.json')

          const pluginInfo = existsSync(pluginJsonPath) ? readJson(pluginJsonPath) : null
          if (!pluginInfo) continue

          const name    = pluginInfo.name ?? entry
          const version = pluginInfo.version ?? ''
          const desc    = pluginInfo.description ?? ''

          integrations.push({
            id:          `plugin-${entry}`,
            name:        titleCase(name.replace(/-/g, ' ')),
            description: desc.slice(0, 120),
            category:    'plugin',
            status:      'connected',
            icon:        pluginIcon(name),
            version,
            detail:      `v${version} · by ${pluginInfo.author?.name ?? 'Unknown'}`,
            source:      'plugin',
            lastSync:    nowLabel,
          })

          // Extract MCP connectors from .mcp.json
          const mcpConfig = existsSync(mcpJsonPath) ? readJson(mcpJsonPath) : null
          const mcpServers: Record<string, any> = mcpConfig?.mcpServers ?? {}
          pluginMcpMap[entry] = Object.keys(mcpServers)

          for (const [mcpName, mcpCfg] of Object.entries(mcpServers)) {
            const meta = svcMeta(mcpName)
            integrations.push({
              id:          `connector-${entry}-${mcpName}`,
              name:        titleCase(mcpName.replace(/-/g, ' ')),
              description: meta.description,
              category:    meta.category,
              status:      'pending',  // can't easily check auth without token
              icon:        meta.icon,
              detail:      `via ${titleCase(name.replace(/-/g, ' '))} plugin`,
              source:      'mcp',
              url:         (mcpCfg as any).url,
            })
          }
        } catch { /* skip malformed plugin */ }
      }
    } catch { /* ignore */ }
  }

  // ── 3. Direct MCP servers from Claude settings ────────────────────────────
  const settingsPath = findClaudeSettingsPath()
  const settings     = settingsPath ? readJson(settingsPath) : null
  const directMcps: Record<string, any> = settings?.mcpServers ?? {}

  for (const [mcpName, mcpCfg] of Object.entries(directMcps)) {
    // Skip if already added via plugin
    const alreadyAdded = integrations.some(i => i.id === `connector-${mcpName}` || i.name.toLowerCase() === mcpName.toLowerCase())
    if (alreadyAdded) continue

    const meta = svcMeta(mcpName)
    integrations.push({
      id:          `mcp-${mcpName}`,
      name:        titleCase(mcpName.replace(/-/g, ' ')),
      description: meta.description || (mcpCfg as any).description || 'MCP server',
      category:    meta.category,
      status:      'connected',   // if it's in settings, assume active
      icon:        meta.icon,
      version:     (mcpCfg as any).version,
      detail:      (mcpCfg as any).url ? `HTTP · ${(mcpCfg as any).url}` : 'stdio transport',
      source:      'mcp',
      url:         (mcpCfg as any).url,
    })
  }

  // Sort: auth first, then plugins, then connectors by category
  const ORDER: IntegrationCategory[] = ['auth', 'ai', 'plugin', 'productivity', 'communication', 'development', 'analytics', 'storage']
  integrations.sort((a, b) => {
    const ai = ORDER.indexOf(a.category)
    const bi = ORDER.indexOf(b.category)
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    return a.name.localeCompare(b.name)
  })

  res.json({ integrations, fetchedAt: now })
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function pluginIcon(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('productivity')) return '⚡'
  if (lower.includes('finance'))      return '💰'
  if (lower.includes('design'))       return '🎨'
  if (lower.includes('cowork'))       return '🔧'
  if (lower.includes('management'))   return '⚙️'
  return '🧩'
}
