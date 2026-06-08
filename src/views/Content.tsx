// title: Content — real agent-published output
// path: src/views/Content.tsx
// purpose: A feed of the content the agents actually produce and deliver
//          (briefings, status reports, digests, replies) from real event data,
//          replacing the old mock content pipeline.

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  FileText, Search, RefreshCw, ChevronDown, ChevronRight, Hash, Clock, Sun, Activity, HeartPulse, Sparkles, MessageSquare,
} from 'lucide-react'
import { publicationsApi, type AgentPublication } from '../lib/api'

function typeMeta(type: string): { icon: React.ReactNode; badge: string } {
  const t = type.toLowerCase()
  if (t.includes('morning') || t.includes('brief')) return { icon: <Sun size={11} />,       badge: 'bg-amber-950/50 border-amber-900/50 text-amber-300' }
  if (t.includes('status'))                         return { icon: <Activity size={11} />,  badge: 'bg-blue-950/50 border-blue-900/50 text-blue-300' }
  if (t.includes('heartbeat') || t.includes('health')) return { icon: <HeartPulse size={11} />, badge: 'bg-green-950/50 border-green-900/50 text-green-300' }
  if (t.includes('digest') || t.includes('recap'))  return { icon: <Sparkles size={11} />,  badge: 'bg-violet-950/50 border-violet-900/50 text-violet-300' }
  if (t === 'reply')                                return { icon: <MessageSquare size={11} />, badge: 'bg-card border-border text-text-muted' }
  return { icon: <FileText size={11} />, badge: 'bg-card border-border text-text-secondary' }
}

const channelStyle: Record<string, string> = {
  discord: 'text-violet-300', telegram: 'text-sky-300', cron: 'text-amber-300', main: 'text-text-muted',
}

function Markdownish({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs text-text-secondary leading-relaxed">
      {text.split('\n').map((line, i) => {
        const t = line.trim()
        if (!t) return <div key={i} className="h-1.5" />
        if (/^#{1,3}\s/.test(t)) return <p key={i} className="font-semibold text-text-primary mt-1">{t.replace(/^#{1,3}\s/, '')}</p>
        if (/^[-*•]\s/.test(t))  return <div key={i} className="flex gap-1.5"><span className="opacity-40 mt-0.5">·</span><span>{t.replace(/^[-*•]\s/, '')}</span></div>
        if (/^\d+[.)]\s/.test(t)) return <div key={i} className="flex gap-1.5"><span className="opacity-50 tabular-nums">{t.match(/^\d+/)?.[0]}.</span><span>{t.replace(/^\d+[.)]\s/, '')}</span></div>
        return <p key={i}>{t}</p>
      })}
    </div>
  )
}

function PubCard({ pub }: { pub: AgentPublication }) {
  const [open, setOpen] = useState(false)
  const tm = typeMeta(pub.type)
  return (
    <div className="rounded-lg border border-border bg-card hover:border-border transition-all">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-3 p-3.5 text-left">
        <div className="mt-0.5 text-text-muted shrink-0">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded border text-xxs font-medium', tm.badge)}>{tm.icon}{pub.type}</span>
            <span className={clsx('flex items-center gap-0.5 text-xxs', channelStyle[pub.channel] ?? 'text-text-muted')}><Hash size={9} />{pub.channel}</span>
            <span className="text-xxs text-text-muted">· {pub.wordCount} words</span>
            <span className="ml-auto flex items-center gap-1 text-xxs text-text-muted shrink-0"><Clock size={9} />{pub.tsAgo}</span>
          </div>
          <p className="text-sm font-medium text-text-primary leading-snug truncate">{pub.title}</p>
          {!open && <p className="text-xxs text-text-muted line-clamp-2 mt-1 leading-relaxed">{pub.preview}</p>}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-11 border-t border-border-subtle pt-3">
          <Markdownish text={pub.content} />
        </div>
      )}
    </div>
  )
}

export function Content() {
  const [pubs, setPubs]       = useState<AgentPublication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [query, setQuery]     = useState('')
  const [type, setType]       = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [oc, hm] = await Promise.allSettled([publicationsApi.openclaw(), publicationsApi.hermes()])
      const all: AgentPublication[] = []
      if (oc.status === 'fulfilled') all.push(...oc.value.publications)
      if (hm.status === 'fulfilled') all.push(...hm.value.publications)
      all.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      setPubs(all)
      if (oc.status === 'rejected' && hm.status === 'rejected') setError('Could not load published content.')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const types = ['all', ...Array.from(new Set(pubs.map(p => p.type)))]
  const filtered = pubs.filter(p => {
    if (type !== 'all' && p.type !== type) return false
    const q = query.trim().toLowerCase()
    return !q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
  })
  const totalWords = pubs.reduce((s, p) => s + p.wordCount, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Content</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading ? 'Loading…' : error ? <span className="text-red-400">{error}</span>
              : <>{pubs.length} pieces your agents published · {totalWords.toLocaleString()} words</>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0 overflow-x-auto">
        <div className="relative flex-1 max-w-xs shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search content…"
            className="w-full pl-7 pr-3 py-1.5 rounded border border-border bg-card text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-border" />
        </div>
        {types.length > 1 && (
          <div className="flex items-center gap-1">
            {types.map(t => (
              <button key={t} onClick={() => setType(t)}
                className={clsx('px-2.5 py-1 rounded text-xs font-medium transition-all shrink-0 capitalize',
                  type === t ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {t === 'all' ? 'All' : t}{t !== 'all' && <span className="ml-1 text-xxs opacity-60">{pubs.filter(p => p.type === t).length}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex flex-col gap-2 max-w-3xl">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 rounded-lg border border-border bg-card animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <FileText size={22} className="text-text-muted" />
            <p className="text-sm text-text-secondary">{pubs.length === 0 ? 'No published content yet' : 'No content matches'}</p>
            <p className="text-xs text-text-muted max-w-sm">Briefings, status reports, digests and replies your agents publish appear here automatically.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl">
            {filtered.map(p => <PubCard key={`${p.source}:${p.id}`} pub={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}
