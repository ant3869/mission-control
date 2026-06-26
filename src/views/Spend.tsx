// title: Financials — personal money command center
// path: src/views/Spend.tsx  (view id stays "spend" for routing/persistence)
// purpose: Top = clickable stat cards (On hand, Net worth, Owed, Hardware, AI cost,
//   To-buy). Clicking a card opens an Inventory-style right side panel with a
//   donut + full breakdown for that figure. Bottom = a hero layout for the manual
//   holdings the user enters by hand (stocks + bank + savings + cash − debts),
//   stored in data/financials.json. Hardware/AI/To-buy stay SEPARATE auto figures.

import { useState, useEffect, useCallback } from 'react'
import { DATA_REFRESH_EVENT, type DataRefreshDetail } from '../lib/dataRefresh'
import { clsx } from 'clsx'
import { useEscapeKey } from '../hooks/useEscapeKey'
import {
  RefreshCw, Plus, Pencil, Trash2, Check, X, Wallet, Landmark, TrendingDown,
  TrendingUp, Package, Sparkles, Bot, ShoppingCart, Scale, ChevronRight,
  Receipt, CreditCard, Calendar,
} from 'lucide-react'
import {
  radar, modelOps, inventory, financials, bills as billsApi, finance as ledgerApi,
  type RadarUsageResponse, type RadarInsightsResponse, type ModelOpsResponse, type InventoryStats,
  type FinanceEntry, type FinanceKind, type FinancialsResponse, type BillsResponse,
  type LedgerEntry, type LedgerResponse,
} from '../lib/api'
import { Donut, SegmentBar, Histogram, fmtNum } from '../components/charts'

const DAYS = 30

const ACCENT = { blue: '#60a5fa', purple: '#a78bfa', teal: '#2dd4bf', amber: '#fbbf24', green: '#4ade80', red: '#f87171' }
const PALETTE = ['#60a5fa', '#a78bfa', '#2dd4bf', '#fbbf24', '#fb7185', '#38bdf8', '#a3e635', '#f472b6', '#94a3b8']

function money(n: number): string {
  if (!isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1000) return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
  return `${sign}$${abs.toFixed(2)}`
}
function shortMoney(n: number): string {
  const a = Math.abs(n)
  if (a >= 1000) return `${n < 0 ? '-' : ''}$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`
  return `${n < 0 ? '-' : ''}$${Math.round(a)}`
}

interface BuyItem { id: string; estimatedPrice: number; quantity: number; purchased: boolean }

// ─── Category metadata ───────────────────────────────────────────────────────────

const FIN_META: Record<string, { label: string; icon: string }> = {
  cash:       { label: 'Cash',        icon: '💵' },
  bank:       { label: 'Bank',        icon: '🏦' },
  investment: { label: 'Investments', icon: '📈' },
  crypto:     { label: 'Crypto',      icon: '🪙' },
  property:   { label: 'Property',    icon: '🏠' },
  vehicle:    { label: 'Vehicles',    icon: '🚗' },
  hardware:   { label: 'Hardware',    icon: '🔧' },
  receivable: { label: 'Owed to me',  icon: '📜' },
  other:      { label: 'Other',       icon: '📦' },
  loan:       { label: 'Loans',       icon: '🏦' },
  credit:     { label: 'Credit',      icon: '💳' },
  mortgage:   { label: 'Mortgage',    icon: '🏠' },
  tax:        { label: 'Tax',         icon: '🧾' },
}
const finMeta = (c: string) => FIN_META[c] ?? { label: c || 'Other', icon: '📦' }

const CAT_HEX: Record<string, string> = {
  cash: '#4ade80', bank: '#60a5fa', investment: '#a78bfa', crypto: '#fbbf24',
  property: '#2dd4bf', vehicle: '#fb7185', hardware: '#38bdf8', receivable: '#a3e635', other: '#94a3b8',
}
const catHex = (c: string) => CAT_HEX[c] ?? '#94a3b8'

// Recurring-bill category colours (for the bills donut/legend).
const BILL_HEX: Record<string, string> = {
  ai: '#60a5fa', housing: '#f87171', utilities: '#fbbf24', telecom: '#2dd4bf',
  insurance: '#a78bfa', entertainment: '#fb7185', health: '#a3e635', other: '#94a3b8',
}
const billHex = (c: string) => BILL_HEX[c] ?? '#94a3b8'
const BILL_LABEL: Record<string, string> = {
  ai: 'AI / software', housing: 'Housing', utilities: 'Utilities', telecom: 'Phone / net',
  insurance: 'Insurance', entertainment: 'Entertainment', health: 'Health', other: 'Other',
}

type CardId = 'networth' | 'bills' | 'ai' | 'hardware' | 'tobuy'

// ─── Stat card (clickable → opens side panel) ───────────────────────────────────

function Stat({ label, value, icon, tone, sub, onClick, active }: {
  label: string; value: string; icon: React.ReactNode; tone?: string; sub?: string
  onClick?: () => void; active?: boolean
}) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-text-muted">
        <span className={tone}>{icon}</span>
        <span className="text-xxs uppercase tracking-wide">{label}</span>
        {onClick && <ChevronRight size={11} className="ml-auto text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />}
      </div>
      <span className={clsx('text-xl font-semibold tabular-nums', tone ?? 'text-text-primary')}>{value}</span>
      {sub && <span className="text-xxs text-text-muted">{sub}</span>}
    </>
  )
  const cls = 'group flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors'
  if (!onClick) return <div className={clsx(cls, 'border-border bg-card')}>{body}</div>
  return (
    <button onClick={onClick} className={clsx(cls, active ? 'border-accent-blue/50 bg-card-hover' : 'border-border bg-card hover:bg-card-hover')}>
      {body}
    </button>
  )
}

// ─── Holding row (inline-editable) ──────────────────────────────────────────────

function HoldingRow({ entry, categories, onSave, onDelete }: {
  entry: FinanceEntry
  categories: { asset: string[]; liability: string[] }
  onSave: (id: string, body: Partial<FinanceEntry>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing]   = useState(false)
  const [label, setLabel]       = useState(entry.label)
  const [amount, setAmount]     = useState(String(entry.amount))
  const [category, setCategory] = useState(entry.category)
  const [busy, setBusy]         = useState(false)

  async function save() {
    setBusy(true)
    try {
      await onSave(entry.id, { label: label.trim() || entry.label, amount: Math.abs(Number(amount)) || 0, category })
      setEditing(false)
    } finally { setBusy(false) }
  }

  if (editing) {
    const opts = entry.kind === 'liability' ? categories.liability : categories.asset
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-card-hover">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label"
          className="flex-1 min-w-0 bg-base border border-border rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-blue/50" />
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="bg-base border border-border rounded px-1.5 py-1 text-xs text-text-secondary outline-none">
          {opts.map(c => <option key={c} value={c}>{finMeta(c).label}</option>)}
        </select>
        <div className="flex items-center">
          <span className="text-xs text-text-muted">$</span>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" onKeyDown={e => e.key === 'Enter' && save()}
            className="w-20 bg-base border border-border rounded px-1.5 py-1 text-xs text-right tabular-nums text-text-primary outline-none focus:border-accent-blue/50" />
        </div>
        <button onClick={save} disabled={busy} className="p-1 text-green-400 hover:text-green-300" title="Save"><Check size={14} /></button>
        <button onClick={() => { setEditing(false); setLabel(entry.label); setAmount(String(entry.amount)); setCategory(entry.category) }}
          className="p-1 text-text-muted hover:text-text-secondary" title="Cancel"><X size={14} /></button>
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-card-hover transition-colors">
      <span className="text-base shrink-0 w-6 text-center">{finMeta(entry.category).icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary truncate">{entry.label}</p>
        <p className="text-xxs text-text-muted">{finMeta(entry.category).label}</p>
      </div>
      <span className={clsx('text-sm font-semibold tabular-nums shrink-0', entry.kind === 'liability' ? 'text-red-400' : 'text-text-primary')}>
        {entry.kind === 'liability' ? '−' : ''}{money(entry.amount)}
      </span>
      <div className="flex items-center shrink-0">
        <button onClick={() => setEditing(true)} className="p-1 text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-opacity" title="Edit"><Pencil size={12} /></button>
        <button onClick={() => onDelete(entry.id)} className="p-1 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete"><Trash2 size={12} /></button>
      </div>
    </div>
  )
}

// ─── Add form (inline) ───────────────────────────────────────────────────────────

function AddEntry({ open, setOpen, categories, onAdd }: {
  open: boolean; setOpen: (v: boolean) => void
  categories: { asset: string[]; liability: string[] }
  onAdd: (body: { label: string; kind: FinanceKind; category: string; amount: number }) => Promise<void>
}) {
  const [kind, setKind]     = useState<FinanceKind>('asset')
  const [label, setLabel]   = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('bank')
  const [busy, setBusy]     = useState(false)
  const opts = kind === 'liability' ? categories.liability : categories.asset

  function switchKind(k: FinanceKind) {
    setKind(k)
    const list = k === 'liability' ? categories.liability : categories.asset
    if (!list.includes(category)) setCategory(list[0] ?? 'other')
  }
  async function submit() {
    if (!label.trim()) return
    setBusy(true)
    try {
      await onAdd({ label: label.trim(), kind, category, amount: Math.abs(Number(amount)) || 0 })
      setLabel(''); setAmount('')
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border text-xs text-text-muted hover:text-text-secondary hover:border-text-muted transition-colors w-full justify-center">
        <Plus size={13} /> Add holding or debt
      </button>
    )
  }
  const input = 'bg-base border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50'
  return (
    <div className="rounded-lg border border-border bg-card-hover p-3 flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xxs">
          {(['asset', 'liability'] as FinanceKind[]).map(k => (
            <button key={k} onClick={() => switchKind(k)}
              className={clsx('px-2 py-1 rounded uppercase tracking-wider font-medium transition-colors',
                kind === k ? 'bg-card text-text-primary' : 'text-text-muted hover:text-text-secondary')}>{k}</button>
          ))}
        </div>
        <button aria-label="Close" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-primary"><X size={14} /></button>
      </div>
      <div className="flex items-center gap-2">
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={kind === 'liability' ? 'e.g. Car loan' : 'e.g. Brokerage · Fidelity'} className={clsx(input, 'flex-1 min-w-0 px-2.5 py-1.5')} />
        <select value={category} onChange={e => setCategory(e.target.value)} className={clsx(input, 'px-1.5 py-1.5 text-text-secondary')}>
          {opts.map(c => <option key={c} value={c}>{finMeta(c).icon} {finMeta(c).label}</option>)}
        </select>
        <div className="flex items-center">
          <span className="text-xs text-text-muted">$</span>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" onKeyDown={e => e.key === 'Enter' && submit()} placeholder="0"
            className={clsx(input, 'w-24 px-1.5 py-1.5 text-right tabular-nums')} />
        </div>
        <button onClick={submit} disabled={busy || !label.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent-blue/40 bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 disabled:opacity-40 text-xs font-medium">
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  )
}

// ─── Side panel (Inventory drawer style) ─────────────────────────────────────────

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">{title}</p>
      {children}
    </div>
  )
}

function LegendRow({ color, label, value, pct }: { color: string; label: string; value: string; pct?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-text-secondary truncate">{label}</span>
      {pct && <span className="text-xxs text-text-muted">{pct}</span>}
      <span className="ml-auto tabular-nums font-medium text-text-primary">{value}</span>
    </div>
  )
}

function BreakdownPanel({
  card, onClose, onHand, liabilities, netWorth, byCategory,
  invStats, claudeCost, claudeTokens, claudeRuns, agentCost, agentRuns,
  trendPct, dailyBars, buyTotal, buyCount, billsData,
}: {
  card: CardId; onClose: () => void
  onHand: number; liabilities: number; netWorth: number; byCategory: Record<string, number>
  invStats: InventoryStats | null
  claudeCost: number; claudeTokens: number; claudeRuns: number; agentCost: number; agentRuns: number
  trendPct: number; dailyBars: { value: number; color: string; label: string }[]
  buyTotal: number; buyCount: number; billsData: BillsResponse | null
}) {
  useEscapeKey(onClose)

  const TITLE: Record<CardId, { label: string; icon: React.ReactNode }> = {
    networth: { label: 'Net worth breakdown', icon: <Landmark size={15} /> },
    bills:    { label: 'Recurring bills',     icon: <Receipt size={15} /> },
    hardware: { label: 'Hardware value',      icon: <Package size={15} /> },
    ai:       { label: 'AI spend',            icon: <Sparkles size={15} /> },
    tobuy:    { label: 'To-buy',              icon: <ShoppingCart size={15} /> },
  }

  // AI money split: subscriptions are FLAT real fees (from calendar bills); agent
  // API usage is real but sporadic; Claude token cost is NOTIONAL value, not money.
  const aiSubs       = billsData?.ai ?? []
  const aiSubsTotal  = billsData?.monthly.aiTotal ?? 0
  const actualAi     = aiSubsTotal + agentCost
  const leverage     = aiSubsTotal > 0 ? claudeCost / aiSubsTotal : 0

  const assetSegs = Object.entries(byCategory)
    .map(([cat, val]) => ({ value: val, color: catHex(cat), label: finMeta(cat).label }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)

  const invCats = (invStats?.byCategory ?? []).slice().sort((a, b) => b.value - a.value)
  const invSegs = invCats.slice(0, 8).map((c, i) => ({ value: c.value, color: PALETTE[i % PALETTE.length], label: c.category }))

  return (
    <div className="flex flex-col h-full w-[360px] min-w-[360px] border-l border-border bg-surface overflow-y-auto">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-text-primary">
          {TITLE[card].icon}
          <p className="text-sm font-semibold">{TITLE[card].label}</p>
        </div>
        <button aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-primary"><X size={15} /></button>
      </div>

      <div className="flex flex-col gap-5 p-5">

        {/* ── Net worth / allocation ── */}
        {card === 'networth' && (
          <>
            <div className="flex items-center justify-center py-1">
              <Donut segments={assetSegs.length ? assetSegs : [{ value: 1, color: '#33333a', label: 'empty' }]}
                size={150} thickness={20} centerTop={shortMoney(onHand)} centerBottom="on hand" />
            </div>
            <PanelSection title="Allocation">
              {assetSegs.length === 0 ? (
                <p className="text-xs text-text-muted">No holdings yet — add accounts in the hero below.</p>
              ) : assetSegs.map(s => (
                <LegendRow key={s.label} color={s.color} label={s.label} value={money(s.value)}
                  pct={`${Math.round((s.value / (onHand || 1)) * 100)}%`} />
              ))}
            </PanelSection>
            <div className="rounded-lg border border-border bg-base p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs"><span className="text-text-muted">Assets</span><span className="tabular-nums font-medium text-text-primary">{money(onHand)}</span></div>
              <div className="flex items-center justify-between text-xs"><span className="text-text-muted">Liabilities</span><span className="tabular-nums font-medium text-red-400">−{money(liabilities)}</span></div>
              <div className="flex items-center justify-between text-xs pt-2 border-t border-border">
                <span className="text-text-secondary font-medium">Net worth</span>
                <span className={clsx('tabular-nums font-semibold', netWorth >= 0 ? 'text-green-400' : 'text-red-400')}>{money(netWorth)}</span>
              </div>
            </div>
          </>
        )}

        {/* ── Hardware (inventory) ── */}
        {card === 'hardware' && (
          <>
            <div className="flex items-center justify-center py-1">
              <Donut segments={invSegs.length ? invSegs : [{ value: 1, color: '#33333a', label: 'empty' }]}
                size={150} thickness={20} centerTop={shortMoney(invStats?.totalValue ?? 0)} centerBottom="hardware" />
            </div>
            <p className="text-xxs text-text-muted -mt-2 text-center">{invStats?.totalItems ?? 0} items · tracked separately from cash</p>
            <PanelSection title="By category">
              {invCats.length === 0 ? (
                <p className="text-xs text-text-muted">No inventory recorded.</p>
              ) : invCats.slice(0, 10).map((c, i) => (
                <LegendRow key={c.category} color={PALETTE[i % PALETTE.length]} label={`${c.category} ·×${c.quantity}`} value={money(c.value)} />
              ))}
            </PanelSection>
          </>
        )}

        {/* ── AI cost ── */}
        {card === 'ai' && (
          <>
            {/* Pool 1 — ACTUAL money out the door */}
            <div className="rounded-lg border border-blue-900/30 bg-blue-950/10 p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xxs font-semibold uppercase tracking-wide text-blue-300">Actual spend / mo</p>
                <p className="text-lg font-bold tabular-nums text-blue-300">{money(actualAi)}</p>
              </div>
              <p className="text-xxs text-text-muted mt-0.5">flat subscriptions + sporadic API — real money</p>
            </div>

            <PanelSection title="Subscriptions · flat (from calendar)">
              {aiSubs.length === 0 ? (
                <p className="text-xs text-text-muted">No AI subscriptions found on your calendar.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {aiSubs.map(s => (
                    <div key={s.id} className="flex items-center gap-2 text-xs py-0.5">
                      <CreditCard size={12} className="text-blue-400 shrink-0" />
                      <span className="text-text-secondary truncate">{s.name}</span>
                      <span className="text-xxs text-text-muted">due {s.dueDisplay}</span>
                      <span className="ml-auto tabular-nums font-medium text-text-primary">{money(s.amount)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs pt-1.5 mt-1 border-t border-border">
                    <span className="text-text-muted">Subscriptions / mo</span>
                    <span className="tabular-nums font-semibold text-text-primary">{money(aiSubsTotal)}</span>
                  </div>
                </div>
              )}
            </PanelSection>

            <PanelSection title={`API overflow · last ${DAYS} days`}>
              <div className="flex items-center gap-2 text-xs">
                <Bot size={13} className="text-purple-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-text-secondary">Agents · OpenClaw + Hermes</p>
                  <p className="text-xxs text-text-muted">{agentCost > 0 ? `per-token API · ${fmtNum(agentRuns)} runs` : 'idle / not configured'}</p>
                </div>
                <span className="ml-auto tabular-nums font-medium text-text-primary">{money(agentCost)}</span>
              </div>
            </PanelSection>

            {/* Pool 2 — NOTIONAL token-equivalent value */}
            <div className="rounded-lg border border-border bg-base p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Token-equivalent value</p>
                <p className="text-base font-bold tabular-nums text-text-secondary">{money(claudeCost)}</p>
              </div>
              <p className="text-xxs text-text-muted mt-1 leading-relaxed">
                What your Claude Code usage <span className="italic">would</span> cost at API token rates — covered by the flat subscription, so it is <span className="text-text-secondary">not money spent</span>.
                {leverage >= 1.2 && <> You got <span className="text-green-400 font-medium">{leverage.toFixed(1)}×</span> the subscription's worth.</>}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xxs text-text-muted">
                <span>{fmtNum(claudeTokens)} tok</span><span>{fmtNum(claudeRuns)} runs</span>
                {trendPct !== 0 && (
                  <span className={clsx('flex items-center gap-1 tabular-nums', trendPct > 0 ? 'text-amber-400' : 'text-green-400')}>
                    {trendPct > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(trendPct)}%
                  </span>
                )}
              </div>
              {dailyBars.length > 0 && <div className="mt-2"><Histogram bars={dailyBars} height={40} /></div>}
            </div>
          </>
        )}

        {/* ── Recurring bills ── */}
        {card === 'bills' && (() => {
          const segs = Object.entries(billsData?.monthly.byCategory ?? {})
            .map(([cat, val]) => ({ value: val, color: billHex(cat), label: BILL_LABEL[cat] ?? cat }))
            .filter(s => s.value > 0).sort((a, b) => b.value - a.value)
          const list = billsData?.bills ?? []
          return (
            <>
              <div className="flex items-center justify-center py-1">
                <Donut segments={segs.length ? segs : [{ value: 1, color: '#33333a', label: 'none' }]}
                  size={150} thickness={20} centerTop={shortMoney(billsData?.monthly.total ?? 0)} centerBottom="/ mo" />
              </div>
              <PanelSection title="By category">
                {segs.map(s => <LegendRow key={s.label} color={s.color} label={s.label} value={money(s.value)} />)}
              </PanelSection>
              <PanelSection title={`Upcoming · ${list.length} bills`}>
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
                  {list.map(b => (
                    <div key={b.id} className={clsx('flex items-center gap-2 px-3 py-1.5 text-xs', b.isAi && 'bg-blue-950/10')}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: billHex(b.category) }} />
                      <span className="text-text-secondary truncate">{b.name}</span>
                      {b.isAi && <span className="text-[9px] uppercase tracking-wide text-blue-400">AI</span>}
                      <span className="text-xxs text-text-muted ml-auto flex items-center gap-1"><Calendar size={9} />{b.dueDisplay}</span>
                      <span className="tabular-nums font-medium text-text-primary w-16 text-right">{money(b.amount)}</span>
                    </div>
                  ))}
                </div>
              </PanelSection>
              <p className="text-xxs text-text-muted leading-relaxed">Pulled live from your Google Calendar (events whose description is an amount). Edit a bill on the calendar to update it here.</p>
            </>
          )
        })()}

        {/* ── To-buy ── */}
        {card === 'tobuy' && (
          <>
            <div className="rounded-lg border border-border bg-base p-4 text-center">
              <p className="text-3xl font-bold tabular-nums text-amber-400">{money(buyTotal)}</p>
              <p className="text-xxs text-text-muted mt-1">{buyCount > 0 ? `${buyCount} open item${buyCount !== 1 ? 's' : ''} on your list` : 'nothing on the list'}</p>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">Estimated cost of everything still open on your To-Buy list. Manage items on the To-Buy page; this figure updates automatically.</p>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────────

export function Spend() {
  const [usage, setUsage]       = useState<RadarUsageResponse | null>(null)
  const [insights, setInsights] = useState<RadarInsightsResponse | null>(null)
  const [ops, setOps]           = useState<ModelOpsResponse | null>(null)
  const [invStats, setInvStats] = useState<InventoryStats | null>(null)
  const [buyOpen, setBuyOpen]   = useState<{ total: number; count: number } | null>(null)
  const [fin, setFin]           = useState<FinancialsResponse | null>(null)
  const [billsData, setBills]   = useState<BillsResponse | null>(null)
  const [ledger, setLedger]     = useState<LedgerResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [addOpen, setAddOpen]   = useState(false)
  const [card, setCard]         = useState<CardId | null>(null)
  const [logOpen, setLogOpen]   = useState(false)
  const [logDesc, setLogDesc]   = useState('')
  const [logAmount, setLogAmount] = useState('')
  const [logCat, setLogCat]     = useState('Misc')
  const [logBusy, setLogBusy]   = useState(false)

  const loadFinancials = useCallback(async () => {
    try { setFin(await financials.list()) } catch { /* keep previous */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [u, ins, mo, inv, tb, fn, bl, lg] = await Promise.allSettled([
        radar.usage(DAYS),
        radar.insights(DAYS),
        modelOps.summary(DAYS, 'all'),
        inventory.list(),
        fetch('/api/tobuy').then(r => r.json()),
        financials.list(),
        billsApi.list(),
        ledgerApi.list(),
      ])
      if (u.status   === 'fulfilled') setUsage(u.value)
      if (ins.status === 'fulfilled') setInsights(ins.value)
      if (mo.status  === 'fulfilled') setOps(mo.value)
      if (inv.status === 'fulfilled') setInvStats(inv.value.stats)
      if (fn.status  === 'fulfilled') setFin(fn.value)
      if (bl.status  === 'fulfilled') setBills(bl.value)
      if (lg.status  === 'fulfilled') setLedger(lg.value)
      if (tb.status  === 'fulfilled') {
        const open: BuyItem[] = (tb.value?.items ?? []).filter((i: BuyItem) => !i.purchased)
        setBuyOpen({ total: open.reduce((s, i) => s + (i.estimatedPrice || 0) * (i.quantity || 1), 0), count: open.length })
      }
      if ([u, mo, inv, fn].every(r => r.status === 'rejected')) setError('Could not load financial data')
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load financial data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const handler = (e: Event) => {
      const { domain } = (e as CustomEvent<DataRefreshDetail>).detail
      if (domain === 'finance' || domain === 'financials') load()
    }
    window.addEventListener(DATA_REFRESH_EVENT, handler)
    return () => window.removeEventListener(DATA_REFRESH_EVENT, handler)
  }, [load])

  const addEntry        = async (body: { label: string; kind: FinanceKind; category: string; amount: number }) => { await financials.create(body); await loadFinancials() }
  const saveEntry       = async (id: string, body: Partial<FinanceEntry>) => { await financials.update(id, body as any); await loadFinancials() }
  const deleteEntry     = async (id: string) => { await financials.remove(id); await loadFinancials() }
  const deleteLedgerEntry = async (id: string) => {
    await ledgerApi.remove(id)
    setLedger(prev => {
      if (!prev) return null
      const entries = prev.entries.filter(e => e.id !== id)
      return { ...prev, entries, total: entries.reduce((s, e) => s + e.amount, 0) }
    })
  }

  const submitLedgerEntry = async () => {
    const amount = parseFloat(logAmount)
    if (!logDesc.trim() || !isFinite(amount) || amount <= 0) return
    setLogBusy(true)
    try {
      await ledgerApi.create({ amount, description: logDesc.trim(), category: logCat || 'Misc', source: 'manual' })
      setLogDesc(''); setLogAmount(''); setLogCat('Misc'); setLogOpen(false)
      const fresh = await ledgerApi.list()
      setLedger(fresh)
    } finally { setLogBusy(false) }
  }

  // ── Derive ──────────────────────────────────────────────────────────────────
  const bySource    = ops?.bySource ?? []
  const claudeCost  = usage?.totalCost ?? 0
  const claudeTokens = usage?.totalTokens ?? 0
  const claudeRuns  = usage?.totalRuns ?? 0
  const agentCost   = bySource.filter(s => s.source === 'openclaw' || s.source === 'hermes').reduce((s, r) => s + r.cost, 0)
  const agentRuns   = bySource.filter(s => s.source === 'openclaw' || s.source === 'hermes').reduce((s, r) => s + r.runs, 0)
  const trendPct    = insights?.runRate.trendPct ?? 0
  const invValue    = invStats?.totalValue ?? 0
  const invItems    = invStats?.totalItems ?? 0
  const buyTotal    = buyOpen?.total ?? 0
  const buyCount    = buyOpen?.count ?? 0
  const dailyBars   = (usage?.dailyUsage ?? []).map(d => ({ value: d.cost, color: ACCENT.blue, label: `${d.date}: ${money(d.cost)}` }))

  // AI money: actual = flat subscriptions (calendar) + sporadic agent API. The
  // Claude token cost is notional VALUE, not money spent (subscription covers it).
  const aiSubsMonthly = billsData?.monthly.aiTotal ?? 0
  const actualAiSpend = aiSubsMonthly + agentCost
  const billsMonthly  = billsData?.monthly.total ?? 0
  const billsCount    = billsData?.count ?? 0

  // Manual figures ONLY — inventory is a separate sum, never counted on hand.
  const entries     = fin?.entries ?? []
  const categories  = fin?.categories ?? { asset: [], liability: [] }
  const byCategory  = fin?.summary.byCategory ?? {}
  const onHand      = fin?.summary.assets ?? 0
  const liabilities = fin?.summary.liabilities ?? 0
  const netWorth    = onHand - liabilities
  const hasEntries  = entries.length > 0
  const assetEntries = entries.filter(e => e.kind === 'asset').sort((a, b) => b.amount - a.amount)
  const liabEntries  = entries.filter(e => e.kind === 'liability').sort((a, b) => b.amount - a.amount)

  const heroSegs = Object.entries(byCategory)
    .map(([cat, val]) => ({ value: val, color: catHex(cat), label: finMeta(cat).label }))
    .filter(s => s.value > 0)

  const now = new Date()
  const ledgerEntries = ledger?.entries ?? []
  const monthTotal = ledgerEntries
    .filter(e => { const d = new Date(e.createdAt); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() })
    .reduce((s, e) => s + e.amount, 0)

  return (
    <div className="flex h-full overflow-hidden relative">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div>
            <h1 className="text-base font-semibold text-text-primary flex items-center gap-2"><Wallet size={16} className="text-text-muted" /> Financials</h1>
            <p className="text-xs text-text-muted mt-0.5">On hand {money(onHand)} · net worth {money(netWorth)}{liabilities > 0 ? ` · ${money(liabilities)} owed` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary text-xs">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {loading ? 'Syncing…' : 'Sync'}
            </button>
            <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-accent-blue/40 bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 text-xs font-medium">
              <Plus size={13} /> Add holding
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 flex flex-col gap-5">

          {error && (
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300">
              <X size={13} className="shrink-0 mt-0.5" /><p className="text-xs">{error}</p>
            </div>
          )}

          {/* ── Stat cards (click → side panel) ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="On hand"    value={money(onHand)}        icon={<Wallet size={12} />}       tone="text-text-primary" sub="tap for breakdown" onClick={() => setCard('networth')} active={card === 'networth'} />
            <Stat label="Net worth"  value={money(netWorth)}      icon={<Landmark size={12} />}     tone={netWorth >= 0 ? 'text-green-400' : 'text-red-400'} sub="after debts" onClick={() => setCard('networth')} active={card === 'networth'} />
            <Stat label="Bills / mo" value={money(billsMonthly)}  icon={<Receipt size={12} />}      tone="text-text-primary" sub={`${billsCount} recurring`} onClick={() => setCard('bills')} active={card === 'bills'} />
            <Stat label="AI spend"   value={money(actualAiSpend)} icon={<Sparkles size={12} />}     tone="text-blue-400"  sub={`${money(aiSubsMonthly)} subs + API`} onClick={() => setCard('ai')} active={card === 'ai'} />
            <Stat label="Hardware"   value={money(invValue)}      icon={<Package size={12} />}      tone="text-teal-400"  sub={`${invItems} items`} onClick={() => setCard('hardware')} active={card === 'hardware'} />
            <Stat label="To-buy"     value={money(buyTotal)}      icon={<ShoppingCart size={12} />} tone={buyCount > 0 ? 'text-amber-400' : undefined} sub={buyCount > 0 ? `${buyCount} open` : 'clear'} onClick={() => setCard('tobuy')} active={card === 'tobuy'} />
          </div>

          {/* ── Expense ledger (Discord !spend + manual) ── */}
          <section className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-border-subtle">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">Transactions</span>
                {ledgerEntries.length > 0 && (
                  <>
                    <span className="text-xxs text-text-muted tabular-nums">{money(monthTotal)} this month</span>
                    <span className="text-xxs text-text-muted opacity-40">·</span>
                    <span className="text-xxs text-text-muted tabular-nums opacity-60">{money(ledger?.total ?? 0)} all-time</span>
                  </>
                )}
              </div>
              <button
                onClick={() => setLogOpen(o => !o)}
                className="flex items-center gap-1 px-2.5 py-1 rounded border border-dashed border-border text-xxs text-text-muted hover:text-text-secondary hover:border-text-muted transition-colors"
              >
                <Plus size={11} /> Log expense
              </button>
            </div>

            {logOpen && (
              <div className="px-4 py-3 border-b border-border bg-card-hover flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={logDesc}
                  onChange={e => setLogDesc(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitLedgerEntry()}
                  placeholder="Description"
                  className="flex-1 min-w-[120px] bg-base border border-border rounded px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
                />
                <input
                  value={logCat}
                  onChange={e => setLogCat(e.target.value)}
                  placeholder="Category"
                  className="w-24 bg-base border border-border rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
                />
                <div className="flex items-center">
                  <span className="text-xs text-text-muted">$</span>
                  <input
                    value={logAmount}
                    onChange={e => setLogAmount(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitLedgerEntry()}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="w-20 bg-base border border-border rounded px-2 py-1.5 text-xs text-right tabular-nums text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50"
                  />
                </div>
                <button
                  onClick={submitLedgerEntry}
                  disabled={logBusy || !logDesc.trim() || !logAmount}
                  className="flex items-center gap-1 px-3 py-1.5 rounded border border-accent-blue/40 bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 disabled:opacity-40 text-xs font-medium"
                >
                  <Check size={12} /> Add
                </button>
                <button onClick={() => setLogOpen(false)} className="p-1.5 text-text-muted hover:text-text-secondary">
                  <X size={13} />
                </button>
              </div>
            )}

            {!ledger || ledger.entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-1 text-center">
                <Receipt size={18} className="text-text-muted" />
                <p className="text-sm text-text-muted mt-1">No expenses logged yet</p>
                <p className="text-xxs text-text-muted">Use <span className="font-mono text-text-secondary">!spend $5 Coffee</span> in Discord or click "Log expense" above</p>
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border max-h-64 overflow-y-auto">
                {ledger.entries.slice().reverse().map((e: LedgerEntry) => (
                  <div key={e.id} className="group flex items-center gap-3 px-4 py-2 hover:bg-card-hover transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary truncate">{e.description}</p>
                      <p className="text-xxs text-text-muted">{e.category}{e.source === 'discord' ? ' · discord' : e.source === 'manual' ? ' · manual' : ''} · {new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-amber-400 shrink-0">{money(e.amount)}</span>
                    <button onClick={() => deleteLedgerEntry(e.id)}
                      className="p-1 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" title="Delete">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── HERO · manual holdings ── */}
          <section className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-text-muted">On hand</span>
                <span className="text-xxs text-text-muted">stocks · bank · savings · cash</span>
              </div>
              <p className="text-5xl font-bold tabular-nums leading-none mt-3 text-text-primary">{money(onHand)}</p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="rounded-full px-2.5 py-1 text-xxs font-medium tabular-nums"
                  style={{ color: netWorth >= 0 ? ACCENT.green : ACCENT.red, backgroundColor: `${netWorth >= 0 ? ACCENT.green : ACCENT.red}14` }}>
                  Net worth {money(netWorth)}
                </span>
                {liabilities > 0 && (
                  <span className="rounded-full px-2.5 py-1 text-xxs font-medium tabular-nums text-red-400" style={{ backgroundColor: `${ACCENT.red}14` }}>− {money(liabilities)} owed</span>
                )}
                {hasEntries && <span className="rounded-full px-2.5 py-1 text-xxs font-medium text-text-muted bg-card-hover">{entries.length} holdings</span>}
                <button onClick={() => setCard('networth')} className="ml-auto text-xxs text-accent-blue hover:underline flex items-center gap-0.5">Breakdown <ChevronRight size={11} /></button>
              </div>
              {heroSegs.length > 0 && <div className="mt-4"><SegmentBar segments={heroSegs} showLegend /></div>}
            </div>

            <div className="border-t border-border-subtle px-3 py-3 flex flex-col gap-0.5">
              {loading && !fin ? (
                <div className="space-y-1.5 p-1">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-9 rounded-lg bg-card-hover animate-pulse" />)}</div>
              ) : !hasEntries ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                  <Scale size={20} className="text-text-muted" />
                  <p className="text-sm text-text-muted">No holdings yet</p>
                  <button onClick={() => setAddOpen(true)} className="text-xs text-accent-blue hover:underline">Add your accounts to see what you've got on hand</button>
                </div>
              ) : (
                <>
                  {assetEntries.map(e => <HoldingRow key={e.id} entry={e} categories={categories} onSave={saveEntry} onDelete={deleteEntry} />)}
                  {liabEntries.length > 0 && <div className="px-2.5 pt-2.5 pb-1 text-xxs uppercase tracking-wider text-text-muted">Owed</div>}
                  {liabEntries.map(e => <HoldingRow key={e.id} entry={e} categories={categories} onSave={saveEntry} onDelete={deleteEntry} />)}
                </>
              )}
              <div className="px-0.5 pt-1.5"><AddEntry open={addOpen} setOpen={setAddOpen} categories={categories} onAdd={addEntry} /></div>
            </div>
          </section>
        </div>
      </div>

      {card && (
        <BreakdownPanel
          card={card} onClose={() => setCard(null)}
          onHand={onHand} liabilities={liabilities} netWorth={netWorth} byCategory={byCategory}
          invStats={invStats}
          claudeCost={claudeCost} claudeTokens={claudeTokens} claudeRuns={claudeRuns}
          agentCost={agentCost} agentRuns={agentRuns} trendPct={trendPct}
          dailyBars={dailyBars} buyTotal={buyTotal} buyCount={buyCount} billsData={billsData}
        />
      )}
    </div>
  )
}
