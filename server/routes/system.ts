/**
 * System health → /api/system
 *
 * Reads the real Claude config from the user's home directory to discover
 * MCP servers, plugins, skills, and commands, then pings what it can to check
 * health. Also reports host/runtime info for the dashboard's System panel.
 *
 * GET /api/system/components   → components + host info, with live status
 */
import { Router } from 'express'
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { homedir, platform, arch, release, hostname, cpus, totalmem, freemem, loadavg } from 'os'
import { join } from 'path'
import v8 from 'node:v8'
import { deriveHealth, type AgentSource } from '../lib/agentEvents.js'
import { getConnectors, getConnector } from '../lib/connectors.js'
import { isConnected as openclawWsConnected } from '../lib/openclawLive.js'
import { remoteStatus, readMemorySystemState } from '../lib/remoteMemoryFs.js'

export const systemRouter = Router()

// ─── V8 heap / process budget ──────────────────────────────────────────────────
//
// OpenClaw recently crashed on a heap-limit breach, so the dashboard surfaces the
// Node process's live heap against its configured ceiling. The ceiling is the
// real V8 `heap_size_limit` (which already reflects `--max-old-space-size`), but
// if that ever reads suspiciously low we fall back to the explicit flag, then to
// the PRD's 8 GB assumption.

function parseMaxOldSpaceMb(): number | null {
  const fromArgv = process.execArgv.find(a => a.startsWith('--max-old-space-size='))
  const fromEnv  = (process.env.NODE_OPTIONS ?? '').match(/--max-old-space-size=(\d+)/)
  const raw = fromArgv ? fromArgv.split('=')[1] : fromEnv?.[1]
  const mb = raw ? Number(raw) : NaN
  return Number.isFinite(mb) && mb > 0 ? mb : null
}

function heapInfo() {
  const mem = process.memoryUsage()
  const stats = v8.getHeapStatistics()
  const v8LimitMb = Math.round(stats.heap_size_limit / 1_048_576)
  const flagMb    = parseMaxOldSpaceMb()
  // Capacity for the gauge: explicit flag wins (it's the operator's intent),
  // else the live V8 limit, else the PRD default of 8 GB.
  const capacityMb = flagMb ?? (v8LimitMb > 256 ? v8LimitMb : 8192)
  const heapUsedMb = Math.round(mem.heapUsed / 1_048_576)
  const heapTotalMb = Math.round(mem.heapTotal / 1_048_576)
  const usedPct = capacityMb > 0 ? Math.round((heapUsedMb / capacityMb) * 100) : 0
  return {
    rssMb:        Math.round(mem.rss / 1_048_576),
    heapUsedMb,
    heapTotalMb,
    heapCapacityMb: capacityMb,
    heapLimitMb:  v8LimitMb,
    externalMb:   Math.round((mem.external ?? 0) / 1_048_576),
    arrayBuffersMb: Math.round(((mem as any).arrayBuffers ?? 0) / 1_048_576),
    heapUsedPct:  usedPct,
    heapCritical: usedPct >= 80,
    capacitySource: flagMb ? 'flag' : v8LimitMb > 256 ? 'v8' : 'default',
  }
}

const claudeDir = () =>
  process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude') : join(homedir(), '.claude')

// ─── Read JSON config files ─────────────────────────────────────────────────────

function readJsonSafe(path: string): Record<string, any> | null {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null } catch { return null }
}

function readClaudeConfig(): Record<string, any> {
  const candidates = [
    join(homedir(), '.claude', 'settings.json'),
    join(homedir(), '.config', 'claude', 'settings.json'),
    process.env.APPDATA ? join(process.env.APPDATA, 'Claude', 'settings.json') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'settings.json') : '',
  ].filter(Boolean)
  for (const p of candidates) { const j = readJsonSafe(p); if (j) return j }
  return {}
}

function readClaudeDesktopConfig(): Record<string, any> {
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
    process.env.APPDATA ? join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json') : '',
    join(homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
  ].filter(Boolean)
  for (const p of candidates) { const j = readJsonSafe(p); if (j) return j }
  return {}
}

// ~/.claude/mcp.json — the CLI's own MCP registry (was previously ignored).
function readMcpJson(): Record<string, any> {
  return readJsonSafe(join(claudeDir(), 'mcp.json')) ?? {}
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

// ─── Discover skills / commands ────────────────────────────────────────────────

function listDir(dir: string, kind: 'dir' | 'file'): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter(entry => {
      try {
        const st = statSync(join(dir, entry))
        return kind === 'dir' ? st.isDirectory() : st.isFile()
      } catch { return false }
    })
  } catch { return [] }
}

function discoverSkills(): Array<{ name: string; scope: string }> {
  const out: Array<{ name: string; scope: string }> = []
  for (const [dir, scope] of [
    [join(claudeDir(), 'skills'), 'user'],
    [join(process.cwd(), '.claude', 'skills'), 'project'],
  ] as Array<[string, string]>) {
    for (const name of listDir(dir, 'dir')) out.push({ name, scope })
  }
  return out
}

function discoverCommands(): string[] {
  return [
    ...listDir(join(claudeDir(), 'commands'), 'file'),
    ...listDir(join(process.cwd(), '.claude', 'commands'), 'file'),
  ].filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
}

// ─── Discover plugins ───────────────────────────────────────────────────────────

interface PluginInfo { id: string; name: string; marketplace: string; enabled: boolean; version?: string; installedAt?: string }

function discoverPlugins(settings: Record<string, any>): PluginInfo[] {
  const enabled: Record<string, boolean> = settings.enabledPlugins ?? {}
  const installed = readJsonSafe(join(claudeDir(), 'plugins', 'installed_plugins.json'))?.plugins ?? {}

  const keys = new Set<string>([...Object.keys(enabled), ...Object.keys(installed)])
  return [...keys].map(key => {
    const [name, marketplace = ''] = key.split('@')
    const meta = Array.isArray(installed[key]) ? installed[key][0] : undefined
    return {
      id: key,
      name,
      marketplace,
      enabled: enabled[key] !== false && key in enabled,
      version: meta?.version,
      installedAt: meta?.installedAt,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Host / runtime info ─────────────────────────────────────────────────────────

function hostInfo() {
  const totalMb = totalmem() / 1_048_576
  const freeMb  = freemem() / 1_048_576
  const heap = heapInfo()
  return {
    hostname:    hostname(),
    platform:    platform(),
    release:     release(),
    arch:        arch(),
    nodeVersion: process.version,
    cpuModel:    cpus()[0]?.model?.trim() ?? 'unknown',
    cpuCount:    cpus().length,
    loadAvg:     loadavg()[0] ?? 0,
    totalMemMb:  Math.round(totalMb),
    freeMemMb:   Math.round(freeMb),
    usedMemPct:  totalMb > 0 ? Math.round(((totalMb - freeMb) / totalMb) * 100) : 0,
    uptimeSec:   Math.round(process.uptime()),
    ...heap,
  }
}

// ─── Main route ───────────────────────────────────────────────────────────────

systemRouter.get('/components', async (_req, res) => {
  const config        = readClaudeConfig()
  const desktopConfig = readClaudeDesktopConfig()
  const mcpJson       = readMcpJson()
  const components: any[] = []
  const now = new Date().toISOString()

  // ── MCP Servers (settings.json + desktop config + mcp.json) ────────────────
  const mcpServers: Record<string, any> = {
    ...(config.mcpServers        ?? {}),
    ...(desktopConfig.mcpServers ?? {}),
    ...(mcpJson.mcpServers       ?? {}),
  }

  for (const [name, cfg] of Object.entries(mcpServers)) {
    const url: string | undefined = (cfg as any).url ?? (cfg as any).baseUrl
    const command: string | undefined = (cfg as any).command
    let status = 'healthy'
    let latencyMs: number | undefined
    let error: string | undefined

    if (url) {
      const ping = await pingEndpoint(url)
      status    = ping.ok ? 'healthy' : 'error'
      latencyMs = ping.latencyMs
      error     = ping.error
    }

    const transport = url ? 'http' : command ? 'stdio' : 'unknown'
    components.push({
      id:          `mcp-${name}`,
      name,
      type:        'mcp',
      status,
      latencyMs,
      error,
      transport,
      description: (cfg as any).description
        ?? (url ? `HTTP MCP · ${url}` : command ? `stdio · ${command}${Array.isArray((cfg as any).args) ? ' ' + (cfg as any).args.join(' ') : ''}` : 'MCP server'),
      lastChecked: now,
      version:     (cfg as any).version,
    })
  }

  // ── Plugins ────────────────────────────────────────────────────────────────
  for (const p of discoverPlugins(config)) {
    components.push({
      id:          `plugin-${p.id}`,
      name:        p.name,
      type:        'plugin',
      status:      p.enabled ? 'healthy' : 'offline',
      description: `${p.marketplace || 'local'}${p.installedAt ? ` · installed ${new Date(p.installedAt).toLocaleDateString()}` : ''}`,
      lastChecked: now,
      version:     p.version,
    })
  }

  // ── Skills ───────────────────────────────────────────────────────────────────
  for (const s of discoverSkills()) {
    components.push({
      id:          `skill-${s.scope}-${s.name}`,
      name:        s.name,
      type:        'skill',
      status:      'healthy',
      description: `${s.scope} skill`,
      lastChecked: now,
    })
  }

  // ── Slash commands ────────────────────────────────────────────────────────────
  for (const cmd of discoverCommands()) {
    components.push({
      id:          `command-${cmd}`,
      name:        `/${cmd}`,
      type:        'command',
      status:      'healthy',
      description: 'Custom slash command',
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

  // ── Agent platforms (OpenClaw + Hermes) ───────────────────────────────────
  const connectors = getConnectors()
  for (const [source, label] of [['openclaw', 'OpenClaw'], ['hermes', 'Hermes']] as Array<[AgentSource, string]>) {
    const conn = connectors.find(c => c.id === source)
    try {
      const h = deriveHealth(source)
      const configured = !!(conn?.enabled && conn?.baseUrl)
      components.push({
        id:          `ext-${source}`,
        name:        label,
        type:        'extension',
        status:      !configured ? 'offline' : h.status === 'healthy' ? 'healthy' : h.status === 'warning' ? 'warning' : 'offline',
        latencyMs:   h.latencyMs,
        error:       !configured ? 'Not connected — add a token in Settings' : h.status === 'offline' ? 'No recent events' : undefined,
        description: configured
          ? `${conn!.baseUrl} · ${h.eventCount} events${h.lastEventAt ? ` · last ${new Date(h.lastEventAt).toLocaleTimeString()}` : ''}`
          : `${label} gateway connector`,
        lastChecked: now,
      })
    } catch { /* skip if db not available */ }
  }

  res.json({
    components,
    host:      hostInfo(),
    fetchedAt: now,
    source:    Object.keys(mcpServers).length > 0 ? 'claude-config' : 'defaults',
  })
})

// ─── Global connectivity strip ─────────────────────────────────────────────────
//
// Three at-a-glance indicators for the top navbar:
//   1. Tailscale node — can we reach the agent host (over SSH)?
//   2. Gateway WS     — is the persistent OpenClaw WebSocket live?
//   3. LanceDB        — does the on-disk vector store exist & is it fresh?
//
// Each dot is green (ok) / amber (degraded) / red (down). All probes are cached
// upstream and run concurrently so the strip can poll cheaply.

type DotStatus = 'ok' | 'degraded' | 'down'
interface Indicator { id: string; label: string; status: DotStatus; detail: string }

systemRouter.get('/connectivity', async (_req, res) => {
  const force = false
  const [tailscale, lancedb] = await Promise.allSettled([
    remoteStatus(force),
    readMemorySystemState(force),
  ])

  // 1. Tailscale node (agent host reachability via SSH)
  const node: Indicator = (() => {
    if (tailscale.status !== 'fulfilled') return { id: 'tailscale', label: 'Tailscale Node', status: 'down', detail: 'probe failed' }
    const s = tailscale.value
    const host = s.host || 'agent host'
    return s.reachable
      ? { id: 'tailscale', label: 'Tailscale Node', status: 'ok', detail: `${host} reachable` }
      : { id: 'tailscale', label: 'Tailscale Node', status: 'down', detail: s.error ? `${host}: ${s.error}` : `${host} unreachable` }
  })()

  // 2. Gateway WebSocket (OpenClaw live runtime)
  const gateway: Indicator = (() => {
    const conn = getConnector('openclaw')
    const configured = !!(conn?.enabled && conn?.baseUrl)
    if (openclawWsConnected()) return { id: 'gateway', label: 'Gateway WS', status: 'ok', detail: 'live WebSocket connected' }
    if (!configured) return { id: 'gateway', label: 'Gateway WS', status: 'down', detail: 'not configured — add a token in Settings' }
    return { id: 'gateway', label: 'Gateway WS', status: 'degraded', detail: 'configured, socket not connected' }
  })()

  // 3. LanceDB vector store (on-disk, via SSH)
  const lance: Indicator = (() => {
    if (lancedb.status !== 'fulfilled') return { id: 'lancedb', label: 'LanceDB', status: 'down', detail: 'probe failed' }
    const st = lancedb.value
    if (!st.lance?.present) return { id: 'lancedb', label: 'LanceDB', status: 'down', detail: 'vector store not found' }
    const stale = !st.lance.lastWrite || Date.now() - new Date(st.lance.lastWrite).getTime() > 3 * 86_400_000
    return stale
      ? { id: 'lancedb', label: 'LanceDB', status: 'degraded', detail: st.lance.lastWrite ? `last write ${new Date(st.lance.lastWrite).toLocaleDateString()}` : 'no recent writes' }
      : { id: 'lancedb', label: 'LanceDB', status: 'ok', detail: 'vector store fresh' }
  })()

  res.json({ indicators: [node, gateway, lance], fetchedAt: new Date().toISOString() })
})
