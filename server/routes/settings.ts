// title: Settings backend route
// path: server/routes/settings.ts
// purpose: Manage agent connector credentials (OpenClaw / Hermes gateway base
//          URL + token) and report live connection status. Tokens are stored
//          server-side and only ever returned to the browser masked.

import { Router } from 'express'
import {
  getConnectors, getConnector, saveConnector, toPublic, isLive,
  type ConnectorId,
} from '../lib/connectors.js'
import { probeStatus } from '../lib/agentSources.js'
import { clearSnapshotCache } from '../lib/openclawWs.js'
import { restartLive } from '../lib/openclawLive.js'
import { restartLive as restartHermesLive } from '../lib/hermesLive.js'
import { hermesApiHealth } from '../lib/hermesApiServer.js'

export const settingsRouter = Router()

const VALID_IDS: ConnectorId[] = ['openclaw', 'hermes']
function isValidId(id: string): id is ConnectorId {
  return (VALID_IDS as string[]).includes(id)
}

// GET /api/settings/connectors → masked configs + live status
settingsRouter.get('/connectors', async (_req, res) => {
  const connectors = getConnectors()

  const withStatus = await Promise.all(
    connectors.map(async c => {
      const pub = toPublic(c)
      if (!isLive(c.id)) {
        return {
          ...pub,
          status: c.enabled ? 'incomplete' : 'disabled',
          reachable: false,
          version: null,
          activeSessions: null,
          latencyMs: 0,
          error: c.enabled && !c.baseUrl ? 'base URL required' : null,
        }
      }
      const s = await probeStatus(c.id)
      const authFailed = s.authOk === false
      return {
        ...pub,
        // Reachable but token-rejected is an error, not a healthy connection —
        // otherwise the public /api/status makes a bad token look "connected".
        status: s.reachable ? (authFailed ? 'error' : 'connected') : 'error',
        reachable: s.reachable,
        version: s.version,
        gatewayStatus: s.gatewayStatus,
        platforms: s.platforms,
        activeSessions: s.activeSessions,
        latencyMs: s.latencyMs,
        error: s.error,
      }
    }),
  )

  res.json({ connectors: withStatus, fetchedAt: new Date().toISOString() })
})

// PUT /api/settings/connectors/:id → save base URL / token / enabled +
// (Hermes only) the OpenAI-compat API server URL + key. The dashboard URL
// and the API server URL are intentionally separate: status/sessions/logs
// live on the dashboard, chat lives on the API server.
settingsRouter.put('/connectors/:id', (req, res) => {
  const { id } = req.params
  if (!isValidId(id)) return res.status(404).json({ error: 'unknown connector' })

  const body = (req.body ?? {}) as {
    baseUrl?: unknown; token?: unknown; enabled?: unknown
    apiBaseUrl?: unknown; apiToken?: unknown
  }
  const patch: { baseUrl?: string; token?: string; enabled?: boolean; apiBaseUrl?: string; apiToken?: string } = {}

  if (typeof body.baseUrl === 'string') patch.baseUrl = body.baseUrl
  if (typeof body.token === 'string') patch.token = body.token
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.apiBaseUrl === 'string') patch.apiBaseUrl = body.apiBaseUrl
  if (typeof body.apiToken === 'string') patch.apiToken = body.apiToken

  const saved = saveConnector(id, patch)
  if (id === 'openclaw') { clearSnapshotCache(); restartLive() }
  if (id === 'hermes') restartHermesLive()
  res.json({ connector: toPublic(saved) })
})

// POST /api/settings/connectors/:id/test → probe the gateway now
settingsRouter.post('/connectors/:id/test', async (req, res) => {
  const { id } = req.params
  if (!isValidId(id)) return res.status(404).json({ error: 'unknown connector' })

  const cfg = getConnector(id)
  if (!cfg || !cfg.baseUrl) {
    return res.json({ ok: false, error: 'base URL not set', reachable: false })
  }

  const s = await probeStatus(id, true)

  // For Hermes, also verify the separate OpenAI-compat API server with a real
  // request — the dashboard reaching ≠ chat working. Surfacing both probes
  // makes it obvious when only one of the two layers is misconfigured.
  let apiServer: any = undefined
  if (id === 'hermes') {
    const h = await hermesApiHealth()
    apiServer = {
      ok: h.ok,
      baseUrl: h.baseUrl,
      hasToken: h.hasToken,
      reachable: h.reachable,
      latencyMs: h.latencyMs,
      modelCount: h.modelCount,
      models: h.models,
      error: h.error,
      triedPaths: h.triedPaths,
    }
  }

  res.json({
    // Top-level ok reflects what the user really needs: dashboard healthy AND,
    // for Hermes, the API server healthy too. Otherwise chat will silently
    // 405 every time even though /api/sessions probes pass.
    ok: s.reachable && s.authOk !== false && (id !== 'hermes' || apiServer?.ok === true),
    reachable: s.reachable,
    authOk: s.authOk,
    // Diagnostics: what the server actually tried, so a base-URL typo or a
    // stored-mask is visible without leaking the token itself.
    baseUrl: cfg.baseUrl,
    triedUrl: `${cfg.baseUrl}/api/sessions`,
    tokenLen: cfg.token.length,
    version: s.version,
    gatewayStatus: s.gatewayStatus,
    platforms: s.platforms,
    activeSessions: s.activeSessions,
    latencyMs: s.latencyMs,
    error: s.error,
    apiServer,
  })
})
