// title: To-Buy backend route
// path: server/routes/tobuy.ts
// purpose: Personal shopping list (stored in data/tobuy.json) with priority,
//          quantity, and per-item estimated price, plus agent-driven research
//          that attaches general info, a price, local options, and online buy
//          links to each item. Mirrors routes/todos.ts.

import { Router } from 'express'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { researchBuyItem, type BuyResearchResult } from '../lib/research.js'

export const toBuyRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type BuyPriority = 'low' | 'medium' | 'high'

export interface BuyResearch extends BuyResearchResult {
  status:      'idle' | 'pending' | 'done' | 'failed'
  requestedAt: string   // ISO or empty
  completedAt: string   // ISO or empty
  error:       string
}

export interface BuyItem {
  id:             string
  title:          string
  notes:          string
  priority:       BuyPriority
  quantity:       number
  estimatedPrice: number   // per-unit USD (user-entered or agent-suggested)
  purchased:      boolean
  createdAt:      string
  updatedAt:      string
  purchasedAt:    string   // ISO or empty
  research:       BuyResearch
}

const PRIORITIES: BuyPriority[] = ['low', 'medium', 'high']

const emptyResearch = (): BuyResearch => ({ status: 'idle', requestedAt: '', completedAt: '', error: '' })

function toNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function buyPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'tobuy.json')
}

function loadItems(): BuyItem[] {
  const path = buyPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BuyItem[]
    return parsed.map(i => ({ quantity: 1, estimatedPrice: 0, ...i }))
  } catch { return [] }
}

function saveItems(items: BuyItem[]): void {
  writeFileSync(buyPath(), JSON.stringify(items, null, 2), 'utf8')
}

// Research marked 'pending' from a previous server run is orphaned. Reset it.
{
  const items = loadItems()
  let dirty = false
  for (const i of items) {
    if (i.research?.status === 'pending') {
      i.research = { ...i.research, status: 'failed', error: 'Reset: server restarted while research was in progress' }
      dirty = true
    }
  }
  if (dirty) saveItems(items)
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/tobuy
toBuyRouter.get('/', (_req, res) => {
  res.json({ items: loadItems(), fetchedAt: new Date().toISOString() })
})

// POST /api/tobuy
toBuyRouter.post('/', (req, res) => {
  const body = req.body ?? {}
  if (!String(body.title ?? '').trim()) return res.status(400).json({ error: 'title is required' })
  const item: BuyItem = {
    id:             randomUUID(),
    title:          String(body.title).trim(),
    notes:          String(body.notes ?? ''),
    priority:       PRIORITIES.includes(body.priority) ? body.priority : 'medium',
    quantity:       Math.max(1, Math.round(toNum(body.quantity, 1))),
    estimatedPrice: toNum(body.estimatedPrice, 0),
    purchased:      false,
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    purchasedAt:    '',
    research:       emptyResearch(),
  }
  const items = loadItems()
  items.unshift(item)
  saveItems(items)
  res.status(201).json({ item })
})

// PATCH /api/tobuy/:id
toBuyRouter.patch('/:id', (req, res) => {
  const items = loadItems()
  const item  = items.find(i => i.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'not found' })

  const { title, notes, priority, quantity, estimatedPrice, purchased } = req.body ?? {}
  if (title !== undefined && String(title).trim()) item.title = String(title).trim()
  if (notes !== undefined)                         item.notes = String(notes)
  if (PRIORITIES.includes(priority))               item.priority = priority
  if (quantity !== undefined)                      item.quantity = Math.max(1, Math.round(toNum(quantity, item.quantity)))
  if (estimatedPrice !== undefined)                item.estimatedPrice = toNum(estimatedPrice, item.estimatedPrice)
  if (purchased !== undefined) {
    item.purchased = Boolean(purchased)
    item.purchasedAt = item.purchased ? new Date().toISOString() : ''
  }
  item.updatedAt = new Date().toISOString()
  saveItems(items)
  res.json({ item })
})

// POST /api/tobuy/clear-purchased — remove all purchased items
toBuyRouter.post('/clear-purchased', (_req, res) => {
  const items = loadItems()
  const kept = items.filter(i => !i.purchased)
  saveItems(kept)
  res.json({ removed: items.length - kept.length })
})

// DELETE /api/tobuy/:id
toBuyRouter.delete('/:id', (req, res) => {
  const items = loadItems()
  const filtered = items.filter(i => i.id !== req.params.id)
  if (filtered.length === items.length) return res.status(404).json({ error: 'not found' })
  saveItems(filtered)
  res.json({ ok: true })
})

// POST /api/tobuy/:id/research — ask a connected agent to research the item (async)
toBuyRouter.post('/:id/research', (req, res) => {
  const items = loadItems()
  const item  = items.find(i => i.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'not found' })
  if (item.research?.status === 'pending') return res.status(409).json({ error: 'research already in progress' })

  const source = req.body?.source === 'hermes' ? 'hermes' : 'openclaw'
  item.research = { ...emptyResearch(), status: 'pending', requestedAt: new Date().toISOString() }
  item.updatedAt = new Date().toISOString()
  saveItems(items)

  // Fire-and-forget: the client polls GET /api/tobuy for status transitions.
  researchBuyItem(item, source).then(r => {
    const cur = loadItems()
    const t = cur.find(x => x.id === item.id)
    if (!t) return
    t.research = { ...t.research, ...r, status: 'done', completedAt: new Date().toISOString(), error: '' }
    // Auto-fill the estimated price from research if the user hasn't set one.
    if ((!t.estimatedPrice || t.estimatedPrice <= 0) && r.estimatedPrice && r.estimatedPrice > 0) {
      t.estimatedPrice = r.estimatedPrice
    }
    t.updatedAt = new Date().toISOString()
    saveItems(cur)
  }).catch(err => {
    const cur = loadItems()
    const t = cur.find(x => x.id === item.id)
    if (!t) return
    t.research = { ...t.research, status: 'failed', error: String(err?.message ?? err).slice(0, 200) }
    t.updatedAt = new Date().toISOString()
    saveItems(cur)
  })

  res.status(202).json({ item })
})
