import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  Terminal, FileText, FilePen, Globe, Search, Bot,
  MessageSquare, Send, Activity, AlertTriangle,
  Wifi, WifiOff, Brain, Zap, Clock, Cpu, Pause,
} from 'lucide-react'
import { WATCH_STREAM_URL, type WatchEvent, type WatchSource } from '../lib/api'
import { usePaused } from '../lib/refreshBus'

// ─── Status classification ────────────────────────────────────────────────────

interface Status {
  verb:   string   // "reading the file"
  detail: string   // "/path/to/file" — shown as monospace below the verb
  icon:   React.ReactNode
  color:  string
  active: boolean  // true = animate the dot
}

function platform(ch: string): string {
  if (!ch) return ''
  const l = ch.toLowerCase()
  if (l.includes('discord'))  return 'Discord'
  if (l.includes('slack'))    return 'Slack'
  if (l.includes('telegram')) return 'Telegram'
  if (l.includes('twitter') || l.includes('x.com')) return 'X'
  if (l.includes('whatsapp')) return 'WhatsApp'
  if (l.includes('email') || l.includes('gmail')) return 'email'
  if (ch.startsWith('#')) return ch
  const last = ch.split(':').pop() ?? ch
  return last.length > 28 ? last.slice(0, 28) + '…' : last
}

const sz = 18

function classify(e: WatchEvent): Status {
  if (e.kind === 'tool') {
    const tool  = (e.meta?.tool ?? e.sub ?? '').toLowerCase().replace(/[^a-z_]/g, '')
    const input = (e.meta?.toolInput ?? '').trim()

    if (tool === 'bash' || tool === 'terminal' || tool === 'shell' || tool === 'execute' || tool === 'exec' || tool === 'computer') {
      // exec commands often lead with a "# comment" line — show the first real
      // command line instead so the detail is the actual command being run.
      const cmd = input.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#')) ?? input
      return { verb: 'running a terminal command', detail: cmd.slice(0, 120), icon: <Terminal size={sz} />, color: 'text-amber-400', active: true }
    }
    if (tool === 'read' || tool === 'readfile' || tool === 'read_file' || tool === 'viewfile')
      return { verb: 'reading the file', detail: input.slice(0, 120), icon: <FileText size={sz} />, color: 'text-blue-400', active: true }
    if (tool === 'write' || tool === 'writefile' || tool === 'write_file' || tool === 'create')
      return { verb: 'writing to file', detail: input.slice(0, 120), icon: <FilePen size={sz} />, color: 'text-green-400', active: true }
    if (tool === 'edit' || tool === 'multiedit' || tool === 'patch' || tool === 'apply_patch' || tool === 'str_replace_editor')
      return { verb: 'editing the file', detail: input.slice(0, 120), icon: <FilePen size={sz} />, color: 'text-emerald-400', active: true }
    if (tool === 'webfetch' || tool === 'fetch' || tool === 'browse' || tool === 'curl' || tool === 'http') {
      const host = input.replace(/^https?:\/\//, '').split('/')[0]
      return { verb: 'browsing the web', detail: host || input.slice(0, 80), icon: <Globe size={sz} />, color: 'text-cyan-400', active: true }
    }
    if (tool === 'websearch' || tool === 'search' || tool === 'googlesearch' || tool === 'tavily')
      return { verb: 'searching the web', detail: input ? `"${input.slice(0, 80)}"` : '', icon: <Search size={sz} />, color: 'text-violet-400', active: true }
    if (tool === 'task' || tool === 'agent' || tool === 'spawn' || tool === 'delegate' || tool === 'subtask')
      return { verb: 'spawning an agent', detail: input.slice(0, 80), icon: <Bot size={sz} />, color: 'text-purple-400', active: true }
    if (tool.includes('memory') || tool.includes('recall') || tool.includes('remember'))
      return { verb: 'accessing memory', detail: '', icon: <Brain size={sz} />, color: 'text-pink-400', active: true }
    // Generic tool
    const name = e.meta?.tool ?? tool
    return { verb: `using ${name || 'a tool'}`, detail: input.slice(0, 100), icon: <Zap size={sz} />, color: 'text-yellow-400', active: true }
  }

  if (e.kind === 'message') {
    const ch  = e.meta?.channel ?? ''
    const dir = e.meta?.direction ?? (/sent|send|outbound|reply/i.test(e.event) ? 'out' : 'in')
    const src = platform(ch)
    if (dir === 'out')
      return { verb: 'writing a response', detail: src ? `to ${src}` : '', icon: <Send size={sz} />, color: 'text-green-400', active: true }
    return { verb: 'reading a message', detail: src ? `from ${src}` : '', icon: <MessageSquare size={sz} />, color: 'text-blue-400', active: true }
  }

  if (e.kind === 'cron')
    return { verb: 'running a scheduled task', detail: e.sub.slice(0, 80), icon: <Clock size={sz} />, color: 'text-amber-400', active: true }

  if (e.kind === 'session') {
    if (/think/i.test(e.event)) return { verb: 'thinking', detail: (e.meta?.channel ?? '').trim(), icon: <Brain size={sz} />, color: 'text-violet-400', active: true }
    if (/start/i.test(e.event)) return { verb: 'starting a session', detail: e.sub.slice(0, 60), icon: <Activity size={sz} />, color: 'text-green-400', active: true }
    if (/end|close/i.test(e.event)) return { verb: 'ending the session', detail: '', icon: <Activity size={sz} />, color: 'text-slate-400', active: false }
    if (/active/i.test(e.event)) return { verb: 'working', detail: (e.meta?.channel ?? '').trim(), icon: <Cpu size={sz} />, color: 'text-amber-400', active: true }
    return { verb: 'working', detail: e.sub.slice(0, 60), icon: <Cpu size={sz} />, color: 'text-amber-400', active: true }
  }

  if (e.kind === 'error')
    return { verb: 'reporting an error', detail: e.sub.slice(0, 100), icon: <AlertTriangle size={sz} />, color: 'text-red-400', active: false }

  return { verb: 'active', detail: e.sub.slice(0, 80), icon: <Activity size={sz} />, color: 'text-text-muted', active: true }
}

// ─── Source config ────────────────────────────────────────────────────────────

const SOURCE_CFG: Record<WatchSource, {
  label: string
  name:  string
  dot:   string
  ring:  string
  bg:    string
}> = {
  openclaw: {
    label: 'OpenClaw',
    name:  'Claw',
    dot:   'bg-amber-400',
    ring:  'ring-amber-500/30',
    bg:    'bg-amber-500/5',
  },
  hermes: {
    label: 'Hermes',
    name:  'Hermes',
    dot:   'bg-blue-400',
    ring:  'ring-blue-500/30',
    bg:    'bg-blue-500/5',
  },
  claude: {
    label: 'Claude',
    name:  'Claude',
    dot:   'bg-violet-400',
    ring:  'ring-violet-500/30',
    bg:    'bg-violet-500/5',
  },
}

// ─── Status card ─────────────────────────────────────────────────────────────

function timeAgo(ts: string): string {
  const sec = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (sec < 5)  return 'just now'
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

function AgentCard({ source, event }: { source: WatchSource; event: WatchEvent | null }) {
  const cfg = SOURCE_CFG[source]
  const [, tick] = useState(0)

  // Tick every second to refresh the "ago" timestamp.
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const age    = event ? Date.now() - new Date(event.ts).getTime() : Infinity
  const recent = age < 8_000
  const status = event ? classify(event) : null
  // live = actively happening right now (< 8s)
  // stale = finished within 10 min — show dimmed last-known state
  // idle = nothing for 10+ min (or no data)
  const live  = recent && !!status?.active
  const stale = !live && !!status && age < 600_000
  const idle  = !status || age >= 600_000

  return (
    <div className={clsx(
      'relative flex flex-col gap-4 p-6 rounded-xl border transition-all duration-500',
      live
        ? `${cfg.bg} ring-1 ${cfg.ring} border-transparent`
        : 'bg-card border-border',
    )}>
      {/* Agent label + connection dot */}
      <div className="flex items-center gap-2.5">
        <div className={clsx(
          'w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-300',
          live ? `${cfg.dot} animate-pulse` : stale ? cfg.dot + ' opacity-40' : 'bg-slate-600',
        )} />
        <span className="text-xs font-semibold tracking-widest uppercase text-text-muted">
          {cfg.label}
        </span>
      </div>

      {/* Main status */}
      {idle ? (
        <div className="flex items-end gap-2">
          <span className="text-2xl font-light text-text-muted italic">idle</span>
        </div>
      ) : (
        <div className={clsx('flex flex-col gap-2 min-w-0 transition-opacity duration-500', stale && 'opacity-40')}>
          <div className="flex items-start gap-3">
            <span className={clsx('shrink-0 mt-0.5', live ? status!.color : 'text-text-muted')}>
              {status!.icon}
            </span>
            <div className="flex flex-col gap-1 min-w-0">
              <p className="text-text-primary font-medium leading-snug">
                <span className="text-text-muted">{cfg.name} {stale ? 'was' : 'is'} </span>
                <span className={clsx('font-semibold', live ? status!.color : 'text-text-muted')}>
                  {status!.verb}
                </span>
              </p>
              {status!.detail && (
                <p className="text-xs font-mono text-text-muted truncate max-w-full" title={status!.detail}>
                  {status!.detail}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Timestamp */}
      {event && (
        <span className="text-xxs text-text-muted tabular-nums">
          {timeAgo(event.ts)}
        </span>
      )}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

const SOURCES: WatchSource[] = ['openclaw', 'hermes', 'claude']

// Treat any of these as meaningful activity (updates the status card).
const ACTIVITY_KINDS: WatchEvent['kind'][] = ['tool', 'message', 'cron', 'session', 'error']

export function Watch() {
  const [latestBySource, setLatestBySource] = useState<Partial<Record<WatchSource, WatchEvent>>>({})
  const [connected, setConnected] = useState(false)
  const paused = usePaused()

  useEffect(() => {
    if (paused) { setConnected(false); return }   // Pause freezes the live stream
    const es = new EventSource(WATCH_STREAM_URL)

    es.onmessage = (ev) => {
      try {
        const e = JSON.parse(ev.data) as WatchEvent
        if (e.event === 'tick' || e.event === 'presence') return
        if (!ACTIVITY_KINDS.includes(e.kind)) return
        // Skip "session ended / disconnected" from clearing an active status
        const isTerminal = e.kind === 'session' && /end|close/i.test(e.event)
        if (isTerminal) return
        // The generic "active run / working" filler streams every few seconds and
        // would clobber a real tool/message on the card. While a richer event is
        // still recent, let it stand instead of dropping back to "working".
        const isFiller = e.kind === 'session' && /active/i.test(e.event)
        setLatestBySource(prev => {
          const cur = prev[e.source]
          if (isFiller && cur && (cur.kind === 'tool' || cur.kind === 'message')
              && Date.now() - new Date(cur.ts).getTime() < 45_000) {
            return prev
          }
          return { ...prev, [e.source]: e }
        })
      } catch { /* ignore */ }
    }
    es.onopen  = () => setConnected(true)
    es.onerror = () => setConnected(false)
    return () => es.close()
  }, [paused])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary">Watch</h1>
          <p className="text-xs text-text-muted mt-0.5">Live agent status</p>
        </div>
        <div className={clsx('flex items-center gap-1.5 text-xxs font-medium', paused ? 'text-amber-400' : connected ? 'text-green-400' : 'text-red-400')}>
          {paused
            ? <><Pause size={12} /> paused</>
            : connected
              ? <><Wifi size={12} /> live</>
              : <><WifiOff size={12} /> disconnected</>
          }
        </div>
      </div>

      {/* Status cards */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="grid grid-cols-1 gap-4 max-w-3xl">
          {SOURCES.map(src => (
            <AgentCard key={src} source={src} event={latestBySource[src] ?? null} />
          ))}
        </div>
      </div>
    </div>
  )
}
