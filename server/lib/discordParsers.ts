// title: Discord command parsers
// path: server/lib/discordParsers.ts
// purpose: Pure, side-effect-free text parsing helpers for the Discord bot.
//          Extracted so they can be unit-tested without a running bot or server.

export interface ParsedSeverity { severity: 'low' | 'medium' | 'high' | 'critical'; rest: string }
export interface ParsedDue      { due: string; rest: string }
export interface ParsedPrice    { price: number; rest: string }
export interface ParsedPriority { priority: 'low' | 'medium' | 'high'; rest: string }
export interface ParsedSpend    { amount: number; description: string; category: string }

function clean(text: string): string {
  return text.replace(/\s{2,}/g, ' ').trim()
}

// Extract severity keyword (checked in priority order: critical → high → medium → low).
// Defaults to 'medium' when none found.
export function extractSeverity(text: string): ParsedSeverity {
  for (const s of ['critical', 'high', 'medium', 'low'] as const) {
    const re = new RegExp(`\\b${s}\\b`, 'i')
    if (re.test(text)) return { severity: s, rest: clean(text.replace(re, '')) }
  }
  return { severity: 'medium', rest: text }
}

// Extract `due:YYYY-MM-DD` token; returns ISO date string or '' if absent.
export function extractDue(text: string): ParsedDue {
  const m = text.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/i)
  if (!m) return { due: '', rest: text }
  return { due: m[1], rest: clean(text.replace(m[0], '')) }
}

// Extract a $-prefixed price (e.g. "$5.50", "$1,299"). Requiring the $ sign
// prevents false matches on items like "Raspberry Pi 4".
// NOTE: intentionally uses .trim() instead of clean() so that double-space
// separators (used by parseSpend for description/category splitting) survive.
export function extractPrice(text: string): ParsedPrice {
  const m = text.match(/\$(\d[\d,]*(?:\.\d{1,2})?)/)
  if (!m) return { price: 0, rest: text }
  const val = parseFloat(m[1].replace(/,/g, ''))
  if (!isFinite(val) || val <= 0) return { price: 0, rest: text }
  return { price: val, rest: text.replace(m[0], '').trim() }
}

// Extract priority keyword (checked in order: high → medium → low).
// Defaults to 'medium' when none found.
export function extractPriority(text: string): ParsedPriority {
  for (const p of ['high', 'medium', 'low'] as const) {
    const re = new RegExp(`\\b${p}\\b`, 'i')
    if (re.test(text)) return { priority: p, rest: clean(text.replace(re, '')) }
  }
  return { priority: 'medium', rest: text }
}

// Parse !spend args: "$5.50 Coffee" or "$12.00 Gas  Transport"
// Two+ spaces separate description from optional category.
export function parseSpend(args: string): ParsedSpend | null {
  const { price: amount, rest } = extractPrice(args)
  if (!amount || amount <= 0) return null
  const parts       = rest.split(/\s{2,}/)
  const description = parts[0]?.trim() || rest.trim()
  const category    = parts.slice(1).join('  ').trim() || 'Misc'
  if (!description) return null
  return { amount, description, category }
}

// Humanise a YYYY-MM-DD date relative to today (timezone-safe string comparison).
export function formatDueDate(isoDate: string): string {
  if (!isoDate) return ''
  // Parse as UTC components to avoid local-midnight shifts
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const dueMs   = Date.UTC(y, m - 1, d)
  const now      = new Date()
  const todayMs  = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dayDiff  = Math.round((dueMs - todayMs) / 86_400_000)
  if (dayDiff === 0)  return 'today'
  if (dayDiff === 1)  return 'tomorrow'
  if (dayDiff === -1) return 'yesterday'
  if (dayDiff < 0)    return `${Math.abs(dayDiff)}d overdue`
  if (dayDiff <= 7)   return `in ${dayDiff}d`
  const label = new Date(`${isoDate}T00:00:00Z`)
  return label.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// Trim a bulleted list to fit within Discord's 2000-char message limit.
export function fmtList(lines: string[], header: string, footer = ''): string {
  const MAX = 1900
  let out    = header + '\n'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] + '\n'
    if (out.length + line.length + footer.length + 40 > MAX) {
      out += `*…and ${lines.length - i} more item${lines.length - i === 1 ? '' : 's'}*\n`
      break
    }
    out += line
  }
  return (out + footer).trimEnd()
}

export function fmtMoney(n: number): string {
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`
  return `$${n.toFixed(2)}`
}
