// title: To-Buy view
// path: src/views/ToBuy.tsx
// purpose: Personal shopping list — compact rows click to open a side drawer
//          (same pattern as To-Do / Inventory). Quick add with priority + price,
//          a running total, and inline agent research that returns general info,
//          a fair price, local options, and online buy links via OpenClaw/Hermes.

import { useState, useEffect, useCallback, useRef } from 'react'
import { DATA_REFRESH_EVENT, type DataRefreshDetail } from '../lib/dataRefresh'
import { clsx } from 'clsx'
import {
  ShoppingCart, RefreshCw, AlertCircle, Plus, Trash2, Sparkles, Loader2,
  Circle, CheckCircle2, ExternalLink, Pencil, Check, X, MapPin,
} from 'lucide-react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { isRefreshPaused } from '../lib/refreshBus'
import { friendlyError } from '../lib/friendlyError'
import { toBuy } from '../lib/api'

// ─── Types (mirror server/routes/tobuy.ts) ────────────────────────────────────

type Priority = 'low' | 'medium' | 'high'

interface BuyResearch {
  status:          'idle' | 'pending' | 'done' | 'failed'
  requestedAt:     string
  completedAt:     string
  error:           string
  guidance?:       string
  summary?:        string
  estimatedPrice?: number
  priceRange?:     string
  buyLinks?:       Array<{ title: string; url: string; price?: string }>
  localOptions?:   Array<{ store: string; note?: string }>
  data?:           Record<string, string>
}

interface BuyItem {
  id:             string
  title:          string
  notes:          string
  priority:       Priority
  quantity:       number
  estimatedPrice: number
  purchased:      boolean
  createdAt:      string
  updatedAt:      string
  purchasedAt:    string
  research:       BuyResearch
}

type BuyPatch = Partial<Pick<BuyItem, 'title' | 'notes' | 'priority' | 'quantity' | 'estimatedPrice' | 'purchased'>>

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchItems(): Promise<{ items: BuyItem[] }> {
  const res = await fetch('/api/tobuy')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function createItem(body: { title: string; priority: Priority; quantity?: number; estimatedPrice?: number }): Promise<{ item?: BuyItem; queued?: boolean }> {
  return toBuy.create(body) as Promise<{ item?: BuyItem; queued?: boolean }>
}

async function patchItem(id: string, body: BuyPatch): Promise<{ item: BuyItem }> {
  const res = await fetch(`/api/tobuy/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function deleteItem(id: string): Promise<void> {
  const res = await fetch(`/api/tobuy/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await res.text())
}

async function clearPurchased(): Promise<{ removed: number }> {
  const res = await fetch('/api/tobuy/clear-purchased', { method: 'POST' })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

type ResearchSource = 'openclaw' | 'hermes'

async function startResearch(id: string, source: ResearchSource, guidance?: string): Promise<{ item: BuyItem }> {
  const res = await fetch(`/api/tobuy/${id}/research`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, guidance: guidance ?? '' }) })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ─── Quick-add parsing ────────────────────────────────────────────────────────
// e.g. "cordless power drill !high x2 $89"

const PRI_TOKEN: Record<string, Priority> = {
  low: 'low', med: 'medium', medium: 'medium', high: 'high',
}

function parseQuickAdd(raw: string, defaults: { priority: Priority }) {
  let title    = raw.trim()
  let priority = defaults.priority
  let quantity = 1
  let estimatedPrice = 0

  title = title.replace(/(^|\s)!(low|med|medium|high)\b/gi, (_m, _sp, s) => {
    priority = PRI_TOKEN[s.toLowerCase()]
    return ' '
  })
  title = title.replace(/(^|\s)x(\d{1,3})\b/gi, (_m, _sp, n) => {
    quantity = Math.max(1, parseInt(n, 10))
    return ' '
  })
  title = title.replace(/(^|\s)\$(\d+(?:\.\d{1,2})?)\b/g, (_m, _sp, n) => {
    estimatedPrice = parseFloat(n)
    return ' '
  })

  return { title: title.replace(/\s{2,}/g, ' ').trim(), priority, quantity, estimatedPrice }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

const PRIORITY_STYLE: Record<Priority, string> = {
  high:   'bg-orange-500/10 border-orange-500/30 text-orange-400',
  medium: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  low:    'bg-white/5 border-white/10 text-text-muted',
}

function fmtAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

function money(n: number): string {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 === 0 ? 0 : 2 })
}

// ─── Agent source picker ──────────────────────────────────────────────────────

function AgentSourcePicker({ value, onChange }: { value: ResearchSource; onChange: (s: ResearchSource) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-violet-900/40 bg-violet-950/20 p-0.5 text-[10px]">
      {(['openclaw', 'hermes'] as ResearchSource[]).map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={clsx(
            'px-2 py-0.5 rounded transition-colors',
            value === s ? 'bg-violet-500/25 text-violet-100' : 'text-violet-400/60 hover:text-violet-300',
          )}
        >
          {s === 'openclaw' ? 'OpenClaw' : 'Hermes'}
        </button>
      ))}
    </div>
  )
}

// ─── Research refine box ──────────────────────────────────────────────────────

function RefineBox({ value, onChange, onRun, onCancel, placeholder }: {
  value: string
  onChange: (s: string) => void
  onRun: () => void
  onCancel: () => void
  placeholder: string
}) {
  return (
    <div className="animate-rise-in flex flex-col gap-2 rounded-lg border border-violet-900/40 bg-violet-950/25 p-2.5">
      <textarea
        autoFocus
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-violet-500/50 resize-none"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onRun() }}
      />
      <div className="flex items-center gap-2">
        <button onClick={onRun}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-500/40 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30 text-xs">
          <Sparkles size={11} /> Re-run research
        </button>
        <button onClick={onCancel}
                className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-text-muted">⌘↵</span>
      </div>
    </div>
  )
}

// ─── Item row ─────────────────────────────────────────────────────────────────

// Muted second line — quantity / unit price / notes, with a quiet fallback.
function buySubtext(item: BuyItem): string {
  const parts: string[] = []
  if (item.quantity > 1) parts.push(`Qty ${item.quantity}`)
  if (item.estimatedPrice > 0) parts.push(`${money(item.estimatedPrice)} each`)
  if (item.notes.trim()) parts.push(item.notes.trim().split('\n')[0])
  if (parts.length) return parts.join('  ·  ')
  if (item.research?.status === 'done' && item.research.priceRange) return `Typical ${item.research.priceRange}`
  return `added ${fmtAgo(item.createdAt)}`
}

function BuyRow({ item, active, onToggle, onClick }: {
  item:     BuyItem
  active:   boolean
  onToggle: (i: BuyItem) => void
  onClick:  () => void
}) {
  const r    = item.research
  const line = item.estimatedPrice * item.quantity

  return (
    <div className={clsx(
      'relative flex items-center gap-2.5 w-full transition-colors',
      'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[2px] before:transition-colors',
      active ? 'before:bg-sky-400' : 'before:bg-transparent',
      active ? 'bg-card-hover' : 'bg-card hover:bg-card-hover',
    )}>
      {/* Circle toggle — mark purchased */}
      <button
        onClick={e => { e.stopPropagation(); onToggle(item) }}
        className="shrink-0 pl-3 py-2.5 text-text-muted hover:text-emerald-400 transition-colors"
        title={item.purchased ? 'Mark as not bought' : 'Mark as bought'}
      >
        {item.purchased
          ? <CheckCircle2 size={16} className="text-emerald-400" />
          : <Circle size={16} />
        }
      </button>

      {/* Row body — clicking opens the drawer. Two-line item + uniform right
          badge column (mirrors the To-Do layout). */}
      <button
        onClick={onClick}
        className="flex flex-1 min-w-0 items-center gap-3 pr-4 py-2.5 text-left"
      >
        {/* Left text column */}
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className={clsx(
            'text-sm truncate leading-tight',
            item.purchased ? 'line-through text-text-muted' : 'text-text-primary',
          )}>
            {item.title}
          </span>
          <span className="text-[11px] text-text-muted truncate leading-tight">
            {buySubtext(item)}
          </span>
        </div>

        {/* Right badge column — fixed slots keep everything aligned */}
        <div className="shrink-0 flex items-center gap-2">
          {item.estimatedPrice > 0 && (
            <span className="text-xs text-text-secondary tabular-nums" title={item.quantity > 1 ? `${money(item.estimatedPrice)} each` : undefined}>
              {money(line)}
            </span>
          )}
          <span className={clsx(
            'inline-flex justify-center min-w-[60px] text-[10px] px-1.5 py-0.5 rounded border capitalize',
            PRIORITY_STYLE[item.priority],
          )}>
            {item.priority}
          </span>
          <span className="w-4 flex justify-center shrink-0">
            {r.status === 'pending' && <Loader2 size={12} className="text-violet-400 animate-spin" />}
            {r.status === 'done'    && <Sparkles size={12} className="text-violet-400" />}
            {r.status === 'failed'  && <Sparkles size={12} className="text-text-muted/40" />}
          </span>
        </div>
      </button>
    </div>
  )
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function BuyDrawer({ item, onClose, onToggle, onSave, onDelete, onResearch }: {
  item:       BuyItem
  onClose:    () => void
  onToggle:   (i: BuyItem) => void
  onSave:     (i: BuyItem, patch: BuyPatch) => void
  onDelete:   (i: BuyItem) => void
  onResearch: (i: BuyItem, source: ResearchSource, guidance?: string) => void
}) {
  useEscapeKey(onClose)

  const [editing, setEditing]   = useState(false)
  const [title, setTitle]       = useState(item.title)
  const [notes, setNotes]       = useState(item.notes)
  const [priority, setPriority] = useState<Priority>(item.priority)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [price, setPrice]       = useState(item.estimatedPrice ? String(item.estimatedPrice) : '')
  const [source, setSource]     = useState<ResearchSource>('openclaw')
  const [refining, setRefining] = useState(false)
  const [guidance, setGuidance] = useState('')

  function runResearch() {
    onResearch(item, source, guidance.trim() || undefined)
    setRefining(false)
    setGuidance('')
  }

  // Sync local state when the selected item changes
  useEffect(() => {
    setTitle(item.title)
    setNotes(item.notes)
    setPriority(item.priority)
    setQuantity(String(item.quantity))
    setPrice(item.estimatedPrice ? String(item.estimatedPrice) : '')
    setEditing(false)
    setRefining(false)
    setGuidance('')
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    if (!title.trim()) return
    onSave(item, {
      title: title.trim(),
      notes,
      priority,
      quantity: Math.max(1, parseInt(quantity, 10) || 1),
      estimatedPrice: Math.max(0, parseFloat(price) || 0),
    })
    setEditing(false)
  }

  const r        = item.research
  const line     = item.estimatedPrice * item.quantity
  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50'

  return (
    <div className={clsx(
      'animate-drawer-in flex flex-col h-full border-l border-border bg-surface overflow-y-auto',
      // Narrow (half-screen): overlay the list instead of crushing it.
      'absolute inset-y-0 right-0 z-30 w-full max-w-[440px]  ',
      // Wide: sit side-by-side as a static panel.
      'lg:static lg:w-[380px] lg:min-w-[380px] lg:max-w-none lg: lg:z-auto',
    )}>

      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0 gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <button
            onClick={() => onToggle(item)}
            className="shrink-0 text-text-muted hover:text-emerald-400 transition-colors"
            title={item.purchased ? 'Mark as not bought' : 'Mark as bought'}
          >
            {item.purchased
              ? <CheckCircle2 size={18} className="text-emerald-400" />
              : <Circle size={18} />
            }
          </button>
          <p className={clsx('text-sm font-semibold leading-snug min-w-0', item.purchased ? 'line-through text-text-muted' : 'text-text-primary')}>
            {item.title}
          </p>
        </div>
        <button aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-primary shrink-0">
          <X size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-5 overflow-y-auto flex-1">

        {/* Property chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border capitalize', PRIORITY_STYLE[item.priority])}>
            {item.priority}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-base text-text-muted tabular-nums">
            Qty {item.quantity}
          </span>
          {item.estimatedPrice > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-base text-text-secondary tabular-nums">
              {money(item.estimatedPrice)}{item.quantity > 1 ? ` ea · ${money(line)} total` : ''}
            </span>
          )}
          <span className="ml-auto text-[10px] text-text-muted" title={item.createdAt}>
            {fmtAgo(item.createdAt)}
          </span>
        </div>

        {/* Edit form */}
        {editing ? (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Item</span>
              <input value={title} onChange={e => setTitle(e.target.value)} autoFocus className={inputCls}
                     onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Notes</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                        className={clsx(inputCls, 'resize-none')} placeholder="Additional context…" />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Priority</span>
                <select value={priority} onChange={e => setPriority(e.target.value as Priority)} className={inputCls}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Qty</span>
                <input type="number" min={1} value={quantity} onChange={e => setQuantity(e.target.value)} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">Price $</span>
                <input type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" className={inputCls} />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={save} disabled={!title.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-xs font-medium disabled:opacity-40">
                <Check size={12} /> Save
              </button>
              <button onClick={() => setEditing(false)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          item.notes ? (
            <div>
              <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Notes</p>
              <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{item.notes}</p>
            </div>
          ) : null
        )}

        {/* Research section */}
        <div className="rounded-lg border border-violet-900/30 bg-violet-950/15 p-3">
          {r.status === 'pending' ? (
            <div className="flex items-center gap-2 text-xs text-violet-200">
              <Loader2 size={13} className="animate-spin text-violet-400" />
              Agent is researching… (~1–2 min)
            </div>
          ) : r.status === 'done' ? (
            <div className="animate-rise-in flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-violet-200">
                  <Sparkles size={13} className="text-violet-400" /> Shopping research
                </span>
                <div className="flex items-center gap-2">
                  <AgentSourcePicker value={source} onChange={setSource} />
                  <button onClick={() => setRefining(v => !v)} className="text-[10px] text-violet-400/70 hover:text-violet-300">
                    {refining ? 'close' : 're-run'}
                  </button>
                </div>
              </div>
              {refining && (
                <RefineBox
                  value={guidance}
                  onChange={setGuidance}
                  onRun={runResearch}
                  onCancel={() => { setRefining(false); setGuidance('') }}
                  placeholder="What should the agent do differently? e.g. budget under $50, prefer brand, only in-stock locally…"
                />
              )}
              {r.guidance && (
                <p className="text-[10px] text-violet-300/70 italic leading-snug">Refined with: “{r.guidance}”</p>
              )}
              {r.summary && (
                <p className="text-xs text-text-secondary leading-relaxed">{r.summary}</p>
              )}
              {(r.priceRange || (r.estimatedPrice && r.estimatedPrice > 0)) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {r.estimatedPrice && r.estimatedPrice > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 tabular-nums">
                      Typical {money(r.estimatedPrice)}
                    </span>
                  )}
                  {r.priceRange && (
                    <span className="text-[10px] px-2 py-0.5 rounded border border-border bg-base text-text-secondary">
                      Range {r.priceRange}
                    </span>
                  )}
                </div>
              )}
              {r.buyLinks && r.buyLinks.length > 0 && (
                <div>
                  <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Buy online</p>
                  <div className="flex flex-col gap-1">
                    {r.buyLinks.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                         className="flex items-center gap-1.5 text-xs text-accent-blue hover:underline w-fit">
                        <ExternalLink size={11} className="shrink-0" />
                        <span className="truncate">{l.title || l.url}</span>
                        {l.price && <span className="text-text-muted shrink-0">· {l.price}</span>}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {r.localOptions && r.localOptions.length > 0 && (
                <div>
                  <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Local options</p>
                  <div className="flex flex-col gap-1">
                    {r.localOptions.map((o, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-text-secondary">
                        <MapPin size={11} className="shrink-0 mt-0.5 text-text-muted" />
                        <span><span className="text-text-primary">{o.store}</span>{o.note ? ` — ${o.note}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {r.data && Object.keys(r.data).length > 0 && (
                <div>
                  <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Key specs</p>
                  <div className="flex flex-col rounded-lg border border-border overflow-hidden">
                    {Object.entries(r.data).map(([k, v], i) => (
                      <div key={k} className={clsx('flex gap-2 px-3 py-1.5 text-xxs', i % 2 ? 'bg-base' : 'bg-card')}>
                        <span className="text-text-muted w-28 shrink-0">{k}</span>
                        <span className="text-text-secondary break-words">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : refining ? (
            <RefineBox
              value={guidance}
              onChange={setGuidance}
              onRun={runResearch}
              onCancel={() => { setRefining(false); setGuidance('') }}
              placeholder="What should the agent do differently? e.g. budget under $50, prefer brand, only in-stock locally…"
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              <button onClick={() => onResearch(item, source)} className="flex items-center gap-2 text-xs text-violet-200 hover:text-violet-100 w-full text-left">
                <Sparkles size={13} className="text-violet-400 shrink-0" />
                {r.status === 'failed' ? 'Research failed — click to retry' : 'Ask an agent to research where to buy & price'}
              </button>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-text-muted">via</span>
                  <AgentSourcePicker value={source} onChange={setSource} />
                </div>
                <button onClick={() => setRefining(true)} className="text-[10px] text-violet-400/70 hover:text-violet-300">
                  {r.status === 'failed' ? 'refine & retry' : 'add guidance'}
                </button>
              </div>
            </div>
          )}
          {r.status === 'failed' && r.error && (
            <p className="text-[10px] text-red-400 mt-1.5">{r.error}</p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          {!editing && (
            <button onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary text-xs">
              <Pencil size={12} /> Edit
            </button>
          )}
          <button onClick={() => onDelete(item)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-900/40 bg-red-950/20 text-red-400 hover:bg-red-950/40 text-xs">
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

type Filter = 'open' | 'bought'

export default function ToBuy() {
  const [items, setItems]       = useState<BuyItem[]>([])
  const [filter, setFilter]     = useState<Filter>('open')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [title, setTitle]       = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [adding, setAdding]     = useState(false)
  const [clearing, setClearing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null) }
    try { setItems((await fetchItems()).items) }
    catch (e: any) { if (!silent) setError(e.message) }
    finally { if (!silent) setLoading(false) }
  }, [])

  const anyPending = items.some(i => i.research?.status === 'pending')
  useEffect(() => { load() }, [load])
  useEffect(() => {
    pollRef.current = setInterval(() => { if (!isRefreshPaused()) load(true) }, anyPending ? 5_000 : 30_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [load, anyPending])
  useEffect(() => {
    const handler = (e: Event) => {
      const { domain } = (e as CustomEvent<DataRefreshDetail>).detail
      if (domain === 'tobuy') load(true)
    }
    window.addEventListener(DATA_REFRESH_EVENT, handler)
    return () => window.removeEventListener(DATA_REFRESH_EVENT, handler)
  }, [load])

  async function handleAdd() {
    const parsed = parseQuickAdd(title, { priority })
    if (!parsed.title || adding) return
    setAdding(true); setError(null)
    try {
      const r = await createItem(parsed)
      if (r.item) setItems(is => [r.item!, ...is])
      setTitle('')
      inputRef.current?.focus()
    } catch (e: any) { setError(e.message) }
    finally { setAdding(false) }
  }

  async function handleToggle(item: BuyItem) {
    try {
      const r = await patchItem(item.id, { purchased: !item.purchased })
      setItems(is => is.map(i => i.id === item.id ? r.item : i))
    } catch (e: any) { setError(e.message) }
  }

  async function handleSave(item: BuyItem, patch: BuyPatch) {
    try {
      const r = await patchItem(item.id, patch)
      setItems(is => is.map(i => i.id === item.id ? r.item : i))
    } catch (e: any) { setError(e.message) }
  }

  async function handleDelete(item: BuyItem) {
    if (!confirm(`Delete "${item.title}"?`)) return
    try {
      await deleteItem(item.id)
      setItems(is => is.filter(i => i.id !== item.id))
      setSelectedId(null)
    } catch (e: any) { setError(e.message) }
  }

  async function handleClearBought() {
    const n = items.filter(i => i.purchased).length
    if (!n || !confirm(`Remove ${n} bought item${n > 1 ? 's' : ''}?`)) return
    setClearing(true)
    try {
      await clearPurchased()
      setItems(is => is.filter(i => !i.purchased))
      setSelectedId(null)
    } catch (e: any) { setError(e.message) }
    finally { setClearing(false) }
  }

  async function handleResearch(item: BuyItem, source: ResearchSource, guidance?: string) {
    try {
      const r = await startResearch(item.id, source, guidance)
      setItems(is => is.map(i => i.id === item.id ? r.item : i))
    } catch (e: any) { setError(e.message) }
  }

  const visible = items
    .filter(i => filter === 'bought' ? i.purchased : !i.purchased)
    .sort((a, b) =>
      filter === 'bought'
        ? (b.purchasedAt || '').localeCompare(a.purchasedAt || '')
        : PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
          || b.createdAt.localeCompare(a.createdAt))

  const openItems = items.filter(i => !i.purchased)
  const openTotal = openItems.reduce((sum, i) => sum + i.estimatedPrice * i.quantity, 0)
  const counts: Record<Filter, number> = {
    open:   openItems.length,
    bought: items.filter(i => i.purchased).length,
  }

  const selected = items.find(i => i.id === selectedId) ?? null

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* ── Main column ── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 lg:px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <ShoppingCart size={18} className="text-sky-400" />
            <h1 className="text-base font-semibold text-text-primary">To-Buy</h1>
            {counts.open > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-400 tabular-nums">
                {counts.open} item{counts.open > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {openTotal > 0 && (
              <span className="text-xs text-text-secondary tabular-nums" title="Estimated total of unbought items">
                Est. total <span className="text-text-primary font-semibold">{money(openTotal)}</span>
              </span>
            )}
            <button onClick={() => load()} disabled={loading}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-card hover:bg-card-hover border border-border rounded text-text-secondary transition-colors disabled:opacity-50">
              <RefreshCw size={11} className={clsx(loading && 'animate-spin')} /> Refresh
            </button>
          </div>
        </div>

        {/* Quick add + filters */}
        <div className="shrink-0 px-4 lg:px-6 py-3 border-b border-border space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-400">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <p className="text-xs leading-snug">{friendlyError(error, 'the to-buy API')}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              placeholder='Add something to buy… ("cordless power drill !high x1 $89")'
              className="flex-1 min-w-0 bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border"
            />
            <select value={priority} onChange={e => setPriority(e.target.value as Priority)}
                    className="bg-base border border-border rounded-lg px-2 py-2 text-xs text-text-secondary focus:outline-none" title="Priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button onClick={handleAdd} disabled={!title.trim() || adding}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 rounded-lg text-sky-400 transition-colors disabled:opacity-40">
              {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
            </button>
          </div>

          <div className="flex items-center gap-1">
            {(['open', 'bought'] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                      className={clsx(
                        'px-2.5 py-1 rounded text-xs transition-colors',
                        filter === f ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary hover:bg-card',
                      )}>
                {f === 'open' ? 'To buy' : 'Bought'}
                <span className="ml-1.5 tabular-nums opacity-60">{counts[f]}</span>
              </button>
            ))}
            {filter === 'bought' && counts.bought > 0 && (
              <button onClick={handleClearBought} disabled={clearing}
                      className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted hover:text-red-400 hover:bg-card transition-colors disabled:opacity-50">
                {clearing ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Clear bought
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-text-muted">
              <ShoppingCart size={22} className="opacity-30" />
              <p className="text-xs">{filter === 'bought' ? 'Nothing bought yet.' : 'Nothing to buy — add an item above.'}</p>
              {filter !== 'bought' && (
                <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-xs">
                  <span className="text-[10px] text-text-muted/70">Try tokens:</span>
                  {['!high', 'x2', '$89'].map(t => (
                    <code key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-base text-text-secondary font-mono">{t}</code>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-border">
              {visible.map(i => (
                <BuyRow
                  key={i.id}
                  item={i}
                  active={i.id === selectedId}
                  onToggle={handleToggle}
                  onClick={() => setSelectedId(prev => prev === i.id ? null : i.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail drawer ── (overlay on narrow widths, side panel when wide) */}
      {selected && (
        <>
          <div
            onClick={() => setSelectedId(null)}
            className="absolute inset-0 z-20 bg-black/40 lg:hidden"
            aria-hidden
          />
          <BuyDrawer
            item={selected}
            onClose={() => setSelectedId(null)}
            onToggle={handleToggle}
            onSave={handleSave}
            onDelete={handleDelete}
            onResearch={handleResearch}
          />
        </>
      )}
    </div>
  )
}
