// title: Financials backend route
// path: server/routes/financials.ts
// purpose: Manual money figures the user enters by hand — accounts, savings,
//          investments, property, and liabilities — stored in data/financials.json.
//          The Financials view combines these with automatic analytics (AI cost,
//          To-Buy, Inventory) to show a live net-worth picture. Mirrors routes/tobuy.ts.

import { Router } from 'express'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { emitDataChanged } from '../lib/dataEvents.js'
import { saveJson } from '../lib/jsonStore.js'

export const financialsRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntryKind = 'asset' | 'liability'

const VALID_KINDS = ['asset', 'liability'] as const
type FinanceKind  = typeof VALID_KINDS[number]

// Free-form category, but we suggest a stable set to the client for grouping/colour.
export const ASSET_CATEGORIES = ['cash', 'bank', 'investment', 'crypto', 'property', 'vehicle', 'hardware', 'receivable', 'other'] as const
export const LIABILITY_CATEGORIES = ['loan', 'credit', 'mortgage', 'tax', 'other'] as const

export interface FinanceEntry {
  id:        string
  label:     string
  kind:      EntryKind
  category:  string
  amount:    number   // USD, always stored positive; kind decides the sign
  notes:     string
  createdAt: string
  updatedAt: string
}

function toNum(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function dataPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'financials.json')
}

function loadEntries(): FinanceEntry[] {
  const path = dataPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as FinanceEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveEntries(entries: FinanceEntry[]): void {
  saveJson(dataPath(), entries)
}

function summarize(entries: FinanceEntry[]) {
  const assets      = entries.filter(e => e.kind === 'asset').reduce((s, e) => s + Math.abs(e.amount), 0)
  const liabilities = entries.filter(e => e.kind === 'liability').reduce((s, e) => s + Math.abs(e.amount), 0)
  const byCategory: Record<string, number> = {}
  for (const e of entries) {
    if (e.kind !== 'asset') continue
    byCategory[e.category] = (byCategory[e.category] ?? 0) + Math.abs(e.amount)
  }
  return { assets, liabilities, netWorth: assets - liabilities, byCategory, count: entries.length }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/financials
financialsRouter.get('/', (_req, res) => {
  const entries = loadEntries()
  res.json({
    entries,
    summary: summarize(entries),
    categories: { asset: ASSET_CATEGORIES, liability: LIABILITY_CATEGORIES },
    fetchedAt: new Date().toISOString(),
  })
})

// POST /api/financials
financialsRouter.post('/', (req, res) => {
  const body = req.body as Record<string, unknown>
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label) return res.status(400).json({ error: 'label is required' })

  const kind: FinanceKind = VALID_KINDS.includes(body.kind as FinanceKind)
    ? (body.kind as FinanceKind) : 'asset'
  const amount   = typeof body.amount   === 'number' ? body.amount   : 0
  const category = typeof body.category === 'string' ? body.category : ''
  const notes    = typeof body.notes    === 'string' ? body.notes    : ''
  const now = new Date().toISOString()
  const entry: FinanceEntry = {
    id:        randomUUID(),
    label,
    kind,
    category:  category.trim() || (kind === 'liability' ? 'other' : 'cash'),
    amount:    Math.abs(toNum(amount, 0)),
    notes,
    createdAt: now,
    updatedAt: now,
  }
  const entries = loadEntries()
  entries.unshift(entry)
  saveEntries(entries)
  emitDataChanged('financials')
  res.status(201).json({ entry })
})

// PATCH /api/financials/:id
financialsRouter.patch('/:id', (req, res) => {
  const entries = loadEntries()
  const entry   = entries.find(e => e.id === req.params.id)
  if (!entry) return res.status(404).json({ error: 'not found' })

  const body = req.body as Record<string, unknown>
  if (typeof body.label === 'string' && body.label.trim())   entry.label    = body.label.trim()
  if (VALID_KINDS.includes(body.kind as FinanceKind))        entry.kind     = body.kind as FinanceKind
  if (typeof body.category === 'string' && body.category.trim()) entry.category = body.category.trim()
  if (typeof body.amount === 'number')                       entry.amount   = Math.abs(toNum(body.amount, entry.amount))
  if (typeof body.notes === 'string')                        entry.notes    = body.notes
  entry.updatedAt = new Date().toISOString()
  saveEntries(entries)
  emitDataChanged('financials')
  res.json({ entry })
})

// DELETE /api/financials/:id
financialsRouter.delete('/:id', (req, res) => {
  const entries  = loadEntries()
  const filtered = entries.filter(e => e.id !== req.params.id)
  if (filtered.length === entries.length) return res.status(404).json({ error: 'not found' })
  saveEntries(filtered)
  emitDataChanged('financials')
  res.json({ ok: true })
})
