import { useState, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Terminal, FileText, FilePen, Globe, Search, Bot, Clock,
  MessageSquare, SendHorizontal, Activity, AlertTriangle,
  Wifi, WifiOff, Trash2, Brain, Zap, Radio, Play, Square,
} from 'lucide-react'
import { WATCH_STREAM_URL, type WatchEvent, type WatchSource } from '../lib/api'

// ─── Activity classification ──────────────────────────────────────────────────

interface Activity {
  verb:   string
  detail: string
  icon:   React.ReactNode
  color:  string  // Tailwind text-* class
}

function channelDisplay(ch: string): string {
  if (!ch) return ''
  const l = ch.toLowerCase()
  if (l.includes('discord'))             return 'Discord'
  if (l.includes('slack'))               return 'Slack'
  if (l.includes('telegram'))            return 'Telegram'
  if (l.includes('twitter') || l.includes('x.com')) return 'X'
  if (l.includes('whatsapp'))            return 'WhatsApp'
  if (l.includes('email') || l.includes('gmail'))   return 'email'
  if (ch.startsWith('#'))                return ch
  const last = ch.split(':').pop() ?? ch
  return last.length > 24 ? last.slice(0, 24) + '…' : last
}

const sz = 13

function classify(e: WatchEvent): Activity {
  if (e.kind === 'tool') {
    const tool  = (e.meta?.tool ?? e.sub ?? '').toLowerCase().replace(/[^a-z_]/g, '')
    const input = e.meta?.toolInput ?? ''

    if (tool === 'bash' || tool === 'terminal' || tool === 'shell' || tool === 'execute') {
      return { verb: 'Running command', detail: input ? `\`${input.slice(0, 90)}\`` : '', icon: <Terminal size={sz} />, color: 'text-amber-400' }
    }
    if (tool === 'read' || tool === 'readfile' || tool === 'read_file' || tool === 'viewfile') {
      return { verb: 'Reading file', detail: input, icon: <FileText size={sz} />, color: 'text-blue-400' }
    }
    if (tool === 'write' || tool === 'writefile' || tool === 'write_file' || tool === 'create') {
      return { verb: 'Writing file', detail: input, icon: <FilePen size={sz} />, color: 'text-green-400' }
    }
    if (tool === 'edit' || tool === 'multiedit' || tool === 'patch' || tool === 'str_replace_editor') {
      return { verb: 'Editing file', detail: input, icon: <FilePen size={sz} />, color: 'text-emerald-400' }
    }
    if (tool === 'webfetch' || tool === 'fetch' || tool === 'browse' || tool === 'curl' || tool === 'http') {
      const host = input.replace(/^https?:\/\//, '').split('/')[0]
      return { verb: 'Browsing', detail: host || input, icon: <Globe size={sz} />, color: 'text-cyan-400' }
    }
    if (tool === 'websearch' || tool === 'search' || tool === 'googlesearch' || tool === 'tavily') {
      return { verb: 'Searching web', detail: input ? `"${input.slice(0, 60)}"` : '', icon: <Search size={sz} />, color: 'text-violet-400' }
    }
    if (tool === 'task' || tool === 'agent' || tool === 'spawn' || tool === 'delegate' || tool === 'subtask') {
      return { verb: 'Spawning agent', detail: input.slice(0, 60), icon: <Bot size={sz} />, color: 'text-purple-400' }
    }
    if (tool === 'todowrite' || tool === 'todo' || tool === 'checklist') {
      return { verb: 'Updating todos', detail: '', icon: <Zap size={sz} />, color: 'text-yellow-400' }
    }
    if (tool.includes('memory') || tool.includes('recall') || tool.includes('remember')) {
      return { verb: 'Accessing memory', detail: '', icon: <Brain size={sz} />, color: 'text-pink-400' }
    }
    // Generic tool
    const name = e.meta?.tool ?? e.sub.split(':')[0].trim()
    return { verb: `Using ${name || 'tool'}`, detail: input.slice(0, 70), icon: <Zap size={sz} />, color: 'text-slate-400' }
  }

  if (e.kind === 'message') {
    const ch  = e.meta?.channel ?? ''
    const dir = e.meta?.direction ?? (
      /sent|send|outbound|reply/i.test(e.event) ? 'out' : 'in'
    )
    const platform = channelDisplay(ch)
    if (dir === 'out') {
      return {
        verb: 'Writing response',
        detail: platform ? `to ${platform}` : e.sub.slice(0, 55),
        icon: <SendHorizontal size={sz} />, color: 'text-green-400',
      }
    }
    return {
      verb: 'Reading message',
      detail: platform ? `from ${platform}` : e.sub.slice(0, 55),
      icon: <MessageSquare size={sz} />, color: 'text-blue-400',
    }
  }

  if (e.kind === 'cron') {
    return { verb: 'Running scheduled task', detail: e.sub.slice(0, 60), icon: <Clock size={sz} />, color: 'text-amber-400' }
  }

  if (e.kind === 'health') {
    return { verb: 'Health check', detail: e.sub.slice(0, 50), icon: <Activity size={sz} />, color: 'text-slate-400' }
  }

  if (e.kind === 'error') {
    return { verb: 'Error', detail: e.sub.slice(0, 75), icon: <AlertTriangle size={sz} />, color: 'text-red-400' }
  }

  if (e.kind === 'session') {
    if (e.event.includes('start')) return { verb: 'Session started', detail: e.sub.slice(0, 50), icon: <Play size={sz} />, color: 'text-green-400' }
    if (e.event.includes('end') || e.event.includes('close')) return { verb: 'Session ended', detail: '', icon: <Square size={sz} />, color: 'text-slate-400' }
    return { verb: 'Session', detail: e.sub.slice(0, 50), icon: <Activity size={sz} />, color: 'text-slate-400' }
  }

  if (e.event === 'connected')    return { verb: 'Connected',    detail: '', icon: <Wifi size={sz} />,    color: 'text-green-400' }
  if (e.event === 'disconnected') return { verb: 'Disconnected', detail: '', icon: <WifiOff size={sz} />, color: 'text-red-400'   }
  return { verb: e.title || 'Event', detail: e.sub.slice(0, 60), icon: <Radio size={sz} />, color: 'text-slate-400' }
}

// ─── Source config ────────────────────────────────────────────────────────────

const SOURCE_CFG: Record<WatchSource, { label: string; short: string; dot: string; badge: string; name: string }> = {
  openclaw: { label: 'OpenClaw', short: 'OC', dot: 'bg-amber-400',  badge: 'bg-amber-500/15 text-amber-300 border-amber-700/30', name: 'Claw' },
  hermes:   { label: 'Hermes',   short: 'HC', dot: 'bg-blue-400',   badge: 'bg-blue-500/15  text-blue-300  border-blue-700/30',  name: 'Hermes' },
  claude:   { label: 'Claude',   short: 'CC', dot: 'bg-violet-400', badge: 'bg-violet-500/15 text-violet-300 border-violet-700/30', name: 'Claude' },
}

// ─── Current-status header card ───────────────────────────────────────────────

function StatusCard({ source, event }: { source: WatchSource; event: WatchEvent | null }) {
  const cfg = SOURCE_CFG[source]
  const act = event ? classify(event) : null
  const isRecent = event ? (Date.now() - new Date(event.ts).getTime()) < 8_000 : false

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-lg">
      <div className="flex items-center gap-2 shrink-0 w-24">
        <div className={clsx('w-2 h-2 rounded-full shrink-0', isRecent ? cfg.dot : 'bg-slate-600')} />
        <span className="text-xs font-semibold text-text-muted">{cfg.label}</span>
      </div>
      {act ? (
        <div className="flex items-center gap-2 min-w-0">
          <span className={clsx('shrink-0', act.color)}>{act.icon}</span>
          <span className="text-sm text-text-primary font-medium">
            {cfg.name} is{' '}
            <span className={clsx('font-semibold', act.color)}>{act.verb.toLowerCase()}</span>
            {act.detail && (
              <span className="text-text-muted font-normal ml-1 font-mono text-xs">{act.detail}</span>
            )}
          </span>
        </div>
      ) : (
        <span className="text-sm text-text-muted italic">idle</span>
      )}
    </div>
  )
}

// ─── Feed item ────────────────────────────────────────────────────────────────

function FeedItem({ e, age }: { e: WatchEvent; age: number }) {
  const cfg = SOURCE_CFG[e.source]
  const act = classify(e)
  const dim = age > 30_000

  return (
    <div className={clsx(
      'group flex items-start gap-3 px-4 py-2 border-b border-border-subtle last:border-b-0 transition-opacity',
      dim ? 'opacity-40' : 'opacity-100',
    )}>
      {/* Timestamp */}
      <span className="shrink-0 w-14 text-xxs text-text-muted tabular-nums font-mono pt-0.5">
        {new Date(e.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>

      {/* Source badge */}
      <span className={clsx('shrink-0 text-xxs font-semibold px-1.5 py-0.5 rounded border', cfg.badge)}>
        {cfg.short}
      </span>

      {/* Icon */}
      <span className={clsx('shrink-0 mt-0.5', act.color)}>{act.icon}</span>

      {/* Verb + detail */}
      <div className="flex-1 min-w-0">
        <span className={clsx('text-xs font-semibold', act.color)}>{act.verb}</span>
        {act.detail && (
          <span className="ml-2 text-xs text-text-muted font-mono truncate">{act.detail}</span>
        )}
      </div>
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

const MAX_EVENTS = 150
const SOURCES: WatchSource[] = ['openclaw', 'hermes', 'claude']

// Only meaningful events bubble into the status card.
const IS_ACTIVITY: WatchEvent['kind'][] = ['tool', 'message', 'cron']

export function Watch() {
  const [events,    setEvents]    = useState<WatchEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [now,       setNow]       = useState(Date.now())
  const [filter,    setFilter]    = useState<WatchSource | 'all'>('all')
  const feedRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)

  // Keep "now" ticking for age-based dimming.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 3_000)
    return () => clearInterval(t)
  }, [])

  // SSE connection.
  useEffect(() => {
    const es = new EventSource(WATCH_STREAM_URL)

    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as WatchEvent
        // Skip noisy ping / low-value system events.
        if (e.kind === 'health' && e.kind === 'health') return // always skip health in feed (shown in status card)
        if (e.event === 'tick' || e.event === 'presence') return
        setEvents(prev => {
          const next = [...prev, e]
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
        })
      } catch { /* ignore */ }
    }
    es.onopen  = () => setConnected(true)
    es.onerror = () => setConnected(false)

    return () => es.close()
  }, [])

  // Auto-scroll to bottom unless the user has scrolled up.
  const handleScroll = useCallback(() => {
    const el = feedRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  useEffect(() => {
    if (!atBottomRef.current) return
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  // Latest meaningful event per source for the status cards.
  const latestBySource: Partial<Record<WatchSource, WatchEvent>> = {}
  for (const e of events) {
    if (IS_ACTIVITY.includes(e.kind)) latestBySource[e.source] = e
  }

  const filtered = filter === 'all' ? events : events.filter(e => e.source === filter)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Watch</h1>
          <p className="text-xs text-text-muted mt-0.5">Real-time agent activity</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={clsx('flex items-center gap-1.5 text-xxs font-medium', connected ? 'text-green-400' : 'text-red-400')}>
            <div className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-400 animate-pulse' : 'bg-red-400')} />
            {connected ? 'live' : 'disconnected'}
          </div>
          <button
            onClick={() => setEvents([])}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-card text-text-muted hover:text-text-secondary text-xs transition-colors"
          >
            <Trash2 size={11} /> Clear
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col gap-0">
        {/* Status cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 shrink-0">
          {SOURCES.map(src => (
            <StatusCard key={src} source={src} event={latestBySource[src] ?? null} />
          ))}
        </div>

        {/* Source filter + feed */}
        <div className="flex-1 overflow-hidden flex flex-col mx-6 mb-4 bg-card border border-border rounded-lg">
          {/* Filter bar */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0">
            <span className="text-xxs text-text-muted mr-1">Source:</span>
            {(['all', ...SOURCES] as const).map(src => (
              <button
                key={src}
                onClick={() => setFilter(src)}
                className={clsx(
                  'px-2.5 py-0.5 rounded text-xxs font-medium transition-all',
                  filter === src
                    ? 'bg-card-hover text-text-primary'
                    : 'text-text-muted hover:text-text-secondary',
                )}
              >
                {src === 'all' ? 'All' : SOURCE_CFG[src].label}
              </button>
            ))}
            <span className="ml-auto text-xxs text-text-muted tabular-nums">
              {filtered.length} events
            </span>
          </div>

          {/* Feed */}
          <div
            ref={feedRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <Radio size={20} className="text-text-muted" />
                <span className="text-sm text-text-muted">
                  {connected ? 'Waiting for activity…' : 'Connecting to live stream…'}
                </span>
              </div>
            ) : (
              filtered.map(e => (
                <FeedItem key={`${e.source}-${e.seq}`} e={e} age={now - new Date(e.ts).getTime()} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
