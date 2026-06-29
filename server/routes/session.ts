import { Router } from 'express'
import {
  DashboardAuth,
  clearSessionCookie,
  sessionCookie,
} from '../lib/dashboardAuth.js'

function isSecure(req: { secure: boolean; header(name: string): string | undefined }): boolean {
  return req.secure || req.header('x-forwarded-proto') === 'https'
}

export function createSessionRouter(auth: DashboardAuth): Router {
  const router = Router()

  router.get('/status', (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      required: auth.enabled,
      authenticated: auth.authenticateCookie(req.headers.cookie),
    })
  })

  router.post('/login', (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : ''
    const session = auth.login(token)
    if (!session) return res.status(401).json({ error: 'invalid dashboard token' })
    res.setHeader('Set-Cookie', sessionCookie(session, isSecure(req)))
    res.json({ ok: true })
  })

  router.post('/pairing-code', (req, res) => {
    const code = auth.createPairingCode(auth.sessionFromCookie(req.headers.cookie))
    if (!code) return res.status(401).json({ error: 'authentication required' })
    res.status(201).json({ code, expiresInSeconds: 300 })
  })

  router.post('/pair', (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
    const session = auth.exchangePairingCode(code)
    if (!session) return res.status(401).json({ error: 'invalid or expired pairing code' })
    res.setHeader('Set-Cookie', sessionCookie(session, isSecure(req)))
    res.json({ ok: true })
  })

  router.post('/logout', (req, res) => {
    auth.logoutCookie(req.headers.cookie)
    res.setHeader('Set-Cookie', clearSessionCookie(isSecure(req)))
    res.json({ ok: true })
  })

  return router
}
