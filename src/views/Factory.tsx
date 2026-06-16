// title: Idea Factory — real agent-generated project ideas
// path: src/views/Factory.tsx
// purpose: Browse + triage the project ideas the agents generate from your
//          inventory (real data via /api/inventory/project-ideas). Styled to
//          match the Inventory project-backlog cards, with a richer toolset:
//          buildable-now detection, smart sorting, search, summary stats, and
//          reject-with-reason. Like / snooze / reject / built-it + detail drawer.

import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Sparkles, RefreshCw, ThumbsUp, ThumbsDown, Clock, CheckCircle2, Package,
  AlertTriangle, RotateCcw, Loader2, X, Search, Hammer, Lightbulb, ArrowUpDown,
} from 'lucide-react'
import { projectIdeas, type ProjectIdea, type ProjectIdeaStatus } from '../lib/api'
import { ProjectIdeaPanel } from '../components/inventory/ProjectIdeaPanel'

const STATUSES: ProjectIdeaStatus[] = ['new', 'liked', 'snoozed', 'completed', 'rejected']
const STATUS_LABEL: Record<ProjectIdeaStatus, string> = {
  new: 'New', liked: 'Liked', snoozed: 'Snoozed', completed: 'Built', rejected: 'Rejected',
}
const STATUS_DOT: Record<ProjectIdeaStatus, string> = {
  new: 'bg-blue-400', liked: 'bg-emerald-400', snoozed: 'bg-amber-400', completed: 'bg-violet-400', rejected: 'bg-red-500',
}

const DIFF_META: Record<string, { label: string; cls: string }> = {
  easy:   { label: 'Easy',   cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/40' },
  medium: { label: 'Medium', cls: 'bg-amber-900/40 text-amber-300 border-amber-800/40' },
  hard:   { label: 'Hard',   cls: 'bg-orange-900/40 text-orange-300 border-orange-800/40' },
  expert: { label: 'Expert', cls: 'bg-red-900/40 text-red-300 border-red-800/40' },
}
const CATEGORY_LABELS: Record<string, string> = {
  'raspberry-pi-build': 'Raspberry Pi', 'microcontroller-project': 'Microcontroller',
  'sensor-automation': 'Sensor / Automation', 'display-dashboard': 'Display / Dashboard',
  'repair-reuse': 'Repair & Reuse', 'lab-equipment': 'Lab Equipment',
  'cyberdeck-portable': 'Cyberdeck / Portable', 'prop-electronics': 'Prop Electronics',
  'home-utility': 'Home Utility', 'experimental': 'Experimental',
}

type SortKey = 'best' | 'coolest' | 'cheapest' | 'newest'
const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'best', label: 'Best' }, { id: 'coolest', label: 'Coolest' },
  { id: 'cheapest', label: 'Cheapest' }, { id: 'newest', label: 'Newest' },
]

// A project is "buildable now" when you already own every part it needs.
const isBuildable = (i: ProjectIdea) => i.missingParts.length === 0 && i.haveParts.length > 0
// Parse a rough USD figure out of the free-text cost estimate for sorting.
function costNum(i: ProjectIdea): number {
  if (isBuildable(i)) return 0
  const m = (i.costEstimate || '').match(/\$\s*(\d+)/)
  return m ? Number(m[1]) : 999
}

// ─── Score bar (matches the Inventory backlog) ───────────────────────────────────

function ScoreBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xxs text-text-muted shrink-0 w-16">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="text-xxs text-text-secondary shrink-0 w-6 text-right tabular-nums">{value}</span>
    </div>
  )
}

function PartList({ parts, kind }: { parts: string[]; kind: 'have' | 'missing' }) {
  if (!parts?.length) return null
  const have = kind === 'have'
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1 mb-1">
        {have ? <Package size={10} className="text-emerald-400/70" /> : <AlertTriangle size={10} className="text-amber-400/70" />}
        <span className={clsx('text-xxs font-medium uppercase tracking-wide', have ? 'text-emerald-400/70' : 'text-amber-400/70')}>
          {have ? 'Parts on hand' : 'Still need'}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {parts.map((p, i) => (
          <span key={i} className={clsx('text-xxs px-1.5 py-0.5 rounded border',
            have ? 'bg-emerald-950/30 text-emerald-300/80 border-emerald-900/20' : 'bg-amber-950/20 text-amber-300/70 border-amber-900/20')}>
            {p}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Reject-with-reason modal ────────────────────────────────────────────────────

function RejectModal({ idea, onConfirm, onCancel }: { idea: ProjectIdea; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-surface border border-border rounded-xl p-5 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Reject idea?</h3>
          <button onClick={onCancel} className="text-text-muted hover:text-text-secondary"><X size={14} /></button>
        </div>
        <p className="text-xs text-text-secondary mb-3 line-clamp-2">{idea.title}</p>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="Optional: why? (helps the agent learn what you don't want)"
          className="w-full bg-base border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-violet-600/50 mb-4" />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-secondary border border-border rounded-lg hover:bg-card-hover">Cancel</button>
          <button onClick={() => onConfirm(reason.trim())} className="px-3 py-1.5 text-xs bg-red-900/40 text-red-300 border border-red-800/40 rounded-lg hover:bg-red-900/60">Reject</button>
        </div>
      </div>
    </div>
  )
}

// ─── Idea card (matches Inventory backlog styling) ───────────────────────────────

function IdeaCard({ idea, busy, onSet, onReject, onOpen }: {
  idea: ProjectIdea; busy: boolean; onSet: (s: ProjectIdeaStatus) => void; onReject: () => void; onOpen: () => void
}) {
  const diff = DIFF_META[idea.difficulty] ?? DIFF_META.medium
  const buildable = isBuildable(idea)
  const actioned = idea.status !== 'new'
  return (
    <div onClick={onOpen} title="Open details"
      className={clsx('flex flex-col rounded-xl border transition-all duration-200 cursor-pointer',
        idea.status === 'liked' && 'border-emerald-800/50 bg-emerald-950/10',
        idea.status === 'rejected' && 'border-red-900/30 bg-red-950/5 opacity-60',
        idea.status === 'snoozed' && 'border-amber-900/30 bg-amber-950/5 opacity-75',
        idea.status === 'completed' && 'border-violet-900/30 bg-violet-950/5',
        idea.status === 'new' && 'border-border bg-card hover:bg-card-hover',
        busy && 'opacity-50 pointer-events-none')}>
      <div className="flex-1 p-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3 className="text-sm font-semibold text-text-primary leading-snug min-w-0">{idea.title}</h3>
          <div className="flex items-center gap-1.5 shrink-0">
            {buildable && (
              <span className="flex items-center gap-0.5 text-xxs px-1.5 py-0.5 rounded-md border bg-emerald-900/40 text-emerald-300 border-emerald-800/40 font-medium" title="You have every part needed">
                <Hammer size={9} /> Buildable
              </span>
            )}
            <span className={clsx('text-xxs px-1.5 py-0.5 rounded-md border font-medium', diff.cls)}>{diff.label}</span>
          </div>
        </div>

        <p className="text-xs text-text-secondary leading-relaxed mb-2 line-clamp-3">{idea.description}</p>

        {idea.whyFit && (
          <p className="text-xxs text-violet-300/80 italic mb-2 leading-relaxed line-clamp-2">
            <span className="not-italic text-violet-400/60">Why it fits: </span>{idea.whyFit}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {idea.category && (
            <span className="text-xxs px-1.5 py-0.5 rounded-md bg-violet-950/30 text-violet-300/80 border border-violet-900/20">
              {CATEGORY_LABELS[idea.category] ?? idea.category.replace(/-/g, ' ')}
            </span>
          )}
          {idea.timeEstimate && <span className="flex items-center gap-1 text-xxs text-text-muted"><Clock size={10} />{idea.timeEstimate}</span>}
          {idea.costEstimate && <span className="text-xxs text-text-muted">{idea.costEstimate}</span>}
        </div>

        <div className="flex flex-col gap-1 mb-3">
          <ScoreBar value={idea.confidence} label="Confidence" color="bg-blue-500/70" />
          <ScoreBar value={idea.coolness} label="Coolness" color="bg-violet-500/70" />
        </div>

        <PartList parts={idea.haveParts} kind="have" />
        <PartList parts={idea.missingParts} kind="missing" />

        {idea.nextStep && (
          <p className="flex items-start gap-1 text-xxs text-text-secondary border-t border-border-subtle pt-2 mt-1">
            <span className="text-amber-400/70 font-medium uppercase tracking-wide shrink-0">First step:</span>
            <span className="line-clamp-2">{idea.nextStep}</span>
          </p>
        )}

        {idea.status === 'rejected' && idea.rejectionReason && (
          <p className="text-xxs text-red-400/70 italic mt-2">Rejected: {idea.rejectionReason}</p>
        )}
      </div>

      {/* Action bar — always visible, stops propagation so it doesn't open the drawer */}
      <div onClick={e => e.stopPropagation()} className="flex items-center gap-1.5 px-4 pb-3 border-t border-border/30 pt-2.5">
        {busy ? <Loader2 size={12} className="animate-spin text-text-muted" /> : (
          <>
            {idea.status !== 'liked' && (
              <button onClick={() => onSet('liked')} className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-emerald-950/30 text-emerald-300 border border-emerald-800/30 hover:bg-emerald-950/60"><ThumbsUp size={10} /> Like</button>
            )}
            {idea.status !== 'rejected' && (
              <button onClick={onReject} className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-red-950/20 text-red-400 border border-red-900/20 hover:bg-red-950/40"><ThumbsDown size={10} /> Reject</button>
            )}
            {idea.status !== 'snoozed' && idea.status !== 'rejected' && (
              <button onClick={() => onSet('snoozed')} className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-amber-950/20 text-amber-400 border border-amber-900/20 hover:bg-amber-950/40"><Clock size={10} /> Snooze</button>
            )}
            {idea.status !== 'completed' && (
              <button onClick={() => onSet('completed')} className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-violet-950/30 text-violet-300 border border-violet-900/30 hover:bg-violet-950/60"><CheckCircle2 size={10} /> Built it!</button>
            )}
            {actioned && (
              <button onClick={() => onSet('new')} className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-card-hover text-text-muted border border-border hover:text-text-secondary ml-auto"><RotateCcw size={10} /> Reset</button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Header stat chip ────────────────────────────────────────────────────────────

function StatChip({ label, value, accent, active, onClick }: {
  label: string; value: React.ReactNode; accent?: string; active?: boolean; onClick?: () => void
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs transition-colors',
        active ? 'bg-emerald-950/40 border-emerald-800/50' : 'bg-card border-border',
        onClick && 'hover:border-white/15 cursor-pointer', !onClick && 'cursor-default')}>
      <span className={clsx('font-semibold tabular-nums', accent ?? 'text-text-primary')}>{value}</span>
      <span className="text-xxs text-text-muted uppercase tracking-wide">{label}</span>
    </button>
  )
}

export function Factory() {
  const [ideas, setIdeas]     = useState<ProjectIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [filter, setFilter]   = useState<ProjectIdeaStatus | 'all'>('all')
  const [sort, setSort]       = useState<SortKey>('best')
  const [search, setSearch]   = useState('')
  const [buildableOnly, setBuildableOnly] = useState(false)
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [selected, setSelected] = useState<ProjectIdea | null>(null)
  const [rejectFor, setRejectFor] = useState<ProjectIdea | null>(null)
  const pollRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { const r = await projectIdeas.list(); setIdeas(r.ideas) }
    catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    projectIdeas.genStatus().then(r => { if (r.run?.status === 'pending') startPolling() }).catch(() => {})
    return () => { if (pollRef.current) window.clearInterval(pollRef.current) }
  }, [load])

  const startPolling = () => {
    setGenerating(true)
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await projectIdeas.genStatus()
        if (!r.run || r.run.status !== 'pending') {
          window.clearInterval(pollRef.current!); pollRef.current = null
          setGenerating(false); load()
        }
      } catch { /* keep polling */ }
    }, 4000)
  }

  const generate = async () => {
    setGenerating(true)
    try { await projectIdeas.generate(); startPolling() }
    catch (e: any) { setError(e.message); setGenerating(false) }
  }

  const setStatus = async (idea: ProjectIdea, status: ProjectIdeaStatus, reason?: string) => {
    setBusyId(idea.id)
    setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, status } : i))
    try { await projectIdeas.update(idea.id, reason ? { status, rejectionReason: reason } : { status }) }
    catch { setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, status: idea.status } : i)) }
    finally { setBusyId(null) }
  }

  const actOnSelected = (status: ProjectIdeaStatus, reason?: string) => {
    if (selected) setStatus(selected, status, reason)
    setSelected(null)
  }

  // ── Derived ──
  const counts = Object.fromEntries(STATUSES.map(s => [s, ideas.filter(i => i.status === s).length])) as Record<ProjectIdeaStatus, number>
  const buildableCount = ideas.filter(isBuildable).length
  const avgCool = ideas.length ? Math.round(ideas.reduce((s, i) => s + i.coolness, 0) / ideas.length) : 0
  const q = search.trim().toLowerCase()

  const filtered = ideas
    .filter(i => filter === 'all' || i.status === filter)
    .filter(i => !buildableOnly || isBuildable(i))
    .filter(i => !q || `${i.title} ${i.description} ${i.whyFit} ${i.category} ${i.haveParts.join(' ')} ${i.missingParts.join(' ')}`.toLowerCase().includes(q))

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'coolest') return b.coolness - a.coolness
    if (sort === 'cheapest') return costNum(a) - costNum(b) || (b.coolness + b.confidence) - (a.coolness + a.confidence)
    if (sort === 'newest') return (b.createdAt || '').localeCompare(a.createdAt || '')
    return (b.coolness + b.confidence) - (a.coolness + a.confidence)  // best
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {rejectFor && (
        <RejectModal idea={rejectFor}
          onConfirm={reason => { const t = rejectFor; setRejectFor(null); if (t) setStatus(t, 'rejected', reason) }}
          onCancel={() => setRejectFor(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Sparkles size={17} className="text-accent-purple" />
          <div>
            <h1 className="text-base font-semibold text-text-primary">Idea Factory</h1>
            <p className="text-xs text-text-muted mt-0.5">
              {loading ? 'Loading…' : error ? <span className="text-red-400">{error}</span>
                : <>{ideas.length} buildable project ideas from your inventory</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-purple/20 border border-accent-purple/40 text-accent-purple hover:bg-accent-purple/30 disabled:opacity-50 text-xs font-medium">
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {generating ? 'Generating…' : 'Generate ideas'}
          </button>
          <button onClick={load} disabled={loading} title="Refresh"
            className="flex items-center gap-1 px-2 py-1.5 rounded border border-border bg-card text-text-muted hover:text-text-secondary text-xs">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0 flex-wrap">
        <StatChip label="ideas" value={ideas.length} />
        <StatChip label="liked" value={counts.liked} accent="text-emerald-400" />
        <StatChip label="buildable now" value={buildableCount} accent="text-emerald-400" active={buildableOnly} onClick={() => setBuildableOnly(v => !v)} />
        <StatChip label="built" value={counts.completed} accent="text-violet-400" />
        <StatChip label="avg coolness" value={avgCool} accent="text-violet-300" />
      </div>

      {/* Controls: status tabs + sort + search */}
      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button onClick={() => setFilter('all')}
            className={clsx('px-2.5 py-1 rounded text-xs font-medium shrink-0', filter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            All <span className="ml-1 text-xxs opacity-60">{ideas.length}</span>
          </button>
          {STATUSES.map(s => (
            <button key={s} onClick={() => setFilter(s === filter ? 'all' : s)}
              className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium shrink-0', filter === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[s])} />{STATUS_LABEL[s]} <span className="text-xxs opacity-60">{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <div className="flex items-center gap-0.5 rounded-lg bg-card border border-border p-0.5">
            <ArrowUpDown size={11} className="text-text-muted ml-1 mr-0.5" />
            {SORTS.map(s => (
              <button key={s.id} onClick={() => setSort(s.id)}
                className={clsx('px-2 py-0.5 rounded text-xxs font-medium', sort === s.id ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-card border border-border w-44">
            <Search size={11} className="text-text-muted shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ideas…"
              className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none min-w-0" />
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-64 rounded-xl border border-border bg-card animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <Lightbulb size={22} className="text-text-muted" />
            <p className="text-sm text-text-secondary">
              {ideas.length === 0 ? 'No ideas generated yet' : buildableOnly ? 'No buildable-now ideas in this filter' : 'No ideas match'}
            </p>
            <p className="text-xs text-text-muted max-w-sm">Agents turn your inventory into buildable projects. Hit <span className="text-accent-purple">Generate ideas</span> for more.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {sorted.map(idea => (
              <IdeaCard key={idea.id} idea={idea} busy={busyId === idea.id}
                onSet={s => setStatus(idea, s)} onReject={() => setRejectFor(idea)} onOpen={() => setSelected(idea)} />
            ))}
          </div>
        )}
      </div>

      <ProjectIdeaPanel idea={selected} onClose={() => setSelected(null)}
        onSave={() => actOnSelected('liked')} onSnooze={() => actOnSelected('snoozed')}
        onComplete={() => actOnSelected('completed')} onReject={(_id, reason) => actOnSelected('rejected', reason)} />
    </div>
  )
}
