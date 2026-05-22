/**
 * Usage analytics → /api/radar
 *
 * Primary: parses real Claude Code JSONL session files for token + cost data.
 * Optional: also tries the Anthropic organization usage API if a key is configured
 *           (requires Team/Enterprise plan; falls back gracefully if unavailable).
 *
 * GET /api/radar/usage?days=7   → daily token + cost breakdown + model breakdown
 */
import { Router } from 'express'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import { deriveEventStats } from '../lib/agentEvents.js'

export const radarRouter = Router()

// ─── Pricing ──────────────────────────────────────────────────────────────────

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4':     { input: 15.00, output: 75.00 },
  'claude-opus-4-5':   { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6': { input:  3.00, output: 15.00 },
  'claude-sonnet-4-5': { input:  3.00, output: 15.00 },
  'claude-sonnet-4':   { input:  3.00, output: 15.00 },
  'claude-3-5-sonnet': { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':  { input:  0.80, output:  4.00 },
  'claude-haiku-4':    { input:  0.80, output:  4.00 },
  'claude-3-5-haiku':  { input:  0.80, output:  4.00 },
  'claude-3-haiku':    { input:  0.25, output:  1.25 },
  'claude-3-opus':     { input: 15.00, output: 75.00 },
  'default':           { input:  3.00, output: 15.00 },
}

function priceFor(model: string) {
  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (key !== 'default' && model.includes(key)) return val
  }
  return MODEL_PRICING['default']
}

function calcCost(model: string, inp: number, out: number): number {
  const p = priceFor(model)
  return (inp / 1_000_000) * p.input + (out / 1_000_000) * p.output
}

// ─── JSONL project dir discovery ─────────────────────────────────────────────

function findClaudeProjectsDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
    join(process.cwd(), '.claude', 'projects'),
    join(process.cwd(), 'mnt', '.claude', 'projects'),
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude', 'projects') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'projects') : '',
  ].filter(Boolean)
  return candidates.find(p => {
    try { return existsSync(p) && statSync(p).isDirectory() } catch { return false }
  }) ?? null
}

// ─── JSONL usage extraction ───────────────────────────────────────────────────

interface SessionUsage {
  date:   string   // YYYY-MM-DD
  model:  string
  input:  number
  output: number
}

function extractUsageFromJsonl(filePath: string, cutoffMs: number): SessionUsage[] {
  const records: SessionUsage[] = []
  try {
    const raw   = readFileSync(filePath, 'utf8')
    const lines = raw.split('\n')
    for (const line of lines) {
      if (!line.includes('"usage"') && !line.includes('"input_tokens"')) continue
      let e: any
      try { e = JSON.parse(line) } catch { continue }

      const ts    = e.timestamp ?? ''
      if (!ts) continue
      const ms = new Date(ts).getTime()
      if (ms < cutoffMs) continue

      const date  = ts.slice(0, 10)
      const model = e.message?.model ?? e.model ?? ''
      const usage = e.usage ?? e.message?.usage

      if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
        records.push({
          date,
          model,
          input:  (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
          output: usage.output_tokens ?? 0,
        })
      }
    }
  } catch { /* skip unreadable */ }
  return records
}

function collectAllUsage(projectsDir: string, cutoffMs: number): SessionUsage[] {
  const all: SessionUsage[] = []
  try {
    for (const entry of readdirSync(projectsDir)) {
      const full = join(projectsDir, entry)
      try {
        if (!statSync(full).isDirectory()) continue
        for (const child of readdirSync(full)) {
          if (!child.endsWith('.jsonl')) continue
          const fp = join(full, child)
          try {
            if (statSync(fp).mtimeMs < cutoffMs - 86_400_000) continue // skip very old files
            all.push(...extractUsageFromJsonl(fp, cutoffMs))
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return all
}

// ─── Optional Anthropic API fetch ─────────────────────────────────────────────

async function tryAnthropicUsage(startDate: string, endDate: string): Promise<any[] | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const url = `https://api.anthropic.com/v1/usage?start_time=${startDate}T00:00:00Z&end_time=${endDate}T23:59:59Z&granularity=day`
    const res = await fetch(url, {
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
    })
    if (!res.ok) return null
    const json = await res.json()
    return Array.isArray(json.data) ? json.data : null
  } catch {
    return null
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

radarRouter.get('/usage', async (req, res) => {
  const days     = Math.min(Number(req.query.days ?? 7), 30)
  const now      = new Date()
  const cutoff   = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffMs = cutoff.getTime()
  const fmt      = (d: Date) => d.toISOString().slice(0, 10)

  // ── 1. Try Anthropic API ──────────────────────────────────────────────────
  const apiRecords = await tryAnthropicUsage(fmt(cutoff), fmt(now))

  // ── 2. Always collect from JSONL (more complete for CLI usage) ────────────
  const projectsDir  = findClaudeProjectsDir()
  const jsonlRecords = projectsDir ? collectAllUsage(projectsDir, cutoffMs) : []

  // Merge: prefer API records if available (de-duplicate by summing both isn't ideal,
  // so if API data exists use it; otherwise fall back to JSONL only)
  type DayStats = { tokens: number; cost: number; runs: number }
  const byDay:   Record<string, DayStats> = {}
  const byModel: Record<string, DayStats> = {}

  const processRecord = (date: string, model: string, inp: number, out: number) => {
    if (!date || date < fmt(cutoff) || date > fmt(now)) return
    const total = inp + out
    const cost  = calcCost(model || 'default', inp, out)

    byDay[date]   ??= { tokens: 0, cost: 0, runs: 0 }
    byDay[date].tokens += total
    byDay[date].cost   += cost
    byDay[date].runs   += 1

    const mk = model || 'unknown'
    byModel[mk] ??= { tokens: 0, cost: 0, runs: 0 }
    byModel[mk].tokens += total
    byModel[mk].cost   += cost
    byModel[mk].runs   += 1
  }

  if (apiRecords && apiRecords.length > 0) {
    for (const r of apiRecords) {
      const date  = (r.timestamp ?? r.date ?? '').slice(0, 10)
      const model = r.model ?? 'unknown'
      const inp   = (r.input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0)
      const out   = r.output_tokens ?? 0
      processRecord(date, model, inp, out)
    }
  } else {
    for (const r of jsonlRecords) {
      processRecord(r.date, r.model, r.input, r.output)
    }
  }

  const dailyUsage = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stats]) => ({
      date:    new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      dateIso: date,
      tokens:  stats.tokens,
      cost:    Math.round(stats.cost * 10000) / 10000,
      runs:    stats.runs,
    }))

  const modelBreakdown = Object.entries(byModel)
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .map(([model, stats]) => ({
      model,
      tokens: stats.tokens,
      cost:   Math.round(stats.cost * 10000) / 10000,
      runs:   stats.runs,
    }))

  const totalTokens = dailyUsage.reduce((s, d) => s + d.tokens, 0)
  const totalCost   = dailyUsage.reduce((s, d) => s + d.cost, 0)
  const totalRuns   = dailyUsage.reduce((s, d) => s + d.runs, 0)

  res.json({
    days,
    startDate:      fmt(cutoff),
    endDate:        fmt(now),
    totalTokens,
    totalCost:      Math.round(totalCost * 10000) / 10000,
    totalRuns,
    dailyUsage,
    modelBreakdown,
    openclawStats:  deriveEventStats('openclaw', cutoffMs),
    hermesStats:    deriveEventStats('hermes', cutoffMs),
    source:         apiRecords ? 'anthropic-api' : 'jsonl',
    fetchedAt:      new Date().toISOString(),
  })
})

// ─── Insights: heatmap + run-rate + tool-loop anomalies ──────────────────────

radarRouter.get('/insights', async (req, res) => {
  const days     = Math.min(Number(req.query.days ?? 30), 90)
  const now      = new Date()
  const cutoff   = new Date(now)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffMs = cutoff.getTime()

  const projectsDir = findClaudeProjectsDir()

  // heatmap[dayOfWeek 0=Sun][hour 0-23] = event count (all in UTC)
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const costByDay: Record<string, number> = {}
  const sessionCosts: Array<{ sessionId: string; date: string; model: string; tokens: number; cost: number }> = []
  const rawAnomalies: Array<{ sessionId: string; date: string; tool: string; maxConsecutive: number; totalCalls: number }> = []

  if (projectsDir) {
    try {
      for (const entry of readdirSync(projectsDir)) {
        const projectDir = join(projectsDir, entry)
        try {
          if (!statSync(projectDir).isDirectory()) continue
          for (const child of readdirSync(projectDir)) {
            if (!child.endsWith('.jsonl')) continue
            const fp = join(projectDir, child)
            try {
              if (statSync(fp).mtimeMs < cutoffMs - 86_400_000) continue

              const raw   = readFileSync(fp, 'utf8')
              const lines = raw.split('\n')

              let sessionDate  = ''
              let sessionModel = ''
              let sessionCost  = 0
              let sessionToks  = 0
              let lastTool     = ''
              let consecutive  = 0
              const toolStats: Record<string, { max: number; total: number }> = {}

              for (const line of lines) {
                if (!line.trim() || !line.includes('"timestamp"')) continue
                let e: any
                try { e = JSON.parse(line) } catch { continue }

                const ts: string = e.timestamp ?? ''
                if (!ts) continue
                const ms = new Date(ts).getTime()
                if (!Number.isFinite(ms) || ms < cutoffMs) continue

                const d = new Date(ts)
                heatmap[d.getUTCDay()][d.getUTCHours()]++

                if (!sessionDate) sessionDate = ts.slice(0, 10)

                const m: string = e.message?.model ?? e.model ?? ''
                if (m) sessionModel = m

                const usage = e.usage ?? e.message?.usage
                if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
                  const inp = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
                  const out = usage.output_tokens ?? 0
                  const c   = calcCost(m || 'default', inp, out)
                  sessionCost += c
                  sessionToks += inp + out
                  const dayKey = ts.slice(0, 10)
                  costByDay[dayKey] = (costByDay[dayKey] ?? 0) + c
                }

                // Tool-use block scanning for loop detection
                const content = e.message?.content ?? e.content
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block?.type === 'tool_use') {
                      const name = String(block.name ?? 'unknown')
                      consecutive = name === lastTool ? consecutive + 1 : 1
                      lastTool    = name
                      if (!toolStats[name]) toolStats[name] = { max: 0, total: 0 }
                      toolStats[name].total++
                      toolStats[name].max = Math.max(toolStats[name].max, consecutive)
                    }
                  }
                }
              }

              const sid = basename(child, '.jsonl').slice(0, 8)
              if (sessionCost > 0 && sessionDate) {
                sessionCosts.push({ sessionId: sid, date: sessionDate, model: sessionModel, tokens: sessionToks, cost: Math.round(sessionCost * 10000) / 10000 })
              }
              for (const [tool, s] of Object.entries(toolStats)) {
                if (s.max >= 5) rawAnomalies.push({ sessionId: sid, date: sessionDate || '—', tool, maxConsecutive: s.max, totalCalls: s.total })
              }
            } catch { /* skip unreadable */ }
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }

  // Build flat heatmap cells array (all 168 entries)
  const cells: Array<{ day: number; hour: number; count: number }> = []
  let maxCount = 0, peakDay = 0, peakHour = 0
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = heatmap[day][hour]
      cells.push({ day, hour, count })
      if (count > maxCount) { maxCount = count; peakDay = day; peakHour = hour }
    }
  }
  const totalEvents = cells.reduce((s, c) => s + c.count, 0)

  // Run-rate from per-day cost sums
  const dayEntries    = Object.entries(costByDay).sort(([a], [b]) => a.localeCompare(b))
  const daysWithData  = dayEntries.length
  const totalCostSum  = dayEntries.reduce((s, [, c]) => s + c, 0)
  const avgDailyCost  = daysWithData > 0 ? totalCostSum / daysWithData : 0
  const third         = Math.max(1, Math.floor(dayEntries.length / 3))
  const firstAvg      = dayEntries.slice(0, third).reduce((s, [, c]) => s + c, 0) / third
  const lastAvg       = dayEntries.slice(-third).reduce((s, [, c]) => s + c, 0) / third
  const trendPct      = firstAvg > 0.00001 ? Math.round(((lastAvg - firstAvg) / firstAvg) * 100) : 0

  res.json({
    days,
    heatmap:  { cells, maxCount, peakDay, peakHour, totalEvents },
    runRate: {
      avgDailyCost:         Math.round(avgDailyCost * 10000) / 10000,
      projectedMonthlyCost: Math.round(avgDailyCost * 30 * 10000) / 10000,
      projectedWeeklyCost:  Math.round(avgDailyCost * 7  * 10000) / 10000,
      daysWithData,
      trendPct,
      topSessions: sessionCosts.sort((a, b) => b.cost - a.cost).slice(0, 10),
    },
    toolAnomalies: rawAnomalies
      .sort((a, b) => b.maxConsecutive - a.maxConsecutive)
      .slice(0, 20)
      .map(a => ({ ...a, severity: a.maxConsecutive >= 10 ? 'high' : a.maxConsecutive >= 7 ? 'medium' : 'low' })),
    fetchedAt: new Date().toISOString(),
  })
})
