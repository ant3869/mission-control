// title: Spend — personal money command center
// path: src/views/Spend.tsx
// purpose: One place for "what am I spending". Keeps Claude Code (a subscription —
//   shown as token-equivalent VALUE, not billed per-token) separate from the
//   OpenClaw/Hermes agents (real per-token API spend), and tracks "things":
//   To-Buy outstanding + the value of hardware already owned (Inventory).
//   Also shows the manual expense ledger populated via the Discord !spend command.

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  RefreshCw, Sparkles, Bot, ShoppingCart, Package, TrendingUp, TrendingDown, Coins, Receipt,
} from 'lucide-react'
import {
  radar, modelOps, inventory, finance,
  type RadarUsageResponse, type RadarInsightsResponse, type ModelOpsResponse, type InventoryStats,
  type FinanceEntry,
} from '../lib/api'
import { SegmentBar, Histogram, fmtNum } from '../components/charts'

const ACCENT = {
  green:  '#4ade80',
  amber:  '#fbbf24',
  blue:   '#60a5fa',
  purple: '#a78bfa',
  teal:   '#2dd4bf',
  muted:  '#4a4a58',
} as const

const DAYS = 30

function money(n: number): string {
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return `$${Math.round(n).toLocaleString('en-US')}`
  return `$${n.toFixed(2)}`
}

interface BuyItem { id: string; estimatedPrice: number; quantity: number; purchased: boolean }

function Lane({
  accent, icon, title, tag, primary, primarySub, children,
}: {
  accent: string; icon: React.ReactNode; title: string; tag?: string
  primary: string; primarySub?: string; children?: React.ReactNode
}) {
  return (
    <section
      className="rounded-xl border border-border bg-card overflow-hidden"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 shrink-0" style={{ color: accent }}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{title}</h2>
            {tag && (
              <span className="rounded border px-1.5 py-0.5 text-xxs font-medium"
                style={{ color: accent, backgroundColor: `${accent}1a`, borderColor: `${accent}33` }}>
                {tag}
              </span>
            )}
          </div>
          <p className="text-3xl font-bold tabular-nums leading-none mt-2" style={{ color: accent }}>{primary}</p>
          {primarySub && <p className="text-[11px] text-text-muted mt-1.5">{primarySub}</p>}
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </section>
  )
}

export function Spend() {
  const [usage, setUsage]           = useState<RadarUsageResponse | null>(null)
  const [insights, setInsights]     = useState<RadarInsightsResponse | null>(null)
  const [ops, setOps]               = useState<ModelOpsResponse | null>(null)
  const [invStats, setInvStats]     = useState<InventoryStats | null>(null)
  const [buyOpen, setBuyOpen]       = useState<{ total: number; count: number } | null>(null)
  const [finEntries, setFinEntries] = useState<FinanceEntry[]>([])
  const [finTotal, setFinTotal]     = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [u, ins, mo, inv, tb, fin] = await Promise.allSettled([
        radar.usage(DAYS),
        radar.insights(DAYS),
        modelOps.summary(DAYS, 'all'),
        inventory.list(),
        fetch('/api/tobuy').then(r => r.json()),
        finance.list(),
      ])
      if (u.status   === 'fulfilled') setUsage(u.value)
      if (ins.status === 'fulfilled') setInsights(ins.value)
      if (mo.status  === 'fulfilled') setOps(mo.value)
      if (inv.status === 'fulfilled') setInvStats(inv.value.stats)
      if (tb.status  === 'fulfilled') {
        const open: BuyItem[] = (tb.value?.items ?? []).filter((i: BuyItem) => !i.purchased)
        setBuyOpen({ total: open.reduce((s, i) => s + (i.estimatedPrice || 0) * (i.quantity || 1), 0), count: open.length })
      }
      if (fin.status === 'fulfilled') {
        setFinEntries(fin.value.entries ?? [])
        setFinTotal(fin.value.total ?? 0)
      }
      if ([u, mo, inv].every(r => r.status === 'rejected')) setError('Could not load spend data')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load spend data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Derive ──────────────────────────────────────────────────────────────────
  const bySource     = ops?.bySource ?? []
  const claudeCost   = usage?.totalCost ?? 0                       // Claude Code, token-equivalent value
  const claudeTokens = usage?.totalTokens ?? 0
  const claudeRuns   = usage?.totalRuns ?? 0
  const agentCost    = bySource.filter(s => s.source === 'openclaw' || s.source === 'hermes').reduce((s, r) => s + r.cost, 0)
  const agentRuns    = bySource.filter(s => s.source === 'openclaw' || s.source === 'hermes').reduce((s, r) => s + r.runs, 0)
  const projMonthly  = insights?.runRate.projectedMonthlyCost ?? 0
  const trendPct     = insights?.runRate.trendPct ?? 0
  const invValue     = invStats?.totalValue ?? 0
  const invItems     = invStats?.totalItems ?? 0
  const buyTotal     = buyOpen?.total ?? 0
  const buyCount     = buyOpen?.count ?? 0

  const dailyBars = (usage?.dailyUsage ?? []).map(d => ({ value: d.cost, color: ACCENT.blue, label: `${d.date}: ${money(d.cost)}` }))

  // Finance ledger — current-month breakdown
  const now = new Date()
  const finThisMonth = finEntries.filter(e => {
    const d = new Date(e.createdAt)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  })
  const finMonthTotal = finThisMonth.reduce((s, e) => s + e.amount, 0)
  const finByCategory = finThisMonth.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount
    return acc
  }, {})
  const finCatSegments = Object.entries(finByCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({
      value,
      label,
      color: [ACCENT.amber, ACCENT.teal, ACCENT.purple, ACCENT.blue, ACCENT.green][i % 5],
    }))

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary flex items-center gap-2"><Coins size={16} /> Spend</h1>
          <p className="text-xs text-text-muted mt-0.5">Last {DAYS} days · AI cost separated from things you buy</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 lg:p-6 flex flex-col gap-4">

          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>
          )}

          {/* AI split overview */}
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">AI cost · {DAYS}d</h2>
              <span className="text-2xl font-bold tabular-nums text-text-primary">{money(claudeCost + agentCost)}</span>
            </div>
            <SegmentBar
              segments={[
                { value: Math.max(claudeCost, 0.0001), color: ACCENT.blue,   label: 'Claude (value)' },
                { value: Math.max(agentCost, 0),       color: ACCENT.purple, label: 'Agents (billed)' },
              ]}
              showLegend
            />
          </section>

          {/* Lane 1 — Claude Code (subscription) */}
          <Lane
            accent={ACCENT.blue}
            icon={<Sparkles size={16} />}
            title="Claude Code"
            tag="subscription"
            primary={money(claudeCost)}
            primarySub={`token-equivalent value · not billed per-token · ${fmtNum(claudeTokens)} tokens · ${fmtNum(claudeRuns)} runs`}
          >
            <div className="flex items-center gap-4 mb-2">
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <span>Projected / mo</span>
                <span className="font-semibold tabular-nums text-text-secondary">{money(projMonthly)}</span>
              </div>
              {trendPct !== 0 && (
                <span className={clsx('flex items-center gap-1 text-xs tabular-nums', trendPct > 0 ? 'text-amber-400' : 'text-green-400')}>
                  {trendPct > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {Math.abs(trendPct)}% vs early period
                </span>
              )}
            </div>
            {dailyBars.length > 0 && <Histogram bars={dailyBars} height={44} />}
          </Lane>

          {/* Lane 2 — Agents (per-token API) */}
          <Lane
            accent={ACCENT.purple}
            icon={<Bot size={16} />}
            title="Agents — OpenClaw + Hermes"
            tag="per-token API"
            primary={money(agentCost)}
            primarySub={agentCost > 0
              ? `real API spend · ${fmtNum(agentRuns)} runs`
              : 'no agent spend recorded — connectors idle or not configured'}
          />

          {/* Lane 3 — Things */}
          <Lane
            accent={ACCENT.teal}
            icon={<ShoppingCart size={16} />}
            title="Things to buy"
            tag={buyCount > 0 ? `${buyCount} open` : 'clear'}
            primary={money(buyTotal)}
            primarySub={buyCount > 0 ? 'estimated cost of your open To-Buy list' : 'nothing on the list'}
          >
            <div className="flex items-center gap-2 pt-1 border-t border-border-subtle">
              <Package size={13} className="text-text-muted" />
              <span className="text-xs text-text-muted">Hardware owned (Inventory)</span>
              <span className="ml-auto text-sm font-semibold tabular-nums text-text-secondary">{money(invValue)}</span>
              <span className="text-xxs text-text-muted">· {invItems} items</span>
            </div>
          </Lane>

          {/* Lane 4 — Expense Ledger (Discord !spend + manual entries) */}
          <Lane
            accent={ACCENT.amber}
            icon={<Receipt size={16} />}
            title="Expense Ledger"
            tag={finEntries.length > 0 ? `${finEntries.length} entries` : 'empty'}
            primary={money(finMonthTotal)}
            primarySub={finMonthTotal > 0
              ? `this month · all-time total ${money(finTotal)}`
              : finEntries.length > 0 ? `no entries this month · all-time ${money(finTotal)}` : 'log expenses with !spend in Discord'}
          >
            {finCatSegments.length > 0 && (
              <>
                <SegmentBar segments={finCatSegments} showLegend />
                <div className="mt-3 space-y-1">
                  {finEntries.slice(0, 6).map(e => (
                    <div key={e.id} className="flex items-center gap-2 text-xs text-text-secondary">
                      <span className="text-text-muted tabular-nums shrink-0">
                        {new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="truncate flex-1">{e.description}</span>
                      <span className="shrink-0 rounded px-1 py-0.5 text-xxs"
                        style={{ background: `${ACCENT.amber}1a`, color: ACCENT.amber }}>
                        {e.category}
                      </span>
                      <span className="tabular-nums font-semibold shrink-0">{money(e.amount)}</span>
                    </div>
                  ))}
                  {finEntries.length > 6 && (
                    <p className="text-xxs text-text-muted pt-1">+{finEntries.length - 6} more entries</p>
                  )}
                </div>
              </>
            )}
          </Lane>

          {loading && !usage && (
            <p className="text-center text-xs text-text-muted py-4">Loading spend…</p>
          )}
        </div>
      </div>
    </div>
  )
}
