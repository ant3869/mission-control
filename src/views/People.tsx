// title: People — real conversation participants
// path: src/views/People.tsx
// purpose: A real contacts directory derived from who actually interacts with the
//          agents (OpenClaw / Hermes event senders), replacing the old mock list.

import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { Search, RefreshCw, MessageSquare, Hash, Users, Clock } from 'lucide-react'
import { peopleApi, type AgentPerson } from '../lib/api'

const AVATAR = [
  'from-violet-500 to-indigo-600', 'from-blue-500 to-cyan-600', 'from-teal-500 to-green-600',
  'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600', 'from-fuchsia-500 to-purple-600',
]
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
function avatarColor(id: string) { return AVATAR[hash(id) % AVATAR.length] }
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

const PLATFORM_STYLE: Record<string, string> = {
  discord:  'text-violet-300 bg-violet-950/40 border-violet-900/50',
  telegram: 'text-sky-300 bg-sky-950/40 border-sky-900/50',
  slack:    'text-green-300 bg-green-950/40 border-green-900/50',
  webchat:  'text-blue-300 bg-blue-950/40 border-blue-900/50',
  unknown:  'text-text-muted bg-card border-border',
}
function platformStyle(p: string) { return PLATFORM_STYLE[p] ?? PLATFORM_STYLE.unknown }

function PersonCard({ p }: { p: AgentPerson }) {
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card hover:bg-card-hover transition-all">
      <div className="flex items-start gap-3">
        <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold bg-gradient-to-br shrink-0', avatarColor(p.id))}>
          {initials(p.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-text-primary leading-tight truncate">{p.name}</p>
            <span className={clsx('px-1.5 py-0.5 rounded border text-xxs font-medium capitalize', platformStyle(p.platform))}>
              {p.platform}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xxs text-text-muted">
            <span className="flex items-center gap-1"><MessageSquare size={10} />{p.messageCount} msg{p.messageCount === 1 ? '' : 's'}</span>
            <span className="flex items-center gap-1"><Clock size={10} />{p.lastSeenAgo}</span>
          </div>
        </div>
      </div>

      {p.channels.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap border-t border-border-subtle pt-2.5">
          {p.channels.map(c => (
            <span key={c} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-base border border-border-subtle text-xxs text-text-muted">
              <Hash size={8} />{c.replace(/^#/, '')}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border-subtle text-xxs text-text-muted">
        <span>Known via {p.source}</span>
        <span title={new Date(p.firstSeen).toLocaleString()}>since {new Date(p.firstSeen).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

export function People() {
  const [list, setList]       = useState<AgentPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [query, setQuery]     = useState('')
  const [platform, setPlatform] = useState<string>('all')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [oc, hm] = await Promise.allSettled([peopleApi.openclaw(), peopleApi.hermes()])
      const people: AgentPerson[] = []
      if (oc.status === 'fulfilled') people.push(...oc.value.people)
      if (hm.status === 'fulfilled') people.push(...hm.value.people)
      // De-dup across sources by id, keeping the most recently seen.
      const byId = new Map<string, AgentPerson>()
      for (const p of people) {
        const prev = byId.get(p.id)
        if (!prev || new Date(p.lastSeen) > new Date(prev.lastSeen)) byId.set(p.id, p)
      }
      setList([...byId.values()].sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()))
      if (oc.status === 'rejected' && hm.status === 'rejected') setError('Could not load people from any connected agent.')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const platforms = ['all', ...Array.from(new Set(list.map(p => p.platform)))]
  const filtered = list.filter(p => {
    if (platform !== 'all' && p.platform !== platform) return false
    const q = query.trim().toLowerCase()
    return !q || p.name.toLowerCase().includes(q) || p.channels.some(c => c.toLowerCase().includes(q))
  })
  const totalMsgs = list.reduce((s, p) => s + p.messageCount, 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">People</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading ? 'Loading…' : error ? <span className="text-red-400">{error}</span>
              : <>{list.length} {list.length === 1 ? 'person has' : 'people have'} interacted with your agents · {totalMsgs} messages</>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people…"
            className="w-full pl-7 pr-3 py-1.5 rounded border border-border bg-card text-xs text-text-primary placeholder-text-muted focus:outline-none focus:border-border" />
        </div>
        {platforms.length > 1 && (
          <div className="flex items-center gap-1">
            {platforms.map(pf => (
              <button key={pf} onClick={() => setPlatform(pf)}
                className={clsx('px-2.5 py-1 rounded text-xs font-medium capitalize transition-all',
                  platform === pf ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {pf}{pf !== 'all' && <span className="ml-1 text-xxs opacity-60">{list.filter(p => p.platform === pf).length}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 rounded-lg border border-border bg-card animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
            <Users size={22} className="text-text-muted" />
            <p className="text-sm text-text-secondary">{list.length === 0 ? 'No one has messaged your agents yet' : 'No people match'}</p>
            <p className="text-xs text-text-muted max-w-sm">People appear here automatically as they interact with OpenClaw / Hermes across Discord, Telegram, and other channels.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map(p => <PersonCard key={`${p.source}:${p.id}`} p={p} />)}
          </div>
        )}
      </div>
    </div>
  )
}
