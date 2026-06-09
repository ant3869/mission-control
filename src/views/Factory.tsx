// title: Idea Factory — real agent-generated project ideas
// path: src/views/Factory.tsx
// purpose: Browse + triage the project ideas the agents generate from your
//          inventory (real data via /api/inventory/project-ideas), replacing the
//          old mock idea list. Like / snooze / reject ideas and trigger a new
//          generation run.

import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Sparkles, RefreshCw, ThumbsUp, ThumbsDown, Clock, DollarSign, Check,
  Loader2, Lightbulb, Zap, Flame, ArrowRight, Moon,
} from 'lucide-react'
import { projectIdeas, type ProjectIdea, type ProjectIdeaStatus } from '../lib/api'
import { ProjectIdeaPanel } from '../components/inventory/ProjectIdeaPanel'

const STATUSES: ProjectIdeaStatus[] = ['new', 'liked', 'snoozed', 'rejected', 'completed']

const statusConfig: Record<ProjectIdeaStatus, { label: string; badge: string; dot: string }> = {
  new:       { label: 'New',       badge: 'bg-blue-950/50 border-blue-900/50 text-blue-300',     dot: 'bg-blue-400'   },
  liked:     { label: 'Liked',     badge: 'bg-green-950/50 border-green-900/50 text-green-300',   dot: 'bg-green-400'  },
  snoozed:   { label: 'Snoozed',   badge: 'bg-amber-950/50 border-amber-900/50 text-amber-300',   dot: 'bg-amber-400'  },
  rejected:  { label: 'Rejected',  badge: 'bg-red-950/40 border-red-900/40 text-red-300',         dot: 'bg-red-500'    },
  completed: { label: 'Completed', badge: 'bg-violet-950/50 border-violet-900/50 text-violet-300', dot: 'bg-violet-400' },
}

function difficultyColor(d: string) {
  const k = (d || '').toLowerCase()
  if (k.startsWith('easy'))   return 'text-green-400'
  if (k.startsWith('medium')) return 'text-amber-400'
  if (k.startsWith('hard'))   return 'text-orange-400'
  if (k.startsWith('expert')) return 'text-red-400'
  return 'text-text-muted'
}

function ScorePill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  const color = value >= 75 ? 'text-green-400' : value >= 45 ? 'text-amber-400' : 'text-red-400'
  return (
    <span className="flex items-center gap-1 text-xxs" title={`${label}: ${value}/100`}>
      <span className="text-text-muted">{icon}</span>
      <span className={clsx('tabular-nums font-semibold', color)}>{value}</span>
    </span>
  )
}

function PartChips({ parts, kind }: { parts: string[]; kind: 'have' | 'missing' }) {
  if (!parts || parts.length === 0) return null
  const cls = kind === 'have'
    ? 'bg-green-950/30 border-green-900/40 text-green-300/80'
    : 'bg-amber-950/30 border-amber-900/40 text-amber-300/80'
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {parts.slice(0, 6).map((p, i) => (
        <span key={i} className={clsx('px-1.5 py-0.5 rounded border text-[10px]', cls)}>{p}</span>
      ))}
      {parts.length > 6 && <span className="text-[10px] text-text-muted">+{parts.length - 6}</span>}
    </div>
  )
}

function IdeaCard({ idea, busy, onSet, onOpen }: {
  idea: ProjectIdea; busy: boolean; onSet: (s: ProjectIdeaStatus) => void; onOpen: () => void
}) {
  const sc = statusConfig[idea.status] ?? statusConfig.new
  return (
    <div onClick={onOpen} title="Open details"
      className={clsx('group flex flex-col gap-2.5 p-4 rounded-lg border bg-card hover:bg-card-hover transition-all cursor-pointer', busy && 'opacity-60 pointer-events-none')}>
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary leading-snug">{idea.title}</p>
          {idea.category && <span className="text-xxs text-text-muted">{idea.category.replace(/-/g, ' ')}</span>}
        </div>
        <span className={clsx('shrink-0 px-1.5 py-0.5 rounded border text-xxs font-medium', sc.badge)}>{sc.label}</span>
      </div>

      {/* Scores + meta */}
      <div className="flex items-center gap-3 flex-wrap">
        <ScorePill icon={<Zap size={11} />} label="Confidence" value={idea.confidence} />
        <ScorePill icon={<Flame size={11} />} label="Coolness" value={idea.coolness} />
        {idea.difficulty && <span className={clsx('text-xxs font-medium capitalize', difficultyColor(idea.difficulty))}>{idea.difficulty}</span>}
        {idea.timeEstimate && <span className="flex items-center gap-0.5 text-xxs text-text-muted"><Clock size={10} />{idea.timeEstimate}</span>}
        {idea.costEstimate && <span className="flex items-center gap-0.5 text-xxs text-text-muted"><DollarSign size={10} />{idea.costEstimate}</span>}
      </div>

      {/* Description / why it fits */}
      <p className="text-xxs text-text-muted leading-relaxed line-clamp-3">{idea.whyFit || idea.description}</p>

      {/* Parts */}
      {(idea.haveParts?.length > 0 || idea.missingParts?.length > 0) && (
        <div className="flex flex-col gap-1">
          <PartChips parts={idea.haveParts} kind="have" />
          <PartChips parts={idea.missingParts} kind="missing" />
        </div>
      )}

      {/* Next step */}
      {idea.nextStep && (
        <p className="flex items-start gap-1 text-xxs text-text-secondary border-t border-border-subtle pt-2">
          <ArrowRight size={11} className="text-accent-blue shrink-0 mt-0.5" />
          <span className="line-clamp-2">{idea.nextStep}</span>
        </p>
      )}

      {/* Actions (stop propagation so they don't also open the detail panel) */}
      <div onClick={e => e.stopPropagation()} className="flex items-center gap-1.5 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {busy && <Loader2 size={12} className="animate-spin text-text-muted" />}
        {idea.status !== 'liked' && (
          <button onClick={() => onSet('liked')} className="flex items-center gap-1 px-2 py-1 rounded border border-green-900/40 bg-green-950/20 text-green-300 text-xxs hover:bg-green-950/40"><ThumbsUp size={10} />Like</button>
        )}
        {idea.status === 'liked' && (
          <button onClick={() => onSet('completed')} className="flex items-center gap-1 px-2 py-1 rounded border border-violet-900/40 bg-violet-950/20 text-violet-300 text-xxs hover:bg-violet-950/40"><Check size={10} />Done</button>
        )}
        {idea.status !== 'snoozed' && (
          <button onClick={() => onSet('snoozed')} className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-card text-text-muted text-xxs hover:text-text-secondary"><Moon size={10} />Snooze</button>
        )}
        {idea.status !== 'rejected' && (
          <button onClick={() => onSet('rejected')} className="flex items-center gap-1 px-2 py-1 rounded border border-red-900/40 bg-red-950/20 text-red-300 text-xxs hover:bg-red-950/40"><ThumbsDown size={10} />Reject</button>
        )}
      </div>
    </div>
  )
}

export function Factory() {
  const [ideas, setIdeas]     = useState<ProjectIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [filter, setFilter]   = useState<ProjectIdeaStatus | 'all'>('all')
  const [busyId, setBusyId]   = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [selected, setSelected] = useState<ProjectIdea | null>(null)
  const pollRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await projectIdeas.list()
      setIdeas(r.ideas)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
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
    setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, status } : i)) // optimistic
    try { await projectIdeas.update(idea.id, reason ? { status, rejectionReason: reason } : { status }) }
    catch { setIdeas(prev => prev.map(i => i.id === idea.id ? { ...i, status: idea.status } : i)) }
    finally { setBusyId(null) }
  }

  // Detail-panel actions: apply the status change, then close the panel.
  const actOnSelected = (status: ProjectIdeaStatus, reason?: string) => {
    if (selected) setStatus(selected, status, reason)
    setSelected(null)
  }

  const counts = Object.fromEntries(STATUSES.map(s => [s, ideas.filter(i => i.status === s).length])) as Record<ProjectIdeaStatus, number>
  const filtered = filter === 'all' ? ideas : ideas.filter(i => i.status === filter)
  // Sort by coolness then confidence so the best ideas surface first.
  const sorted = [...filtered].sort((a, b) => (b.coolness + b.confidence) - (a.coolness + a.confidence))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <Sparkles size={17} className="text-accent-purple" />
          <div>
            <h1 className="text-base font-semibold text-text-primary">Idea Factory</h1>
            <p className="text-xs text-text-muted mt-0.5">
              {loading ? 'Loading…' : error ? <span className="text-red-400">{error}</span>
                : <>{ideas.length} agent-generated project ideas · <span className="text-green-400">{counts.liked} liked</span></>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={generate} disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-purple/20 border border-accent-purple/40 text-accent-purple hover:bg-accent-purple/30 disabled:opacity-50 text-xs font-medium">
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {generating ? 'Generating…' : 'Generate ideas'}
          </button>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1 px-2 py-1.5 rounded border border-border bg-card text-text-muted hover:text-text-secondary text-xs" title="Refresh">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
        <button onClick={() => setFilter('all')}
          className={clsx('px-2.5 py-1 rounded text-xs font-medium transition-all shrink-0',
            filter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
          All <span className="ml-1 text-xxs opacity-60">{ideas.length}</span>
        </button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilter(s === filter ? 'all' : s)}
            className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all shrink-0',
              filter === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', statusConfig[s].dot)} />
            {statusConfig[s].label} <span className="text-xxs opacity-60">{counts[s]}</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-56 rounded-lg border border-border bg-card animate-pulse" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <Lightbulb size={22} className="text-text-muted" />
            <p className="text-sm text-text-secondary">{ideas.length === 0 ? 'No ideas generated yet' : 'No ideas in this status'}</p>
            <p className="text-xs text-text-muted max-w-sm">The agents generate buildable project ideas from your inventory. Hit <span className="text-accent-purple">Generate ideas</span> to create more.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sorted.map(idea => (
              <IdeaCard key={idea.id} idea={idea} busy={busyId === idea.id} onSet={s => setStatus(idea, s)} onOpen={() => setSelected(idea)} />
            ))}
          </div>
        )}
      </div>

      {/* Detail panel for the selected idea (right-side drawer) */}
      <ProjectIdeaPanel
        idea={selected}
        onClose={() => setSelected(null)}
        onSave={() => actOnSelected('liked')}
        onSnooze={() => actOnSelected('snoozed')}
        onComplete={() => actOnSelected('completed')}
        onReject={(_id, reason) => actOnSelected('rejected', reason)}
      />
    </div>
  )
}
