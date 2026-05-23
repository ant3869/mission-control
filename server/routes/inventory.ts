import { Router } from 'express'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { InventoryItem } from '../../src/types/index.js'

const router = Router()

// ─── SQLite setup ─────────────────────────────────────────────────────────────

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'openclaw.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'general',
    quantity INTEGER NOT NULL DEFAULT 1,
    min_threshold INTEGER NOT NULL DEFAULT 1,
    max_threshold INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'in-stock',
    condition TEXT,
    location TEXT,
    supplier TEXT,
    cost REAL,
    notes TEXT,
    tags TEXT DEFAULT '[]',
    last_restocked_ago TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowToItem(row: any): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    quantity: row.quantity,
    minThreshold: row.min_threshold,
    maxThreshold: row.max_threshold,
    status: row.status,
    condition: row.condition ?? undefined,
    location: row.location ?? undefined,
    supplier: row.supplier ?? undefined,
    cost: row.cost ?? undefined,
    notes: row.notes ?? undefined,
    tags: JSON.parse(row.tags ?? '[]'),
    lastRestockedAgo: row.last_restocked_ago ?? undefined,
  }
}

function calcStatus(quantity: number, minThreshold: number): InventoryItem['status'] {
  if (quantity === 0) return 'out-of-stock'
  if (quantity <= minThreshold) return 'low'
  return 'in-stock'
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/inventory/items
router.get('/items', (_req, res) => {
  const rows = db.prepare('SELECT * FROM inventory_items ORDER BY updated_at DESC').all()
  res.json((rows as any[]).map(rowToItem))
})

// GET /api/inventory/stats
router.get('/stats', (_req, res) => {
  const rows = db.prepare('SELECT * FROM inventory_items').all() as any[]
  const items = rows.map(rowToItem)

  const byCategory: Record<string, number> = {}
  const byCondition = { working: 0, broken: 0, parts: 0, unknown: 0 }
  let lowStockCount = 0
  let outOfStockCount = 0
  let totalValue = 0

  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1
    if (item.status === 'low') lowStockCount++
    if (item.status === 'out-of-stock') outOfStockCount++
    if (item.cost) totalValue += item.cost * item.quantity
    const cond = (item.condition ?? 'unknown') as keyof typeof byCondition
    if (cond in byCondition) byCondition[cond]++
    else byCondition.unknown++
  }

  res.json({
    totalItems: items.length,
    totalValue: Math.round(totalValue * 100) / 100,
    lowStockCount,
    outOfStockCount,
    byCategory,
    byCondition,
  })
})

// GET /api/inventory/items/:id
router.get('/items/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Item not found' })
  res.json(rowToItem(row as any))
})

// POST /api/inventory/items
router.post('/items', (req, res) => {
  const { name, model, category, sku, quantity, condition, location, supplier, cost, notes } = req.body
  if (!name) return res.status(400).json({ error: 'Item name is required' })

  const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const qty = Number(quantity) || 1
  const minThreshold = 1
  const status = calcStatus(qty, minThreshold)

  db.prepare(`
    INSERT INTO inventory_items (id, name, sku, category, quantity, min_threshold, max_threshold, status, condition, location, supplier, cost, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, sku || model || '', category || 'general', qty, minThreshold, 10, status,
    condition ?? null, location ?? null, supplier ?? null, cost ? Number(cost) : null, notes ?? null)

  const newItem = rowToItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id) as any)
  res.status(201).json(newItem)
})

// PATCH /api/inventory/items/:id
router.patch('/items/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any
  if (!row) return res.status(404).json({ error: 'Item not found' })

  const { name, sku, category, quantity, condition, location, supplier, cost, notes, minThreshold, maxThreshold, tags } = req.body
  const qty = quantity !== undefined ? Number(quantity) : row.quantity
  const min = minThreshold !== undefined ? Number(minThreshold) : row.min_threshold
  const max = maxThreshold !== undefined ? Number(maxThreshold) : row.max_threshold

  db.prepare(`
    UPDATE inventory_items SET
      name = ?, sku = ?, category = ?, quantity = ?, min_threshold = ?, max_threshold = ?,
      status = ?, condition = ?, location = ?, supplier = ?, cost = ?, notes = ?, tags = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? row.name, sku ?? row.sku, category ?? row.category,
    qty, min, max, calcStatus(qty, min),
    condition !== undefined ? condition : row.condition,
    location !== undefined ? location : row.location,
    supplier !== undefined ? supplier : row.supplier,
    cost !== undefined ? Number(cost) : row.cost,
    notes !== undefined ? notes : row.notes,
    tags !== undefined ? JSON.stringify(tags) : row.tags,
    req.params.id,
  )

  res.json(rowToItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(req.params.id) as any))
})

// DELETE /api/inventory/items/:id
router.delete('/items/:id', (req, res) => {
  const row = db.prepare('SELECT id FROM inventory_items WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Item not found' })
  db.prepare('DELETE FROM inventory_items WHERE id = ?').run(req.params.id)
  res.status(204).send()
})

export const inventoryRouter = router
