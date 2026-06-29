import { useState, useEffect, useCallback, useRef } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { clsx } from 'clsx'
import {
  Activity, DollarSign, MessageSquare, Cpu, Clock, RefreshCw, AlertCircle,
  CheckCircle2, XCircle, Zap, Hash, Terminal, ToggleRight, ToggleLeft,
  TrendingUp, Wrench, Database, Radio, Boxes, Heart, AlertTriangle,
  X, ChevronRight, HeartPulse, GitBranch, Bot, Send, ArrowRight,
  Brain, Network, FileText, Gauge, Shield, LayoutGrid, Edit2, Save, Loader,
} from 'lucide-react'
import { isRefreshPaused } from '../lib/refreshBus'
import {
  metrics as metricsApi, openclawChats, hermesChats, watchHeatmap, budgets as budgetsApi,
  type PlatformMetrics, type ConnectorId, type MetricBreakdown, type MetricSessionRow, type MetricSubAgent, type BudgetLimits, type LiveChatMessage,
} from '../lib/api'
import BrainView from './Brain'
import FlowView from './Flow'
import AlertsView from './Alerts'
import SecurityView from './Security'
import { MemoryAnalyticsBoard } from '../components/metrics/MemoryAnalyticsBoard'
import { fmtTokens, fmtCost, fmtNum, fmtMs, relTime } from '../components/metrics/formatters'

const THEME: Record<ConnectorId, { label: string; icon: string; accent: string; bar: string; dot: string }> = {
  openclaw: { label: 'OpenClaw', icon: '🐾', accent: 'text-amber-300',  bar: 'bg-amber-500/70',  dot: 'bg-amber-400' },
  hermes:   { label: 'Hermes',   icon: '☤',  accent: 'text-purple-300', bar: 'bg-purple-500/70', dot: 'bg-purple-400' },
}

type TabId = 'overview' | 'activity' | 'autonomy' | 'sessions' | 'cron' | 'breakdowns' | 'tools' | 'heatmap' | 'spawntree' | 'budget' | 'system' | 'brain' | 'flow' | 'alerts' | 'security'
const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview',   label: 'Overview',   icon: <LayoutGrid size={13} /> },
  { id: 'activity',   label: 'Activity',   icon: <Activity size={13} /> },
  { id: 'autonomy',   label: 'Autonomy',   icon: <Gauge size={13} /> },
  { id: 'sessions',   label: 'Sessions',   icon: <MessageSquare size={13} /> },
  { id: 'cron',       label: 'Cron',       icon: <Clock size={13} /> },
  { id: 'breakdowns', label: 'Breakdowns', icon: <Cpu size={13} /> },
  { id: 'tools',      label: 'Tools',      icon: <Wrench size={13} /> },
  { id: 'heatmap',    label: 'Heatmap',    icon: <Hash size={13} /> },
  { id: 'spawntree',  label: 'Spawns',     icon: <Bot size={13} /> },
  { id: 'budget',     label: 'Budget',     icon: <DollarSign size={13} /> },
  { id: 'system',     label: 'System',     icon: <Shield size={13} /> },
  { id: 'brain',      label: 'Brain',      icon: <Brain size={13} /> },
  { id: 'flow',       label: 'Flow',       icon: <GitBranch size={13} /> },
  { id: 'alerts',     label: 'Alerts',     icon: <AlertTriangle size={13} /> },
  { id: 'security',   label: 'Security',   icon: <Network size={13} /> },
]

// ─── Building blocks ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, tone }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; tone?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-text-muted">
        <span className={tone}>{icon}</span>
        <span className="text-xxs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <span className={clsx('text-xl font-semibold tabular-nums', tone ?? 'text-text-primary')}>{value}</span>
      {sub && <span className="text-xxs text-text-muted">{sub}</span>}
    </div>
  )
}

function Section({ title, icon, right, children }: {
  title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface/40">
        <span className="text-text-muted">{icon}</span>
        <h3 className="text-xs font-semibold text-text-primary">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function BarList({ items, max, fmt, barClass, empty }: {
  items: Array<{ name: string; value: number; sub?: string }>
  max?: number; fmt: (n: number) => string; barClass: string; empty?: string
}) {
  if (items.length === 0) return <p className="text-xxs text-text-muted py-2">{empty ?? 'No data'}</p>
  const m = max ?? Math.max(...items.map(i => i.value), 1)
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-xxs">
            <span className="text-text-secondary truncate font-mono">{it.name}</span>
            <span className="text-text-muted tabular-nums shrink-0">{fmt(it.value)}{it.sub ? ` · ${it.sub}` : ''}</span>
          </div>
          <div className="h-1.5 rounded-full bg-base overflow-hidden">
            <div className={clsx('h-full rounded-full', barClass)} style={{ width: `${Math.max(2, (it.value / m) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function DailyChart({ data, metric, barClass }: {
  data: PlatformMetrics['daily']; metric: 'tokens' | 'cost'; barClass: string
}) {
  if (data.length === 0) return <p className="text-xxs text-text-muted py-6 text-center">No daily data</p>
  const max = Math.max(...data.map(d => d[metric]), 1)
  return (
    <div>
      <div className="flex items-end gap-[3px] h-40">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full group relative" title={`${d.date}: ${metric === 'cost' ? fmtCost(d.cost) : fmtTokens(d.tokens)}`}>
            <div className={clsx('w-full rounded-t transition-all group-hover:opacity-100 opacity-80', barClass)}
              style={{ height: `${Math.max(1, (d[metric] / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1.5 text-xxs text-text-muted">
        <span>{data[0]?.date}</span>
        <span>{data[Math.floor(data.length / 2)]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function toBars(b: MetricBreakdown[], useCost = false) {
  return b.slice(0, 8).map(x => ({ name: x.name, value: useCost ? x.cost : x.tokens, sub: useCost ? undefined : fmtCost(x.cost) }))
}

// ─── Live message-flow animation ────────────────────────────────────────────────

function FlowNode({ label, count, color, icon, live }: { label: string; count: number; color: string; icon: React.ReactNode; live?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0 w-[88px]">
      <div className={clsx('relative flex items-center justify-center w-12 h-12 rounded-full border', color, live && 'ring-2 ring-current ring-offset-2 ring-offset-card')}
        style={{ animation: live ? 'flow-node-pulse 0.7s ease-in-out infinite' : count > 0 ? 'flow-node-pulse 2.4s ease-in-out infinite' : undefined }}>
        {icon}
      </div>
      <span className={clsx('text-xxs text-center leading-tight', live ? 'text-text-primary font-medium' : 'text-text-muted')}>{label}</span>
      <span className="text-xs font-semibold tabular-nums text-text-primary">{fmtNum(count)}</span>
    </div>
  )
}

function FlowConnector({ active, color, speed }: { active: boolean; color: string; speed: number }) {
  return (
    <div className="flex-1 relative h-px bg-border self-start mt-6 min-w-[24px] overflow-hidden">
      {active && (
        <span className={clsx('absolute top-1/2 -translate-y-1/2 h-1 w-8 rounded-full', color)}
          style={{ animation: `flow-sweep ${speed}s linear infinite` }} />
      )}
    </div>
  )
}

function MessageFlow({ m, activeSet }: { m: PlatformMetrics; activeSet: Set<string> }) {
  const msg = m.messages
  if (!msg) return <p className="text-xxs text-text-muted py-4 text-center">No message-flow data</p>
  const total = Math.max(msg.total, 1)
  const speed = (vol: number) => Math.max(1.2, 4 - (vol / total) * 3) // busier = faster
  const chanLive = [...activeSet].some(id => id.startsWith('ch:'))
  const modelLive = activeSet.has('models')
  const toolLive = activeSet.has('tools')
  const errLive = activeSet.has('error')
  return (
    <div className="flex items-stretch gap-0 py-2 overflow-x-auto">
      <FlowNode label="Channel in" count={msg.user} color="border-blue-500/50 text-blue-400 bg-blue-950/30" icon={<Radio size={16} />} live={chanLive} />
      <FlowConnector active={chanLive || msg.user > 0} color="bg-blue-400" speed={chanLive ? 0.6 : speed(msg.user)} />
      <FlowNode label="LLM" count={msg.assistant} color="border-violet-500/50 text-violet-400 bg-violet-950/30" icon={<Bot size={16} />} live={modelLive} />
      <FlowConnector active={toolLive || msg.toolCalls > 0} color="bg-amber-400" speed={toolLive ? 0.6 : speed(msg.toolCalls)} />
      <FlowNode label="Tool calls" count={msg.toolCalls} color="border-amber-500/50 text-amber-400 bg-amber-950/30" icon={<Wrench size={16} />} live={toolLive} />
      <FlowConnector active={modelLive || msg.assistant > 0} color="bg-green-400" speed={modelLive ? 0.6 : speed(msg.assistant)} />
      <FlowNode label="Responses" count={msg.assistant} color="border-green-500/50 text-green-400 bg-green-950/30" icon={<Send size={16} />} live={chanLive} />
      <FlowConnector active={errLive || msg.errors > 0} color="bg-red-400" speed={errLive ? 0.6 : speed(msg.errors)} />
      <FlowNode label="Errors" count={msg.errors} color="border-red-500/50 text-red-400 bg-red-950/30" icon={<AlertTriangle size={16} />} live={errLive} />
    </div>
  )
}

// ─── Sessions list + transcript drawer ───────────────────────────────────────────

function fmtDur(ms: number): string {
  if (!ms || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function TranscriptBubble({ msg, badge }: { msg: LiveChatMessage; badge: string }) {
  const isUser = msg.role === 'user'
  return (
    <div className={clsx('flex gap-2 mb-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={clsx('w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-semibold text-white mt-0.5',
        isUser ? 'bg-violet-600' : 'bg-blue-700')}>
        {isUser ? 'U' : badge}
      </div>
      <div className={clsx('flex flex-col gap-0.5 max-w-[82%]', isUser && 'items-end')}>
        <div className={clsx('px-2.5 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap break-words',
          isUser ? 'bg-violet-950/50 border border-violet-900/50 text-violet-100 rounded-tr-sm'
                 : 'bg-card border border-border text-text-secondary rounded-tl-sm')}>
          {msg.content}
        </div>
        {msg.timestamp && <span className="text-[9px] text-text-muted px-1">{relTime(msg.timestamp)}</span>}
      </div>
    </div>
  )
}

function TranscriptDrawer({ source, session, badge, onClose }: {
  source: ConnectorId; session: MetricSessionRow; badge: string; onClose: () => void
}) {
  useEscapeKey(onClose)
  const [messages, setMessages] = useState<LiveChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null); setMessages([])
    const api = source === 'openclaw' ? openclawChats : hermesChats
    api.session(session.key)
      .then(d => { if (alive) setMessages(d.session.messages ?? []) })
      .catch(e => { if (alive) setError(e.message ?? 'Failed to load transcript') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [source, session.key])

  return (
    <div className="flex flex-col h-full w-[420px] min-w-[420px] border-l border-border bg-surface overflow-hidden">
      <div className="flex items-start justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{session.title}</p>
          <div className="flex items-center gap-2 flex-wrap text-xxs text-text-muted mt-0.5">
            {session.channel && <span>{session.channel}</span>}
            {session.model && <span className="font-mono">{session.model}</span>}
            <span>{fmtTokens(session.tokens)} tok</span>
            {session.cost > 0 && <span>{fmtCost(session.cost)}</span>}
            {session.runtimeMs > 0 && <span>{fmtDur(session.runtimeMs)}</span>}
          </div>
        </div>
        <button aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-card text-text-muted hover:text-text-primary transition-colors shrink-0"><X size={15} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? <p className="text-xs text-text-muted animate-pulse text-center py-8">Loading transcript…</p>
          : error ? <p className="text-xs text-red-400 py-4">{error}</p>
          : messages.length === 0 ? <p className="text-xs text-text-muted text-center py-8">No readable messages</p>
          : messages.map((msg, i) => <TranscriptBubble key={i} msg={msg} badge={badge} />)}
      </div>
    </div>
  )
}

function ContextBar({ pct }: { pct: number | null }) {
  if (pct == null) return null
  const color = pct >= 85 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-400' : 'bg-green-500'
  return (
    <div className="flex items-center gap-1.5 shrink-0 w-16" title={`~${pct}% of context window`}>
      <div className="flex-1 h-1 rounded-full bg-base overflow-hidden">
        <div className={clsx('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={clsx('text-xxs tabular-nums w-7 text-right', pct >= 85 ? 'text-red-400' : pct >= 60 ? 'text-amber-300' : 'text-text-muted')}>{pct}%</span>
    </div>
  )
}

function SessionsTable({ sessions, onPick }: { sessions: MetricSessionRow[]; onPick: (s: MetricSessionRow) => void }) {
  const [sort, setSort] = useState<'recent' | 'tokens' | 'cost' | 'ctx'>('recent')
  const sorted = [...sessions].sort((a, b) =>
    sort === 'tokens' ? b.tokens - a.tokens
    : sort === 'cost'   ? b.cost - a.cost
    : sort === 'ctx'    ? (b.contextPct ?? -1) - (a.contextPct ?? -1)
    : new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
  ).slice(0, 40)

  const hasCtx = sessions.some(s => s.contextPct != null)

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 bg-base rounded border border-border p-0.5 w-fit">
        {(['recent', 'tokens', 'cost', ...(hasCtx ? ['ctx'] : [])] as const).map(k => (
          <button key={k} onClick={() => setSort(k as typeof sort)} className={clsx('px-2 py-0.5 rounded text-xxs capitalize', sort === k ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
            {k === 'ctx' ? 'context %' : k}
          </button>
        ))}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
        {sorted.map(s => (
          <button key={s.key} onClick={() => onPick(s)} className="flex items-center gap-3 px-3 py-2 bg-card hover:bg-card-hover transition-colors text-left group">
            <span className="shrink-0">{s.isHeartbeat ? <HeartPulse size={12} className="text-emerald-400" /> : <MessageSquare size={12} className="text-text-muted" />}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-text-primary truncate">{s.title}</p>
              <p className="text-xxs text-text-muted truncate">
                {[s.channel, s.model, s.status].filter(Boolean).join(' · ') || s.key}
              </p>
            </div>
            {hasCtx && <ContextBar pct={s.contextPct} />}
            <div className="text-right shrink-0">
              <p className="text-xxs text-text-secondary tabular-nums">{fmtTokens(s.tokens)} tok{s.cost > 0 ? ` · ${fmtCost(s.cost)}` : ''}</p>
              <p className="text-xxs text-text-muted">{relTime(s.updatedAt)}</p>
            </div>
            <ChevronRight size={12} className="text-text-muted group-hover:text-text-secondary shrink-0" />
          </button>
        ))}
        {sorted.length === 0 && <p className="text-xxs text-text-muted px-3 py-3">No sessions</p>}
      </div>
    </div>
  )
}

// ─── Autonomy gauge ──────────────────────────────────────────────────────────────

function AutonomyGauge({ score, level, accent }: { score: number; level: string; accent: string }) {
  const R = 70, C = 2 * Math.PI * R, ARC = 0.75 // 270° arc
  const len = C * ARC
  const filled = len * (score / 100)
  const color = score >= 75 ? '#34d399' : score >= 55 ? '#a78bfa' : score >= 30 ? '#fbbf24' : '#94a3b8'
  return (
    <div className="flex flex-col items-center justify-center">
      <svg viewBox="0 0 180 180" className="w-44 h-44">
        <g transform="rotate(135 90 90)">
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--border)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${len} ${C}`} />
          <circle cx="90" cy="90" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${filled} ${C}`} style={{ transition: 'stroke-dasharray 0.9s ease-out' }} />
        </g>
        <text x="90" y="84" textAnchor="middle" className="fill-text-primary" style={{ fontSize: 34, fontWeight: 700 }}>{score}</text>
        <text x="90" y="104" textAnchor="middle" className="fill-text-muted" style={{ fontSize: 10 }}>/ 100</text>
      </svg>
      <span className={clsx('text-sm font-semibold -mt-2', accent)}>{level}</span>
    </div>
  )
}

// ─── Brain Overview animated board ────────────────────────────────────────────────

// Map a live event to the brain node(s) it "lights up" — content-driven so it
// works for OpenClaw's typed events AND Hermes' log lines.
function eventNodeIds(ev: LiveEvent, m: PlatformMetrics): string[] {
  if (ev.kind === 'health') return ['center']
  const hay = `${ev.event} ${ev.title} ${ev.sub ?? ''} ${ev.sessionKey ?? ''}`.toLowerCase()
  const ids = new Set<string>()
  for (const c of m.channels) if (hay.includes(c.id.toLowerCase()) || hay.includes(c.label.toLowerCase())) ids.add(`ch:${c.id}`)
  if (ev.kind === 'tool' || /\btool|tool_call|web_search|web_extract|web_fetch|\bbash\b|\bexec\b|apply_patch|run_query|read_file/.test(hay)) ids.add('tools')
  if (ev.kind === 'cron' || /cron|schedul|heartbeat/.test(hay)) ids.add('cron')
  if (/subagent|sub-agent|spawn|delegate/.test(hay)) ids.add('subagents')
  if (/\bmodel|\bllm\b|completion|inference|provider|gpt|claude|gemini|openai|anthropic|auxiliary|reasoning/.test(hay)) ids.add('models')
  if (/memory|soul\.md|memory\.md|agents\.md|recall|embed|lancedb/.test(hay)) ids.add('memory')
  if (/\bskill/.test(hay)) ids.add('skills')
  // A message/inbound/response with no specific match → light all channels faintly.
  if (ids.size === 0 && (ev.kind === 'message' || ev.kind === 'session' || /inbound|response|message/.test(hay))) {
    for (const c of m.channels) ids.add(`ch:${c.id}`)
  }
  return [...ids]
}

interface BNode { id: string; x: number; y: number; label: string; icon: string; color: string; value?: string; active: boolean; r: number }

function BrainBoard({ m, activeSet }: { m: PlatformMetrics; activeSet: Set<string> }) {
  const has = (id: string) => activeSet.has(id)
  const chanLive = [...activeSet].some(id => id.startsWith('ch:'))

  // ── Inputs (channels + cron) stacked on the left ──
  const inputs: BNode[] = m.channels.map(c => ({
    id: `ch:${c.id}`, x: 50, y: 0, label: c.label, icon: '📡',
    color: c.running ? '#34d399' : c.configured ? '#fbbf24' : '#64748b',
    value: c.running ? 'on' : 'off', active: has(`ch:${c.id}`), r: 19,
  }))
  if (m.cron.total > 0) inputs.push({ id: 'cron', x: 50, y: 0, label: 'Cron', icon: '⏰', color: '#22d3ee', value: String(m.cron.total), active: has('cron'), r: 19 })
  const startY = 120 - (inputs.length - 1) * 30
  inputs.forEach((n, i) => { n.y = startY + i * 60 })

  // ── Pipeline core → llm → tools / response ──
  const core: BNode = { id: 'core', x: 175, y: 120, label: m.source === 'hermes' ? 'Hermes' : 'OpenClaw', icon: m.source === 'hermes' ? '☤' : '🐾', color: '#c4b5fd', value: '', active: has('center'), r: 27 }
  const llm: BNode = { id: 'llm', x: 300, y: 92, label: 'LLM', icon: '🧠', color: '#a78bfa', value: String(m.models.length), active: has('models'), r: 23 }
  const tools: BNode | null = m.tools.length > 0 ? { id: 'tools', x: 425, y: 50, label: 'Tools', icon: '🔧', color: '#fbbf24', value: String(m.tools.length), active: has('tools'), r: 20 } : null
  const response: BNode = { id: 'response', x: 425, y: 148, label: 'Response', icon: '💬', color: '#34d399', value: '', active: chanLive, r: 20 }

  // ── Subsystems the LLM/core draw on, along the bottom ──
  const subDefs = [
    m.skills.length > 0     && { id: 'skills',    label: 'Skills',     icon: '📦', color: '#5eead4', value: String(m.skills.length),     active: has('skills') },
    m.memoryFiles.length > 0 && { id: 'memory',   label: 'Memory',     icon: '📄', color: '#60a5fa', value: String(m.memoryFiles.length), active: has('memory') },
    m.subAgents.total > 0   && { id: 'subagents', label: 'Sub-agents', icon: '🌿', color: '#f472b6', value: String(m.subAgents.total),   active: has('subagents') },
  ].filter(Boolean) as Array<Omit<BNode, 'x' | 'y' | 'r'>>
  const bottom: BNode[] = subDefs.map((s, i) => ({ ...s, x: 230 + i * 95, y: 235, r: 18 }))

  const nodes: BNode[] = [...inputs, core, llm, ...(tools ? [tools] : []), response, ...bottom]
  const byId: Record<string, BNode> = Object.fromEntries(nodes.map(n => [n.id, n]))

  // ── Directional edges: [from, to, dashed?] ──
  const edges: Array<[string, string, boolean?]> = []
  inputs.forEach(n => edges.push([n.id, 'core']))
  edges.push(['core', 'llm'])
  if (tools) { edges.push(['llm', 'tools']); edges.push(['tools', 'llm', true]) } // tool-result loop
  edges.push(['llm', 'response'])
  m.channels.forEach(c => edges.push(['response', `ch:${c.id}`, true])) // response flows back out
  bottom.forEach(s => {
    if (s.id === 'subagents') edges.push(['core', s.id])
    else { edges.push(['llm', s.id]); edges.push([s.id, 'llm', true]) } // memory/skills read+write
  })

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox="0 0 500 290" className="w-full max-w-[680px] mx-auto" style={{ minWidth: 440 }}>
        {/* edges */}
        {edges.map(([fromId, toId, dashed], i) => {
          const a = byId[fromId], b = byId[toId]
          if (!a || !b) return null
          const on = a.active || b.active
          const dur = on ? 0.7 : 2.6
          return (
            <g key={`e${i}`}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={b.color}
                strokeOpacity={on ? 0.85 : 0.18} strokeWidth={on ? 2.5 : 1.2}
                strokeDasharray={dashed ? '3 5' : undefined} />
              {/* a dot always travels source→target to show flow direction */}
              <circle r={on ? 3.5 : 1.8} fill={b.color} opacity={on ? 1 : 0.4}>
                <animate attributeName="cx" values={`${a.x};${b.x}`} dur={`${dur}s`} repeatCount="indefinite" />
                <animate attributeName="cy" values={`${a.y};${b.y}`} dur={`${dur}s`} repeatCount="indefinite" />
              </circle>
            </g>
          )
        })}
        {/* nodes */}
        {nodes.map((p, i) => (
          <g key={`n${i}`}>
            {p.active && <circle cx={p.x} cy={p.y} r={p.r} fill="none" stroke={p.color}>
              <animate attributeName="r" values={`${p.r};${p.r + 12}`} dur="1s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.6;0" dur="1s" repeatCount="indefinite" />
            </circle>}
            {p.id === 'core' && <circle cx={p.x} cy={p.y} r={p.r + 8} fill="currentColor" className="text-violet-500/10" style={{ animation: 'brain-pulse 2.6s ease-in-out infinite' }} />}
            <circle cx={p.x} cy={p.y} r={p.r} fill="var(--bg-card)" stroke={p.color} strokeOpacity={p.active ? 1 : 0.5} strokeWidth={p.active ? 2.5 : 1.5} />
            <text x={p.x} y={p.y + (p.value ? -2 : 5)} textAnchor="middle" style={{ fontSize: p.id === 'core' ? 20 : 14 }}>{p.icon}</text>
            {p.value ? <text x={p.x} y={p.y + 10} textAnchor="middle" style={{ fontSize: 8, fontWeight: 700 }} fill={p.color}>{p.value}</text> : null}
            <text x={p.x} y={p.y + p.r + 11} textAnchor="middle" className="fill-text-muted" style={{ fontSize: 9 }}>{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ─── Sub-agent tree ────────────────────────────────────────────────────────────────

function SubAgentTree({ m, accent }: { m: PlatformMetrics; accent: string }) {
  if (m.subAgents.total === 0) return <p className="text-xxs text-text-muted py-2">No sub-agents spawned</p>
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={clsx('w-2 h-2 rounded-full', accent.replace('text-', 'bg-'))} />
        <span className="text-text-primary font-medium">main agent</span>
        <span className="text-xxs text-text-muted">spawned {m.subAgents.total}</span>
      </div>
      <div className="pl-2 ml-1 border-l border-border flex flex-col gap-1 mt-1">
        {m.subAgents.recent.map(s => (
          <div key={s.key} className="flex items-center gap-2 text-xxs pl-3 relative">
            <span className="absolute left-0 top-1/2 w-2.5 h-px bg-border" />
            <span className={clsx('shrink-0', s.status === 'error' ? 'text-red-400' : 'text-text-muted')}>↳</span>
            <span className="text-text-secondary truncate flex-1">{s.title}</span>
            <span className="text-text-muted shrink-0">{fmtTokens(s.tokens)} tok · {relTime(s.updatedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Live event stream (SSE) ──────────────────────────────────────────────────────

interface LiveEvent { seq: number; ts: string; event: string; kind: string; title: string; sub: string; sessionKey?: string; health?: any }

function useEventStream(source: ConnectorId, enabled: boolean) {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!enabled) { setEvents([]); setConnected(false); return }
    let es: EventSource | null = null
    try { es = new EventSource(`/api/${source}/stream`) } catch { return }
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = e => {
      try {
        const ev = JSON.parse(e.data) as LiveEvent
        setEvents(prev => (prev[0]?.seq === ev.seq ? prev : [ev, ...prev].slice(0, 250)))
      } catch { /* ignore */ }
    }
    return () => es?.close()
  }, [source, enabled])
  return { events, connected }
}

const CAT_STYLE: Record<string, { dot: string; tag: string; text: string }> = {
  message: { dot: 'bg-blue-400',    tag: 'text-blue-300 bg-blue-950/40 border-blue-900/40',       text: 'text-blue-100/90' },
  tool:    { dot: 'bg-amber-400',   tag: 'text-amber-300 bg-amber-950/40 border-amber-900/40',    text: 'text-amber-100/90' },
  model:   { dot: 'bg-violet-400',  tag: 'text-violet-300 bg-violet-950/40 border-violet-900/40', text: 'text-violet-100/90' },
  cron:    { dot: 'bg-emerald-400', tag: 'text-emerald-300 bg-emerald-950/40 border-emerald-900/40', text: 'text-emerald-100/90' },
  memory:  { dot: 'bg-cyan-400',    tag: 'text-cyan-300 bg-cyan-950/40 border-cyan-900/40',       text: 'text-cyan-100/90' },
  skill:   { dot: 'bg-teal-400',    tag: 'text-teal-300 bg-teal-950/40 border-teal-900/40',       text: 'text-teal-100/90' },
  session: { dot: 'bg-fuchsia-400', tag: 'text-fuchsia-300 bg-fuchsia-950/40 border-fuchsia-900/40', text: 'text-fuchsia-100/90' },
  error:   { dot: 'bg-red-400',     tag: 'text-red-300 bg-red-950/50 border-red-900/50',          text: 'text-red-200' },
  health:  { dot: 'bg-slate-500',   tag: 'text-text-muted bg-base border-border',                 text: 'text-text-muted' },
  info:    { dot: 'bg-sky-500/70',  tag: 'text-text-muted bg-base border-border',                 text: 'text-text-secondary' },
}

// Classify an event into a colored category from its content.
function categorize(ev: LiveEvent): string {
  if (ev.kind === 'error') return 'error'
  if (ev.kind === 'health') return 'health'
  const hay = `${ev.event} ${ev.title} ${ev.sub ?? ''}`.toLowerCase()
  if (/web_search|web_extract|web_fetch|\btool|tool_call|\bbash\b|\bexec\b|apply_patch|read_file|run_query|invoke/.test(hay)) return 'tool'
  if (/cron|schedul|heartbeat/.test(hay)) return 'cron'
  if (/inbound|response ready|sending response|flushing|platform=|discord|telegram|slack|whatsapp|signal/.test(hay)) return 'message'
  if (/\bmodel|\bllm\b|completion|auxiliary|vision|reasoning|gpt|claude|gemini|provider|inference/.test(hay)) return 'model'
  if (/memory|recall|embed|lancedb|soul\.md|memory\.md/.test(hay)) return 'memory'
  if (/\bskill/.test(hay)) return 'skill'
  if (ev.kind === 'session') return 'session'
  return 'info'
}

// Pull the log "module" (e.g. gateway.run) off the front of a message for a compact source tag.
function eventSource(ev: LiveEvent): { src: string; msg: string } {
  const m = (ev.sub ?? '').match(/^([a-z_]+(?:\.[a-z_]+)+):\s*(.*)$/i)
  if (m) return { src: m[1], msg: m[2] }
  return { src: ev.title, msg: ev.sub ?? '' }
}

function LiveEventTail({ events, connected }: { events: LiveEvent[]; connected: boolean }) {
  const [hideHealth, setHideHealth] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  let shown = hideHealth ? events.filter(e => e.kind !== 'health') : events
  if (filter !== 'all') shown = shown.filter(e => categorize(e) === filter)
  shown = shown.slice(0, 120)
  const cats = ['all', 'message', 'tool', 'model', 'cron', 'error']
  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-xxs font-semibold">
          <span className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-400' : 'bg-text-muted')} style={{ animation: connected ? 'flow-node-pulse 1.4s ease-in-out infinite' : undefined }} />
          <span className={connected ? 'text-green-400' : 'text-text-muted'}>{connected ? 'LIVE' : 'connecting…'}</span>
        </span>
        <span className="text-xxs text-text-muted">{events.length} events</span>
        <div className="flex items-center gap-0.5 ml-auto bg-base rounded border border-border p-0.5">
          {cats.map(c => (
            <button key={c} onClick={() => setFilter(c)} className={clsx('px-1.5 py-0.5 rounded text-xxs capitalize', filter === c ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>{c}</button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-xxs text-text-muted cursor-pointer select-none">
          <input type="checkbox" checked={hideHealth} onChange={e => setHideHealth(e.target.checked)} className="accent-current" />
          hide health
        </label>
      </div>
      <div className="flex flex-col gap-0.5 max-h-[360px] overflow-y-auto rounded-lg border border-border bg-base p-2">
        {shown.length === 0 ? (
          <p className="text-xxs text-text-muted py-6 text-center">Waiting for events… (messages, tool calls and cron runs appear here as they happen)</p>
        ) : shown.map(e => {
          const cat = categorize(e)
          const st = CAT_STYLE[cat] ?? CAT_STYLE.info
          const { src, msg } = eventSource(e)
          return (
            <div key={e.seq} className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-card text-xxs leading-tight">
              <span className="text-text-muted shrink-0 tabular-nums w-[52px] font-mono">{new Date(e.ts).toLocaleTimeString([], { hour12: false })}</span>
              <span className={clsx('shrink-0 px-1 rounded border text-[9px] font-semibold uppercase mt-px w-[58px] text-center', st.tag)}>{cat}</span>
              <span className="text-text-secondary shrink-0 font-mono max-w-[150px] truncate" title={src}>{src}</span>
              <span className={clsx('truncate', st.text)} title={msg}>{msg}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Live gateway load (from streamed health events) ──────────────────────────────

function GatewayLoad({ events }: { events: LiveEvent[] }) {
  const samples = events.filter(e => e.kind === 'health' && e.health?.eventLoop).slice(0, 32).reverse()
    .map(e => ({ p99: Number(e.health.eventLoop.delayP99Ms) || 0, util: Number(e.health.eventLoop.utilization) || 0 }))
  if (samples.length === 0) return <p className="text-xxs text-text-muted py-3 text-center">Waiting for live health samples…</p>
  const maxP = Math.max(...samples.map(s => s.p99), 1)
  const cur = samples[samples.length - 1]
  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-xxs">
        <span className="text-text-secondary">event-loop p99 <span className="font-semibold text-text-primary">{fmtMs(cur.p99)}</span></span>
        <span className="text-text-muted">utilization {Math.round(cur.util * 100)}%</span>
        <span className="text-text-muted ml-auto">{samples.length} live samples</span>
      </div>
      <div className="flex items-end gap-[2px] h-16">
        {samples.map((s, i) => (
          <div key={i} className={clsx('flex-1 rounded-t', s.p99 > 100 ? 'bg-amber-500/70' : 'bg-emerald-500/60')}
            title={`p99 ${fmtMs(s.p99)} · util ${Math.round(s.util * 100)}%`}
            style={{ height: `${Math.max(3, (s.p99 / maxP) * 100)}%`, opacity: i === samples.length - 1 ? 1 : 0.55 }} />
        ))}
      </div>
    </div>
  )
}

function fmtUptime(ms: number): string {
  if (!ms || ms < 0) return '—'
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ─── Tool analytics table ──────────────────────────────────────────────────────────

type ToolSort = 'calls' | 'errors' | 'errRate' | 'avgMs'

function ToolsTable({ tools, theme }: { tools: PlatformMetrics['tools']; theme: typeof THEME[ConnectorId] }) {
  const [sort, setSort] = useState<ToolSort>('calls')

  const totalCalls = tools.reduce((s, t) => s + t.count, 0) || 1
  const sorted = [...tools].sort((a, b) => {
    if (sort === 'calls')   return b.count - a.count
    if (sort === 'errors')  return b.errors - a.errors
    if (sort === 'errRate') return (b.errors / Math.max(b.count, 1)) - (a.errors / Math.max(a.count, 1))
    if (sort === 'avgMs')   return (b.avgMs ?? -1) - (a.avgMs ?? -1)
    return 0
  })

  const hasLatency = tools.some(t => t.avgMs != null && t.avgMs > 0)
  const hasErrors  = tools.some(t => t.errors > 0)

  const ColHeader = ({ id, label }: { id: ToolSort; label: string }) => (
    <button onClick={() => setSort(id)} className={clsx('text-left text-xxs uppercase tracking-wide font-semibold transition-colors', sort === id ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
      {label}{sort === id ? ' ↓' : ''}
    </button>
  )

  if (tools.length === 0) return <p className="text-xxs text-text-muted py-4 text-center">No tool usage data</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left pb-2 pr-4 min-w-[140px]"><ColHeader id="calls" label="Tool" /></th>
            <th className="text-right pb-2 px-3 w-20"><ColHeader id="calls" label="Calls" /></th>
            <th className="text-right pb-2 px-3 w-20"><span className="text-xxs uppercase tracking-wide font-semibold text-text-muted">Share</span></th>
            {hasErrors && <>
              <th className="text-right pb-2 px-3 w-16"><ColHeader id="errors" label="Errors" /></th>
              <th className="text-right pb-2 px-3 w-16"><ColHeader id="errRate" label="Err%" /></th>
            </>}
            {hasLatency && <th className="text-right pb-2 pl-3 w-20"><ColHeader id="avgMs" label="Avg ms" /></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map(t => {
            const share   = t.count / totalCalls
            const errPct  = t.count > 0 ? (t.errors / t.count) * 100 : 0
            const errTone = errPct > 20 ? 'text-red-400' : errPct > 5 ? 'text-amber-300' : 'text-text-muted'
            return (
              <tr key={t.name} className="group hover:bg-card-hover transition-colors">
                <td className="py-2 pr-4">
                  <span className="font-mono text-text-primary">{t.name}</span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-text-secondary">{fmtNum(t.count)}</td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-base overflow-hidden min-w-[40px]">
                      <div className={clsx('h-full rounded-full', theme.bar)} style={{ width: `${Math.max(2, share * 100)}%` }} />
                    </div>
                    <span className="tabular-nums text-text-muted text-xxs w-8 text-right">{Math.round(share * 100)}%</span>
                  </div>
                </td>
                {hasErrors && <>
                  <td className="py-2 px-3 text-right tabular-nums text-text-muted">{t.errors > 0 ? fmtNum(t.errors) : '—'}</td>
                  <td className={clsx('py-2 px-3 text-right tabular-nums font-medium', errTone)}>{t.errors > 0 ? `${errPct.toFixed(1)}%` : '—'}</td>
                </>}
                {hasLatency && <td className="py-2 pl-3 text-right tabular-nums text-text-muted">{t.avgMs != null && t.avgMs > 0 ? fmtMs(t.avgMs) : '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Budget gauge ─────────────────────────────────────────────────────────────

function BudgetBar({ label, used, limit, fmt }: { label: string; used: number; limit: number | null; fmt: (n: number) => string }) {
  const pct   = limit ? Math.min(100, Math.round((used / limit) * 100)) : null
  const color  = pct == null ? 'bg-slate-600' : pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'
  const textCl = pct == null ? 'text-text-muted' : pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-300' : 'text-emerald-400'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xxs">
        <span className="text-text-muted uppercase tracking-wide">{label}</span>
        <span className={textCl}>{fmt(used)}{limit ? ` / ${fmt(limit)}` : ' (no limit)'}</span>
      </div>
      <div className="h-2 rounded-full bg-base overflow-hidden">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct ?? 0}%` }} />
      </div>
      {pct != null && <div className="flex justify-between text-xxs text-text-muted"><span>{pct}% used</span>{limit && <span>{fmt(limit - used)} remaining</span>}</div>}
    </div>
  )
}

type BudgetField = 'daily.cost' | 'daily.tokens' | 'weekly.cost' | 'weekly.tokens'

function BudgetGauge({ m }: { m: PlatformMetrics }) {
  const [limits, setLimits]   = useState<BudgetLimits>({ daily: { cost: null, tokens: null }, weekly: { cost: null, tokens: null } })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [draft, setDraft]     = useState<Record<BudgetField, string>>({
    'daily.cost': '', 'daily.tokens': '', 'weekly.cost': '', 'weekly.tokens': '',
  })

  useEffect(() => {
    budgetsApi.get().then(b => {
      setLimits(b)
      setDraft({
        'daily.cost':    b.daily.cost    != null ? String(b.daily.cost)    : '',
        'daily.tokens':  b.daily.tokens  != null ? String(b.daily.tokens)  : '',
        'weekly.cost':   b.weekly.cost   != null ? String(b.weekly.cost)   : '',
        'weekly.tokens': b.weekly.tokens != null ? String(b.weekly.tokens) : '',
      })
    }).catch(() => {})
  }, [])

  // Today's usage from daily array
  const today = new Date().toISOString().slice(0, 10)
  const todayRow = m.daily.find(d => d.date === today)
  const todayTokens = todayRow?.tokens ?? 0
  const todayCost   = todayRow?.cost   ?? 0

  // This week — sum last 7 days
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
  const weekRows = m.daily.filter(d => d.date >= weekAgo)
  const weekTokens = weekRows.reduce((s, d) => s + d.tokens, 0)
  const weekCost   = weekRows.reduce((s, d) => s + d.cost, 0)

  const save = async () => {
    setSaving(true)
    const parse = (k: BudgetField) => { const v = parseFloat(draft[k]); return (Number.isFinite(v) && v > 0) ? v : null }
    const updated: BudgetLimits = {
      daily:  { cost: parse('daily.cost'),  tokens: parse('daily.tokens') },
      weekly: { cost: parse('weekly.cost'), tokens: parse('weekly.tokens') },
    }
    try { const r = await budgetsApi.set(updated); setLimits(r); setEditing(false) } catch { /* ignore */ } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-lg border border-border bg-surface/30 p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-text-primary uppercase tracking-wide">Today</p>
          <BudgetBar label="Cost"   used={todayCost}   limit={limits.daily.cost}   fmt={fmtCost} />
          <BudgetBar label="Tokens" used={todayTokens} limit={limits.daily.tokens} fmt={fmtTokens} />
        </div>
        <div className="rounded-lg border border-border bg-surface/30 p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-text-primary uppercase tracking-wide">This week</p>
          <BudgetBar label="Cost"   used={weekCost}   limit={limits.weekly.cost}   fmt={fmtCost} />
          <BudgetBar label="Tokens" used={weekTokens} limit={limits.weekly.tokens} fmt={fmtTokens} />
        </div>
      </div>

      {!editing ? (
        <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xxs text-text-muted hover:text-text-secondary transition-colors self-start">
          <Edit2 size={11} /> Set budget limits
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
          <p className="text-xs font-semibold text-text-primary">Budget limits</p>
          {([ ['daily.cost','Daily cost ($)'], ['daily.tokens','Daily tokens'], ['weekly.cost','Weekly cost ($)'], ['weekly.tokens','Weekly tokens'] ] as [BudgetField, string][]).map(([k, lbl]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="text-xxs text-text-muted w-32 shrink-0">{lbl}</span>
              <input
                type="number" min={0} value={draft[k]} placeholder="no limit"
                onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                className="flex-1 bg-base border border-border rounded px-2 py-1 text-xs text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-border"
              />
            </div>
          ))}
          <div className="flex gap-2 mt-1">
            <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-xxs px-3 py-1.5 bg-card-hover rounded border border-border text-text-primary hover:border-text-muted transition-colors">
              {saving ? <Loader size={11} className="animate-spin" /> : <Save size={11} />} Save
            </button>
            <button onClick={() => setEditing(false)} className="text-xxs px-3 py-1.5 text-text-muted hover:text-text-secondary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Hourly heatmap ───────────────────────────────────────────────────────────

// ─── Spawn tree ───────────────────────────────────────────────────────────────

type SpawnNode = { agent: MetricSubAgent; children: SpawnNode[] }

function buildTree(agents: MetricSubAgent[]): SpawnNode[] {
  const byKey = new Map(agents.map(a => [a.key, { agent: a, children: [] as SpawnNode[] }]))
  const roots: SpawnNode[] = []
  for (const node of byKey.values()) {
    const parentNode = node.agent.parentKey ? byKey.get(node.agent.parentKey) : null
    if (parentNode) parentNode.children.push(node)
    else roots.push(node)
  }
  return roots
}

function SpawnNode({ node, depth = 0 }: { node: SpawnNode; depth?: number }) {
  const a = node.agent
  const isActive = a.status === 'active' || a.status === 'running'
  return (
    <div>
      <div className={clsx('flex items-center gap-2 py-1.5 px-2 rounded hover:bg-card-hover transition-colors', depth > 0 && 'ml-4 border-l border-border pl-4')} style={depth > 1 ? { marginLeft: depth * 16 } : {}}>
        <div className={clsx('w-1.5 h-1.5 rounded-full shrink-0', isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500')} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-primary truncate">{a.title || a.key}</p>
          {a.key !== a.title && <p className="text-xxs text-text-muted font-mono truncate">{a.key}</p>}
        </div>
        <span className={clsx('text-xxs px-1.5 py-0.5 rounded shrink-0', isActive ? 'bg-emerald-900/40 text-emerald-300' : 'bg-card text-text-muted')}>{a.status || 'done'}</span>
        {a.tokens > 0 && <span className="text-xxs text-text-muted tabular-nums shrink-0">{fmtTokens(a.tokens)}</span>}
      </div>
      {node.children.map(c => <SpawnNode key={c.agent.key} node={c} depth={depth + 1} />)}
    </div>
  )
}

function SpawnTree({ subAgents }: { subAgents: PlatformMetrics['subAgents'] }) {
  const { recent, total } = subAgents
  if (recent.length === 0) {
    return <p className="text-xxs text-text-muted py-2">No sub-agent sessions found</p>
  }
  const roots = buildTree(recent)
  const hasParentData = recent.some(a => a.parentKey != null)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-2 text-xxs text-text-muted">
        <Bot size={12} />
        <span>{total} total sub-agent spawn{total === 1 ? '' : 's'} · showing {recent.length} recent</span>
        {!hasParentData && <span className="ml-auto italic">parent data unavailable for this source</span>}
      </div>
      {roots.map(r => <SpawnNode key={r.agent.key} node={r} />)}
    </div>
  )
}

function HourlyHeatmap({ source }: { source: ConnectorId }) {
  const [hours, setHours]   = useState<number[]>(Array(24).fill(0))
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () => watchHeatmap().then(d => { if (!cancelled) { setHours(d.hours); setLoading(false) } }).catch(() => setLoading(false))
    load()
    const t = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [source])

  const max   = Math.max(...hours, 1)
  const total = hours.reduce((a, b) => a + b, 0)
  const now   = new Date().getHours()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-xxs text-text-muted">
        <span>{total.toLocaleString()} events today</span>
        {loading && <Loader size={10} className="animate-spin" />}
      </div>
      <div className="flex items-end gap-px" style={{ height: 80 }}>
        {hours.map((cnt, hr) => {
          const pct = Math.round((cnt / max) * 100)
          const isCurrent = hr === now
          const intensity = pct === 0 ? 'bg-base' : pct < 20 ? 'bg-amber-900/40' : pct < 50 ? 'bg-amber-700/60' : pct < 80 ? 'bg-amber-500/80' : 'bg-amber-400'
          return (
            <div key={hr} className="flex-1 flex flex-col items-center gap-1" title={`${hr}:00 — ${cnt} events`}>
              <div className="w-full flex items-end justify-center" style={{ height: 64 }}>
                <div
                  className={clsx('w-full rounded-t transition-all', intensity, isCurrent && 'ring-1 ring-white/30')}
                  style={{ height: `${Math.max(pct, cnt > 0 ? 6 : 1)}%` }}
                />
              </div>
              {hr % 4 === 0 && (
                <span className={clsx('text-xxs tabular-nums', isCurrent ? 'text-amber-300' : 'text-text-muted')}>
                  {hr.toString().padStart(2, '0')}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex gap-6 flex-wrap">
        {hours.map((cnt, hr) => cnt > 0 && (
          <div key={hr} className="flex items-center gap-1.5 text-xxs">
            <span className={clsx('font-mono text-text-secondary', hr === now && 'text-amber-300')}>{hr.toString().padStart(2, '0')}:00</span>
            <span className="text-text-muted">{cnt}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Security / health alerts ─────────────────────────────────────────────────────

type Sev = 'high' | 'medium' | 'low' | 'ok'
interface Alert { sev: Sev; title: string; detail: string }

function computeAlerts(m: PlatformMetrics, events: LiveEvent[]): Alert[] {
  const a: Alert[] = []
  // Channel down
  for (const c of m.channels) if (c.configured && !c.running) a.push({ sev: 'high', title: `${c.label} channel down`, detail: 'configured but not running' })
  // Cron failures
  if (m.cron.failures > 0) a.push({ sev: m.cron.successRate < 60 ? 'high' : 'medium', title: `${m.cron.failures} cron failure${m.cron.failures === 1 ? '' : 's'}`, detail: `${m.cron.successRate}% success across recent runs` })
  // Error rate
  if (m.messages && m.messages.total > 0) {
    const er = m.messages.errors / m.messages.total
    if (er > 0.2) a.push({ sev: 'high', title: 'High error rate', detail: `${Math.round(er * 100)}% of messages errored (${fmtNum(m.messages.errors)})` })
    else if (er > 0.1) a.push({ sev: 'medium', title: 'Elevated error rate', detail: `${Math.round(er * 100)}% of messages errored` })
  }
  // Error spike (live)
  const recentErr = events.filter(e => e.kind === 'error' && Date.now() - new Date(e.ts).getTime() < 120_000).length
  if (recentErr >= 3) a.push({ sev: 'high', title: 'Error spike', detail: `${recentErr} errors in the last 2 min` })
  // Stuck / runaway run (very long max latency)
  if (m.latency?.maxMs && m.latency.maxMs > 600_000) a.push({ sev: 'medium', title: 'Possible stuck / runaway turn', detail: `longest turn ran ${fmtMs(m.latency.maxMs)}` })
  // Cost spike (today vs prior-day average)
  if (m.daily.length >= 4) {
    const last = m.daily[m.daily.length - 1]
    const prior = m.daily.slice(0, -1)
    const mean = prior.reduce((s, d) => s + d.cost, 0) / Math.max(prior.length, 1)
    if (last.cost > 0.5 && mean > 0 && last.cost > mean * 2.5) a.push({ sev: 'medium', title: 'Cost spike today', detail: `${fmtCost(last.cost)} vs ${fmtCost(mean)}/day avg` })
  }
  // Event loop degraded
  if (m.health.eventLoop?.degraded) a.push({ sev: 'medium', title: 'Event loop degraded', detail: `p99 ${fmtMs(m.health.eventLoop.delayP99Ms ?? 0)}` })
  // Memory index
  if (m.health.memory && m.health.memory.ok === false) a.push({ sev: 'low', title: 'Memory index unavailable', detail: String(m.health.memory.error ?? 'embedding offline') })
  // Update
  if (m.health.updateAvailable) a.push({ sev: 'low', title: 'Update available', detail: 'gateway update pending' })
  if (a.length === 0) a.push({ sev: 'ok', title: 'All clear', detail: 'no anomalies detected' })
  // sort by severity
  const order: Record<Sev, number> = { high: 0, medium: 1, low: 2, ok: 3 }
  return a.sort((x, y) => order[x.sev] - order[y.sev])
}

const SEV_STYLE: Record<Sev, { cls: string; icon: React.ReactNode }> = {
  high:   { cls: 'border-red-900/50 bg-red-950/20 text-red-300',       icon: <AlertTriangle size={13} className="text-red-400" /> },
  medium: { cls: 'border-amber-900/50 bg-amber-950/20 text-amber-300', icon: <AlertCircle size={13} className="text-amber-400" /> },
  low:    { cls: 'border-border bg-base text-text-secondary',          icon: <AlertCircle size={13} className="text-text-muted" /> },
  ok:     { cls: 'border-green-900/50 bg-green-950/20 text-green-300',  icon: <CheckCircle2 size={13} className="text-green-400" /> },
}

function SecurityAlerts({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="flex flex-col gap-2">
      {alerts.map((al, i) => {
        const st = SEV_STYLE[al.sev]
        return (
          <div key={i} className={clsx('flex items-start gap-2 px-3 py-2 rounded-lg border', st.cls)}>
            <span className="shrink-0 mt-0.5">{st.icon}</span>
            <div className="min-w-0">
              <p className="text-xs font-medium">{al.title}</p>
              <p className="text-xxs opacity-80">{al.detail}</p>
            </div>
            {al.sev !== 'ok' && <span className="ml-auto text-xxs uppercase font-semibold opacity-70 shrink-0">{al.sev}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ─── Not-connected state ────────────────────────────────────────────────────────

function NotConnected({ theme, error, onNav }: { theme: typeof THEME[ConnectorId]; error: string | null; onNav?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <span className="text-4xl">{theme.icon}</span>
      <p className="text-sm text-text-primary font-medium">{theme.label} not connected</p>
      <p className="text-xs text-text-muted max-w-sm">
        {error
          ? (/fetch|network|ECONNREFUSED|timeout|getaddr|refused|socket/i.test(error)
              ? `Couldn't reach the ${theme.label} server — check it's running and that the URL/token are set in Settings.`
              : error)
          : 'Add a gateway URL + token in Settings to pull live metrics.'}
      </p>
      {onNav && (
        <button onClick={onNav} className="mt-1 px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-card-hover text-xs text-text-secondary hover:text-text-primary transition-colors">
          Open Settings
        </button>
      )}
    </div>
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────────

export function PlatformMetrics({ source, onNavigate }: { source: ConnectorId; onNavigate?: (v: any) => void }) {
  const theme = THEME[source]
  const [m, setM] = useState<PlatformMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chartMetric, setChartMetric] = useState<'tokens' | 'cost'>('tokens')
  const [bdMetric, setBdMetric] = useState<'tokens' | 'cost'>('tokens')
  const [selectedSession, setSelectedSession] = useState<MetricSessionRow | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const badge = source === 'openclaw' ? 'O' : 'H'

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null)
    try {
      const data = force ? await metricsApi[source](true) : await metricsApi[source]()
      setM(data.metrics)
    } catch (err: any) {
      setError(err.message ?? 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }, [source])

  useEffect(() => { load() }, [load])

  // True live: persistent SSE event stream from the gateway (both platforms).
  const { events: liveEvents, connected: liveConnected } = useEventStream(source, true)
  const latestHealth = liveEvents.find(e => e.kind === 'health')?.health ?? null

  // Keep the boards live: periodic refresh + a debounced refresh on real activity.
  useEffect(() => {
    if (!m?.reachable) return
    const t = setInterval(() => { if (!isRefreshPaused()) load() }, 15_000)
    return () => clearInterval(t)
  }, [m?.reachable, load])

  const lastSeq = useRef(0)
  useEffect(() => {
    const top = liveEvents[0]
    if (!top || top.seq === lastSeq.current) return
    lastSeq.current = top.seq
    if (['message', 'tool', 'cron', 'error'].includes(top.kind)) {
      const t = setTimeout(() => load(true), 2500)
      return () => clearTimeout(t)
    }
  }, [liveEvents, load])

  // Track which brain-board nodes are "lit up" by recent events, with a ticker to fade them.
  const activityRef = useRef<Record<string, number>>({})
  const [, setPulseTick] = useState(0)
  useEffect(() => {
    const top = liveEvents[0]
    if (!top || !m) return
    const now = Date.now()
    for (const id of eventNodeIds(top, m)) activityRef.current[id] = now
    if (top.kind === 'error') activityRef.current['error'] = now
  }, [liveEvents, m])

  // Reliable fallback: pulse nodes when their metric counts rise between refreshes
  // (tool calls aren't always in the log stream, but the counts still grow).
  const prevCounts = useRef<{ tools: number; msgs: number; cron: number; errors: number } | null>(null)
  useEffect(() => {
    if (!m) return
    const cur = { tools: m.messages?.toolCalls ?? 0, msgs: m.messages?.total ?? 0, cron: m.cron.runsTotal || m.cron.total, errors: m.messages?.errors ?? 0 }
    const prev = prevCounts.current
    if (prev) {
      const now = Date.now()
      if (cur.tools > prev.tools) activityRef.current['tools'] = now
      if (cur.cron > prev.cron) activityRef.current['cron'] = now
      if (cur.errors > prev.errors) activityRef.current['error'] = now
      if (cur.msgs > prev.msgs) for (const c of m.channels) activityRef.current[`ch:${c.id}`] = now
    }
    prevCounts.current = cur
  }, [m])
  useEffect(() => {
    if (tab !== 'activity') return
    const t = setInterval(() => setPulseTick(x => (x + 1) % 100000), 350)
    return () => clearInterval(t)
  }, [tab])

  if (loading && !m) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-6 pt-5 pb-4 border-b border-border"><div className="h-6 w-40 bg-card rounded animate-pulse" /></div>
        <div className="flex-1 p-6 grid grid-cols-2 md:grid-cols-4 gap-3 content-start">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-card border border-border animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!m || !m.reachable) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
          <h1 className="text-base font-semibold text-text-primary flex items-center gap-2">{theme.icon} {theme.label} Metrics</h1>
          <button onClick={() => load(true)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary text-xs">
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Retry
          </button>
        </div>
        <div className="flex-1"><NotConnected theme={theme} error={m?.error ?? error} onNav={onNavigate ? () => onNavigate('settings') : undefined} /></div>
      </div>
    )
  }

  const tok = m.tokens, cost = m.cost
  const cacheHitRate = tok.input + tok.cacheRead > 0 ? Math.round((tok.cacheRead / (tok.input + tok.cacheRead)) * 100) : 0
  const errRate = m.messages && m.messages.total > 0 ? Math.round((m.messages.errors / m.messages.total) * 100) : 0

  const _now = Date.now()
  const activeSet = new Set(Object.entries(activityRef.current).filter(([, ts]) => _now - ts < 1800).map(([id]) => id))
  const alerts = computeAlerts(m, liveEvents)
  const alertCount = alerts.filter(al => al.sev === 'high' || al.sev === 'medium').length

  return (
    <div className="flex h-full overflow-hidden">
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-text-primary flex items-center gap-2">{theme.icon} {theme.label} Metrics</h1>
          <p className="text-xs text-text-muted mt-0.5 flex items-center gap-2">
            {liveConnected
              ? <span className="flex items-center gap-1 text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ animation: 'flow-node-pulse 1.4s ease-in-out infinite' }} /> LIVE</span>
              : <span className="flex items-center gap-1"><span className={clsx('w-1.5 h-1.5 rounded-full', theme.dot)} /> Connected</span>}
            {m.version && <span>· v{m.version}</span>}
            <span>· {m.latencyMs}ms</span>
            {latestHealth?.eventLoop && <span>· loop {Math.round(latestHealth.eventLoop.delayP99Ms ?? 0)}ms</span>}
            <span>· updated {new Date(m.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card hover:bg-card-hover text-text-secondary hover:text-text-primary transition-colors text-xs">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 border-b border-border shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              tab === t.id ? 'border-text-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {(['brain', 'flow', 'alerts', 'security'] as TabId[]).includes(tab) ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'brain'    && <BrainView />}
          {tab === 'flow'     && <FlowView />}
          {tab === 'alerts'   && <AlertsView />}
          {tab === 'security' && <SecurityView />}
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
        {tab === 'autonomy' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Section title="Autonomy score" icon={<Gauge size={13} />}>
              <AutonomyGauge score={m.autonomy.score} level={m.autonomy.level} accent={theme.accent} />
              <p className="text-xxs text-text-muted text-center mt-2 leading-relaxed">How independently this agent operates — blended from tool agency, self-directed sessions, scheduled work, low human reliance, and delegation.</p>
            </Section>
            <div className="lg:col-span-2">
              <Section title="Contributing factors" icon={<TrendingUp size={13} />}>
                <div className="flex flex-col gap-3">
                  {m.autonomy.factors.map(f => (
                    <div key={f.label} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">{f.label}</span>
                        <span className="text-text-muted tabular-nums">{f.score}/100</span>
                      </div>
                      <div className="h-2 rounded-full bg-base overflow-hidden">
                        <div className={clsx('h-full rounded-full', theme.bar)} style={{ width: `${f.score}%` }} />
                      </div>
                      <span className="text-xxs text-text-muted">{f.detail}</span>
                    </div>
                  ))}
                  {m.autonomy.factors.length === 0 && <p className="text-xxs text-text-muted">No autonomy data</p>}
                </div>
              </Section>
            </div>
          </div>
        )}

        {tab === 'overview' && <>
        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <StatCard label="Total Tokens" value={fmtTokens(tok.total)} sub={`${fmtTokens(tok.cacheRead)} cached`} icon={<Activity size={12} />} tone={theme.accent} />
          <StatCard label="Total Cost" value={fmtCost(cost.total)} sub={`${fmtCost(cost.cacheRead)} cache`} icon={<DollarSign size={12} />} />
          <StatCard label="Sessions" value={fmtNum(m.sessions.total)} icon={<Hash size={12} />} />
          <StatCard label="Messages" value={m.messages ? fmtNum(m.messages.total) : '—'} sub={m.messages ? `${fmtNum(m.messages.assistant)} assistant` : undefined} icon={<MessageSquare size={12} />} />
          <StatCard label="Tool Calls" value={m.messages ? fmtNum(m.messages.toolCalls) : fmtNum(m.tools.reduce((s, t) => s + t.count, 0))} sub={`${m.tools.length} tools`} icon={<Wrench size={12} />} />
          <StatCard label="Errors" value={m.messages ? fmtNum(m.messages.errors) : '—'} sub={m.messages ? `${errRate}% of msgs` : undefined} icon={<AlertTriangle size={12} />} tone={errRate > 10 ? 'text-red-400' : undefined} />
          <StatCard label="Cron Success" value={`${m.cron.successRate}%`} sub={`${m.cron.total} jobs · ${m.cron.failures} fails`} icon={<Clock size={12} />} tone={m.cron.successRate < 80 ? 'text-amber-300' : 'text-green-400'} />
          <StatCard label="Cache Hit" value={`${cacheHitRate}%`} sub={`${m.models.length} models`} icon={<Database size={12} />} />
        </div>

        {/* Daily usage chart */}
        <Section title="Usage over time" icon={<TrendingUp size={13} />} right={
          <div className="flex items-center gap-1 bg-base rounded border border-border p-0.5">
            {(['tokens', 'cost'] as const).map(k => (
              <button key={k} onClick={() => setChartMetric(k)} className={clsx('px-2 py-0.5 rounded text-xxs capitalize', chartMetric === k ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>{k}</button>
            ))}
          </div>
        }>
          <DailyChart data={m.daily} metric={chartMetric} barClass={theme.bar} />
        </Section>
        </>}

        {tab === 'activity' && <>
        {/* Security / health alerts */}
        <Section title="Alerts" icon={<Shield size={13} />} right={<span className={clsx('text-xxs', alertCount > 0 ? 'text-amber-300' : 'text-green-400')}>{alertCount > 0 ? `${alertCount} active` : 'all clear'}</span>}>
          <SecurityAlerts alerts={alerts} />
        </Section>

        {/* Live event tail */}
        <Section title="Live event tail" icon={<Radio size={13} />} right={<span className="text-xxs text-text-muted">streamed from the gateway (SSE)</span>}>
          <LiveEventTail events={liveEvents} connected={liveConnected} />
        </Section>

        {/* Brain overview */}
        <Section title="Brain overview" icon={<Brain size={13} />} right={<span className="text-xxs text-text-muted">live wiring · pulses when in use</span>}>
          <BrainBoard m={m} activeSet={activeSet} />
        </Section>

        {/* Live gateway load */}
        <Section title="Gateway load" icon={<Activity size={13} />} right={<span className="text-xxs text-text-muted">live event-loop p99</span>}>
          <GatewayLoad events={liveEvents} />
        </Section>

        {/* Live message flow */}
        <Section title="Message flow" icon={<GitBranch size={13} />} right={<span className="text-xxs text-text-muted flex items-center gap-1"><ArrowRight size={10} /> color-coded · fires on live events</span>}>
          <MessageFlow m={m} activeSet={activeSet} />
        </Section>

        {/* Sub-agent activity */}
        <Section title={`Sub-agent activity (${m.subAgents.total})`} icon={<Network size={13} />}>
          <SubAgentTree m={m} accent={theme.accent} />
        </Section>
        </>}

        {tab === 'sessions' && <>
        {/* Sessions + transcript */}
        <Section title={`Sessions (${m.sessions.total})`} icon={<MessageSquare size={13} />} right={<span className="text-xxs text-text-muted">click a row for the transcript</span>}>
          <SessionsTable sessions={m.sessionList} onPick={setSelectedSession} />
        </Section>
        </>}

        {tab === 'overview' && <>
        {/* Token breakdown + latency/messages */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section title="Token & cost breakdown" icon={<Boxes size={13} />}>
            <BarList barClass={theme.bar} fmt={fmtTokens} items={[
              { name: 'input', value: tok.input, sub: fmtCost(cost.input) },
              { name: 'output', value: tok.output, sub: fmtCost(cost.output) },
              { name: 'cache read', value: tok.cacheRead, sub: fmtCost(cost.cacheRead) },
              { name: 'cache write', value: tok.cacheWrite, sub: fmtCost(cost.cacheWrite) },
            ]} />
          </Section>
          <Section title="Latency & message flow" icon={<Zap size={13} />}>
            {m.latency ? (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <Stat mini label="Avg latency" value={fmtMs(m.latency.avgMs ?? 0)} />
                <Stat mini label="p95 latency" value={fmtMs(m.latency.p95Ms ?? 0)} />
                <Stat mini label="Max latency" value={fmtMs(m.latency.maxMs ?? 0)} />
                <Stat mini label="Samples" value={fmtNum(m.latency.count ?? 0)} />
              </div>
            ) : <p className="text-xxs text-text-muted mb-3">No latency data</p>}
            {m.messages && (
              <BarList barClass={theme.bar} fmt={fmtNum} items={[
                { name: 'user', value: m.messages.user },
                { name: 'assistant', value: m.messages.assistant },
                { name: 'tool calls', value: m.messages.toolCalls },
                { name: 'errors', value: m.messages.errors },
              ]} />
            )}
          </Section>
        </div>
        </>}

        {tab === 'breakdowns' && <>
        {/* Breakdowns */}
        <Section title="Breakdowns" icon={<Cpu size={13} />} right={
          <div className="flex items-center gap-1 bg-base rounded border border-border p-0.5">
            {(['tokens', 'cost'] as const).map(k => (
              <button key={k} onClick={() => setBdMetric(k)} className={clsx('px-2 py-0.5 rounded text-xxs capitalize', bdMetric === k ? 'bg-card-hover text-text-primary' : 'text-text-muted hover:text-text-secondary')}>{k}</button>
            ))}
          </div>
        }>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            <div><p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">By model</p><BarList barClass={theme.bar} fmt={bdMetric === 'cost' ? fmtCost : fmtTokens} items={toBars(m.byModel, bdMetric === 'cost')} /></div>
            <div><p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">By provider</p><BarList barClass={theme.bar} fmt={bdMetric === 'cost' ? fmtCost : fmtTokens} items={toBars(m.byProvider, bdMetric === 'cost')} /></div>
            <div><p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">By agent</p><BarList barClass={theme.bar} fmt={bdMetric === 'cost' ? fmtCost : fmtTokens} items={toBars(m.byAgent, bdMetric === 'cost')} /></div>
            <div><p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">By channel</p><BarList barClass={theme.bar} fmt={bdMetric === 'cost' ? fmtCost : fmtTokens} items={toBars(m.byChannel, bdMetric === 'cost')} /></div>
          </div>
        </Section>

        {/* Tool leaderboard */}
        {m.tools.length > 0 && (
          <Section title={`Tool usage (${m.tools.length})`} icon={<Terminal size={13} />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              <BarList barClass={theme.bar} fmt={fmtNum} items={m.tools.slice(0, Math.ceil(Math.min(m.tools.length, 16) / 2)).map(t => ({ name: t.name, value: t.count }))} />
              <BarList barClass={theme.bar} fmt={fmtNum} items={m.tools.slice(Math.ceil(Math.min(m.tools.length, 16) / 2), 16).map(t => ({ name: t.name, value: t.count }))} />
            </div>
          </Section>
        )}
        </>}

        {tab === 'tools' && (
          <Section title={`Tool analytics (${m.tools.length} tools · ${fmtNum(m.tools.reduce((s, t) => s + t.count, 0))} total calls)`} icon={<Wrench size={13} />}
            right={<span className="text-xxs text-text-muted">click column headers to sort</span>}>
            <ToolsTable tools={m.tools} theme={theme} />
          </Section>
        )}

        {tab === 'heatmap' && (
          <Section title="Hourly activity — today" icon={<Hash size={13} />}
            right={<span className="text-xxs text-text-muted">refreshes every 60 s</span>}>
            <HourlyHeatmap source={source} />
          </Section>
        )}

        {tab === 'spawntree' && (
          <Section title={`Spawn tree (${m.subAgents.total} sub-agent${m.subAgents.total === 1 ? '' : 's'})`} icon={<Bot size={13} />}>
            <SpawnTree subAgents={m.subAgents} />
          </Section>
        )}

        {tab === 'budget' && (
          <Section title="Spend budget" icon={<DollarSign size={13} />}
            right={<span className="text-xxs text-text-muted">limits apply per source</span>}>
            <BudgetGauge m={m} />
          </Section>
        )}

        {tab === 'cron' && <>
        {/* Cron */}
        <Section title="Scheduled jobs" icon={<Clock size={13} />} right={
          <span className="text-xxs text-text-muted">{m.cron.total} jobs · {m.cron.successRate}% ok{m.cron.nextWakeAt ? ` · next ${relTime(m.cron.nextWakeAt)}` : ''}</span>
        }>
          {m.cron.jobs.length === 0 ? <p className="text-xxs text-text-muted">No jobs defined on the gateway</p> : (
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden mb-4">
              {m.cron.jobs.map(j => (
                <div key={j.id} className="flex items-center gap-3 px-3 py-2 bg-card">
                  <span className="shrink-0">{j.enabled ? <ToggleRight size={14} className="text-green-400" /> : <ToggleLeft size={14} className="text-text-muted" />}</span>
                  <div className="flex-1 min-w-0">
                    <p className={clsx('text-xs font-medium truncate', j.enabled ? 'text-text-primary' : 'text-text-muted')}>{j.name}</p>
                    <p className="text-xxs text-text-muted font-mono">{j.schedule || '—'}{j.agentId ? ` · ${j.agentId}` : ''}{j.delivery ? ` → ${j.delivery}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0 text-xxs text-text-muted">
                    {j.nextRunAt && <p>next {relTime(j.nextRunAt)}</p>}
                    <p>last {relTime(j.lastRunAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {m.cron.runs.length > 0 && (
            <>
              <p className="text-xxs font-semibold uppercase tracking-wide text-text-muted mb-2">Recent runs ({m.cron.runsTotal || m.cron.runs.length})</p>
              <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                {m.cron.runs.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xxs px-2 py-1 rounded bg-base">
                    <span className="shrink-0">{r.status === 'error' || r.status === 'failed' ? <XCircle size={11} className="text-red-400" /> : <CheckCircle2 size={11} className="text-green-400" />}</span>
                    <span className="text-text-muted shrink-0 w-14">{relTime(r.ts)}</span>
                    <span className="text-text-secondary truncate">{r.error ? r.error : `${r.action || 'run'} · ${r.status || 'ok'}`}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
        </>}

        {tab === 'system' && <>
        {/* Channels + Health */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section title="Channels" icon={<Radio size={13} />}>
            {m.channels.length === 0 ? <p className="text-xxs text-text-muted">No channels</p> : (
              <div className="flex flex-col gap-2">
                {m.channels.map(c => (
                  <div key={c.id} className="flex items-center gap-2 text-xs">
                    <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', c.running ? 'bg-green-400' : c.configured ? 'bg-amber-400' : 'bg-text-muted')} />
                    <span className="text-text-secondary capitalize">{c.label}</span>
                    <span className="text-xxs text-text-muted ml-auto">
                      {c.running ? 'running' : c.configured ? 'configured' : 'off'}{c.lastStartAt ? ` · ${relTime(c.lastStartAt)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
          <Section title="Health" icon={<Heart size={13} />}>
            <div className="grid grid-cols-2 gap-3">
              <Stat mini label="Gateway" value={m.health.ok ? 'Healthy' : 'Degraded'} tone={m.health.ok ? 'text-green-400' : 'text-red-400'} />
              {(() => {
                const starts = m.channels.map(c => c.lastStartAt).filter(Boolean).map(s => new Date(s as string).getTime())
                return starts.length ? <Stat mini label="Uptime" value={fmtUptime(Date.now() - Math.min(...starts))} /> : null
              })()}
              <Stat mini label="Update" value={m.health.updateAvailable ? 'Available' : 'Up to date'} tone={m.health.updateAvailable ? 'text-amber-300' : undefined} />
              {m.health.eventLoop && <>
                <Stat mini label="Event loop p99" value={fmtMs(m.health.eventLoop.delayP99Ms ?? 0)} tone={m.health.eventLoop.degraded ? 'text-amber-300' : undefined} />
                <Stat mini label="CPU ratio" value={`${Math.round((m.health.eventLoop.cpuCoreRatio ?? 0) * 100)}%`} />
              </>}
              {m.health.memory && <Stat mini label="Memory index" value={m.health.memory.ok ? 'OK' : (m.health.memory.error ? 'Error' : 'Off')} tone={m.health.memory.ok ? 'text-green-400' : 'text-text-muted'} />}
              {m.heartbeat.length > 0 && <Stat mini label="Heartbeat" value={m.heartbeat.map(h => `${h.agentId} ${h.every}`).join(', ')} />}
            </div>
          </Section>
        </div>

        {/* Models + Skills */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section title={`Models (${m.models.length})`} icon={<Cpu size={13} />}>
            {m.models.length === 0 ? <p className="text-xxs text-text-muted">No models</p> : (
              <div className="flex flex-wrap gap-1.5">
                {m.models.map(md => (
                  <span key={md.id} className="px-1.5 py-0.5 rounded border border-border bg-base text-xxs font-mono text-text-secondary">
                    {md.provider ? `${md.provider}/` : ''}{md.name}
                  </span>
                ))}
              </div>
            )}
          </Section>
          <Section title={`Skills (${m.skills.length})`} icon={<Boxes size={13} />}>
            {m.skills.length === 0 ? <p className="text-xxs text-text-muted">No skills</p> : (
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {m.skills.map(s => (
                  <span key={s.name} title={s.description} className="px-1.5 py-0.5 rounded border border-border bg-base text-xxs text-text-secondary">{s.name}</span>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Memory files */}
        <Section title={`Memory files (${m.memoryFiles.length})`} icon={<FileText size={13} />} right={<span className="text-xxs text-text-muted">SOUL.md · MEMORY.md · AGENTS.md…</span>}>
          <MemoryAnalyticsBoard files={m.memoryFiles} source={source} />
        </Section>
        </>}
      </div>
      )}
    </div>

      {selectedSession && (
        <TranscriptDrawer source={source} session={selectedSession} badge={badge} onClose={() => setSelectedSession(null)} />
      )}
    </div>
  )
}

function Stat({ label, value, tone, mini }: { label: string; value: string; tone?: string; mini?: boolean }) {
  return (
    <div className={clsx('flex flex-col gap-0.5 rounded-lg bg-base border border-border', mini ? 'px-2.5 py-2' : 'p-3')}>
      <span className="text-xxs text-text-muted">{label}</span>
      <span className={clsx('text-xs font-semibold tabular-nums truncate', tone ?? 'text-text-primary')}>{value}</span>
    </div>
  )
}

export function OpenClawMetrics({ onNavigate }: { onNavigate?: (v: any) => void }) {
  return <PlatformMetrics source="openclaw" onNavigate={onNavigate} />
}
export function HermesMetrics({ onNavigate }: { onNavigate?: (v: any) => void }) {
  return <PlatformMetrics source="hermes" onNavigate={onNavigate} />
}
