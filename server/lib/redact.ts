// title: Secret redaction utilities
// path: server/lib/redact.ts
// purpose: Strip large config blobs and mask secret-like values out of event
//          payloads before they are stored or returned to the browser.

// Keys whose entire value is dropped (they carry the agent's full live config,
// including provider tokens, bot tokens, gateway auth, etc).
const STRIP_KEYS = new Set(['cfg', 'config', 'secrets', 'credentials'])

// Keys that look like secrets — value is masked to its last 4 chars.
const SECRET_KEY =
  /(^|[_-])(token|api[_-]?key|apikey|secret|password|passwd|authorization|bearer|bot[_-]?token|client[_-]?secret|refresh[_-]?token|access[_-]?token|private[_-]?key)($|[_-])/i

export function maskSecret(value: string): string {
  if (!value) return value
  if (value.length <= 8) return '••••'
  return `••••${value.slice(-4)}`
}

/**
 * Recursively redact an arbitrary value. Drops config blobs entirely and masks
 * secret-looking string fields. Pure — returns a new structure, never mutates.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 10) return value
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP_KEYS.has(key)) {
        out[key] = '[redacted]'
        continue
      }
      if (SECRET_KEY.test(key) && typeof val === 'string') {
        out[key] = maskSecret(val)
        continue
      }
      out[key] = redact(val, depth + 1)
    }
    return out
  }
  return value
}

/** Redact a JSON string in place; returns a redacted JSON string. */
export function redactJsonString(json: string): string {
  try {
    return JSON.stringify(redact(JSON.parse(json)))
  } catch {
    return json
  }
}
