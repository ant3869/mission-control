// title: Alerts backend route
// path: server/routes/alerts.ts
// purpose: Manage alert rules (stored in data/alerts.json) and evaluate them
//          against live agent event data to surface actionable notifications.

import { Router } from 'express'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getRawEvents } from '../lib/agentEvents.js'
import { getSpendSnapshot } from '../lib/spendCache.js'
import { saveJson } from '../lib/jsonStore.js'
import { getIncidentStore } from '../lib/incidentStore.js'

export const alertsRouter = Router()

const ALERTS_FILE = join(process.cwd(), 'data', 'alerts.json')

interface AlertRule {
  id:        string
  name:      string
  enabled:   boolean
  severity:  'info' | 'warning' | 'critical'
  condition: 'error_rate' | 'loop_detected' | 'session_stalled' | 'token_spike' | 'no_activity'
  threshold: number          // meaning depends on condition
  windowMinutes: number
  source:    'openclaw' | 'hermes' | 'all'
  createdAt: string
  updatedAt: string
}

interface ActiveAlert {
  ruleId:    string
  ruleName:  string
  severity:  AlertRule['severity']
  message:   string
  firedAt:   string
}

function readRules(): AlertRule[] {
  if (!existsSync(ALERTS_FILE)) return []
  try { return JSON.parse(readFileSync(ALERTS_FILE, 'utf8')) } catch { return [] }
}

function writeRules(rules: AlertRule[]): void {
  saveJson(ALERTS_FILE, rules)
}

function evaluateRules(rules: AlertRule[]): ActiveAlert[] {
  const fired: ActiveAlert[] = []
  const now = Date.now()

  for (const rule of rules.filter(r => r.enabled)) {
    const windowMs = rule.windowMinutes * 60_000
    const cutoff   = new Date(now - windowMs).toISOString()

    const sources: Array<'openclaw' | 'hermes'> = rule.source === 'all' ? ['openclaw', 'hermes'] : [rule.source]
    const events = sources.flatMap(s => getRawEvents(s, 500)).filter(e => e.ts >= cutoff)

    switch (rule.condition) {
      case 'error_rate': {
        const errors = events.filter(e => e.eventType.toLowerCase().includes('error') || e.eventType.toLowerCase().includes('fail'))
        if (errors.length >= rule.threshold) {
          fired.push({ ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
            message: `${errors.length} error events in the last ${rule.windowMinutes}m (threshold: ${rule.threshold})`,
            firedAt: new Date().toISOString() })
        }
        break
      }
      case 'loop_detected': {
        const toolCounts = new Map<string, number>()
        for (const e of events) {
          if (!e.eventType.includes('tool')) continue
          const tool = (e.payload as any)?.tool ?? (e.payload as any)?.toolName ?? ''
          if (tool) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1)
        }
        for (const [tool, count] of toolCounts) {
          if (count >= rule.threshold) {
            fired.push({ ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
              message: `Tool "${tool}" called ${count} times in ${rule.windowMinutes}m — possible loop (threshold: ${rule.threshold})`,
              firedAt: new Date().toISOString() })
            break
          }
        }
        break
      }
      case 'session_stalled': {
        // No events for more than threshold minutes while sessions are active
        const latestEvent = events[0]
        if (!latestEvent) {
          const allEvents = sources.flatMap(s => getRawEvents(s, 10))
          if (allEvents.length > 0) {
            const staleMins = Math.round((now - new Date(allEvents[0].ts).getTime()) / 60_000)
            if (staleMins >= rule.threshold) {
              fired.push({ ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
                message: `No agent events for ${staleMins} minutes (threshold: ${rule.threshold}m)`,
                firedAt: new Date().toISOString() })
            }
          }
        }
        break
      }
      case 'token_spike': {
        const totalTokens = events.reduce((n, e) => {
          const p = e.payload as any
          return n + (p?.inputTokens ?? p?.input_tokens ?? 0) + (p?.outputTokens ?? p?.output_tokens ?? 0)
        }, 0)
        if (totalTokens >= rule.threshold) {
          fired.push({ ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
            message: `${totalTokens.toLocaleString()} tokens used in the last ${rule.windowMinutes}m (threshold: ${rule.threshold.toLocaleString()})`,
            firedAt: new Date().toISOString() })
        }
        break
      }
      case 'no_activity': {
        if (events.length === 0) {
          fired.push({ ruleId: rule.id, ruleName: rule.name, severity: rule.severity,
            message: `No agent activity in the last ${rule.windowMinutes}m`,
            firedAt: new Date().toISOString() })
        }
        break
      }
    }
  }

  return fired
}

// GET /api/alerts/rules
alertsRouter.get('/rules', (_req, res) => {
  res.json({ rules: readRules(), fetchedAt: new Date().toISOString() })
})

// POST /api/alerts/rules
alertsRouter.post('/rules', (req, res) => {
  const body = req.body ?? {}
  if (!body.name || !body.condition) return res.status(400).json({ error: 'name and condition required' })
  const rules = readRules()
  const rule: AlertRule = {
    id:            crypto.randomUUID(),
    name:          String(body.name),
    enabled:       body.enabled ?? true,
    severity:      body.severity ?? 'warning',
    condition:     body.condition,
    threshold:     Number(body.threshold ?? 5),
    windowMinutes: Number(body.windowMinutes ?? 60),
    source:        body.source ?? 'all',
    createdAt:     new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
  }
  rules.push(rule)
  writeRules(rules)
  res.status(201).json({ rule })
})

// PUT /api/alerts/rules/:id
alertsRouter.put('/rules/:id', (req, res) => {
  const rules = readRules()
  const idx   = rules.findIndex(r => r.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'not found' })
  rules[idx] = { ...rules[idx], ...req.body, id: rules[idx].id, createdAt: rules[idx].createdAt, updatedAt: new Date().toISOString() }
  writeRules(rules)
  res.json({ rule: rules[idx] })
})

// DELETE /api/alerts/rules/:id
alertsRouter.delete('/rules/:id', (req, res) => {
  const rules = readRules()
  const filtered = rules.filter(r => r.id !== req.params.id)
  if (filtered.length === rules.length) return res.status(404).json({ error: 'not found' })
  writeRules(filtered)
  res.json({ ok: true })
})

// GET /api/alerts/active — evaluate all enabled rules against current event window
alertsRouter.get('/active', (_req, res) => {
  const rules  = readRules()
  const alerts = evaluateRules(rules)

  // ── Budget threshold checks (synthetic alerts) ───────────────────────────
  // Only fire when spend data has been loaded (radar/usage fetched at least once).
  try {
    const BUDGETS_FILE = join(process.cwd(), 'data', 'budgets.json')
    if (existsSync(BUDGETS_FILE)) {
      const budgets = JSON.parse(readFileSync(BUDGETS_FILE, 'utf8')) as {
        daily:  { cost: number | null; tokens: number | null }
        weekly: { cost: number | null; tokens: number | null }
      }
      const spend = getSpendSnapshot()
      if (spend) {
        if (budgets.daily.cost && spend.dailyCost >= budgets.daily.cost) {
          alerts.push({
            ruleId:   'budget:daily:cost',
            ruleName: 'Daily cost budget',
            severity: 'critical',
            message:  `Daily spend $${spend.dailyCost.toFixed(4)} has reached the $${budgets.daily.cost.toFixed(2)} limit`,
            firedAt:  spend.updatedAt,
          })
        }
        if (budgets.daily.tokens && spend.dailyTokens >= budgets.daily.tokens) {
          alerts.push({
            ruleId:   'budget:daily:tokens',
            ruleName: 'Daily token budget',
            severity: 'warning',
            message:  `Daily tokens ${spend.dailyTokens.toLocaleString()} has reached the ${budgets.daily.tokens.toLocaleString()} limit`,
            firedAt:  spend.updatedAt,
          })
        }
        if (budgets.weekly.cost && spend.weeklyCost >= budgets.weekly.cost) {
          alerts.push({
            ruleId:   'budget:weekly:cost',
            ruleName: 'Weekly cost budget',
            severity: 'critical',
            message:  `Weekly spend $${spend.weeklyCost.toFixed(4)} has reached the $${budgets.weekly.cost.toFixed(2)} limit`,
            firedAt:  spend.updatedAt,
          })
        }
        if (budgets.weekly.tokens && spend.weeklyTokens >= budgets.weekly.tokens) {
          alerts.push({
            ruleId:   'budget:weekly:tokens',
            ruleName: 'Weekly token budget',
            severity: 'warning',
            message:  `Weekly tokens ${spend.weeklyTokens.toLocaleString()} has reached the ${budgets.weekly.tokens.toLocaleString()} limit`,
            firedAt:  spend.updatedAt,
          })
        }
      }
    }
  } catch { /* budgets unavailable — skip */ }

  getIncidentStore().sync(alerts)
  res.json({ alerts, total: alerts.length, fetchedAt: new Date().toISOString() })
})
