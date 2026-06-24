// title: Recurring bills — derived from Google Calendar
// path: server/routes/bills.ts
// purpose: The user keeps every recurring bill on their calendar with the amount
//   in the event description (e.g. "Anthropic (Claude Pro)" → "$25"). This route
//   reads the calendar, isolates events whose description is purely a money
//   amount, dedupes them into one bill per series, classifies each (AI vs other),
//   and returns a monthly recurring picture. This is the source of truth for the
//   "actual money spent" pools in Financials — AI subscriptions are FLAT fees,
//   not token-priced, so they belong here, not in token-equivalent value.

import { Router } from 'express'
import { GoogleAuthError, isConfigured, hasToken } from '../lib/googleAuth.js'
import { listEventsAcrossCalendars } from '../lib/googleCalendar.js'

export const billsRouter = Router()

// ─── Classification ─────────────────────────────────────────────────────────────

export type BillCategory = 'ai' | 'telecom' | 'insurance' | 'housing' | 'entertainment' | 'health' | 'utilities' | 'other'

const CATEGORY_KEYWORDS: Array<{ cat: BillCategory; words: string[] }> = [
  { cat: 'ai',            words: ['anthropic', 'claude', 'openai', 'chatgpt', 'github', 'copilot', 'cursor', 'midjourney', 'perplexity', 'gemini', 'grok', 'replit', 'huggingface', 'elevenlabs', 'runway'] },
  { cat: 'telecom',       words: ['google fi', 'mobile', 'phone', 'vpn', 'verizon', 'at&t', 'att', 't-mobile', 'spectrum'] },
  { cat: 'insurance',     words: ['insurance', 'root', 'geico', 'allstate', 'progressive'] },
  { cat: 'housing',       words: ['rent', 'mortgage', 'hoa'] },
  { cat: 'utilities',     words: ['utilities', 'electric', 'water', 'cox', 'internet', 'gas', 'power', 'city of'] },
  { cat: 'entertainment', words: ['youtube', 'netflix', 'spotify', 'hulu', 'disney', 'prime', 'hbo', 'max', 'paramount', 'peacock', 'twitch'] },
  { cat: 'health',        words: ['gym', 'bluechew', 'fitness', 'peloton', 'health'] },
]

function classify(name: string): BillCategory {
  const n = name.toLowerCase()
  for (const { cat, words } of CATEGORY_KEYWORDS) {
    if (words.some(w => n.includes(w))) return cat
  }
  return 'other'
}

// A bill's description is (essentially) just a money amount: "$25", "110.33",
// "$1,129.25", optionally with a "/mo" suffix. This deliberately rejects events
// whose description is prose (e.g. a "Week Preview" checklist that happens to
// contain a number), so only real bills are picked up.
function parseAmount(desc: string): number | null {
  const m = String(desc).trim().match(/^\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/?\s*(?:mo|month|monthly))?$/i)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export interface Bill {
  id:          string
  name:        string
  amount:      number
  category:    BillCategory
  isAi:        boolean
  dueIso:      string | null
  dueDisplay:  string
}

// ─── Route ──────────────────────────────────────────────────────────────────────

function guard(res: any): boolean {
  if (!isConfigured()) { res.status(503).json({ error: 'Google Calendar not configured', state: 'not_configured' }); return false }
  if (!hasToken())     { res.status(503).json({ error: 'Google Calendar not connected', state: 'disconnected' }); return false }
  return true
}

// GET /api/bills — recurring bills for the next ~35 days, deduped to one per series.
billsRouter.get('/', async (_req, res) => {
  if (!guard(res)) return
  try {
    const now = new Date()
    const end = new Date(now); end.setDate(end.getDate() + 35)
    const events = await listEventsAcrossCalendars(now.toISOString(), end.toISOString())

    // One bill per series (calendar expands recurrences into instances). Keep the
    // soonest upcoming instance as the "next due".
    const byName = new Map<string, Bill>()
    for (const ev of events) {
      const amount = parseAmount(ev.description)
      if (amount == null) continue
      const key = normName(ev.name)
      const cat = classify(ev.name)
      const dueIso = ev.startIso
      const existing = byName.get(key)
      if (existing && existing.dueIso && dueIso && existing.dueIso <= dueIso) continue
      byName.set(key, {
        id:         ev.id,
        name:       ev.name,
        amount,
        category:   cat,
        isAi:       cat === 'ai',
        dueIso,
        dueDisplay: dueIso ? new Date(dueIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—',
      })
    }

    const bills = Array.from(byName.values()).sort((a, b) => (a.dueIso ?? '').localeCompare(b.dueIso ?? ''))

    const byCategory: Record<string, number> = {}
    let total = 0, aiTotal = 0
    for (const b of bills) {
      total += b.amount
      byCategory[b.category] = (byCategory[b.category] ?? 0) + b.amount
      if (b.isAi) aiTotal += b.amount
    }

    res.json({
      bills,
      ai: bills.filter(b => b.isAi),
      monthly: {
        total:   Math.round(total * 100) / 100,
        aiTotal: Math.round(aiTotal * 100) / 100,
        byCategory,
      },
      count:     bills.length,
      source:    'calendar',
      fetchedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    if (err instanceof GoogleAuthError) return res.status(502).json({ error: err.message, state: err.state })
    res.status(500).json({ error: err?.message ?? 'Failed to derive bills' })
  }
})
