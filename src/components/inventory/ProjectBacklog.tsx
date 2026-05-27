/**
 * ProjectBacklog — displays the AI-generated project ideas backlog for the
 * inventory view. Handles all lifecycle states: empty, generating, and
 * populated. Cards support like / reject (with optional reason) / snooze /
 * complete actions.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Sparkles, RefreshCw, ThumbsUp, ThumbsDown, Clock, CheckCircle2,
  ChevronDown, ChevronUp, Wrench, Package, AlertTriangle, Zap,
  RotateCcw, Filter, Loader2, X,
} from 'lucide-react'
import clsx from 'clsx'
import { projectIdeas } from '../../lib/api'
import type { ProjectIdea, ProjectGenRun, ProjectIdeaStatus } from '../../lib/api'

// ─── Difficulty meta ─────────────────────────────────────────────────────────

const DIFF_META: Record<string, { label: string; cls: string }> = {
  easy:   { label: 'Easy',   cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/40' },
  medium: { label: 'Medium', cls: 'bg-amber-900/40  text-amber-300  border-amber-800/40' },
  hard:   { label: 'Hard',   cls: 'bg-orange-900/40 text-orange-300 border-orange-800/40' },
  expert: { label: 'Expert', cls: 'bg-red-900/40    text-red-300    border-red-800/40' },
}

const CATEGORY_LABELS: Record<string, string> = {
  'raspberry-pi-build':      'Raspberry Pi',
  'microcontroller-project': 'Microcontroller',
  'sensor-automation':       'Sensor / Automation',
  'display-dashboard':       'Display / Dashboard',
  'repair-reuse':            'Repair & Reuse',
  'lab-equipment':           'Lab Equipment',
  'cyberdeck-portable':      'Cyberdeck / Portable',
  'prop-electronics':        'Prop Electronics',
  'home-utility':            'Home Utility',
  'experimental':            'Experimental',
}

// ─── Score bar ───────────────────────────────────────────────────────────────

function ScoreBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xxs text-text-muted shrink-0 w-16">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xxs text-text-secondary shrink-0 w-6 text-right">{value}</span>
    </div>
  )
}

// ─── Reject modal ─────────────────────────────────────────────────────────────

function RejectModal({
  idea,
  onConfirm,
  onCancel,
}: { idea: ProjectIdea; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-surface border border-border rounded-xl p-5 w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Reject idea?</h3>
          <button onClick={onCancel} className="text-text-muted hover:text-text-secondary transition-colors">
            <X size={14} />
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-3 line-clamp-2">{idea.title}</p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Optional: why are you rejecting this? (helps the AI learn)"
          rows={3}
          className="w-full bg-base border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-violet-600/50 mb-4"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-text-secondary border border-border rounded-lg hover:bg-card-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            className="px-3 py-1.5 text-xs bg-red-900/40 text-red-300 border border-red-800/40 rounded-lg hover:bg-red-900/60 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Idea card ────────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  onUpdate,
  onDelete,
}: {
  idea:     ProjectIdea
  onUpdate: (id: string, status: ProjectIdeaStatus, rejectionReason?: string) => void
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded]         = useState(false)
  const [showReject, setShowReject]     = useState(false)
  const [busy, setBusy]                 = useState(false)
  const diff                            = DIFF_META[idea.difficulty] ?? DIFF_META.medium

  const act = async (status: ProjectIdeaStatus, rejectionReason?: string) => {
    setBusy(true)
    try { await onUpdate(idea.id, status, rejectionReason) } finally { setBusy(false) }
  }

  const isActioned = idea.status !== 'new'

  return (
    <>
      {showReject && (
        <RejectModal
          idea={idea}
          onConfirm={reason => { setShowReject(false); act('rejected', reason) }}
          onCancel={() => setShowReject(false)}
        />
      )}

      <div className={clsx(
        'flex flex-col rounded-xl border transition-all duration-200',
        idea.status === 'liked'    && 'border-emerald-800/50 bg-emerald-950/10',
        idea.status === 'rejected' && 'border-red-900/30 bg-red-950/5 opacity-60',
        idea.status === 'snoozed'  && 'border-amber-900/30 bg-amber-950/5 opacity-70',
        idea.status === 'completed'&& 'border-violet-900/30 bg-violet-950/5',
        idea.status === 'new'      && 'border-border bg-card',
      )}>
        {/* Card header */}
        <div className="flex items-start gap-3 p-4">
          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <h3 className="text-sm font-semibold text-text-primary leading-snug">{idea.title}</h3>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={clsx('text-xxs px-1.5 py-0.5 rounded-md border font-medium', diff.cls)}>
                  {diff.label}
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="text-xs text-text-secondary leading-relaxed mb-2">{idea.description}</p>

            {/* Why it fits */}
            {idea.whyFit && (
              <p className="text-xxs text-violet-300/80 italic mb-2 leading-relaxed">
                <span className="not-italic text-violet-400/60">Why it fits: </span>{idea.whyFit}
              </p>
            )}

            {/* Category + time + cost */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {idea.category && (
                <span className="text-xxs px-1.5 py-0.5 rounded-md bg-violet-950/30 text-violet-300/80 border border-violet-900/20">
                  {CATEGORY_LABELS[idea.category] ?? idea.category}
                </span>
              )}
              {idea.timeEstimate && (
                <span className="flex items-center gap-1 text-xxs text-text-muted">
                  <Clock size={10} />{idea.timeEstimate}
                </span>
              )}
              {idea.costEstimate && (
                <span className="text-xxs text-text-muted">{idea.costEstimate}</span>
              )}
            </div>

            {/* Score bars */}
            <div className="flex flex-col gap-1 mb-3">
              <ScoreBar value={idea.confidence} label="Confidence" color="bg-blue-500/70" />
              <ScoreBar value={idea.coolness}   label="Coolness"   color="bg-violet-500/70" />
            </div>

            {/* Parts I have */}
            {idea.haveParts.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1 mb-1">
                  <Package size={10} className="text-emerald-400/70" />
                  <span className="text-xxs font-medium text-emerald-400/70 uppercase tracking-wide">Parts on hand</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {idea.haveParts.map((p, i) => (
                    <span key={i} className="text-xxs px-1.5 py-0.5 rounded bg-emerald-950/30 text-emerald-300/80 border border-emerald-900/20">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing parts */}
            {idea.missingParts.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-1 mb-1">
                  <AlertTriangle size={10} className="text-amber-400/70" />
                  <span className="text-xxs font-medium text-amber-400/70 uppercase tracking-wide">Still need</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {idea.missingParts.map((p, i) => (
                    <span key={i} className="text-xxs px-1.5 py-0.5 rounded bg-amber-950/20 text-amber-300/70 border border-amber-900/20">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Expandable details */}
            {(idea.requiredTools.length > 0 || idea.nextStep) && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xxs text-text-muted hover:text-text-secondary transition-colors mt-1"
              >
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {expanded ? 'Less' : 'More details'}
              </button>
            )}

            {expanded && (
              <div className="mt-2 pt-2 border-t border-border/40 space-y-2">
                {idea.requiredTools.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1 mb-1">
                      <Wrench size={10} className="text-text-muted" />
                      <span className="text-xxs font-medium text-text-muted uppercase tracking-wide">Tools / Skills</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {idea.requiredTools.map((t, i) => (
                        <span key={i} className="text-xxs px-1.5 py-0.5 rounded bg-card-hover text-text-secondary border border-border">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {idea.nextStep && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <Zap size={10} className="text-amber-400/70" />
                      <span className="text-xxs font-medium text-amber-400/70 uppercase tracking-wide">First step</span>
                    </div>
                    <p className="text-xs text-text-secondary leading-relaxed">{idea.nextStep}</p>
                  </div>
                )}
              </div>
            )}

            {/* Rejection reason */}
            {idea.status === 'rejected' && idea.rejectionReason && (
              <p className="text-xxs text-red-400/70 italic mt-2">
                Rejected: {idea.rejectionReason}
              </p>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-1.5 px-4 pb-3 border-t border-border/30 pt-2.5">
          {busy ? (
            <Loader2 size={12} className="animate-spin text-text-muted" />
          ) : (
            <>
              {idea.status !== 'liked' && (
                <button
                  onClick={() => act('liked')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-emerald-950/30 text-emerald-300 border border-emerald-800/30 hover:bg-emerald-950/60 transition-colors"
                >
                  <ThumbsUp size={10} /> Like
                </button>
              )}
              {idea.status !== 'rejected' && (
                <button
                  onClick={() => setShowReject(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-red-950/20 text-red-400 border border-red-900/20 hover:bg-red-950/40 transition-colors"
                >
                  <ThumbsDown size={10} /> Reject
                </button>
              )}
              {idea.status !== 'snoozed' && idea.status !== 'rejected' && (
                <button
                  onClick={() => act('snoozed')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-amber-950/20 text-amber-400 border border-amber-900/20 hover:bg-amber-950/40 transition-colors"
                >
                  <Clock size={10} /> Snooze
                </button>
              )}
              {idea.status !== 'completed' && (
                <button
                  onClick={() => act('completed')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-violet-950/30 text-violet-300 border border-violet-900/30 hover:bg-violet-950/60 transition-colors"
                >
                  <CheckCircle2 size={10} /> Built it!
                </button>
              )}
              {isActioned && (
                <button
                  onClick={() => act('new')}
                  className="flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-card-hover text-text-muted border border-border hover:text-text-secondary transition-colors ml-auto"
                >
                  <RotateCcw size={10} /> Reset
                </button>
              )}
              <button
                onClick={() => onDelete(idea.id)}
                className={clsx('flex items-center gap-1 px-2.5 py-1 text-xxs rounded-md bg-card-hover text-text-muted border border-border hover:text-red-400 transition-colors', !isActioned && 'ml-auto')}
              >
                <X size={10} />
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Status filter tabs ───────────────────────────────────────────────────────

type FilterTab = 'all' | ProjectIdeaStatus

const FILTER_TABS: Array<{ id: FilterTab; label: string }> = [
  { id: 'all',       label: 'All' },
  { id: 'new',       label: 'New' },
  { id: 'liked',     label: 'Liked' },
  { id: 'snoozed',   label: 'Snoozed' },
  { id: 'completed', label: 'Built' },
  { id: 'rejected',  label: 'Rejected' },
]

// ─── Running state banner ─────────────────────────────────────────────────────

function RunningBanner({ run }: { run: ProjectGenRun }) {
  const elapsed = Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 1000)
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-violet-900/30 bg-violet-950/15 text-xs text-violet-300/80">
      <Loader2 size={12} className="animate-spin shrink-0" />
      <span>Agent is analysing your inventory&hellip;</span>
      <span className="ml-auto text-violet-400/50 text-xxs">{elapsed}s</span>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({
  filterTab,
  onGenerate,
  generating,
}: {
  filterTab:  FilterTab
  onGenerate: () => void
  generating: boolean
}) {
  if (filterTab !== 'all' && filterTab !== 'new') {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="text-text-muted text-sm">No ideas in this category yet.</div>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center px-8">
      <div className="w-12 h-12 rounded-xl bg-violet-950/30 border border-violet-900/30 flex items-center justify-center">
        <Sparkles size={22} className="text-violet-400" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-1">No project ideas yet</h3>
        <p className="text-xs text-text-muted leading-relaxed max-w-xs">
          Click <strong className="text-text-secondary">Find Projects I Can Build</strong> to let an AI agent scan your
          inventory and suggest realistic builds based on what you already have.
        </p>
      </div>
      {!generating && (
        <button
          onClick={onGenerate}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-900/40 text-violet-200 border border-violet-700/40 hover:bg-violet-900/60 transition-colors text-sm font-medium"
        >
          <Sparkles size={13} />
          Find Projects I Can Build
        </button>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProjectBacklog() {
  const [ideas, setIdeas]             = useState<ProjectIdea[]>([])
  const [run, setRun]                 = useState<ProjectGenRun | null>(null)
  const [loading, setLoading]         = useState(true)
  const [filterTab, setFilterTab]     = useState<FilterTab>('all')
  const [error, setError]             = useState<string | null>(null)
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load ideas + last run status
  const load = async () => {
    try {
      const r = await projectIdeas.list()
      setIdeas(r.ideas)
      setRun(r.run)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load project ideas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Poll while generation is running
  useEffect(() => {
    if (run?.status === 'pending') {
      if (pollRef.current) return  // already polling
      pollRef.current = setInterval(async () => {
        try {
          const r = await projectIdeas.list()
          setIdeas(r.ideas)
          setRun(r.run)
          if (r.run?.status !== 'pending') {
            clearInterval(pollRef.current!)
            pollRef.current = null
          }
        } catch { /* swallow */ }
      }, 5_000)
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [run?.status])

  const handleGenerate = async () => {
    setError(null)
    try {
      const r = await projectIdeas.generate()
      setRun(r.run)
    } catch (e: any) {
      setError(e.message ?? 'Failed to start generation')
    }
  }

  const handleUpdate = async (id: string, status: ProjectIdeaStatus, rejectionReason?: string) => {
    try {
      const r = await projectIdeas.update(id, { status, rejectionReason })
      setIdeas(prev => prev.map(i => i.id === id ? r.idea : i))
    } catch (e: any) {
      setError(e.message ?? 'Failed to update idea')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await projectIdeas.remove(id)
      setIdeas(prev => prev.filter(i => i.id !== id))
    } catch (e: any) {
      setError(e.message ?? 'Failed to delete idea')
    }
  }

  const generating = run?.status === 'pending'

  const filtered = filterTab === 'all'
    ? ideas
    : ideas.filter(i => i.status === filterTab)

  // Tab counts
  const countFor = (tab: FilterTab) => tab === 'all' ? ideas.length : ideas.filter(i => i.status === tab).length

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg p-1">
          <Filter size={11} className="text-text-muted ml-1 mr-0.5" />
          {FILTER_TABS.map(tab => {
            const count = countFor(tab.id)
            return (
              <button
                key={tab.id}
                onClick={() => setFilterTab(tab.id)}
                className={clsx(
                  'flex items-center gap-1 px-2.5 py-1 rounded-md text-xxs font-medium transition-colors',
                  filterTab === tab.id
                    ? 'bg-violet-900/50 text-violet-200 border border-violet-700/40'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {tab.label}
                {count > 0 && (
                  <span className={clsx(
                    'text-xxs px-1 rounded',
                    filterTab === tab.id ? 'bg-violet-700/50 text-violet-200' : 'bg-card-hover text-text-muted',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Re-run button */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            generating
              ? 'bg-violet-950/20 text-violet-400/50 border-violet-900/20 cursor-not-allowed'
              : 'bg-violet-900/30 text-violet-200 border-violet-700/40 hover:bg-violet-900/50',
          )}
        >
          {generating
            ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
            : <><RefreshCw size={11} /> Regenerate</>
          }
        </button>
      </div>

      {/* Errors */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950/20 border border-red-900/30 text-xs text-red-300">
          <AlertTriangle size={12} className="shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto"><X size={11} /></button>
        </div>
      )}

      {/* Generation failed */}
      {run?.status === 'failed' && run.error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-950/20 border border-red-900/30 text-xs text-red-300">
          <AlertTriangle size={12} className="shrink-0" />
          Agent generation failed: {run.error}
        </div>
      )}

      {/* Running banner */}
      {generating && run && <RunningBanner run={run} />}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-text-muted text-sm">
          <Loader2 size={16} className="animate-spin" />
          Loading ideas…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filterTab={filterTab} onGenerate={handleGenerate} generating={generating} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filtered.map(idea => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Last run metadata */}
      {run && run.status === 'done' && (
        <p className="text-xxs text-text-muted text-right">
          Last generated {new Date(run.completedAt || run.startedAt).toLocaleString()} via {run.source} ·{' '}
          {run.newIdeas} idea{run.newIdeas !== 1 ? 's' : ''} from {run.itemCount} items
        </p>
      )}
    </div>
  )
}
