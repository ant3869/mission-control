// title: Finance / expense ledger route
// path: server/routes/finance.ts
// purpose: Simple JSON-backed expense log. Entries flow in from the Discord bot
//          (!spend) and optionally from the UI. Read by GET /api/finance.

import { Router } from 'express'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { emitDataChanged } from '../lib/dataEvents.js'
import { saveJson } from '../lib/jsonStore.js'

export const financeRouter = Router()

export interface FinanceEntry {
  id:          string
  amount:      number   // positive USD, two decimal places
  description: string
  category:    string
  source:      string   // 'discord' | 'manual'
  createdAt:   string
}

function financePath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'finance.json')
}

function loadEntries(): FinanceEntry[] {
  const path = financePath()
  if (!existsSync(path)) return []
  try { return JSON.parse(readFileSync(path, 'utf8')) as FinanceEntry[] }
  catch { return [] }
}

function saveEntries(entries: FinanceEntry[]): void {
  saveJson(financePath(), entries)
}

// GET /api/finance
financeRouter.get('/', (_req, res) => {
  const entries = loadEntries()
  const total = entries.reduce((s, e) => s + e.amount, 0)
  res.json({ entries, total: Math.round(total * 100) / 100, fetchedAt: new Date().toISOString() })
})

// POST /api/finance
financeRouter.post('/', (req, res) => {
  const body = req.body ?? {}
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ error: 'amount must be a positive number' })
  const description = String(body.description ?? '').trim()
  if (!description)
    return res.status(400).json({ error: 'description is required' })
  const entry: FinanceEntry = {
    id:          randomUUID(),
    amount:      Math.round(amount * 100) / 100,
    description,
    category:    String(body.category ?? 'Misc').trim() || 'Misc',
    source:      String(body.source ?? 'manual').trim(),
    createdAt:   new Date().toISOString(),
  }
  const entries = loadEntries()
  entries.unshift(entry)
  saveEntries(entries)
  emitDataChanged('finance')
  res.status(201).json({ entry })
})

// DELETE /api/finance/:id
financeRouter.delete('/:id', (req, res) => {
  const entries = loadEntries()
  const filtered = entries.filter(e => e.id !== req.params.id)
  if (filtered.length === entries.length) return res.status(404).json({ error: 'not found' })
  saveEntries(filtered)
  res.json({ ok: true })
})
