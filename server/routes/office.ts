// title: Office integrations route
// path: server/routes/office.ts
// purpose: Aggregate all external integration statuses (auth, AI providers,
//          agent platforms, communication, dev tools) for the Settings panel.

import { Router } from 'express'
import { getConnectionStatus } from '../lib/googleAuth.js'
import { getConnector } from '../lib/connectors.js'
import { fetchStatus } from '../lib/gateway.js'

export const officeRouter = Router()

interface LiveIntegration {
  id:           string
  name:         string
  description:  string
  category:     'auth' | 'plugin' | 'productivity' | 'communication' | 'development' | 'ai' | 'analytics' | 'storage'
  status:       'connected' | 'error' | 'disconnected' | 'pending'
  icon:         string
  connectedAs?: string
  error?:       string
  version?:     string
  detail?:      string
  source:       'auth' | 'plugin' | 'mcp' | 'system'
  url?:         string
}

officeRouter.get('/integrations', async (_req, res) => {
  const integrations: LiveIntegration[] = []

  // ── Google Calendar ────────────────────────────────────────────────────────
  try {
    const g = await getConnectionStatus()
    integrations.push({
      id:          'google',
      name:        'Google Calendar',
      description: 'Calendar events, scheduled tasks and to-do sync',
      category:    'productivity',
      icon:        'google',
      source:      'auth',
      status:      g.connected ? 'connected' : g.clientConfigured ? 'error' : 'disconnected',
      connectedAs: g.email || undefined,
      error:       g.error || undefined,
    })
  } catch (e: any) {
    integrations.push({
      id: 'google', name: 'Google Calendar', description: 'Calendar events, scheduled tasks and to-do sync',
      category: 'productivity', icon: 'google', source: 'auth', status: 'error', error: e?.message,
    })
  }

  // ── Anthropic API ─────────────────────────────────────────────────────────
  integrations.push({
    id:          'anthropic',
    name:        'Anthropic API',
    description: 'Radar analytics and research prompts',
    category:    'ai',
    icon:        'anthropic',
    source:      'auth',
    status:      process.env.ANTHROPIC_API_KEY ? 'connected' : 'disconnected',
    detail:      process.env.ANTHROPIC_API_KEY ? 'API key configured' : 'Set ANTHROPIC_API_KEY in .env',
  })

  // ── OpenClaw ──────────────────────────────────────────────────────────────
  const oc = getConnector('openclaw')
  if (oc?.enabled && oc.baseUrl) {
    try {
      const gs = await fetchStatus('openclaw')
      integrations.push({
        id:          'openclaw',
        name:        'OpenClaw',
        description: 'Agent platform — live activity, sessions and memory',
        category:    'ai',
        icon:        'openclaw',
        source:      'plugin',
        status:      gs.reachable ? 'connected' : 'error',
        version:     gs.version || undefined,
        detail:      gs.reachable ? `${gs.activeSessions ?? 0} active sessions` : undefined,
        error:       gs.error || undefined,
        url:         oc.baseUrl,
      })
    } catch (e: any) {
      integrations.push({
        id: 'openclaw', name: 'OpenClaw', description: 'Agent platform — live activity, sessions and memory',
        category: 'ai', icon: 'openclaw', source: 'plugin', status: 'error', error: e?.message,
      })
    }
  } else {
    integrations.push({
      id: 'openclaw', name: 'OpenClaw', description: 'Agent platform — live activity, sessions and memory',
      category: 'ai', icon: 'openclaw', source: 'plugin',
      status: oc && !oc.enabled ? 'disconnected' : 'disconnected',
      detail: 'Configure in Settings → Connectors',
    })
  }

  // ── Hermes ────────────────────────────────────────────────────────────────
  const he = getConnector('hermes')
  if (he?.enabled && he.baseUrl) {
    try {
      const gs = await fetchStatus('hermes')
      integrations.push({
        id:          'hermes',
        name:        'Hermes',
        description: 'Agent API server — benchmarks and model dispatch',
        category:    'ai',
        icon:        'hermes',
        source:      'plugin',
        status:      gs.reachable ? 'connected' : 'error',
        version:     gs.version || undefined,
        detail:      gs.reachable ? `${gs.activeSessions ?? 0} active sessions` : undefined,
        error:       gs.error || undefined,
        url:         he.baseUrl,
      })
    } catch (e: any) {
      integrations.push({
        id: 'hermes', name: 'Hermes', description: 'Agent API server — benchmarks and model dispatch',
        category: 'ai', icon: 'hermes', source: 'plugin', status: 'error', error: e?.message,
      })
    }
  } else {
    integrations.push({
      id: 'hermes', name: 'Hermes', description: 'Agent API server — benchmarks and model dispatch',
      category: 'ai', icon: 'hermes', source: 'plugin', status: 'disconnected',
      detail: 'Configure in Settings → Connectors',
    })
  }

  // ── Discord ───────────────────────────────────────────────────────────────
  integrations.push({
    id:          'discord',
    name:        'Discord',
    description: 'Bot notifications and expense tracking via chat commands',
    category:    'communication',
    icon:        'discord',
    source:      'plugin',
    status:      process.env.DISCORD_BOT_TOKEN ? 'connected' : 'disconnected',
    detail:      process.env.DISCORD_BOT_TOKEN ? 'Bot token configured' : 'Set DISCORD_BOT_TOKEN in .env',
  })

  // ── GitHub ────────────────────────────────────────────────────────────────
  integrations.push({
    id:          'github',
    name:        'GitHub',
    description: 'Trending repositories in the News view',
    category:    'development',
    icon:        'github',
    source:      'system',
    status:      process.env.GITHUB_TOKEN ? 'connected' : 'disconnected',
    detail:      process.env.GITHUB_TOKEN ? 'Token configured (higher rate limit)' : 'Unauthenticated (60 req/hr limit)',
  })

  res.json({ integrations, fetchedAt: new Date().toISOString() })
})
