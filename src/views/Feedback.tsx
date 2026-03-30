import { useState } from 'react'
import { clsx } from 'clsx'
import { ThumbsUp, ThumbsDown, Star, MessageSquare, Filter } from 'lucide-react'
import { feedbackItems } from '../data/mockData'
import type { FeedbackItem, FeedbackSentiment, FeedbackSource, FeedbackStatus } from '../types'

// ─── Config ────────────────────────────────────────────────────────────────────

const sentimentConfig: Record<FeedbackSentiment, { label: string; icon: React.ReactNode; color: string; border: string; bg: string }> = {
  positive: { label: 'Positive', icon: <ThumbsUp  size={11} />, color: 'text-green-400',  border: 'border-green-900/40', bg: 'bg-green-950/20'  },
  neutral:  { label: 'Neutral',  icon: <MessageSquare size={11} />, color: 'text-text-muted',  border: 'border-border',       bg: ''                 },
  negative: { label: 'Negative', icon: <ThumbsDown size={11} />, color: 'text-red-400',    border: 'border-red-900/40',   bg: 'bg-red-950/20'    },
}

const sourceConfig: Record<FeedbackSource, { label: string; color: string }> = {
  email:   { label: 'Email',   color: 'text-blue-400   bg-blue-950/40   border-blue-900/40'   },
  twitter: { label: 'Twitter', color: 'text-sky-400    bg-sky-950/40    border-sky-900/40'    },
  direct:  { label: 'Direct',  color: 'text-violet-400 bg-violet-950/40 border-violet-900/40' },
  form:    { label: 'Form',    color: 'text-amber-400  bg-amber-950/40  border-amber-900/40'  },
  slack:   { label: 'Slack',   color: 'text-green-400  bg-green-950/40  border-green-900/40'  },
}

const statusOrder: FeedbackStatus[] = ['new', 'actioned', 'reviewed', 'archived']

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(n => (
        <Star
          key={n}
          size={10}
          className={n <= rating ? 'text-amber-400 fill-amber-400' : 'text-border'}
        />
      ))}
    </div>
  )
}

function StatusDot({ status }: { status: FeedbackStatus }) {
  const colors: Record<FeedbackStatus, string> = {
    new:      'bg-violet-400',
    reviewed: 'bg-blue-400',
    actioned: 'bg-green-400',
    archived: 'bg-slate-600',
  }
  const labels: Record<FeedbackStatus, string> = {
    new: 'New', reviewed: 'Reviewed', actioned: 'Actioned', archived: 'Archived',
  }
  return (
    <span className="flex items-center gap-1 text-xxs text-text-muted">
      <span className={clsx('w-1.5 h-1.5 rounded-full', colors[status])} />
      {labels[status]}
    </span>
  )
}

function FeedbackCard({ item }: { item: FeedbackItem }) {
  const sm = sentimentConfig[item.sentiment]
  const src = sourceConfig[item.source]

  return (
    <div className={clsx('flex flex-col gap-3 p-4 rounded-lg border transition-all', sm.border, sm.bg || 'bg-card')}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={clsx('flex items-center gap-1 text-xxs font-medium', sm.color)}>
            {sm.icon}{sm.label}
          </span>
          <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium', src.color)}>
            {src.label}
          </span>
          {item.status === 'new' && (
            <span className="px-1.5 py-0.5 rounded border border-violet-900/40 bg-violet-950/30 text-violet-400 text-xxs font-semibold">
              New
            </span>
          )}
        </div>
        {item.rating !== undefined && <StarRow rating={item.rating} />}
      </div>

      {/* Quote */}
      <blockquote className="text-xs text-text-primary leading-relaxed border-l-2 border-border-strong pl-3 italic">
        "{item.quote}"
      </blockquote>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {item.tags.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">#{t}</span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          {item.author && (
            <span className="text-xxs text-text-secondary font-medium">
              {item.authorHandle ? `@${item.authorHandle}` : item.author}
            </span>
          )}
          {item.project && (
            <span className="text-xxs text-text-muted">{item.project}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusDot status={item.status} />
          <span className="text-xxs text-text-muted">{item.receivedAgo}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main view ──────────────────────────────────────────────────────────────────

type SentimentFilter = FeedbackSentiment | 'all'
type SourceFilter    = FeedbackSource    | 'all'

export function Feedback() {
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [sourceFilter, setSourceFilter]       = useState<SourceFilter>('all')
  const [showArchived, setShowArchived]        = useState(false)

  const visible = feedbackItems.filter(item => {
    if (!showArchived && item.status === 'archived') return false
    if (sentimentFilter !== 'all' && item.sentiment !== sentimentFilter) return false
    if (sourceFilter !== 'all' && item.source !== sourceFilter) return false
    return true
  })

  const grouped = statusOrder.reduce<Record<FeedbackStatus, FeedbackItem[]>>((acc, s) => {
    acc[s] = visible.filter(i => i.status === s)
    return acc
  }, {} as Record<FeedbackStatus, FeedbackItem[]>)

  const newCount      = feedbackItems.filter(i => i.status === 'new').length
  const positiveCount = feedbackItems.filter(i => i.sentiment === 'positive').length
  const negativeCount = feedbackItems.filter(i => i.sentiment === 'negative').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Feedback</h1>
          <p className="text-xs text-text-muted mt-0.5">
            <span className="text-text-secondary">{feedbackItems.length} total</span>
            {newCount > 0 && <>&nbsp;·&nbsp;<span className="text-violet-400">{newCount} new</span></>}
            &nbsp;·&nbsp;<span className="text-green-400">{positiveCount} positive</span>
            {negativeCount > 0 && <>&nbsp;·&nbsp;<span className="text-red-400">{negativeCount} negative</span></>}
          </p>
        </div>
        <button
          onClick={() => setShowArchived(v => !v)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-all',
            showArchived
              ? 'border-border-strong bg-card-hover text-text-primary'
              : 'border-border bg-card text-text-muted hover:text-text-secondary',
          )}
        >
          <Filter size={12} />
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-border shrink-0 flex-wrap">
        {/* Sentiment */}
        <div className="flex items-center gap-1">
          {(['all', 'positive', 'neutral', 'negative'] as SentimentFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setSentimentFilter(s === sentimentFilter ? 'all' : s)}
              className={clsx('px-2.5 py-1 rounded text-xs font-medium capitalize transition-all',
                sentimentFilter === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
            >
              {s === 'all' ? 'All sentiment' : s}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        {/* Source */}
        <div className="flex items-center gap-1">
          {(['all', 'email', 'form', 'twitter', 'slack', 'direct'] as (SourceFilter)[]).map(s => (
            <button
              key={s}
              onClick={() => setSourceFilter(s === sourceFilter ? 'all' : s as SourceFilter)}
              className={clsx('px-2.5 py-1 rounded text-xs font-medium capitalize transition-all',
                sourceFilter === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}
            >
              {s === 'all' ? 'All sources' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped list */}
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-6">
        {statusOrder
          .filter(s => grouped[s].length > 0)
          .map(s => (
            <div key={s}>
              <p className="text-xxs font-semibold text-text-muted uppercase tracking-widest mb-3">
                {s === 'new' ? 'New' : s === 'actioned' ? 'Actioned' : s === 'reviewed' ? 'Reviewed' : 'Archived'}
                <span className="ml-2 normal-case font-normal opacity-60">{grouped[s].length}</span>
              </p>
              <div className="flex flex-col gap-2">
                {grouped[s].map(item => <FeedbackCard key={item.id} item={item} />)}
              </div>
            </div>
          ))}
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40">
            <MessageSquare size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">No feedback matches</span>
          </div>
        )}
      </div>
    </div>
  )
}
