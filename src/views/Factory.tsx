import { useState } from 'react'
import { clsx } from 'clsx'
import { Plus, ChevronDown, ChevronRight, Zap, TrendingUp, Flame, Target, Cpu } from 'lucide-react'
import { factoryIdeas } from '../data/mockData'
import type { IdeaStatus, FactoryIdea } from '../types'

// ─── Config ────────────────────────────────────────────────────────────────────

const statusConfig: Record<IdeaStatus, { label: string; badge: string; dot: string }> = {
  researching: { label: 'Researching', badge: 'bg-blue-950/50 border-blue-900/50 text-blue-400',     dot: 'bg-blue-400'   },
  qualified:   { label: 'Qualified',   badge: 'bg-violet-950/50 border-violet-900/50 text-violet-400', dot: 'bg-violet-400' },
  building:    { label: 'Building',    badge: 'bg-green-950/50 border-green-900/50 text-green-400',    dot: 'bg-green-400'  },
  parked:      { label: 'Parked',      badge: 'bg-card border-border text-text-muted',                 dot: 'bg-slate-500'  },
  killed:      { label: 'Killed',      badge: 'bg-red-950/50 border-red-900/50 text-red-400',          dot: 'bg-red-500'    },
}

const STATUSES: IdeaStatus[] = ['researching', 'qualified', 'building', 'parked', 'killed']

type FilterStatus = IdeaStatus | 'all'

function agentColor(name?: string) {
  const map: Record<string, string> = {
    Claude: 'from-violet-500 to-indigo-600',
    Scout:  'from-teal-500 to-cyan-600',
    Quill:  'from-blue-500 to-sky-600',
    Forge:  'from-emerald-500 to-green-600',
  }
  return name ? (map[name] ?? 'from-slate-600 to-slate-700') : 'from-slate-700 to-slate-800'
}

// ─── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const display = invert ? 11 - value : value
  const pct = (display / 10) * 100
  const color = display >= 8
    ? 'bg-green-500'
    : display >= 5
    ? 'bg-amber-500'
    : 'bg-red-500'

  return (
    <div className="flex items-center gap-2">
      <span className="text-xxs text-text-muted w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-base overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xxs tabular-nums text-text-secondary w-4 text-right">{value}</span>
    </div>
  )
}

// ─── Viability badge ────────────────────────────────────────────────────────────

function ViabilityBadge({ score }: { score: number }) {
  const color = score >= 8
    ? 'text-green-400 border-green-900/50 bg-green-950/40'
    : score >= 6
    ? 'text-amber-400 border-amber-900/50 bg-amber-950/40'
    : 'text-red-400 border-red-900/50 bg-red-950/40'

  return (
    <div className={clsx('flex flex-col items-center justify-center w-11 h-11 rounded-lg border shrink-0', color)}>
      <span className="text-sm font-bold leading-none">{score}</span>
      <span className="text-xxs opacity-70 mt-0.5">score</span>
    </div>
  )
}

// ─── Idea card ──────────────────────────────────────────────────────────────────

function IdeaCard({ idea }: { idea: FactoryIdea }) {
  const [expanded, setExpanded] = useState(false)
  const st = statusConfig[idea.status]

  return (
    <div className={clsx(
      'flex flex-col gap-3 p-4 rounded-lg border transition-all',
      idea.status === 'killed' || idea.status === 'parked'
        ? 'bg-card border-border opacity-60'
        : 'bg-card border-border',
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <ViabilityBadge score={idea.scores.viability} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', st.badge)}>
              <span className={clsx('w-1.5 h-1.5 rounded-full', st.dot)} />
              {st.label}
            </span>
            {idea.status === 'building' && (
              <span className="flex items-center gap-1 text-xxs text-green-400">
                <Zap size={9} />Active build
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-text-primary leading-snug">{idea.name}</p>
          <p className="text-xxs text-text-muted mt-0.5 leading-relaxed">{idea.tagline}</p>
        </div>
      </div>

      {/* Scores */}
      <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded bg-base border border-border-subtle">
        <ScoreBar label="Market size"   value={idea.scores.market}      />
        <ScoreBar label="Competition"   value={idea.scores.competition} invert />
        <ScoreBar label="Build effort"  value={idea.scores.effort}      invert />
      </div>

      {/* Tags */}
      {idea.tags && idea.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {idea.tags.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">#{t}</span>
          ))}
        </div>
      )}

      {/* Research summary toggle */}
      {idea.researchSummary && (
        <div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xxs text-text-muted hover:text-text-secondary transition-colors"
          >
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Research summary
          </button>
          {expanded && (
            <p className="mt-2 text-xxs text-text-secondary leading-relaxed px-3 py-2 rounded bg-base border border-border-subtle">
              {idea.researchSummary}
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-subtle">
        <div className="flex items-center gap-1.5">
          {idea.agentName && (
            <div className={clsx('w-4 h-4 rounded-full flex items-center justify-center text-white text-xxs font-bold bg-gradient-to-br', agentColor(idea.agentName))}>
              {idea.agentName[0]}
            </div>
          )}
          {idea.agentName && <span className="text-xxs text-text-muted">{idea.agentName}</span>}
        </div>
        <span className="text-xxs text-text-muted">{idea.createdAgo}</span>
      </div>
    </div>
  )
}

// ─── Main view ──────────────────────────────────────────────────────────────────

export function Factory() {
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')

  const filtered = factoryIdeas.filter(idea =>
    statusFilter === 'all' || idea.status === statusFilter
  )

  const counts = Object.fromEntries(
    STATUSES.map(s => [s, factoryIdeas.filter(i => i.status === s).length])
  ) as Record<IdeaStatus, number>

  const avgViability = factoryIdeas.length > 0
    ? (factoryIdeas.reduce((sum, i) => sum + i.scores.viability, 0) / factoryIdeas.length).toFixed(1)
    : '—'

  const building = factoryIdeas.filter(i => i.status === 'building').length
  const qualified = factoryIdeas.filter(i => i.status === 'qualified').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Factory</h1>
          <p className="text-xs text-text-muted mt-0.5">
            <span className="text-text-secondary">{factoryIdeas.length} ideas tracked</span>
            {building > 0 && <>&nbsp;·&nbsp;<span className="text-green-400">{building} building</span></>}
            {qualified > 0 && <>&nbsp;·&nbsp;<span className="text-violet-400">{qualified} qualified</span></>}
          </p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium">
          <Plus size={13} />New Idea
        </button>
      </div>

      {/* Stat strip */}
      <div className="flex items-center gap-5 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <Target size={12} className="text-violet-400" />
          <span className="text-xxs text-text-muted">Avg viability</span>
          <span className="text-xs font-semibold text-text-primary">{avgViability}</span>
        </div>
        <div className="w-px h-3.5 bg-border" />
        <div className="flex items-center gap-1.5 shrink-0">
          <Flame size={12} className="text-green-400" />
          <span className="text-xxs text-text-muted">Active builds</span>
          <span className="text-xs font-semibold text-green-400">{building}</span>
        </div>
        <div className="w-px h-3.5 bg-border" />
        <div className="flex items-center gap-1.5 shrink-0">
          <TrendingUp size={12} className="text-amber-400" />
          <span className="text-xxs text-text-muted">Qualified</span>
          <span className="text-xs font-semibold text-amber-400">{qualified}</span>
        </div>
        <div className="w-px h-3.5 bg-border" />
        <div className="flex items-center gap-1.5 shrink-0">
          <Cpu size={12} className="text-text-muted" />
          <span className="text-xxs text-text-muted">Researching</span>
          <span className="text-xs font-semibold text-text-secondary">{counts.researching}</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border shrink-0">
        <button
          onClick={() => setStatusFilter('all')}
          className={clsx('px-2.5 py-1 rounded text-xs font-medium transition-all',
            statusFilter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
        >
          All
          <span className="ml-1 text-xxs opacity-60">{factoryIdeas.length}</span>
        </button>
        {STATUSES.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s === statusFilter ? 'all' : s)}
            className={clsx('flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all',
              statusFilter === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full', statusConfig[s].dot)} />
            {statusConfig[s].label}
            <span className="text-xxs opacity-60">{counts[s]}</span>
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <Zap size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">No ideas match this filter</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(idea => <IdeaCard key={idea.id} idea={idea} />)}
          </div>
        )}
      </div>
    </div>
  )
}
