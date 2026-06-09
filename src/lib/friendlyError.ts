// title: friendlyError
// path: src/lib/friendlyError.ts
// purpose: Turn raw API/network error strings (e.g. "fetch failed", "401",
//          "invalid_grant") into short, actionable, human-readable messages.
//          Non-recognised errors pass through unchanged so real detail isn't lost.

export function friendlyError(err: unknown, subject = 'the server'): string {
  const msg = err instanceof Error ? err.message : String(err ?? '').trim()
  if (!msg) return 'Something went wrong. Try again.'
  if (/\bfetch\b|network|ECONNREFUSED|getaddr|refused|socket|timed? ?out|aborted|\b50[234]\b/i.test(msg))
    return `Couldn't reach ${subject}. Check it's running and reachable, then retry.`
  if (/invalid_grant|invalid_token|unauthor|\b401\b|\b403\b|expired|credential|forbidden/i.test(msg))
    return `Authentication failed for ${subject}. Reconnect it in Settings.`
  return msg
}
