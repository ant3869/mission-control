import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Boxes, Clock, Plus, Minus, Search, RefreshCw, X, Trash2, Pencil, ExternalLink,
  MapPin, DollarSign, Hash, Bot, FileText, AlertCircle, Layers, Sparkles, Save,
  CheckCircle2, Zap, LockKeyhole, ChevronDown, ChevronRight,
} from 'lucide-react'
import { inventory as invApi, type InventoryItem, type InventoryStats, type InventoryBody } from '../lib/api'
import { ProjectBacklog } from '../components/inventory/ProjectBacklog'

// ─── Category & condition metadata ────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  computer:        { label: 'Computer',        icon: '🖥️' },
  laptop:          { label: 'Laptop',          icon: '💻' },
  sbc:             { label: 'SBC',             icon: '🍓' },
  microcontroller: { label: 'Microcontroller', icon: '🔌' },
  storage:         { label: 'Storage',         icon: '💾' },
  battery:         { label: 'Battery',         icon: '🔋' },
  power:           { label: 'Power',           icon: '⚡' },
  console:         { label: 'Console',         icon: '🎮' },
  peripheral:      { label: 'Peripheral',      icon: '⌨️' },
  cable:           { label: 'Cable',           icon: '🔗' },
  component:       { label: 'Component',       icon: '🧩' },
  sensor:          { label: 'Sensor',          icon: '📡' },
  network:         { label: 'Network',         icon: '🌐' },
  tool:            { label: 'Tool',            icon: '🛠️' },
  breakout:        { label: 'Breakout',        icon: '🔧' },
  camera:          { label: 'Camera',          icon: '📷' },
  tablet:          { label: 'Tablet',          icon: '📱' },
  other:           { label: 'Other',           icon: '📦' },
}
const catMeta = (c: string) => CATEGORY_META[c] ?? { label: c || 'Other', icon: '📦' }

const COND_META: Record<string, { label: string; cls: string }> = {
  working: { label: 'Working',  cls: 'text-green-400 bg-green-950/40 border-green-900/40' },
  untested:{ label: 'Untested', cls: 'text-amber-300 bg-amber-950/40 border-amber-900/40' },
  partial: { label: 'Partial',  cls: 'text-orange-300 bg-orange-950/40 border-orange-900/40' },
  broken:  { label: 'Broken',   cls: 'text-red-400 bg-red-950/40 border-red-900/40' },
  unknown: { label: 'Unknown',  cls: 'text-text-muted bg-base border-border' },
}
const condMeta = (c: string) => COND_META[c] ?? COND_META.unknown

const STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  available: { label: 'Available', cls: 'text-green-400 bg-green-950/40 border-green-900/40', icon: <CheckCircle2 size={10} /> },
  'in-use':  { label: 'In Use',    cls: 'text-amber-300 bg-amber-950/40 border-amber-900/40', icon: <Zap size={10} /> },
  reserved:  { label: 'Reserved',  cls: 'text-blue-300 bg-blue-950/40 border-blue-900/40',   icon: <LockKeyhole size={10} /> },
}
const statusMeta = (s: string) => STATUS_META[s] ?? STATUS_META.available

// ─── Toast hook + component ────────────────────────────────────────────────────

type ToastState = { type: 'saving' | 'saved' | 'error'; msg: string } | null

function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((type: NonNullable<ToastState>['type'], msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ type, msg })
    if (type !== 'saving') timerRef.current = setTimeout(() => setToast(null), type === 'error' ? 6000 : 4500)
  }, [])
  return { toast, show }
}

function MutationToast({ toast }: { toast: ToastState }) {
  if (!toast) return null
  return (
    <div className={clsx(
      'fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs shadow-xl transition-all animate-in fade-in slide-in-from-bottom-2',
      toast.type === 'saving' ? 'border-border bg-surface text-text-secondary' :
      toast.type === 'saved'  ? 'border-green-900/50 bg-green-950/50 text-green-300' :
                                'border-red-900/50 bg-red-950/50 text-red-300',
    )}>
      {toast.type === 'saving' && <RefreshCw size={12} className="animate-spin shrink-0" />}
      {toast.type === 'saved'  && <CheckCircle2 size={12} className="shrink-0" />}
      {toast.type === 'error'  && <AlertCircle size={12} className="shrink-0" />}
      {toast.msg}
    </div>
  )
}

function syncedAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function money(n: number): string {
  if (!n) return '$0'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 2 : 0 })}`
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-text-muted"><span className={tone}>{icon}</span><span className="text-xxs uppercase tracking-wide">{label}</span></div>
      <span className={clsx('text-xl font-semibold tabular-nums', tone ?? 'text-text-primary')}>{value}</span>
    </div>
  )
}

// ─── Item row ──────────────────────────────────────────────────────────────────

function ItemRow({ item, active, onClick }: { item: InventoryItem; active: boolean; onClick: () => void }) {
  const cm = catMeta(item.category)
  const cond = condMeta(item.condition)
  const inUse = item.status === 'in-use'
  const sm = statusMeta(item.status)
  return (
    <button onClick={onClick} className={clsx('flex items-center gap-3 px-3 py-2.5 text-left transition-colors w-full', active ? 'bg-card-hover' : 'bg-card hover:bg-card-hover', inUse && 'border-l-2 border-l-amber-500/50')}>
      <span className="text-lg shrink-0 w-7 text-center">{cm.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={clsx('text-xs font-medium truncate', inUse ? 'text-text-secondary' : 'text-text-primary')}>{item.name}</p>
          {item.enriched && <Sparkles size={10} className="text-violet-400 shrink-0" />}
          {item.researchStatus === 'pending' && <RefreshCw size={9} className="text-violet-400 animate-spin shrink-0" />}
        </div>
        <p className="text-xxs text-text-muted truncate">
          {[cm.label, item.manufacturer && `${item.manufacturer}${item.model ? ` ${item.model}` : ''}`, item.location].filter(Boolean).join(' · ')}
        </p>
      </div>
      {item.status !== 'available' && (
        <span className={clsx('shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs', sm.cls)}>
          {sm.icon}{sm.label}
        </span>
      )}
      <span className={clsx('shrink-0 px-1.5 py-0.5 rounded border text-xxs', cond.cls)}>{cond.label}</span>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-text-secondary w-10 text-right">×{item.quantity}</span>
      <span className="shrink-0 text-xs tabular-nums text-text-muted w-16 text-right">{money(item.totalValue)}</span>
    </button>
  )
}

// ─── Detail drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({ item, onClose, onEdit, onDelete, onQty, onResearch, onStatus }: {
  item: InventoryItem; onClose: () => void; onEdit: () => void; onDelete: () => void; onQty: (delta: number) => void; onResearch: () => void; onStatus: (s: string) => void
}) {
  const cm = catMeta(item.category)
  const cond = condMeta(item.condition)
  const specEntries = Object.entries(item.specs ?? {})
  const researching = item.researchStatus === 'pending'
  return (
    <div className="flex flex-col h-full w-[400px] min-w-[400px] border-l border-border bg-surface overflow-y-auto">
      <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="text-2xl leading-none">{cm.icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">{item.name}</p>
            <p className="text-xxs text-text-muted mt-0.5">{cm.label}{item.manufacturer ? ` · ${item.manufacturer}${item.model ? ` ${item.model}` : ''}` : ''}</p>
          </div>
        </div>
        <button aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-primary shrink-0"><X size={15} /></button>
      </div>

      <div className="flex flex-col gap-4 p-5">
        {item.imageUrl && <img src={item.imageUrl} alt={item.name} className="w-full max-h-40 object-contain rounded-lg border border-border bg-base" />}

        {/* quantity + key stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 rounded-lg bg-base border border-border px-3 py-2">
            <span className="text-xxs text-text-muted">Quantity</span>
            <div className="flex items-center gap-2">
              <button onClick={() => onQty(-1)} disabled={item.quantity <= 0} className="p-0.5 rounded border border-border hover:bg-card text-text-muted hover:text-text-primary disabled:opacity-30"><Minus size={12} /></button>
              <span className="text-sm font-semibold tabular-nums text-text-primary w-8 text-center">{item.quantity}</span>
              <button onClick={() => onQty(1)} className="p-0.5 rounded border border-border hover:bg-card text-text-muted hover:text-text-primary"><Plus size={12} /></button>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-lg bg-base border border-border px-3 py-2">
            <span className="text-xxs text-text-muted">Est. value</span>
            <span className="text-sm font-semibold tabular-nums text-text-primary">{money(item.totalValue)}</span>
            <span className="text-xxs text-text-muted">{money(item.estimatedValue)} each</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xxs">
          <span className={clsx('px-1.5 py-0.5 rounded border', cond.cls)}>{cond.label}</span>
          {item.location && <span className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-base text-text-secondary"><MapPin size={10} />{item.location}</span>}
          {item.tags.map(t => <span key={t} className="px-1.5 py-0.5 rounded border border-border bg-base text-text-muted">#{t}</span>)}
        </div>

        {/* agent spec sheet */}
        {item.summary && (
          <div>
            <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5 flex items-center gap-1"><Sparkles size={11} className="text-violet-400" /> Summary</p>
            <p className="text-xs text-text-secondary leading-relaxed">{item.summary}</p>
          </div>
        )}
        {specEntries.length > 0 && (
          <div>
            <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Specifications</p>
            <div className="flex flex-col rounded-lg border border-border overflow-hidden">
              {specEntries.map(([k, v], i) => (
                <div key={k} className={clsx('flex gap-2 px-3 py-1.5 text-xxs', i % 2 ? 'bg-base' : 'bg-card')}>
                  <span className="text-text-muted w-28 shrink-0">{k}</span>
                  <span className="text-text-secondary break-words">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {item.notes && (
          <div>
            <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Notes</p>
            <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{item.notes}</p>
          </div>
        )}
        {(item.sources.length > 0 || item.datasheetUrl) && (
          <div>
            <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-1.5">Sources</p>
            <div className="flex flex-col gap-1">
              {item.datasheetUrl && <a href={item.datasheetUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xxs text-accent-blue hover:underline"><FileText size={11} /> Datasheet</a>}
              {item.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xxs text-accent-blue hover:underline truncate"><ExternalLink size={11} className="shrink-0" /> {s.title || s.url}</a>)}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1 text-xxs text-text-muted">
          <Bot size={11} /> added by {item.addedBy || 'manual'} · updated {item.updatedAgo}
        </div>

        {/* Deployment status */}
        <div className="rounded-lg border border-border bg-base p-3">
          <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">Deployment Status</p>
          <div className="flex gap-1.5">
            {(['available', 'in-use', 'reserved'] as const).map(s => {
              const m = statusMeta(s)
              const active = item.status === s
              return (
                <button key={s} onClick={() => { if (!active) onStatus(s) }}
                  className={clsx('flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xxs flex-1 justify-center transition-colors', active ? m.cls : 'border-border bg-card text-text-muted hover:bg-card-hover')}
                >
                  {m.icon}{m.label}
                </button>
              )
            })}
          </div>
          {item.status === 'in-use' && <p className="text-xxs text-amber-400/70 mt-1.5">⚡ Agents will consider this item last for new projects.</p>}
        </div>

        {/* Agent research */}
        <div className="rounded-lg border border-violet-900/30 bg-violet-950/15 p-3">
          {researching ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs text-violet-200">
                <RefreshCw size={13} className="animate-spin text-violet-400" /> Agent is researching… (~1–2 min, keep this open)
              </div>
              {item.researchRequestedAt && Date.now() - new Date(item.researchRequestedAt).getTime() > 5 * 60 * 1000 && (
                <button onClick={onResearch} className="text-xxs text-violet-400/70 hover:text-violet-300 text-left underline underline-offset-2">
                  Stuck? Click to retry
                </button>
              )}
            </div>
          ) : (
            <button onClick={onResearch} className="flex items-center gap-2 text-xs text-violet-200 hover:text-violet-100 w-full">
              <Sparkles size={13} className="text-violet-400" />
              {item.enriched ? 'Re-research with agent' : 'Ask agent to research & fill details'}
            </button>
          )}
          {item.researchStatus === 'failed' && item.researchError && (
            <p className="text-xxs text-red-400 mt-1.5">Research failed: {item.researchError}</p>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary text-xs"><Pencil size={12} /> Edit</button>
          <button onClick={onDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-900/40 bg-red-950/20 text-red-400 hover:bg-red-950/40 text-xs"><Trash2 size={12} /> Delete</button>
        </div>
      </div>
    </div>
  )
}

// ─── Add/Edit form modal ───────────────────────────────────────────────────────

function ItemForm({ initial, categories, conditions, onSave, onClose }: {
  initial: InventoryItem | null; categories: string[]; conditions: string[]
  onSave: (body: InventoryBody) => Promise<void>; onClose: () => void
}) {
  const [f, setF] = useState({
    name: initial?.name ?? '', category: initial?.category ?? 'other', quantity: String(initial?.quantity ?? 1),
    condition: initial?.condition ?? 'unknown', location: initial?.location ?? '', estimatedValue: String(initial?.estimatedValue ?? 0),
    manufacturer: initial?.manufacturer ?? '', model: initial?.model ?? '', tags: (initial?.tags ?? []).join(', '),
    summary: initial?.summary ?? '', notes: initial?.notes ?? '', status: initial?.status ?? 'available',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<any>) => setF(p => ({ ...p, [k]: e.target.value }))

  const submit = async () => {
    if (!f.name.trim()) { setErr('Name is required'); return }
    setSaving(true); setErr(null)
    try {
      await onSave({
        name: f.name.trim(), category: f.category, quantity: Number(f.quantity) || 0, condition: f.condition,
        location: f.location.trim(), estimatedValue: Number(f.estimatedValue) || 0,
        manufacturer: f.manufacturer.trim(), model: f.model.trim(),
        tags: f.tags.split(',').map(t => t.trim()).filter(Boolean), summary: f.summary.trim(), notes: f.notes.trim(),
        status: f.status,
      })
    } catch (e: any) { setErr(e.message ?? 'Save failed'); setSaving(false) }
  }

  const input = 'w-full px-2.5 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue/50'
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-full overflow-y-auto rounded-xl border border-border bg-surface p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text-primary">{initial ? 'Edit item' : 'Add item'}</h2>
          <button aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-primary"><X size={15} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1"><span className="text-xxs text-text-muted">Name *</span><input className={input} value={f.name} onChange={set('name')} placeholder="e.g. Raspberry Pi 4 Model B" autoFocus /></label>
          <label className="flex flex-col gap-1"><span className="text-xxs text-text-muted">Category</span>
            <select className={input} value={f.category} onChange={set('category')}>{categories.map(c => <option key={c} value={c}>{catMeta(c).icon} {catMeta(c).label}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="text-xxs text-text-muted">Condition</span>
            <select className={input} value={f.condition} onChange={set('condition')}>{conditions.map(c => <option key={c} value={c}>{condMeta(c).label}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className="text-xxs text-text-muted">Status</span>
            <select className={input} value={f.status} onChange={set('status')}>
              <option value="available">Available</option>
              <option value="in-use">In Use</option>
              <option value="reserved">Reserved</option>
            </select></label>
          <label className="flex flex-col gap-1"><span className="text-xxs text-text-muted">Quantity</span><input type="number" min={0} className={input} value={f.quantity} onChange={set('quantity')} /></label>
          <label className="flex flex-col gap-1"><span className="text-xxs text-text-muted">Est. value (each, USD)</span><input type="number" min={0} step="0.01" className={input} value={f.estimatedValue} onChange={set('estimatedValue')} /></label>
          <label className="flex flex-col gap-1"><span className="text-xxs text-text-muted">Manufacturer</span><input className={input} value={f.manufacturer} onChange={set('manufacturer')} /></label>
          <label className="flex flex-col gap-1"><span className="text-xxs text-text-muted">Model</span><input className={input} value={f.model} onChange={set('model')} /></label>
          <label className="col-span-2 flex flex-col gap-1"><span className="text-xxs text-text-muted">Location</span><input className={input} value={f.location} onChange={set('location')} placeholder="e.g. Shelf A · bin 1" /></label>
          <label className="col-span-2 flex flex-col gap-1"><span className="text-xxs text-text-muted">Tags (comma separated)</span><input className={input} value={f.tags} onChange={set('tags')} placeholder="arm, linux, 5v" /></label>
          <label className="col-span-2 flex flex-col gap-1"><span className="text-xxs text-text-muted">Summary</span><textarea className={clsx(input, 'resize-none h-14')} value={f.summary} onChange={set('summary')} placeholder="Short overview (agents usually fill this)" /></label>
          <label className="col-span-2 flex flex-col gap-1"><span className="text-xxs text-text-muted">Notes</span><textarea className={clsx(input, 'resize-none h-14')} value={f.notes} onChange={set('notes')} /></label>
        </div>
        {err && <p className="text-xxs text-red-400 mt-2">{err}</p>}
        <div className="flex items-center gap-2 mt-4">
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-accent-blue/40 bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 text-xs font-medium"><Save size={12} /> {initial ? 'Save changes' : 'Add item'}</button>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ─── Category section colors ───────────────────────────────────────────────────

const CAT_COLORS: Record<string, { bar: string; label: string; border: string; bg: string }> = {
  computer:        { bar: 'border-l-sky-500',     label: 'text-sky-400',     border: 'border-sky-900/30',     bg: 'bg-sky-950/5' },
  laptop:          { bar: 'border-l-blue-500',    label: 'text-blue-400',    border: 'border-blue-900/30',    bg: 'bg-blue-950/5' },
  sbc:             { bar: 'border-l-red-500',     label: 'text-red-400',     border: 'border-red-900/30',     bg: 'bg-red-950/5' },
  microcontroller: { bar: 'border-l-orange-500',  label: 'text-orange-400',  border: 'border-orange-900/30',  bg: 'bg-orange-950/5' },
  storage:         { bar: 'border-l-violet-500',  label: 'text-violet-400',  border: 'border-violet-900/30',  bg: 'bg-violet-950/5' },
  battery:         { bar: 'border-l-green-500',   label: 'text-green-400',   border: 'border-green-900/30',   bg: 'bg-green-950/5' },
  power:           { bar: 'border-l-yellow-500',  label: 'text-yellow-400',  border: 'border-yellow-900/30',  bg: 'bg-yellow-950/5' },
  console:         { bar: 'border-l-fuchsia-500', label: 'text-fuchsia-400', border: 'border-fuchsia-900/30', bg: 'bg-fuchsia-950/5' },
  peripheral:      { bar: 'border-l-cyan-500',    label: 'text-cyan-400',    border: 'border-cyan-900/30',    bg: 'bg-cyan-950/5' },
  cable:           { bar: 'border-l-slate-500',   label: 'text-slate-400',   border: 'border-slate-900/30',   bg: 'bg-slate-950/5' },
  component:       { bar: 'border-l-teal-500',    label: 'text-teal-400',    border: 'border-teal-900/30',    bg: 'bg-teal-950/5' },
  sensor:          { bar: 'border-l-pink-500',    label: 'text-pink-400',    border: 'border-pink-900/30',    bg: 'bg-pink-950/5' },
  network:         { bar: 'border-l-indigo-500',  label: 'text-indigo-400',  border: 'border-indigo-900/30',  bg: 'bg-indigo-950/5' },
  tool:            { bar: 'border-l-amber-500',   label: 'text-amber-400',   border: 'border-amber-900/30',   bg: 'bg-amber-950/5' },
  breakout:        { bar: 'border-l-lime-500',    label: 'text-lime-400',    border: 'border-lime-900/30',    bg: 'bg-lime-950/5' },
  camera:          { bar: 'border-l-rose-500',    label: 'text-rose-400',    border: 'border-rose-900/30',    bg: 'bg-rose-950/5' },
  tablet:          { bar: 'border-l-emerald-500', label: 'text-emerald-400', border: 'border-emerald-900/30', bg: 'bg-emerald-950/5' },
  other:           { bar: 'border-l-zinc-500',    label: 'text-zinc-400',    border: 'border-zinc-900/30',    bg: 'bg-zinc-950/5' },
}
const catColor = (c: string) => CAT_COLORS[c] ?? CAT_COLORS.other

// ─── Category section ──────────────────────────────────────────────────────────

function CategorySection({ category, items, selectedId, onSelect }: {
  category: string; items: InventoryItem[]; selectedId: string | null; onSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const cm = catMeta(category)
  const cc = catColor(category)
  return (
    <div className={clsx('rounded-lg border overflow-hidden', cc.border, cc.bg)}>
      <button
        onClick={() => setCollapsed(o => !o)}
        className={clsx('flex items-center gap-2 w-full px-3 py-2 text-left hover:brightness-110 transition-all border-b', collapsed ? 'border-transparent' : cc.border)}
      >
        <span className={clsx('flex items-center gap-1.5 flex-1 text-xxs font-semibold uppercase tracking-wide', cc.label)}>
          <span>{cm.icon}</span>
          <span>{cm.label}</span>
          <span className="opacity-50 font-normal normal-case tracking-normal">({items.length})</span>
        </span>
        {collapsed
          ? <ChevronRight size={12} className={cc.label} />
          : <ChevronDown size={12} className={cc.label} />
        }
      </button>
      {!collapsed && (
        <div className="flex flex-col divide-y divide-border">
          {items.map(it => <ItemRow key={it.id} item={it} active={it.id === selectedId} onClick={() => onSelect(it.id)} />)}
        </div>
      )}
    </div>
  )
}

// ─── Agent hint ────────────────────────────────────────────────────────────────

function AgentHint() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-violet-900/30 bg-violet-950/15 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full px-3 py-2 text-left">
        <Bot size={13} className="text-violet-400 shrink-0" />
        <span className="text-xs text-violet-200">Let an agent fill this in</span>
        <span className="ml-auto text-xxs text-text-muted">{open ? 'hide' : 'how'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-xxs text-text-secondary leading-relaxed space-y-1.5">
          <p>Tell your OpenClaw/Hermes agent what you counted — it can research each item online and write it here via the API:</p>
          <pre className="bg-base border border-border rounded p-2 overflow-x-auto text-text-muted">POST /api/inventory   {`{ name, category, quantity, location,
  manufacturer, model, condition, estimatedValue,
  summary, specs:{...}, sources:[{title,url}], datasheetUrl }`}</pre>
          <p>Agents can read everything on hand at <code className="text-accent-blue">GET /api/inventory/context</code> (plain text) and see the field schema at <code className="text-accent-blue">GET /api/inventory/schema</code> — so they know exactly what you have for project ideas, recipes, and troubleshooting.</p>
        </div>
      )}
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export function Inventory() {
  const [items, setItems]     = useState<InventoryItem[]>([])
  const [stats, setStats]     = useState<InventoryStats | null>(null)
  const [categories, setCategories] = useState<string[]>([
    'computer','laptop','sbc','microcontroller','storage','battery','power',
    'console','peripheral','cable','component','sensor','network','tool','other',
  ])
  const [conditions, setConditions] = useState<string[]>(['working','untested','partial','broken','unknown'])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [, setSyncTick]               = useState(0)
  const [search, setSearch]           = useState('')
  const [catFilter, setCatFilter]   = useState<string>('all')
  const [condFilter, setCondFilter] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing]       = useState<InventoryItem | null | 'new'>(null)
  const [researchingAll, setResearchingAll] = useState(false)
  const [view, setView]                     = useState<'catalog' | 'backlog'>('catalog')
  const { toast, show: showToast }  = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const d = await invApi.list()
      setItems(d.items); setStats(d.stats); setCategories(d.categories)
      setConditions(d.conditions)
      setLastSyncedAt(new Date())
    } catch (e: any) { setError(e.message ?? 'Failed to load inventory') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Tick every 30s so the "Synced X ago" label stays current
  useEffect(() => {
    const id = setInterval(() => setSyncTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const filtered = items.filter(it => {
    if (catFilter !== 'all' && it.category !== catFilter) return false
    if (condFilter !== 'all' && it.condition !== condFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (![it.name, it.manufacturer, it.model, it.location, it.summary, it.tags.join(' '), catMeta(it.category).label].join(' ').toLowerCase().includes(q)) return false
    }
    return true
  })
  const available   = filtered.filter(i => i.status !== 'in-use')
  const operational = filtered.filter(i => i.status === 'in-use')
  const selected = items.find(i => i.id === selectedId) ?? null

  const saveItem = async (body: InventoryBody) => {
    showToast('saving', editing && editing !== 'new' ? 'Saving changes…' : 'Adding item…')
    try {
      if (editing && editing !== 'new') { const { item } = await invApi.update(editing.id, body); setSelectedId(item.id) }
      else { const { item } = await invApi.create(body); setSelectedId(item.id) }
      setEditing(null); await load()
      showToast('saved', 'Item saved')
    } catch (e: any) { showToast('error', e.message ?? 'Save failed') }
  }
  const adjustQty = async (it: InventoryItem, delta: number) => {
    const q = Math.max(0, it.quantity + delta)
    showToast('saving', 'Updating quantity…')
    try {
      await invApi.update(it.id, { name: it.name, quantity: q } as InventoryBody)
      await load(); showToast('saved', `Quantity updated to ${q}`)
    } catch (e: any) { showToast('error', e.message ?? 'Update failed') }
  }
  const removeItem = async (it: InventoryItem) => {
    if (!confirm(`Delete "${it.name}"?`)) return
    showToast('saving', 'Deleting…')
    try {
      await invApi.remove(it.id); setSelectedId(null); await load(); showToast('saved', 'Item deleted')
    } catch (e: any) { showToast('error', e.message ?? 'Delete failed') }
  }
  const setItemStatus = async (it: InventoryItem, status: string) => {
    showToast('saving', `Setting status to "${statusMeta(status).label}"…`)
    try {
      await invApi.setStatus(it.id, status as 'available' | 'in-use' | 'reserved')
      await load(); showToast('saved', `Status → ${statusMeta(status).label}`)
    } catch (e: any) { showToast('error', e.message ?? 'Status update failed') }
  }
  const research = async (it: InventoryItem) => {
    showToast('saving', 'Starting agent research…')
    try {
      await invApi.research(it.id); await load(); showToast('saved', 'Research started — polling for updates')
      let n = 0
      const timer = setInterval(async () => {
        n++
        try {
          const { item } = await invApi.get(it.id)
          setItems(prev => prev.map(x => (x.id === it.id ? item : x)))
          if (item.researchStatus !== 'pending' || n > 60) {
            clearInterval(timer); load()
            if (item.researchStatus === 'done') showToast('saved', `Research complete for "${item.name}"`)
            else if (item.researchStatus === 'failed') showToast('error', item.researchError || 'Research failed')
          }
        } catch { if (n > 60) clearInterval(timer) }
      }, 4000)
    } catch (e: any) { showToast('error', e.message ?? 'Could not start research') }
  }

  const researchAll = async () => {
    setResearchingAll(true)
    showToast('saving', 'Queuing all unresearched items…')
    try {
      const r = await invApi.researchAll()
      if (r.queued === 0) { showToast('saved', 'Nothing to research — all items already enriched'); setResearchingAll(false); return }
      const parts = [r.openclaw > 0 && `${r.openclaw} via OpenClaw`, r.hermes > 0 && `${r.hermes} via Hermes`].filter(Boolean).join(', ')
      showToast('saved', `Researching ${r.queued} item${r.queued !== 1 ? 's' : ''} (${parts})`)
      await load()
      let n = 0
      const timer = setInterval(async () => {
        n++
        try {
          const d = await invApi.list()
          setItems(d.items); setStats(d.stats)
          const stillPending = d.items.filter(i => i.researchStatus === 'pending').length
          if (stillPending === 0 || n > 90) {
            clearInterval(timer); setResearchingAll(false)
            const done  = d.items.filter(i => i.researchStatus === 'done' && i.enriched).length
            const failed = d.items.filter(i => i.researchStatus === 'failed').length
            if (n > 90) showToast('error', 'Research timed out — some items may still be processing')
            else showToast('saved', `Research complete — ${done} enriched${failed > 0 ? `, ${failed} failed` : ''}`)
          }
        } catch { if (n > 90) { clearInterval(timer); setResearchingAll(false) } }
      }, 5000)
    } catch (e: any) { showToast('error', e.message ?? 'Could not start bulk research'); setResearchingAll(false) }
  }

  const catCounts = stats?.byCategory ?? []
  const unresearchedCount = items.filter(i => !i.enriched && i.researchStatus !== 'pending').length
  const pendingCount = items.filter(i => i.researchStatus === 'pending').length

  return (
    <div className="flex h-full overflow-hidden relative">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div>
            <h1 className="text-base font-semibold text-text-primary flex items-center gap-2"><Boxes size={16} className="text-text-muted" /> Inventory</h1>
            {stats && <p className="text-xs text-text-muted mt-0.5">{stats.totalItems} items · {stats.totalQuantity.toLocaleString()} units · ~{money(stats.totalValue)} est. value</p>}
          </div>
          <div className="flex items-center gap-2">
            {lastSyncedAt && (
              <span className="flex items-center gap-1 text-xxs text-text-muted select-none" title={`Last synced: ${lastSyncedAt.toLocaleTimeString()}`}>
                <Clock size={10} className="shrink-0" />
                Synced {syncedAgo(lastSyncedAt)}
              </span>
            )}
            <button onClick={load} disabled={loading} title="Sync inventory" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary text-xs">
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Syncing…' : 'Sync'}
            </button>
            {(unresearchedCount > 0 || researchingAll) && (
              <button onClick={researchAll} disabled={researchingAll || unresearchedCount === 0} title={researchingAll ? `Researching ${pendingCount} item${pendingCount !== 1 ? 's' : ''}…` : `Research ${unresearchedCount} unenriched item${unresearchedCount !== 1 ? 's' : ''}`} className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium', researchingAll ? 'border-violet-700/40 bg-violet-950/30 text-violet-400 cursor-default' : 'border-violet-700/40 bg-violet-950/20 text-violet-300 hover:bg-violet-950/40')}>
                <Bot size={13} className={researchingAll ? 'animate-pulse' : ''} />
                {researchingAll ? `Researching ${pendingCount}…` : `Research All (${unresearchedCount})`}
              </button>
            )}
            <button
              onClick={() => setView(v => v === 'backlog' ? 'catalog' : 'backlog')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium',
                view === 'backlog'
                  ? 'border-violet-700/50 bg-violet-900/40 text-violet-200'
                  : 'border-violet-800/30 bg-violet-950/20 text-violet-300 hover:bg-violet-950/40',
              )}
            >
              <Sparkles size={13} /> Build Ideas
            </button>
            {view === 'catalog' && (
              <button onClick={() => setEditing('new')} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-accent-blue/40 bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 text-xs font-medium"><Plus size={13} /> Add item</button>
            )}
          </div>
        </div>

        <div className="shrink-0 p-6 pb-3 space-y-4 border-b border-border">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Stat label="Items" value={String(stats.totalItems)} icon={<Hash size={12} />} />
              <Stat label="Total units" value={stats.totalQuantity.toLocaleString()} icon={<Layers size={12} />} />
              <Stat label="Est. value" value={money(stats.totalValue)} icon={<DollarSign size={12} />} tone="text-green-400" />
              <Stat label="Categories" value={String(stats.byCategory.length)} icon={<Boxes size={12} />} />
              <Stat label="Working" value={String(stats.byCondition.working ?? 0)} icon={<Sparkles size={12} />} tone="text-green-400" />
              <Stat label="In Operation" value={String(stats.operationalCount ?? 0)} icon={<Zap size={12} />} tone={(stats.operationalCount ?? 0) > 0 ? 'text-amber-300' : undefined} />
            </div>
          )}

          <AgentHint />

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items, specs, tags…" className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border" />
            </div>
            <select value={condFilter} onChange={e => setCondFilter(e.target.value)} className="px-2 py-1.5 rounded-lg bg-base border border-border text-xs text-text-secondary outline-none">
              <option value="all">All conditions</option>
              {conditions.map(c => <option key={c} value={c}>{condMeta(c).label}</option>)}
            </select>
          </div>

          {/* Category chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setCatFilter('all')} className={clsx('px-2 py-1 rounded-full border text-xxs', catFilter === 'all' ? 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue' : 'border-border bg-card text-text-muted hover:text-text-secondary')}>All</button>
            {catCounts.map(c => (
              <button key={c.category} onClick={() => setCatFilter(c.category)} className={clsx('flex items-center gap-1 px-2 py-1 rounded-full border text-xxs', catFilter === c.category ? 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue' : 'border-border bg-card text-text-muted hover:text-text-secondary')}>
                {catMeta(c.category).icon} {catMeta(c.category).label} <span className="opacity-60">{c.count}</span>
              </button>
            ))}
          </div>

          {error && <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300"><AlertCircle size={13} className="shrink-0 mt-0.5" /><p className="text-xs">{error}</p></div>}
        </div>

        {/* ── Scrollable item list ── */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
          {view === 'backlog' ? (
            <div className="py-4"><ProjectBacklog /></div>
          ) : loading ? (
            <div className="space-y-1 pt-1">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 rounded-lg bg-card border border-border animate-pulse" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
              <Boxes size={20} className="text-text-muted" />
              <p className="text-sm text-text-muted">{items.length === 0 ? 'No items yet' : 'No items match your filters'}</p>
              {items.length === 0 && <button onClick={() => setEditing('new')} className="text-xs text-accent-blue hover:underline">Add your first item</button>}
            </div>
          ) : (
            <div className="flex flex-col gap-2 pt-1">
              {/* Category sections for available/non-deployed items */}
              {(() => {
                const categorized = available.reduce<Record<string, InventoryItem[]>>((acc, it) => {
                  const k = it.category || 'other'
                  ;(acc[k] ??= []).push(it)
                  return acc
                }, {})
                return Object.entries(categorized)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cat, its]) => (
                    <CategorySection key={cat} category={cat} items={its} selectedId={selectedId} onSelect={setSelectedId} />
                  ))
              })()}

              {/* In-operation section — always shown last */}
              {operational.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 px-1">
                    <Zap size={11} className="text-amber-400 shrink-0" />
                    <span className="text-xxs font-semibold uppercase tracking-wide text-amber-400">In Operation — Deployed ({operational.length})</span>
                    <span className="flex-1 border-t border-amber-900/30" />
                    <span className="text-xxs text-amber-400/60">Agents consider these last</span>
                  </div>
                  <div className="flex flex-col divide-y divide-border rounded-lg border border-amber-900/30 bg-amber-950/5 overflow-hidden">
                    {operational.map(it => <ItemRow key={it.id} item={it} active={it.id === selectedId} onClick={() => setSelectedId(it.id)} />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <DetailDrawer item={selected} onClose={() => setSelectedId(null)} onEdit={() => setEditing(selected)} onDelete={() => removeItem(selected)} onQty={d => adjustQty(selected, d)} onResearch={() => research(selected)} onStatus={s => setItemStatus(selected, s)} />
      )}

      {editing && (
        <ItemForm initial={editing === 'new' ? null : editing} categories={categories} conditions={conditions} onSave={saveItem} onClose={() => setEditing(null)} />
      )}

      <MutationToast toast={toast} />
    </div>
  )
}
