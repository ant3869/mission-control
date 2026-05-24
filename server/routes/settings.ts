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

// PUT /api/settings/connectors/:id → save base URL / token / enabled
settingsRouter.put('/connectors/:id', (req, res) => {
  const { id } = req.params
  if (!isValidId(id)) return res.status(404).json({ error: 'unknown connector' })

  const body = (req.body ?? {}) as { baseUrl?: unknown; token?: unknown; enabled?: unknown }
  const patch: { baseUrl?: string; token?: string; enabled?: boolean } = {}

  if (typeof body.baseUrl === 'string') patch.baseUrl = body.baseUrl
  if (typeof body.token === 'string') patch.token = body.token
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled

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
  res.json({
    ok: s.reachable && s.authOk !== false,
    reachable: s.reachable,
    authOk: s.authOk,
    version: s.version,
    gatewayStatus: s.gatewayStatus,
    platforms: s.platforms,
    activeSessions: s.activeSessions,
    latencyMs: s.latencyMs,
    error: s.error,
  })
})
