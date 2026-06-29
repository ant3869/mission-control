// title: Budget limits route
// path: server/routes/budgets.ts
// purpose: GET/PUT agent spend budgets (daily/weekly cost + token caps).
//          Stored in data/budgets.json. Used by the health dashboard gauge.

import { Router } from 'express'
import { join } from 'node:path'
import { loadJson, saveJson } from '../lib/jsonStore.js'

export const budgetsRouter = Router()

const FILE = join(process.cwd(), 'data', 'budgets.json')

export interface BudgetLimits {
  daily:  { cost: number | null; tokens: number | null }
  weekly: { cost: number | null; tokens: number | null }
}

function load(): BudgetLimits {
  return loadJson(FILE, { daily: { cost: null, tokens: null }, weekly: { cost: null, tokens: null } })
}

function save(b: BudgetLimits) {
  saveJson(FILE, b)
}

function clampNull(v: unknown): number | null {
  const n = Number(v)
  return (v == null || v === '' || Number.isNaN(n) || n <= 0) ? null : n
}

budgetsRouter.get('/', (_req, res) => {
  res.json(load())
})

budgetsRouter.put('/', (req, res) => {
  const body = req.body as Partial<BudgetLimits>
  const current = load()
  const updated: BudgetLimits = {
    daily:  { cost: clampNull(body.daily?.cost  ?? current.daily.cost),  tokens: clampNull(body.daily?.tokens  ?? current.daily.tokens) },
    weekly: { cost: clampNull(body.weekly?.cost ?? current.weekly.cost), tokens: clampNull(body.weekly?.tokens ?? current.weekly.tokens) },
  }
  save(updated)
  res.json(updated)
})
