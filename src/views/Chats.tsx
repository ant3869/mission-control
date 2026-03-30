// title: Combined Claude + OpenClaw chats view
// path: client/views/Chats.tsx
// purpose: Show Claude and OpenClaw sessions on the same page in grouped sections.

import { useState, useEffect, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { MessageSquare, Clock, Hash, Search, Activity, FolderOpen, RefreshCw, AlertCircle } from 'lucide-react'
import { chats, openclawChats, type LiveSession, type LiveChatMessage } from '../lib/api'

// if you already have CombinedSession / openclawChats, keep those types/imports
type SessionSource = 'claude' | 'openclaw'
type CombinedSession = LiveSession & { source: SessionSource }

const POLL_MS = 3000

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

function relativeTime(iso: string) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  const hrs  = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hrs  < 24) return `${hrs}h ago`
  if (days < 7)  return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function projectLabel(slug: string) {
  return slug.replace(/^-/, '').replace(/-/g, '/').slice(0, 32)
}

function sourceKey(session: Pick<CombinedSession, 'id' | 'source'>) {
  return `${session.source}:${session.id}`
}

function sourceLabel(source: SessionSource) {
  return source === 'claude' ? 'Claude' : 'Claw'
}

function sourceBadge(source: SessionSource) {
  return source === 'claude' ? 'C' : 'O'
}

function sourceAvatar(source: SessionSource, id: string) {
  const claude = [
    'from-violet-500 to-indigo-600',
    'from-blue-500 to-cyan-600',
    'from-teal-500 to-green-600',
  ]
  const claw = [
    'from-amber-500 to-orange-600',
    'from-rose-500 to-red-600',
    'from-fuchsia-500 to-pink-600',
  ]
  const palette = source === 'claude' ? claude : claw
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}

function sourceChipClass(source: SessionSource) {
  return source === 'claude'
    ? 'bg-violet-950/40 border-violet-900/40 text-violet-300'
    : 'bg-amber-950/40 border-amber-900/40 text-amber-300'
}

function sourceDotClass(source: SessionSource) {
  return source === 'claude' ? 'bg-violet-400' : 'bg-amber-400'
}

function SessionItem({ session, isActive, onClick }: {
  session: CombinedSession
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-3 py-3 rounded border transition-all',
        isActive
          ? 'bg-card-hover border-border text-text-primary'
          : 'border-transparent hover:bg-card text-text-secondary',
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={clsx(
          'w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-white text-xxs font-bold mt-0.5 bg-gradient-to-br',
          sourceAvatar(session.source, session.id),
        )}>
          {sourceBadge(session.source)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <span className={clsx(
              'text-xs font-semibold truncate',
              isActive ? 'text-text-primary' : 'text-text-secondary',
            )}>
              {session.title || 'Untitled session'}
            </span>
            <span className="text-xxs text-text-muted shrink-0">{relativeTime(session.lastActiveAt)}</span>
          </div>

          <p className="text-xxs text-text-muted line-clamp-2 leading-relaxed mb-1">
            {session.firstMessage}
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <span className={clsx('px-1.5 py-0.5 rounded border text-xxs', sourceChipClass(session.source))}>
              {sourceLabel(session.source)}
            </span>

            <span className="text-xxs text-text-muted">
              {session.messageCount} msgs
            </span>

            {(session.inputTokens + session.outputTokens) > 0 && (
              <span className="text-xxs text-text-muted">
                · {fmt(session.inputTokens + session.outputTokens)} tok
              </span>
            )}

            {session.projectSlug && (
              <span className="px-1.5 py-0.5 rounded bg-base border border-border text-xxs text-text-muted truncate max-w-[120px]">
                {projectLabel(session.projectSlug)}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}

function MessageBubble({ msg, assistantBadge }: {
  msg: LiveChatMessage
  assistantBadge: string
}) {
  const isUser = msg.role === 'user'
  const lines = msg.content.split('\n')

  return (
    <div className={clsx('flex gap-2.5 mb-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={clsx(
        'w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xxs font-bold text-white mt-0.5',
        isUser ? 'bg-gradient-to-br from-violet-500 to-indigo-600' : 'bg-gradient-to-br from-blue-600 to-cyan-700',
      )}>
        {isUser ? 'A' : assistantBadge}
      </div>

      <div className={clsx('flex flex-col gap-1 max-w-[75%]', isUser && 'items-end')}>
        <div className={clsx(
          'px-3 py-2.5 rounded-xl text-xs leading-relaxed',
          isUser
            ? 'bg-violet-950/60 border border-violet-900/50 text-violet-100 rounded-tr-sm'
            : 'bg-card border border-border text-text-secondary rounded-tl-sm',
        )}>
          {lines.map((line, i) => {
            if (line === '') return <br key={i} />
            if (line.startsWith('**') && line.endsWith('**'))
              return <p key={i} className="font-semibold text-text-primary">{line.slice(2, -2)}</p>
            if (line.startsWith('# '))
              return <p key={i} className="font-bold text-text-primary mt-1">{line.slice(2)}</p>
            if (line.startsWith('## '))
              return <p key={i} className="font-semibold text-text-primary mt-1">{line.slice(3)}</p>
            if (line.startsWith('- ') || line.startsWith('* '))
              return <div key={i} className="flex gap-1.5"><span className="opacity-50 mt-0.5">·</span><span>{line.slice(2)}</span></div>
            if (/^\d+\. /.test(line))
              return <div key={i} className="flex gap-1.5"><span className="opacity-50 tabular-nums">{line.match(/^\d+/)?.[0]}.</span><span>{line.replace(/^\d+\. /, '')}</span></div>
            return <p key={i}>{line}</p>
          })}
        </div>

        <div className="flex items-center gap-1.5 px-1">
          {msg.timestamp && <span className="text-xxs text-text-muted">{relativeTime(msg.timestamp)}</span>}
          {msg.tokens && <span className="text-xxs text-text-muted">· {msg.tokens.toLocaleString()} tok</span>}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-2 pb-1">
      <span className="text-xxs font-semibold uppercase tracking-wide text-text-muted">{title}</span>
      <span className="ml-auto text-xxs text-text-muted">{count} found</span>
    </div>
  )
}


export function Chats() {
  const [sessions,  setSessions]  = useState<CombinedSession[]>([])
  const [selected,  setSelected]  = useState<CombinedSession | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [loadingTx, setLoadingTx] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [search,    setSearch]    = useState('')
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)

  const selectedRef = useRef<CombinedSession | null>(null)
  useEffect(() => { selectedRef.current = selected }, [selected])

  const keyOf = (s: { id: string; source: SessionSource }) => `${s.source}:${s.id}`

  const fetchTranscript = useCallback(async (session: CombinedSession, silent = false) => {
    if (!silent) setLoadingTx(true)

    try {
      const data = session.source === 'claude'
        ? await chats.session(session.id)
        : await openclawChats.session(session.id)

      const hydrated: CombinedSession = { ...data.session, source: session.source }

      setSelected(prev => {
        if (!prev) return hydrated                          // initial auto-select
        return keyOf(prev) === keyOf(session) ? hydrated : prev
      })
      setSessions(prev => prev.map(s => keyOf(s) === keyOf(session) ? hydrated : s))
    } catch (err) {
      console.error('Failed to refresh transcript', err)
    } finally {
      if (!silent) setLoadingTx(false)
    }
  }, [])

  // const selectSession = useCallback(async (session: CombinedSession) => {
  //   if (session.messages.length > 0) {
  //     setSelected(session)
  //     return
  //   }

  //   setLoadingTx(true)
  //   setSelected({ ...session, messages: [] })

  //   try {
  //     const data = session.source === 'claude'
  //       ? await chats.session(session.id)
  //       : await openclawChats.session(session.id)

  //     const hydrated: CombinedSession = { ...data.session, source: session.source }

  //     setSelected(hydrated)
  //     setSessions(prev =>
  //       prev.map(s => sourceKey(s) === sourceKey(session) ? hydrated : s),
  //     )
  //   } catch (err: any) {
  //     console.error('Failed to load transcript', err)
  //   } finally {
  //     setLoadingTx(false)
  //   }
  // }, [])


  // const loadSessions = useCallback(async () => {
  //   setLoading(true)
  //   setError(null)

  //   try {
  //     const [claudeResult, clawResult] = await Promise.allSettled([
  //       chats.sessions(50),
  //       openclawChats.sessions(50),
  //     ])

  //     const merged: CombinedSession[] = []
  //     const errors: string[] = []
  //     let latestFetchedAt = ''

  //     if (claudeResult.status === 'fulfilled') {
  //       latestFetchedAt = claudeResult.value.fetchedAt
  //       merged.push(...claudeResult.value.sessions.map(session => ({
  //         ...session,
  //         source: 'claude' as const,
  //       })))
  //       if (claudeResult.value.error) errors.push(`Claude: ${claudeResult.value.error}`)
  //     } else {
  //       errors.push(`Claude: ${claudeResult.reason?.message ?? 'failed to load'}`)
  //     }

  //     if (clawResult.status === 'fulfilled') {
  //       latestFetchedAt = clawResult.value.fetchedAt || latestFetchedAt
  //       merged.push(...clawResult.value.sessions.map(session => ({
  //         ...session,
  //         source: 'openclaw' as const,
  //       })))
  //       if (clawResult.value.error) errors.push(`Claw: ${clawResult.value.error}`)
  //     } else {
  //       errors.push(`Claw: ${clawResult.reason?.message ?? 'failed to load'}`)
  //     }

  //     merged.sort((a, b) =>
  //       new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime(),
  //     )

  //     setSessions(merged)
  //     setFetchedAt(latestFetchedAt || new Date().toISOString())
  //     setError(errors.length ? errors.join(' · ') : null)

  //     const prev = selectedRef.current
  //     if (prev) {
  //       const stillExists = merged.find(s => sourceKey(s) === sourceKey(prev))
  //       if (stillExists) {
  //         setSelected(stillExists)
  //         return
  //       }
  //     }

  //     if (merged.length > 0) {
  //       await selectSession(merged[0])
  //     } else {
  //       setSelected(null)
  //     }
  //   } finally {
  //     setLoading(false)
  //   }
  // }, [selectSession])

  const loadSessions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)

    try {
      const [claudeRes, clawRes] = await Promise.allSettled([
        chats.sessions(50),
        openclawChats.sessions(50),
      ])

      const merged: CombinedSession[] = []
      const errors: string[] = []

      if (claudeRes.status === 'fulfilled') {
        merged.push(...claudeRes.value.sessions.map(s => ({ ...s, source: 'claude' as const })))
      } else {
        errors.push(`Claude: ${claudeRes.reason?.message ?? 'load failed'}`)
      }

      if (clawRes.status === 'fulfilled') {
        merged.push(...clawRes.value.sessions.map(s => ({ ...s, source: 'openclaw' as const })))
      } else {
        errors.push(`Claw: ${clawRes.reason?.message ?? 'load failed'}`)
      }

      merged.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())

      setSessions(prev => {
        const prevMap = new Map(prev.map(s => [keyOf(s), s]))
        return merged.map(s => {
          const old = prevMap.get(keyOf(s))
          return old?.messages?.length ? { ...s, messages: old.messages } : s
        })
      })

      setFetchedAt(new Date().toISOString())
      setError(errors.length ? errors.join(' · ') : null)

      const current = selectedRef.current
      if (!current) {
        if (merged[0]) await fetchTranscript(merged[0], true)
        return
      }

      const updatedSelected = merged.find(s => keyOf(s) === keyOf(current))
      if (updatedSelected) {
        // Preserve existing messages during polling; only re-fetch if we have none
        setSelected(prev => prev ? { ...updatedSelected, messages: prev.messages } : updatedSelected)
        if (!current.messages?.length) {
          await fetchTranscript(updatedSelected, true)
        }
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [fetchTranscript])

  const filtered = sessions.filter(s => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      s.title.toLowerCase().includes(q) ||
      s.firstMessage.toLowerCase().includes(q) ||
      s.projectSlug.toLowerCase().includes(q) ||
      s.cwd.toLowerCase().includes(q) ||
      s.source.toLowerCase().includes(q)
    )
  })

  const selectSession = useCallback(async (session: CombinedSession) => {
    setSelected(session)
    await fetchTranscript(session, false)
  }, [fetchTranscript])

  useEffect(() => {
    loadSessions(false)

    const timer = window.setInterval(() => {
      loadSessions(true)
    }, POLL_MS)

    return () => window.clearInterval(timer)
  }, [loadSessions])

  const claudeSessions = filtered.filter(s => s.source === 'claude')
  const clawSessions   = filtered.filter(s => s.source === 'openclaw')
  const totalTok       = filtered.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0)
  const assistantBadge = selected?.source === 'openclaw' ? 'O' : 'C'

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col w-[320px] min-w-[320px] border-r border-border bg-surface overflow-hidden">
        <div className="px-3 pt-3 pb-2 border-b border-border shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            <MessageSquare size={13} className="text-text-muted" />
            <span className="text-xs font-semibold text-text-primary">Chats</span>
            <span className="ml-auto text-xxs text-text-muted">{filtered.length} total</span>
            <button
              onClick={() => loadSessions(false)}
              disabled={loading}
              className="p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary transition-colors"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-1.5 mb-2">
            <div className="flex items-center gap-2 rounded border border-border bg-base px-2.5 py-2">
              <span className={clsx('w-1.5 h-1.5 rounded-full', sourceDotClass('claude'))} />
              <span className="text-xs text-text-secondary">Claude Sessions</span>
              <span className="ml-auto text-xxs text-text-muted">{claudeSessions.length} found</span>
            </div>
            <div className="flex items-center gap-2 rounded border border-border bg-base px-2.5 py-2">
              <span className={clsx('w-1.5 h-1.5 rounded-full', sourceDotClass('openclaw'))} />
              <span className="text-xs text-text-secondary">Claw Sessions</span>
              <span className="ml-auto text-xxs text-text-muted">{clawSessions.length} found</span>
            </div>
          </div>

          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search sessions..."
              className="w-full pl-7 pr-3 py-2 rounded-lg bg-base border border-border text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-border"
            />
          </div>
        </div>

        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-3 text-xxs text-text-muted">
            <div className="flex items-center gap-1"><Hash size={11} />{filtered.length}</div>
            <div className="flex items-center gap-1"><Activity size={11} />{totalTok.toLocaleString()} tok</div>
            {fetchedAt && <div className="ml-auto">{relativeTime(fetchedAt)}</div>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="h-[76px] rounded border border-border bg-card animate-pulse" />
              ))}
            </div>
          ) : error && filtered.length === 0 ? (
            <div className="flex items-start gap-2 p-3 rounded border border-amber-900/40 bg-amber-950/20 text-amber-300">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <p className="text-xs leading-snug">{error}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
              <MessageSquare size={18} className="text-text-muted" />
              <p className="text-sm text-text-muted">No matching sessions</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <SectionHeader title="Claude Sessions" count={claudeSessions.length} />
                <div className="space-y-1">
                  {claudeSessions.length === 0 ? (
                    <div className="px-2 py-2 text-xxs text-text-muted">No Claude sessions</div>
                  ) : (
                    claudeSessions.map(session => (
                      <SessionItem
                        key={sourceKey(session)}
                        session={session}
                        isActive={selected ? sourceKey(selected) === sourceKey(session) : false}
                        onClick={() => selectSession(session)}
                      />
                    ))
                  )}
                </div>
              </div>

              <div>
                <SectionHeader title="Claw Sessions" count={clawSessions.length} />
                <div className="space-y-1">
                  {clawSessions.length === 0 ? (
                    <div className="px-2 py-2 text-xxs text-text-muted">No Claw sessions</div>
                  ) : (
                    clawSessions.map(session => (
                      <SessionItem
                        key={sourceKey(session)}
                        session={session}
                        isActive={selected ? sourceKey(selected) === sourceKey(session) : false}
                        onClick={() => selectSession(session)}
                      />
                    ))
                  )}
                </div>
              </div>

              {error && (
                <div className="mt-2 flex items-start gap-2 p-3 rounded border border-amber-900/40 bg-amber-950/20 text-amber-300">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <p className="text-xs leading-snug">{error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full">
            <MessageSquare size={20} className="text-text-muted mb-2" />
            <span className="text-sm text-text-muted">Select a session</span>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between px-6 pt-4 pb-3 border-b border-border shrink-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-sm font-semibold text-text-primary truncate">
                    {selected.title || 'Untitled session'}
                  </h2>
                  <span className={clsx('px-1.5 py-0.5 rounded border text-xxs shrink-0', sourceChipClass(selected.source))}>
                    {sourceLabel(selected.source)}
                  </span>
                </div>

                <div className="flex items-center gap-3 flex-wrap text-xxs text-text-muted">
                  <div className="flex items-center gap-1">
                    <Clock size={9} />
                    {relativeTime(selected.lastActiveAt)}
                  </div>

                  <div className="flex items-center gap-1">
                    <Hash size={9} />
                    {selected.messageCount} messages
                  </div>

                  {(selected.inputTokens + selected.outputTokens) > 0 && (
                    <div className="flex items-center gap-1">
                      <Activity size={9} />
                      {fmt(selected.inputTokens + selected.outputTokens)} tokens
                    </div>
                  )}

                  {selected.cwd && (
                    <div className="flex items-center gap-1 truncate max-w-[260px]">
                      <FolderOpen size={9} />
                      <span className="truncate font-mono">{selected.cwd.replace(/^.*\/sessions\/[^/]+\//, '~/')}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loadingTx ? (
                <div className="flex items-center justify-center h-32">
                  <span className="text-sm text-text-muted animate-pulse">Loading transcript…</span>
                </div>
              ) : selected.messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32">
                  <span className="text-sm text-text-muted">No readable messages in this session</span>
                </div>
              ) : (
                selected.messages.map((msg, i) => (
                  <MessageBubble key={`${msg.timestamp}-${i}`} msg={msg} assistantBadge={assistantBadge} />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}



// import { useState, useEffect, useCallback } from 'react'
// import { clsx } from 'clsx'
// import { MessageSquare, Clock, Hash, Search, Activity, FolderOpen, RefreshCw, AlertCircle } from 'lucide-react'
// import { chats, type LiveSession, type LiveChatMessage } from '../lib/api'

// // ─── Helpers ──────────────────────────────────────────────────────────────────

// function fmt(n: number) {
//   if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
//   if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}k`
//   return String(n)
// }

// function relativeTime(iso: string): string {
//   if (!iso) return ''
//   const diff = Date.now() - new Date(iso).getTime()
//   const mins  = Math.floor(diff / 60_000)
//   const hrs   = Math.floor(diff / 3_600_000)
//   const days  = Math.floor(diff / 86_400_000)
//   if (mins < 1)  return 'just now'
//   if (mins < 60) return `${mins}m ago`
//   if (hrs  < 24) return `${hrs}h ago`
//   if (days < 7)  return `${days}d ago`
//   return new Date(iso).toLocaleDateString()
// }

// function projectLabel(slug: string): string {
//   return slug.replace(/^-/, '').replace(/-/g, '/').slice(0, 32)
// }

// // ─── Avatar colour from session id ───────────────────────────────────────────

// const AVATAR_COLORS = [
//   'from-violet-500 to-indigo-600',
//   'from-blue-500 to-cyan-600',
//   'from-teal-500 to-green-600',
//   'from-rose-500 to-pink-600',
//   'from-amber-500 to-orange-600',
// ]
// function avatarColor(id: string) {
//   let h = 0
//   for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
//   return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
// }

// // ─── Session list item ────────────────────────────────────────────────────────

// function SessionItem({ session, isActive, onClick }: {
//   session: LiveSession
//   isActive: boolean
//   onClick: () => void
// }) {
//   return (
//     <button
//       onClick={onClick}
//       className={clsx(
//         'w-full text-left px-3 py-3 rounded border transition-all',
//         isActive
//           ? 'bg-card-hover border-border text-text-primary'
//           : 'border-transparent hover:bg-card text-text-secondary',
//       )}
//     >
//       <div className="flex items-start gap-2.5">
//         <div className={clsx(
//           'w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-white text-xxs font-bold mt-0.5 bg-gradient-to-br',
//           avatarColor(session.id),
//         )}>
//           C
//         </div>
//         <div className="flex-1 min-w-0">
//           <div className="flex items-center justify-between gap-1 mb-0.5">
//             <span className={clsx('text-xs font-semibold truncate', isActive ? 'text-text-primary' : 'text-text-secondary')}>
//               {session.title || 'Untitled session'}
//             </span>
//             <span className="text-xxs text-text-muted shrink-0">{relativeTime(session.lastActiveAt)}</span>
//           </div>
//           <p className="text-xxs text-text-muted line-clamp-2 leading-relaxed mb-1">
//             {session.firstMessage}
//           </p>
//           <div className="flex items-center gap-2 flex-wrap">
//             <span className="text-xxs text-text-muted">
//               {session.messageCount} msgs
//             </span>
//             {(session.inputTokens + session.outputTokens) > 0 && (
//               <span className="text-xxs text-text-muted">
//                 · {fmt(session.inputTokens + session.outputTokens)} tok
//               </span>
//             )}
//             {session.projectSlug && (
//               <span className="px-1.5 py-0.5 rounded bg-base border border-border text-xxs text-text-muted truncate max-w-[120px]">
//                 {projectLabel(session.projectSlug)}
//               </span>
//             )}
//           </div>
//         </div>
//       </div>
//     </button>
//   )
// }

// // ─── Message bubble ───────────────────────────────────────────────────────────

// function MessageBubble({ msg }: { msg: LiveChatMessage }) {
//   const isUser = msg.role === 'user'
//   // Render with basic markdown-lite
//   const lines = msg.content.split('\n')

//   return (
//     <div className={clsx('flex gap-2.5 mb-4', isUser ? 'flex-row-reverse' : 'flex-row')}>
//       <div className={clsx(
//         'w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xxs font-bold text-white mt-0.5',
//         isUser ? 'bg-gradient-to-br from-violet-500 to-indigo-600' : 'bg-gradient-to-br from-blue-600 to-cyan-700',
//       )}>
//         {isUser ? 'A' : 'C'}
//       </div>
//       <div className={clsx('flex flex-col gap-1 max-w-[75%]', isUser && 'items-end')}>
//         <div className={clsx(
//           'px-3 py-2.5 rounded-xl text-xs leading-relaxed',
//           isUser
//             ? 'bg-violet-950/60 border border-violet-900/50 text-violet-100 rounded-tr-sm'
//             : 'bg-card border border-border text-text-secondary rounded-tl-sm',
//         )}>
//           {lines.map((line, i) => {
//             if (line === '') return <br key={i} />
//             if (line.startsWith('**') && line.endsWith('**'))
//               return <p key={i} className="font-semibold text-text-primary">{line.slice(2, -2)}</p>
//             if (line.startsWith('# '))
//               return <p key={i} className="font-bold text-text-primary mt-1">{line.slice(2)}</p>
//             if (line.startsWith('## '))
//               return <p key={i} className="font-semibold text-text-primary mt-1">{line.slice(3)}</p>
//             if (line.startsWith('- ') || line.startsWith('* '))
//               return <div key={i} className="flex gap-1.5"><span className="opacity-50 mt-0.5">·</span><span>{line.slice(2)}</span></div>
//             if (/^\d+\. /.test(line))
//               return <div key={i} className="flex gap-1.5"><span className="opacity-50 tabular-nums">{line.match(/^\d+/)?.[0]}.</span><span>{line.replace(/^\d+\. /, '')}</span></div>
//             return <p key={i}>{line}</p>
//           })}
//         </div>
//         <div className="flex items-center gap-1.5 px-1">
//           {msg.timestamp && <span className="text-xxs text-text-muted">{relativeTime(msg.timestamp)}</span>}
//           {msg.tokens && <span className="text-xxs text-text-muted">· {msg.tokens.toLocaleString()} tok</span>}
//         </div>
//       </div>
//     </div>
//   )
// }

// // ─── Main view ────────────────────────────────────────────────────────────────

// export function Chats() {
//   const [sessions,  setSessions]  = useState<LiveSession[]>([])
//   const [selected,  setSelected]  = useState<LiveSession | null>(null)
//   const [loading,   setLoading]   = useState(true)
//   const [loadingTx, setLoadingTx] = useState(false)
//   const [error,     setError]     = useState<string | null>(null)
//   const [search,    setSearch]    = useState('')
//   const [fetchedAt, setFetchedAt] = useState<string | null>(null)

//   const loadSessions = useCallback(async () => {
//     setLoading(true)
//     setError(null)
//     try {
//       const data = await chats.sessions(50)
//       setSessions(data.sessions)
//       setFetchedAt(data.fetchedAt)
//       if (data.sessions.length > 0 && !selected) {
//         await selectSession(data.sessions[0])
//       }
//       if (data.error) setError(data.error)
//     } catch (err: any) {
//       setError(err.message)
//     } finally {
//       setLoading(false)
//     }
//   }, [])

//   const selectSession = async (session: LiveSession) => {
//     // If we already have the transcript, just select it
//     if (session.messages.length > 0) {
//       setSelected(session)
//       return
//     }
//     setLoadingTx(true)
//     setSelected({ ...session, messages: [] })
//     try {
//       const data = await chats.session(session.id)
//       setSelected(data.session)
//       setSessions(prev => prev.map(s => s.id === session.id ? data.session : s))
//     } catch (err: any) {
//       console.error('Failed to load transcript', err)
//     } finally {
//       setLoadingTx(false)
//     }
//   }

//   useEffect(() => { loadSessions() }, [loadSessions])

//   const filtered = sessions.filter(s => {
//     if (!search.trim()) return true
//     const q = search.toLowerCase()
//     return (
//       s.title.toLowerCase().includes(q) ||
//       s.firstMessage.toLowerCase().includes(q) ||
//       s.projectSlug.toLowerCase().includes(q) ||
//       s.cwd.toLowerCase().includes(q)
//     )
//   })

//   const totalTok = sessions.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0)

//   return (
//     <div className="flex h-full overflow-hidden">
//       {/* ── Left panel ── */}
//       <div className="flex flex-col w-[300px] min-w-[300px] border-r border-border bg-surface overflow-hidden">
//         {/* Header */}
//         <div className="px-3 pt-3 pb-2 border-b border-border shrink-0">
//           <div className="flex items-center gap-1.5 mb-2">
//             <MessageSquare size={13} className="text-text-muted" />
//             <span className="text-xs font-semibold text-text-primary">Claude Sessions</span>
//             <span className="ml-auto text-xxs text-text-muted">{sessions.length} found</span>
//             <button onClick={loadSessions} disabled={loading}
//               className="p-1 rounded hover:bg-card text-text-muted hover:text-text-secondary transition-colors">
//               <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
//             </button>
//           </div>
//           {/* Stats */}
//           {totalTok > 0 && (
//             <div className="flex items-center gap-3 text-xxs text-text-muted pb-2">
//               <div className="flex items-center gap-1">
//                 <Activity size={9} />
//                 <span>{fmt(totalTok)} tokens total</span>
//               </div>
//             </div>
//           )}
//           {/* Search */}
//           <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-card border border-border">
//             <Search size={11} className="text-text-muted shrink-0" />
//             <input
//               type="text"
//               placeholder="Search sessions…"
//               value={search}
//               onChange={e => setSearch(e.target.value)}
//               className="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none"
//             />
//           </div>
//         </div>

//         {/* Error */}
//         {error && (
//           <div className="flex items-center gap-2 mx-3 mt-2 px-3 py-2 rounded border border-amber-900/40 bg-amber-950/20 text-amber-300">
//             <AlertCircle size={11} className="shrink-0" />
//             <p className="text-xxs leading-tight">{error}</p>
//           </div>
//         )}

//         {/* Session list */}
//         <div className="flex-1 overflow-y-auto py-2 px-2">
//           {loading ? (
//             <p className="text-xxs text-text-muted text-center py-6 animate-pulse">Reading session files…</p>
//           ) : filtered.length === 0 ? (
//             <p className="text-xxs text-text-muted text-center py-6">No sessions found</p>
//           ) : (
//             <div className="flex flex-col gap-0.5">
//               {filtered.map(session => (
//                 <SessionItem
//                   key={session.id}
//                   session={session}
//                   isActive={session.id === selected?.id}
//                   onClick={() => selectSession(session)}
//                 />
//               ))}
//             </div>
//           )}
//         </div>
//       </div>

//       {/* ── Right panel ── */}
//       <div className="flex-1 flex flex-col overflow-hidden">
//         {!selected ? (
//           <div className="flex flex-col items-center justify-center h-full">
//             <MessageSquare size={20} className="text-text-muted mb-2" />
//             <span className="text-sm text-text-muted">Select a session</span>
//           </div>
//         ) : (
//           <>
//             {/* Session header */}
//             <div className="flex items-start justify-between px-6 pt-4 pb-3 border-b border-border shrink-0">
//               <div className="flex-1 min-w-0">
//                 <h2 className="text-sm font-semibold text-text-primary truncate mb-1">
//                   {selected.title || 'Untitled session'}
//                 </h2>
//                 <div className="flex items-center gap-3 flex-wrap text-xxs text-text-muted">
//                   <div className="flex items-center gap-1">
//                     <Clock size={9} />
//                     {relativeTime(selected.lastActiveAt)}
//                   </div>
//                   <div className="flex items-center gap-1">
//                     <Hash size={9} />
//                     {selected.messageCount} messages
//                   </div>
//                   {(selected.inputTokens + selected.outputTokens) > 0 && (
//                     <div className="flex items-center gap-1">
//                       <Activity size={9} />
//                       {fmt(selected.inputTokens + selected.outputTokens)} tokens
//                     </div>
//                   )}
//                   {selected.cwd && (
//                     <div className="flex items-center gap-1 truncate max-w-[240px]">
//                       <FolderOpen size={9} />
//                       <span className="truncate font-mono">{selected.cwd.replace(/^.*\/sessions\/[^/]+\//, '~/')}</span>
//                     </div>
//                   )}
//                 </div>
//               </div>
//             </div>

//             {/* Transcript */}
//             <div className="flex-1 overflow-y-auto px-6 py-5">
//               {loadingTx ? (
//                 <div className="flex items-center justify-center h-32">
//                   <span className="text-sm text-text-muted animate-pulse">Loading transcript…</span>
//                 </div>
//               ) : selected.messages.length === 0 ? (
//                 <div className="flex flex-col items-center justify-center h-32">
//                   <span className="text-sm text-text-muted">No readable messages in this session</span>
//                 </div>
//               ) : (
//                 selected.messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)
//               )}
//             </div>
//           </>
//         )}
//       </div>
//     </div>
//   )
// }
