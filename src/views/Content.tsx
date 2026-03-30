import { useState } from 'react'
import { clsx } from 'clsx'
import { Plus, Calendar, Clock, FileText, Youtube, Mail, Twitter, Linkedin } from 'lucide-react'
import { contentItems } from '../data/mockData'
import type { ContentChannel, ContentStatus } from '../types'

// ─── Config ────────────────────────────────────────────────────────────────────

const channelConfig: Record<ContentChannel, {
  label: string
  icon: React.ReactNode
  badge: string
  dot: string
}> = {
  youtube:    { label: 'YouTube',    icon: <Youtube    size={12} />, badge: 'bg-red-950/50 border-red-900/50 text-red-400',     dot: 'bg-red-400'    },
  newsletter: { label: 'Newsletter', icon: <Mail       size={12} />, badge: 'bg-amber-950/50 border-amber-900/50 text-amber-400', dot: 'bg-amber-400'  },
  twitter:    { label: 'Twitter',    icon: <Twitter    size={12} />, badge: 'bg-blue-950/50 border-blue-900/50 text-blue-400',   dot: 'bg-blue-400'   },
  linkedin:   { label: 'LinkedIn',   icon: <Linkedin   size={12} />, badge: 'bg-indigo-950/50 border-indigo-900/50 text-indigo-400', dot: 'bg-indigo-400' },
}

const statusConfig: Record<ContentStatus, {
  label: string
  badge: string
  col: string
}> = {
  draft:     { label: 'Draft',     badge: 'bg-card border-border text-text-muted',              col: 'border-border'       },
  scheduled: { label: 'Scheduled', badge: 'bg-blue-950/50 border-blue-900/50 text-blue-400',   col: 'border-blue-900/30'  },
  published: { label: 'Published', badge: 'bg-green-950/50 border-green-900/50 text-green-400', col: 'border-green-900/30' },
  live:      { label: 'Live',      badge: 'bg-red-950/50 border-red-900/50 text-red-400',       col: 'border-red-900/30'   },
}

function agentColor(name?: string) {
  const map: Record<string, string> = {
    Claude: 'from-violet-500 to-indigo-600',
    Scout:  'from-teal-500 to-cyan-600',
    Quill:  'from-blue-500 to-sky-600',
    Forge:  'from-emerald-500 to-green-600',
  }
  return name ? (map[name] ?? 'from-slate-600 to-slate-700') : 'from-slate-700 to-slate-800'
}

type FilterChannel = ContentChannel | 'all'
type FilterStatus  = ContentStatus  | 'all'

const STATUSES: ContentStatus[] = ['draft', 'scheduled', 'published', 'live']

// ─── Content card ──────────────────────────────────────────────────────────────

function ContentCard({ item }: { item: typeof contentItems[0] }) {
  const ch = channelConfig[item.channel]
  const st = statusConfig[item.status]

  return (
    <div className="group flex flex-col gap-3 p-4 bg-card border border-border rounded-lg hover:bg-card-hover hover:border-border transition-all cursor-pointer">
      {/* Top */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-semibold', ch.badge)}>
            {ch.icon}
            {ch.label}
          </span>
          <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-semibold', st.badge)}>
            {st.label}
          </span>
        </div>
        {item.wordCount !== undefined && item.wordCount > 0 && (
          <span className="text-xxs text-text-muted tabular-nums">{item.wordCount.toLocaleString()} words</span>
        )}
      </div>

      {/* Title */}
      <p className="text-xs font-semibold text-text-primary leading-snug line-clamp-2">{item.title}</p>

      {/* Notes */}
      {item.notes && (
        <p className="text-xxs text-amber-400 italic">{item.notes}</p>
      )}

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {item.tags.map(t => (
            <span key={t} className="px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">#{t}</span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border-subtle">
        <div className="flex items-center gap-1.5">
          {item.agentName && (
            <div className={clsx('w-4 h-4 rounded-full flex items-center justify-center text-white text-xxs font-bold bg-gradient-to-br', agentColor(item.agentName))}>
              {item.agentName[0]}
            </div>
          )}
          {item.project && <span className="text-xxs text-text-muted truncate">{item.project}</span>}
        </div>
        <div className="flex items-center gap-1 text-text-muted shrink-0">
          {item.scheduledFor ? (
            <>
              <Calendar size={9} />
              <span className="text-xxs">{item.scheduledFor}</span>
            </>
          ) : item.publishedAgo ? (
            <>
              <Clock size={9} />
              <span className="text-xxs">{item.publishedAgo}</span>
            </>
          ) : (
            <span className="text-xxs italic">No date set</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main view ─────────────────────────────────────────────────────────────────

export function Content() {
  const [channelFilter, setChannelFilter] = useState<FilterChannel>('all')
  const [statusFilter,  setStatusFilter]  = useState<FilterStatus>('all')

  const filtered = contentItems.filter(item => {
    const matchCh = channelFilter === 'all' || item.channel === channelFilter
    const matchSt = statusFilter  === 'all' || item.status  === statusFilter
    return matchCh && matchSt
  })

  const counts = {
    channel: Object.fromEntries(
      (['youtube','newsletter','twitter','linkedin'] as ContentChannel[]).map(ch => [
        ch, contentItems.filter(i => i.channel === ch).length,
      ])
    ) as Record<ContentChannel, number>,
    status: Object.fromEntries(
      STATUSES.map(s => [s, contentItems.filter(i => i.status === s).length])
    ) as Record<ContentStatus, number>,
  }

  const pendingPublish = contentItems.filter(i => i.status === 'scheduled').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Content</h1>
          <p className="text-xs text-text-muted mt-0.5">
            <span className="text-text-secondary">{contentItems.length} pieces</span>
            &nbsp;·&nbsp;<span className="text-blue-400">{pendingPublish} scheduled</span>
            &nbsp;·&nbsp;<span className="text-text-secondary">{counts.status.draft} drafts</span>
          </p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs font-medium">
          <Plus size={13} />New Content
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-border shrink-0 flex-wrap">
        {/* Channel */}
        <div className="flex items-center gap-1">
          <button onClick={() => setChannelFilter('all')}
            className={clsx('px-2.5 py-1 rounded text-xs font-medium transition-all',
              channelFilter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            All
          </button>
          {(['youtube','newsletter','twitter','linkedin'] as ContentChannel[]).map(ch => (
            <button key={ch} onClick={() => setChannelFilter(ch === channelFilter ? 'all' : ch)}
              className={clsx('flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all',
                channelFilter === ch
                  ? clsx('text-text-primary bg-card-hover')
                  : 'text-text-muted hover:text-text-secondary')}>
              {channelConfig[ch].icon}
              <span>{channelConfig[ch].label}</span>
              <span className="text-xxs opacity-60">{counts.channel[ch]}</span>
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-border" />
        {/* Status */}
        <div className="flex items-center gap-1">
          {(['all', ...STATUSES] as (FilterStatus)[]).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={clsx('px-2.5 py-1 rounded text-xs font-medium capitalize transition-all',
                statusFilter === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              {s === 'all' ? 'All Status' : statusConfig[s as ContentStatus].label}
              {s !== 'all' && <span className="ml-1 text-xxs opacity-60">{counts.status[s as ContentStatus]}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40">
            <FileText size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">No content matches this filter</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(item => <ContentCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  )
}
