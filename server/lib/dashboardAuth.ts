import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'

const SESSION_COOKIE = 'mc_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000
const PAIRING_TTL_MS = 5 * 60_000

type AuthOptions = { now?: () => number }

export function resolveApiHost(value: string | undefined): string {
  return value?.trim() || '127.0.0.1'
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.')
}

export function assertSafeBinding(host: string, dashboardToken: string): void {
  if (!isLoopback(host) && !dashboardToken.trim()) {
    throw new Error('DASHBOARD_TOKEN is required when API_HOST is not loopback')
  }
}

function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    timingSafeEqual(Buffer.alloc(b.length), b)
    return false
  }
  return timingSafeEqual(a, b)
}

function cookieValue(header: string | undefined, name: string): string {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

export class DashboardAuth {
  readonly enabled: boolean
  private readonly now: () => number
  private readonly sessions = new Map<string, number>()
  private readonly pairingCodes = new Map<string, number>()

  constructor(private readonly dashboardToken: string, options: AuthOptions = {}) {
    this.enabled = Boolean(dashboardToken)
    this.now = options.now ?? Date.now
  }

  login(candidate: string): string | null {
    if (!this.enabled || !equalSecret(candidate, this.dashboardToken)) return null
    return this.issueSession()
  }

  authenticateCookie(header: string | undefined): boolean {
    if (!this.enabled) return true
    return this.isSession(cookieValue(header, SESSION_COOKIE))
  }

  createPairingCode(sessionToken: string): string | null {
    if (!this.isSession(sessionToken)) return null
    this.prune()
    let code = ''
    do { code = String(randomInt(0, 1_000_000)).padStart(6, '0') } while (this.pairingCodes.has(code))
    this.pairingCodes.set(code, this.now() + PAIRING_TTL_MS)
    return code
  }

  exchangePairingCode(code: string): string | null {
    this.prune()
    const expiresAt = this.pairingCodes.get(code)
    if (!expiresAt || expiresAt <= this.now()) return null
    this.pairingCodes.delete(code)
    return this.issueSession()
  }

  sessionFromCookie(header: string | undefined): string {
    return cookieValue(header, SESSION_COOKIE)
  }

  logoutCookie(header: string | undefined): void {
    this.sessions.delete(this.sessionFromCookie(header))
  }

  private issueSession(): string {
    const token = randomBytes(32).toString('hex')
    this.sessions.set(token, this.now() + SESSION_TTL_MS)
    return token
  }

  private isSession(token: string): boolean {
    if (!token) return false
    const expiresAt = this.sessions.get(token)
    if (!expiresAt || expiresAt <= this.now()) {
      this.sessions.delete(token)
      return false
    }
    return true
  }

  private prune(): void {
    const now = this.now()
    for (const [token, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(token)
    for (const [code, expiresAt] of this.pairingCodes) if (expiresAt <= now) this.pairingCodes.delete(code)
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

export function isPublicApiPath(method: string, path: string): boolean {
  if (method === 'GET' && path === '/api/health') return true
  if (method === 'POST' && (path === '/api/session/login' || path === '/api/session/pair')) return true
  if (method === 'GET' && path === '/api/auth/google/callback') return true
  if (method === 'POST' && (path === '/api/openclaw/events' || path === '/api/hermes/events')) return true
  return false
}

export function createDashboardAuthMiddleware(auth: DashboardAuth): RequestHandler {
  return (req, res, next) => {
    if (!auth.enabled || isPublicApiPath(req.method, req.originalUrl.split('?')[0])) return next()
    if (auth.authenticateCookie(req.headers.cookie)) return next()
    res.status(401).json({ error: 'authentication required' })
  }
}
