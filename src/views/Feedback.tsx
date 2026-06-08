// title: Feedback — real inbound messages people send the agents
// path: src/views/Feedback.tsx
// purpose: A feed of what users actually say TO the agents (real message:received
//          events), with a transparent keyword-based sentiment tag. Replaces the
//          old mock testimonials.

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { ThumbsUp, ThumbsDown, MessageSquare, Search, RefreshCw, Hash, Clock, Info } from 'lucide-react'
import { inboundApi, type InboundMessage, type InboundSentiment } from '../lib/api'

const sentimentConfig: Record<InboundSentiment, { label: string; icon: React.ReactNode; text: string; badge: string; bar: string }> = {
  positive: { label: 'Positive', icon: <ThumbsUp size={11} />,      text: 'text-green-400', badge: 'bg-green-950/30 border-green-900/40 text-green-300', bar: 'bg-green-500' },
  neutral:  { label: 'Neutral',  icon: <MessageSquare size={11} />, text: 'text-text-muted', badge: 'bg-card border-border text-text-muted',           bar: 'bg-text-muted' },
  negative: { label: 'Negative', icon: <ThumbsDown size={11} />,    text: 'text-red-400',   badge: 'bg-red-950/30 border-red-900/40 text-red-300',     bar: 'bg-red-500' },
}
const SENTIMENTS: InboundSentiment[] = ['positive', 'neutral', 'negative']

const AVATAR = ['from-violet-500 to-indigo-600', 'from-blue-500 to-cyan-600', 'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600', 'from-teal-500 to-green-600']
function avatarColor(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return AVATAR[Math.abs(h) % AVATAR.length] }
function initials(name: string) { const w = name.trim().split(/\s+/); return (w.length >= 2 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase() }

function MsgCard({ m }: { m: InboundMessage }) {
  const sc = sentimentConfig[m.sentiment]
  return (
    <div className={clsx('flex gap-3 p-3.5 rounded-lg border bg-card hover:bg-card-hover transition-all',
      m.sentiment === 'negative' ? 'border-red-900/30' : m.sentiment === 'positive' ? 'border-green-900/30' : 'border-border')}>
      <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-white text-xxs font-bold bg-gradient-to-br shrink-0', avatarColor(m.sender))}>
        {initials(m.sender)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-xs font-semibold text-text-primary">{m.sender}</span>
          <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs', sc.badge)}>{sc.icon}{sc.label}</span>
          <span className="flex items-center gap-0.5 text-xxs text-text-muted"><Hash size={9} />{m.channel}</span>
          <span className="ml-auto flex items-center gap-1 text-xxs text-text-muted shrink-0"><Clock size={9} />{m.tsAgo}</span>
        </div>
        <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap break-words">{m.content}</p>
      </div>
    </div>
  )
}

export function Feedback() {
  const [msgs, setMsgs]       = useState<InboundMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [query, setQuery]     = useState('')
  const [filter, setFilter]   = useState<InboundSentiment | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [oc, hm] = await Promise.allSettled([inboundApi.openclaw(), inboundApi.hermes()])
      const all: InboundMessage[] = []
      if (oc.status === 'fulfilled') all.push(...oc.value.inbound)
      if (hm.status === 'fulfilled') all.push(...hm.value.inbound)
      all.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      setMsgs(all)
      if (oc.status === 'rejected' && hm.status === 'rejected') setError('Could not load inbound messages.')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const counts = Object.fromEntries(SENTIMENTS.map(s => [s, msgs.filter(m => m.sentiment === s).length])) as Record<InboundSentiment, number>
  const filtered = msgs.filter(m => {
    if (filter !== 'all' && m.sentiment !== filter) return false
    const q = query.trim().toLowerCase()
    return !q || m.content.toLowerCase().includes(q) || m.sender.toLowerCase().includes(q)
  })
  const total = msgs.length || 1
  const posPct = Math.round((counts.positive / total) * 100)
  const negPct = Math.round((counts.negative / total) * 100)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Feedback</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading ? 'Loading…' : error ? <span className="text-red-400">{error}</span>
              : <>{msgs.length} inbound messages · <span className="text-green-400">{posPct}% positive</span> · <span className="text-red-400">{negPct}% negative</span></>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Sentiment bar + heuristic note */}
      {!loading && msgs.length > 0 && (
        <div className="flex items-center gap-3 px-6 py-2.5 border-b border-border shrink-0">
          <div className="flex-1 max-w-md h-2 rounded-full overflow-hidden flex bg-base">
            <div className="bg-green-500" style={{ width: `${(counts.positive / total) * 100}%` }} />
            <div className="bg-text-muted/50" style={{ width: `${(counts.neutral / total) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(counts.negative / total) * 100}%` }} />
          </div>
          <span className="flex items-center gap-1 text-xxs text-text-muted" title="Sentiment is a transparent keyword heuristic, not an LLM judge.">
            <Info size={10} /> heuristic sentiment
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search feedback…"
            className="w-full pl-7 pr-3 py-1.5 rounded border border-border bg-card text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-border" />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setFilter('all')}
            className={clsx('px-2.5 py-1 rounded text-xs font-medium transition-all', filter === 'all' ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            All <span className="ml-1 text-xxs opacity-60">{msgs.length}</span>
          </button>
          {SENTIMENTS.map(s => (
            <button key={s} onClick={() => setFilter(s === filter ? 'all' : s)}
              className={clsx('flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all',
                filter === s ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
              <span className={sentimentConfig[s].text}>{sentimentConfig[s].icon}</span>
              {sentimentConfig[s].label} <span className="text-xxs opacity-60">{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex flex-col gap-2 max-w-3xl">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <MessageSquare size={22} className="text-text-muted" />
            <p className="text-sm text-text-secondary">{msgs.length === 0 ? 'No inbound messages yet' : 'No messages match'}</p>
            <p className="text-xs text-text-muted max-w-sm">Messages people send your agents appear here with an at-a-glance sentiment read.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl">
            {filtered.map(m => <MsgCard key={`${m.source}:${m.id}`} m={m} />)}
          </div>
        )}
      </div>
    </div>
  )
}
