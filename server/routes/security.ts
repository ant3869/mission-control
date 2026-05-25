// title: Security backend route
// path: server/routes/security.ts
// purpose: Aggregate connector auth status, token health, rate-limit signals,
//          and recent error patterns into a single security posture response.

import { Router } from 'express'
import { getConnectors, isLive, toPublic } from '../lib/connectors.js'
import { fetchStatus, fetchDiagnostics } from '../lib/gateway.js'
import { getRawEvents, type AgentSource } from '../lib/agentEvents.js'

export const securityRouter = Router()

// GET /api/security/posture — full connector health + auth + error surface
securityRouter.get('/posture', async (_req, res) => {
  const connectors = getConnectors()
  const now = Date.now()
  const windowMs = 60 * 60_000  // 1 hour window for error scan

  const results = await Promise.all(connectors.map(async (c) => {
    const pub     = toPublic(c)
    const live    = isLive(c.id)

    // Always probe status endpoint for reachability
    const statusR = live ? await fetchStatus(c.id) : null

    // Count recent auth errors from the event store
    const cutoff = new Date(now - windowMs).toISOString()
    const events = getRawEvents(c.id as AgentSource, 500).filter(e => e.ts >= cutoff)
    const authErrors   = events.filter(e => e.eventType.toLowerCase().includes('auth') || e.eventType.toLowerCase().includes('401') || e.eventType.toLowerCase().includes('403')).length
    const errorEvents  = events.filter(e => e.eventType.toLowerCase().includes('error') || e.eventType.toLowerCase().includes('fail')).length
    const totalEvents  = events.length

    const tokenStatus =
      !c.enabled               ? 'disabled' :
      !pub.hasToken            ? 'missing' :
      authErrors > 0           ? 'auth_error' :
      !live                    ? 'no_url' :
      statusR?.reachable       ? 'ok' :
                                 'unreachable'

    return {
      id:           c.id,
      label:        c.label,
      enabled:      c.enabled,
      hasToken:     pub.hasToken,
      tokenHint:    pub.tokenHint,
      baseUrl:      pub.baseUrl,
      live,
      tokenStatus,
      reachable:    statusR?.reachable ?? null,
      latencyMs:    statusR?.latencyMs ?? null,
      version:      statusR?.version ?? null,
      recentErrors: errorEvents,
      authErrors,
      totalEvents,
      errorRate:    totalEvents > 0 ? Math.round((errorEvents / totalEvents) * 100) : 0,
    }
  }))

  // Overall risk level
  const hasAuthError   = results.some(r => r.tokenStatus === 'auth_error')
  const hasMissingAuth = results.some(r => r.enabled && r.tokenStatus === 'missing')
  const hasUnreachable = results.some(r => r.enabled && r.tokenStatus === 'unreachable')
  const riskLevel =
    hasAuthError   ? 'critical' :
    hasMissingAuth ? 'warning' :
    hasUnreachable ? 'warning' :
                     'ok'

  // Normalise shape for the frontend
  const postureItems = results.map(r => ({
    id:           r.id,
    name:         r.label,
    enabled:      r.enabled,
    baseUrl:      r.baseUrl,
    tokenHint:    r.tokenHint,
    tokenStatus:  r.tokenStatus,
    reachable:    r.reachable ?? false,
    latencyMs:    r.latencyMs ?? 0,
    version:      r.version,
    recentErrors: r.recentErrors,
    authErrors:   r.authErrors,
    errorRate:    r.errorRate,
    totalEvents:  r.totalEvents,
  }))

  res.json({
    connectors: postureItems,
    riskLevel,
    summary: {
      ok:          postureItems.filter(c => c.tokenStatus === 'ok').length,
      warning:     postureItems.filter(c => c.tokenStatus === 'missing' || c.tokenStatus === 'unreachable').length,
      critical:    postureItems.filter(c => c.tokenStatus === 'auth_error').length,
      unreachable: postureItems.filter(c => c.tokenStatus === 'unreachable').length,
    },
    fetchedAt: new Date().toISOString(),
  })
})

// GET /api/security/diagnostics/:source — full path probe for one connector
securityRouter.get('/diagnostics/:source', async (req, res) => {
  const source = req.params.source as AgentSource
  if (source !== 'openclaw' && source !== 'hermes') {
    return res.status(400).json({ error: 'invalid source' })
  }
  if (!isLive(source)) {
    return res.status(409).json({ error: 'connector not enabled — add a token in Settings', probes: [] })
  }
  const probes = await fetchDiagnostics(source)
  res.json({ probes, fetchedAt: new Date().toISOString() })
})

// GET /api/security/events — recent auth/error events across all sources
securityRouter.get('/events', (_req, res) => {
  const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const events = (['openclaw', 'hermes'] as AgentSource[])
    .flatMap(s => getRawEvents(s, 200).filter(e => e.ts >= cutoff &&
      (e.eventType.includes('error') || e.eventType.includes('fail') || e.eventType.includes('auth'))))
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .slice(0, 100)

  res.json({ events, total: events.length, fetchedAt: new Date().toISOString() })
})
