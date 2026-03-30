/**
 * Google OAuth 2.0 flow.
 *
 * Usage:
 *   1. Visit http://localhost:3001/api/auth/google  → redirects to Google consent
 *   2. Google calls back to /api/auth/google/callback
 *   3. Copy the printed refresh_token into your .env as GOOGLE_REFRESH_TOKEN
 *   4. Restart the server — calendar will use the token automatically
 */
import { Router } from 'express'
import { google } from 'googleapis'

export const authRouter = Router()

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3001/api/auth/google/callback',
  )
}

authRouter.get('/google', (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({
      error: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env',
    })
  }
  const url = oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  })
  res.redirect(url)
})

authRouter.get('/google/callback', async (req, res) => {
  const { code } = req.query as { code?: string }
  if (!code) return res.status(400).send('Missing code')

  try {
    const { tokens } = await oauthClient().getToken(code)
    const refreshToken = tokens.refresh_token

    console.log('\n✅ Google OAuth complete!')
    if (refreshToken) {
      console.log(`Add to .env:\nGOOGLE_REFRESH_TOKEN=${refreshToken}\n`)
    }

    res.send(`
      <html><body style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:2rem">
        <h2 style="color:#3fb950">✅ Google Calendar connected!</h2>
        <p>Copy this token into your <code>.env</code> as <code>GOOGLE_REFRESH_TOKEN</code>, then restart the server.</p>
        ${refreshToken ? `<pre style="background:#161b22;padding:1rem;border-radius:6px;overflow-x:auto">GOOGLE_REFRESH_TOKEN=${refreshToken}</pre>` : '<p>Token already stored — refresh token only appears on first consent.</p>'}
        <p>You can close this tab.</p>
      </body></html>
    `)
  } catch (err) {
    console.error(err)
    res.status(500).send('OAuth failed — check server logs')
  }
})

authRouter.get('/status', (_req, res) => {
  res.json({
    google: {
      clientConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      tokenConfigured:  !!process.env.GOOGLE_REFRESH_TOKEN,
    },
    anthropic: {
      keyConfigured: !!process.env.ANTHROPIC_API_KEY,
    },
  })
})
