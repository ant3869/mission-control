/**
 * Google OAuth 2.0 flow → /api/auth
 *
 * New durable flow (no more copy-paste):
 *   1. Visit http://localhost:3001/api/auth/google  → Google consent
 *   2. Google calls back to /api/auth/google/callback
 *   3. The refresh token is persisted to data/google-tokens.json automatically
 *      and refreshed in the background — no .env editing, no server restart.
 *
 * IMPORTANT: to avoid Google expiring the refresh token after 7 days, publish
 * your OAuth consent screen ("In production") in Google Cloud Console. While it
 * is in "Testing" mode Google revokes refresh tokens weekly.
 */
import { Router } from 'express'
import {
  buildAuthUrl, exchangeCode, getConnectionStatus, disconnect, isConfigured,
} from '../lib/googleAuth.js'

export const authRouter = Router()

const APP_URL = process.env.APP_URL?.trim() || 'http://localhost:5173'

authRouter.get('/google', (_req, res) => {
  if (!isConfigured()) {
    return res.status(400).json({
      error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env',
    })
  }
  try {
    res.redirect(buildAuthUrl())
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

authRouter.get('/google/callback', async (req, res) => {
  const { code, error } = req.query as { code?: string; error?: string }
  if (error) return res.status(400).send(consentPage('error', `Google returned: ${error}`))
  if (!code) return res.status(400).send(consentPage('error', 'Missing authorization code.'))

  try {
    const status = await exchangeCode(code)
    console.log('\n✅ Google connected — tokens stored in data/google-tokens.json')
    res.send(consentPage('ok', status.email ? `Connected as ${status.email}.` : 'Calendar access granted.'))
  } catch (err: any) {
    console.error('[auth/google/callback]', err?.message ?? err)
    res.status(500).send(consentPage('error', err?.message ?? 'OAuth exchange failed — check server logs.'))
  }
})

// Live connection status (real probe, cached ~60s). `?force=1` bypasses the cache.
authRouter.get('/status', async (req, res) => {
  try {
    const google = await getConnectionStatus(req.query.force === '1')
    res.json({
      google: {
        // Back-compat fields used by existing UI:
        clientConfigured: google.clientConfigured,
        tokenConfigured:  google.hasToken,
        // Richer status:
        state:         google.state,
        connected:     google.connected,
        email:         google.email,
        scopes:        google.scopes,
        grantedScopes: google.grantedScopes,
        missingScopes: google.missingScopes,
        connectedAt:   google.connectedAt,
        checkedAt:     google.checkedAt,
        error:         google.error,
      },
      anthropic: {
        keyConfigured: !!process.env.ANTHROPIC_API_KEY,
      },
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Clean reconnect: forget the stored token (and revoke it) so /google starts fresh.
authRouter.post('/google/disconnect', async (_req, res) => {
  try {
    await disconnect()
    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Callback HTML ────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function consentPage(kind: 'ok' | 'error', detail: string): string {
  const ok = kind === 'ok'
  const safe = escapeHtml(detail)
  const color = ok ? '#3fb950' : '#f85149'
  const heading = ok ? '✅ Google Calendar connected!' : '⚠️ Connection failed'
  const body = ok
    ? `<p>${safe}</p><p>You can close this tab — no token to copy, nothing to restart. The connection refreshes itself from now on.</p>`
    : `<p>${safe}</p><p>Close this tab and try reconnecting from Settings.</p>`
  return `
    <html><body style="font-family:system-ui,monospace;background:#0d1117;color:#e6edf3;padding:2.5rem;max-width:560px;margin:auto">
      <h2 style="color:${color}">${heading}</h2>
      ${body}
      <p style="margin-top:1.5rem"><a href="${APP_URL}" style="color:#58a6ff">← Back to Mission Control</a></p>
    </body></html>`
}
