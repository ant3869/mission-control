// title: Google auth service (durable, centralized)
// path: server/lib/googleAuth.ts
// purpose: The single source of truth for Google OAuth2. Authenticate ONCE,
//   persist the refresh token to data/google-tokens.json (never .env / no copy-
//   paste), auto-refresh access tokens before API calls, capture rotated tokens
//   via the client's `tokens` event, and report a real connection status
//   (connected / disconnected / reconnect_required / missing_scopes /
//   auth_error / not_configured). Everything Google goes through here.
//
// Why a file store instead of GOOGLE_REFRESH_TOKEN in .env: the old flow printed
// the token and asked you to paste it into .env and restart. The running server
// could never persist a refreshed/rotated token, so any rotation (or the 7-day
// expiry of an unpublished "Testing" consent screen) forced manual re-auth. With
// a writable store the server keeps itself connected.

import { google, type calendar_v3 } from 'googleapis'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// ─── Scopes ─────────────────────────────────────────────────────────────────
// Minimal set that supports the app's needs:
//   calendar.events   → create / update / delete events
//   calendar.readonly → list calendars + read events across all of them
// (No Gmail, no userinfo/openid — the account email is read from the primary
//  calendar id, so we never request more than calendar access.)
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
]

const DEFAULT_REDIRECT = 'http://localhost:3001/api/auth/google/callback'

// ─── Types ──────────────────────────────────────────────────────────────────

export type GoogleConnectionState =
  | 'connected'           // token works, scopes present
  | 'disconnected'        // client configured but no token yet — connect
  | 'reconnect_required'  // token revoked/expired (invalid_grant) — reconnect
  | 'missing_scopes'      // token works but lacks a required scope — reconnect
  | 'auth_error'          // some other auth/API failure (often transient)
  | 'not_configured'      // GOOGLE_CLIENT_ID / SECRET missing

export interface GoogleConnectionStatus {
  state:            GoogleConnectionState
  connected:        boolean
  clientConfigured: boolean
  hasToken:         boolean
  email:            string
  scopes:           string[]        // scopes we request
  grantedScopes:    string[]        // scopes actually granted (from last token)
  missingScopes:    string[]
  connectedAt:      string
  checkedAt:        string
  error:            string          // human-readable, empty when fine
}

interface StoredTokens {
  refresh_token?: string
  access_token?:  string
  expiry_date?:   number
  scope?:         string
  token_type?:    string
  email?:         string
  connectedAt?:   string
  updatedAt?:     string
  seededFromEnv?: boolean
}

type OAuth2 = InstanceType<typeof google.auth.OAuth2>

// ─── Token store (data/google-tokens.json) ──────────────────────────────────

function tokensPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'google-tokens.json')
}

function loadTokens(): StoredTokens {
  const path = tokensPath()
  if (!existsSync(path)) {
    // Backward compatibility: if a working refresh token still lives in .env,
    // adopt it into the store so the server can persist refreshes from now on.
    const envToken = process.env.GOOGLE_REFRESH_TOKEN?.trim()
    if (envToken) {
      const seeded: StoredTokens = {
        refresh_token: envToken,
        // Do NOT assert the current GOOGLE_SCOPES here: the legacy token was minted
        // by the old read-only OAuth flow and may lack calendar.events write access.
        // Leave scope unset so getConnectionStatus probes and reports accurately.
        connectedAt:   new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
        seededFromEnv: true,
      }
      try { writeFileSync(path, JSON.stringify(seeded, null, 2), 'utf8') } catch { /* read-only fs is fine */ }
      console.log('[google-auth] seeded token store from GOOGLE_REFRESH_TOKEN in .env')
      return seeded
    }
    return {}
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoredTokens
  } catch {
    return {}
  }
}

function saveTokens(t: StoredTokens): void {
  try {
    writeFileSync(tokensPath(), JSON.stringify({ ...t, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch (err: any) {
    console.error('[google-auth] failed to persist tokens:', err?.message ?? err)
  }
}

/** Merge new credentials into the store, never dropping a refresh token we already hold. */
function mergeTokens(incoming: Partial<StoredTokens>): StoredTokens {
  const current = loadTokens()
  const merged: StoredTokens = {
    ...current,
    ...incoming,
    // Google only returns refresh_token on the first consent / re-consent.
    refresh_token: incoming.refresh_token || current.refresh_token,
    connectedAt:   current.connectedAt || new Date().toISOString(),
  }
  saveTokens(merged)
  return merged
}

// ─── Config ─────────────────────────────────────────────────────────────────

export function getConfig() {
  return {
    clientId:     process.env.GOOGLE_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '',
    redirectUri:  process.env.GOOGLE_REDIRECT_URI?.trim() || DEFAULT_REDIRECT,
  }
}

export function isConfigured(): boolean {
  const { clientId, clientSecret } = getConfig()
  return Boolean(clientId && clientSecret)
}

export function hasToken(): boolean {
  return Boolean(loadTokens().refresh_token)
}

// ─── OAuth2 client (singleton) ───────────────────────────────────────────────

let _client: OAuth2 | null = null

export function getOAuthClient(): OAuth2 | null {
  if (!isConfigured()) return null
  if (_client) return _client

  const { clientId, clientSecret, redirectUri } = getConfig()
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)

  // The library auto-refreshes the access token before a call when it's expired.
  // This event fires whenever it does (and on first exchange), so we persist the
  // rotated credentials — the fix for "tokens lost on restart".
  client.on('tokens', (tokens) => {
    mergeTokens({
      access_token:  tokens.access_token  ?? undefined,
      refresh_token: tokens.refresh_token ?? undefined,
      expiry_date:   tokens.expiry_date   ?? undefined,
      scope:         tokens.scope         ?? undefined,
      token_type:    tokens.token_type    ?? undefined,
    })
    if (tokens.refresh_token) console.log('[google-auth] stored a new refresh token')
    else console.log('[google-auth] refreshed access token')
  })

  applyStoredCredentials(client)
  _client = client
  return client
}

function applyStoredCredentials(client: OAuth2): void {
  const t = loadTokens()
  if (t.refresh_token || t.access_token) {
    client.setCredentials({
      refresh_token: t.refresh_token,
      access_token:  t.access_token,
      expiry_date:   t.expiry_date,
      scope:         t.scope,
      token_type:    t.token_type,
    })
  }
}

// ─── Auth URL + code exchange ────────────────────────────────────────────────

export function buildAuthUrl(): string {
  const client = getOAuthClient()
  if (!client) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env')
  return client.generateAuthUrl({
    access_type:            'offline',   // gets us a refresh token
    prompt:                 'consent',   // force refresh-token issuance every time
    include_granted_scopes: true,
    scope:                  GOOGLE_SCOPES,
  })
}

/** Exchange an OAuth callback code for tokens, persist them, and learn the email. */
export async function exchangeCode(code: string): Promise<GoogleConnectionStatus> {
  const client = getOAuthClient()
  if (!client) throw new Error('Google client not configured')

  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)
  mergeTokens({
    access_token:  tokens.access_token  ?? undefined,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date:   tokens.expiry_date   ?? undefined,
    scope:         tokens.scope         ?? undefined,
    token_type:    tokens.token_type    ?? undefined,
    connectedAt:   new Date().toISOString(),
  })
  console.log('[google-auth] OAuth complete — tokens persisted to data/google-tokens.json')

  // Best-effort: capture the account email (primary calendar id) for display.
  try {
    const email = await fetchPrimaryEmail()
    if (email) mergeTokens({ email })
  } catch { /* non-fatal */ }

  return getConnectionStatus(true)
}

/** Forget the stored token so the user can cleanly reconnect. */
export async function disconnect(): Promise<void> {
  const t = loadTokens()
  const client = getOAuthClient()
  if (client && t.refresh_token) {
    try { await client.revokeToken(t.refresh_token) } catch { /* already invalid — fine */ }
  }
  try { rmSync(tokensPath(), { force: true }) } catch { /* ignore */ }
  if (_client) _client.setCredentials({})
  _statusCache = null
  console.log('[google-auth] disconnected — token store cleared')
}

// ─── Access-token / client helpers used by the Calendar service ──────────────

/** Force a valid access token (refreshing if needed). Throws a classified error. */
export async function ensureAccessToken(): Promise<void> {
  const client = getOAuthClient()
  if (!client) throw authError('not_configured', 'Google client is not configured (GOOGLE_CLIENT_ID / SECRET).')
  if (!hasToken())  throw authError('disconnected', 'Google is not connected. Visit /api/auth/google to connect.')
  applyStoredCredentials(client)
  try {
    const res = await client.getAccessToken()
    if (!res || !res.token) throw new Error('no access token returned')
  } catch (err) {
    const { state, message } = classifyGoogleError(err)
    throw authError(state, message)
  }
}

/** A ready-to-use Calendar v3 client, or null if not configured/connected. */
export function getCalendarClient(): calendar_v3.Calendar | null {
  const client = getOAuthClient()
  if (!client || !hasToken()) return null
  applyStoredCredentials(client)
  return google.calendar({ version: 'v3', auth: client })
}

async function fetchPrimaryEmail(): Promise<string> {
  const cal = getCalendarClient()
  if (!cal) return ''
  const primary = await cal.calendarList.get({ calendarId: 'primary' })
  return primary.data.id ?? ''
}

// ─── Error classification ────────────────────────────────────────────────────

/** A typed auth error carrying a connection state so callers can react. */
export class GoogleAuthError extends Error {
  constructor(public state: GoogleConnectionState, message: string) {
    super(message)
    this.name = 'GoogleAuthError'
  }
}
function authError(state: GoogleConnectionState, message: string) {
  return new GoogleAuthError(state, message)
}

export function classifyGoogleError(err: any): { state: GoogleConnectionState; message: string } {
  if (err instanceof GoogleAuthError) return { state: err.state, message: err.message }

  const data   = err?.response?.data
  const gErr   = data?.error
  const errStr = typeof gErr === 'string' ? gErr : (gErr?.status ?? gErr?.errors?.[0]?.reason ?? '')
  const desc   = data?.error_description ?? gErr?.message ?? err?.message ?? String(err ?? '')
  const status = err?.response?.status ?? err?.code ?? ''
  const text   = `${errStr} ${desc} ${status}`.toLowerCase()

  if (/invalid_grant|expired or revoked|invalid_token|token has been expired/.test(text))
    return { state: 'reconnect_required', message: 'Google token expired or was revoked. Reconnect to continue.' }
  if (/insufficient|insufficientpermissions|insufficient.*scope|insufficient authentication scopes/.test(text))
    return { state: 'missing_scopes', message: 'Google token is missing a required scope. Reconnect to grant calendar access.' }
  if (/\b401\b|unauthorized|unauthenticated/.test(text))
    return { state: 'reconnect_required', message: 'Google rejected the credentials. Reconnect to continue.' }
  if (/enotfound|econnrefused|etimedout|getaddrinfo|socket|network|fetch failed/.test(text))
    return { state: 'auth_error', message: 'Could not reach Google. Check your connection and retry.' }
  return { state: 'auth_error', message: desc || 'Google API error.' }
}

// ─── Connection status (cached) ──────────────────────────────────────────────

let _statusCache: { status: GoogleConnectionStatus; at: number } | null = null
const STATUS_TTL_MS = 60_000

function baseStatus(): GoogleConnectionStatus {
  const t = loadTokens()
  return {
    state:            'disconnected',
    connected:        false,
    clientConfigured: isConfigured(),
    hasToken:         Boolean(t.refresh_token),
    email:            t.email ?? '',
    scopes:           GOOGLE_SCOPES,
    grantedScopes:    t.scope ? t.scope.split(' ').filter(Boolean) : [],
    missingScopes:    [],
    connectedAt:      t.connectedAt ?? '',
    checkedAt:        new Date().toISOString(),
    error:            '',
  }
}

function missingScopes(granted: string[]): string[] {
  return GOOGLE_SCOPES.filter(s => !granted.includes(s))
}

/**
 * Real, live status — not just "are env vars set". Does a cheap probe
 * (primary calendar fetch) and classifies failures. Cached for 60s so status
 * polling doesn't hammer Google.
 */
export async function getConnectionStatus(force = false): Promise<GoogleConnectionStatus> {
  if (!force && _statusCache && Date.now() - _statusCache.at < STATUS_TTL_MS) {
    return _statusCache.status
  }

  const status = baseStatus()

  if (!status.clientConfigured) {
    status.state = 'not_configured'
    status.error = 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set.'
    _statusCache = { status, at: Date.now() }
    return status
  }
  if (!status.hasToken) {
    status.state = 'disconnected'
    _statusCache = { status, at: Date.now() }
    return status
  }

  try {
    const cal = getCalendarClient()!
    const primary = await cal.calendarList.get({ calendarId: 'primary' })
    const email = primary.data.id ?? status.email
    if (email && email !== status.email) mergeTokens({ email })

    const granted = baseStatus().grantedScopes
    const missing = missingScopes(granted)
    // We can read the calendar, so readonly is clearly granted. Only flag missing
    // scopes when the granted-scope record explicitly lacks them.
    status.email         = email
    status.grantedScopes = granted
    status.missingScopes = missing
    status.connected     = missing.length === 0
    status.state         = missing.length === 0 ? 'connected' : 'missing_scopes'
    if (missing.length) status.error = 'Calendar write scope not granted — reconnect to enable event creation.'
  } catch (err) {
    const { state, message } = classifyGoogleError(err)
    status.state = state
    status.error = message
    status.connected = false
  }

  _statusCache = { status, at: Date.now() }
  return status
}

/** Invalidate the status cache (call after a write that hit an auth error). */
export function invalidateStatus(): void {
  _statusCache = null
}
