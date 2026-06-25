// title: Home — landing page / command overview
// path: src/views/Home.tsx
// purpose: Default landing view. Mission-control hero (radar sweep, live clock,
//          telemetry ticker, count-up stats) plus an "at a glance" priority
//          queue and quick-view cards for usage, to-dos, projects, alerts, and
//          system health. Styled in the app's native design language: bg-card
//          rounded-xl panels, muted uppercase labels, accent/10 tinted pills.

import { useState, useEffect, useCallback, useRef } from 'react'
import { DATA_REFRESH_EVENT } from '../lib/dataRefresh'
import { clsx } from 'clsx'
import {
  ListTodo, Bell, FolderKanban, Radar, ArrowRight, ArrowUpRight,
  ShieldAlert, AlertTriangle, CheckCircle2, Circle, Flame,
  Activity, Cpu, Coins, Link2, Zap, CalendarDays, Inbox, ServerCrash, TrendingUp,
  HeartPulse, MemoryStick,
} from 'lucide-react'
import {
  radar, system, projects as projectsApi, approvals as approvalsApi,
  inbox, links, agentCron,
  type RadarUsageResponse, type SystemResponse, type LiveProject, type LiveApproval,
  type InboxItem, type LinkItem, type AgentCronJob,
} from '../lib/api'
import { Histogram, SegmentBar, Donut, fmtNum } from '../components/charts'
import { isRefreshPaused } from '../lib/refreshBus'
import { openDocsTab, openInboxItem as focusInboxItem, openTasksTab, openHubTab } from '../lib/quickActions'
import type { View } from '../types'

// ─── Theme accents (mirror tailwind.config.js — never introduce new colors) ───

const ACCENT = {
  green:  '#4ade80',
  amber:  '#fbbf24',
  red:    '#f87171',
  blue:   '#60a5fa',
  purple: '#a78bfa',
  teal:   '#2dd4bf',
  muted:  '#4a4a58',
} as const

// ─── Local types (mirror server/routes) ───────────────────────────────────────

type TodoSeverity = 'low' | 'medium' | 'high' | 'critical'

interface HomeTodo {
  id:       string
  title:    string
  severity: TodoSeverity
  horizon:  'short' | 'long'
  dueDate:  string
  done:     boolean
}

interface FiredAlert {
  ruleId:   string
  ruleName: string
  severity: 'info' | 'warning' | 'critical'
  message:  string
  firedAt:  string
  source:   string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<TodoSeverity, string> = {
  critical: ACCENT.red, high: ACCENT.amber, medium: ACCENT.blue, low: ACCENT.muted,
}

const PROJECT_STATUS_COLOR: Record<LiveProject['status'], string> = {
  active: ACCENT.green, planning: ACCENT.blue, paused: ACCENT.amber, completed: ACCENT.muted,
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5)  return 'Burning the midnight oil'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isOverdue(t: HomeTodo): boolean {
  return !t.done && !!t.dueDate && t.dueDate.slice(0, 10) < todayIso()
}

function isDueToday(t: HomeTodo): boolean {
  return !t.done && !!t.dueDate && t.dueDate.slice(0, 10) === todayIso()
}

function agoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60_000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Tiny animation hooks ─────────────────────────────────────────────────────

/** Eased count-up toward `target`; re-animates whenever target changes. */
function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from  = fromRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      const e = 1 - Math.pow(1 - p, 3)
      setVal(from + (target - from) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

// ─── Attention items (the "see first" list) ───────────────────────────────────

interface AttentionItem {
  key:    string
  weight: number          // lower = more urgent
  color:  string
  icon:   React.ReactNode
  title:  string
  sub:    string
  view:   View
  tab?:   string          // optional inner tab for hub views (e.g. Health → alerts)
}

function buildAttention(
  todos: HomeTodo[], alerts: FiredAlert[], approvals: LiveApproval[], sys: SystemResponse | null,
): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const a of alerts) {
    items.push({
      key:    `alert-${a.ruleId}-${a.firedAt}`,
      weight: a.severity === 'critical' ? 0 : a.severity === 'warning' ? 3 : 6,
      color:  a.severity === 'critical' ? ACCENT.red : a.severity === 'warning' ? ACCENT.amber : ACCENT.blue,
      icon:   <ShieldAlert size={14} />,
      title:  a.message,
      sub:    [a.ruleName, a.source, agoShort(a.firedAt)].filter(Boolean).join(' · '),
      view:   'health',
      tab:    'alerts',
    })
  }

  for (const t of todos.filter(t => !t.done)) {
    const overdue = isOverdue(t)
    const today   = isDueToday(t)
    if (!overdue && !today && t.severity !== 'critical' && t.severity !== 'high') continue
    items.push({
      key:    `todo-${t.id}`,
      weight: overdue ? 1 : t.severity === 'critical' ? 2 : today ? 4 : 5,
      color:  overdue ? ACCENT.red : SEV_COLOR[t.severity],
      icon:   overdue ? <Flame size={14} /> : <ListTodo size={14} />,
      title:  t.title,
      sub:    overdue ? `overdue · due ${t.dueDate.slice(0, 10)}` : today ? 'due today' : `${t.severity} priority`,
      view:   'todos',
    })
  }

  for (const a of approvals.filter(a => a.status === 'pending')) {
    items.push({
      key:    `approval-${a.id}`,
      weight: a.urgency === 'urgent' ? 2 : 5,
      color:  a.urgency === 'urgent' ? ACCENT.red : ACCENT.purple,
      icon:   <Inbox size={14} />,
      title:  a.title,
      sub:    `${a.type} approval · ${a.agentName} · ${a.createdAgo}`,
      view:   'todos',
      tab:    'approvals',
    })
  }

  for (const c of sys?.components ?? []) {
    if (c.status !== 'error' && c.status !== 'offline') continue
    items.push({
      key:    `sys-${c.id}`,
      weight: c.status === 'error' ? 2 : 4,
      color:  c.status === 'error' ? ACCENT.red : ACCENT.muted,
      icon:   <ServerCrash size={14} />,
      title:  `${c.name} ${c.status === 'error' ? 'reporting errors' : 'offline'}`,
      sub:    c.error || c.description || c.type,
      view:   'health',
      tab:    'system',
    })
  }

  // V8 heap pressure — a heap-limit breach is what crashed OpenClaw before.
  const heapPct = sys?.host?.heapUsedPct
  if (sys?.host?.heapCritical || (heapPct != null && heapPct >= 80)) {
    items.push({
      key:    'sys-heap',
      weight: 1,
      color:  ACCENT.red,
      icon:   <MemoryStick size={14} />,
      title:  `Node heap at ${heapPct}% of capacity`,
      sub:    `${sys?.host?.heapUsedMb}MB used · out-of-memory risk`,
      view:   'health',
      tab:    'system',
    })
  }

  return items.sort((a, b) => a.weight - b.weight).slice(0, 6)
}

// ─── Decorative: radar sweep ──────────────────────────────────────────────────

function RadarSweep({ alert }: { alert: boolean }) {
  const blips = [
    { top: '26%', left: '62%', color: alert ? ACCENT.red : ACCENT.teal,    delay: '0s' },
    { top: '58%', left: '30%', color: ACCENT.blue,                          delay: '0.9s' },
    { top: '68%', left: '66%', color: alert ? ACCENT.amber : ACCENT.green,  delay: '1.7s' },
  ]
  return (
    <div className="relative w-[116px] h-[116px] shrink-0 select-none" aria-hidden>
      {/* rings + crosshair, in border tones */}
      <svg viewBox="0 0 116 116" className="absolute inset-0">
        {[18, 35, 52].map(r => (
          <circle key={r} cx={58} cy={58} r={r} fill="none" stroke="#1e1e24" strokeWidth={1} />
        ))}
        <line x1={6} y1={58} x2={110} y2={58} stroke="#17171c" strokeWidth={1} />
        <line x1={58} y1={6} x2={58} y2={110} stroke="#17171c" strokeWidth={1} />
      </svg>
      {/* rotating beam */}
      <div className="absolute inset-[6px] rounded-full overflow-hidden" style={{ animation: 'home-scan 4.5s linear infinite' }}>
        <div className="absolute inset-0" style={{ background: `conic-gradient(from 0deg, ${alert ? ACCENT.red : ACCENT.green}2e, transparent 75deg)` }} />
      </div>
      {/* blips */}
      {blips.map((b, i) => (
        <span
          key={i}
          className="absolute w-1.5 h-1.5 rounded-full"
          style={{ top: b.top, left: b.left, backgroundColor: b.color, animation: `home-blink 2.6s ease-in-out ${b.delay} infinite` }}
        />
      ))}
      {/* center */}
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: alert ? ACCENT.red : ACCENT.green }} />
    </div>
  )
}

// ─── Small building blocks ────────────────────────────────────────────────────

function StatTile({ icon, label, sub, value, accent, delay, onClick }: {
  icon: React.ReactNode; label: string; sub: string; value: number
  accent: string; delay: number; onClick: () => void
}) {
  const n = useCountUp(value)
  return (
    <button
      onClick={onClick}
      className="home-rise group flex flex-col gap-1.5 px-5 py-4 rounded-xl bg-card border border-border hover:bg-card-hover hover:-translate-y-0.5 transition-all duration-200 text-left"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 text-text-muted">
        <span style={{ color: accent }}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        <ArrowUpRight size={12} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <span className="text-3xl font-bold tabular-nums leading-none" style={{ color: accent }}>{Math.round(n)}</span>
      <span className="text-[10px] text-text-muted truncate">{sub}</span>
    </button>
  )
}

function PanelCard({ title, icon, view, onNavigate, accent, delay = 0, children, className }: {
  title: string; icon: React.ReactNode; view: View; onNavigate: (v: View) => void
  accent: string; delay?: number; children: React.ReactNode; className?: string
}) {
  return (
    <section
      className={clsx('home-rise flex flex-col bg-card border border-border rounded-xl overflow-hidden', className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      <button
        onClick={() => onNavigate(view)}
        className="group flex items-center gap-2 px-4 py-3 border-b border-border-subtle hover:bg-card-hover transition-colors text-left"
      >
        <span style={{ color: accent }}>{icon}</span>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted group-hover:text-text-secondary transition-colors">{title}</h2>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-text-muted group-hover:text-text-secondary transition-colors">
          open <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
        </span>
      </button>
      <div className="flex-1 p-4 min-h-0">{children}</div>
    </section>
  )
}

function EmptyNote({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-text-muted">
      {icon}
      <span className="text-xs">{text}</span>
    </div>
  )
}

// ─── Heartbeat monitor widget ─────────────────────────────────────────────────
// Compact at-a-glance card: last heartbeat tick, what it did, and a live
// countdown to the next scheduled tick (from the agent's cron cadence).

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'due now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function HeartbeatWidget({ job, now, onOpen }: { job: AgentCronJob | null; now: Date; onOpen: () => void }) {
  const lastMs = job?.lastRunAt ? new Date(job.lastRunAt).getTime() : 0
  const nextMs = job?.nextRunAt ? new Date(job.nextRunAt).getTime() : 0
  const sinceLast = lastMs ? now.getTime() - lastMs : Infinity
  // A healthy tick is recent; if the last beat is well past a full interval, flag it.
  const beating = isFinite(sinceLast) && sinceLast < 90 * 60_000
  const countdownMs = nextMs ? nextMs - now.getTime() : 0
  const accent = !job ? ACCENT.muted : beating ? ACCENT.green : ACCENT.amber

  return (
    <button
      onClick={onOpen}
      className="home-rise group flex flex-col gap-2 px-5 py-4 rounded-xl bg-card border border-border hover:bg-card-hover transition-all duration-200 text-left"
      style={{ animationDelay: '300ms' }}
    >
      <div className="flex items-center gap-2 text-text-muted">
        <span className="relative flex w-3.5 h-3.5 items-center justify-center" style={{ color: accent }}>
          {beating && <span className="absolute inline-flex w-2.5 h-2.5 rounded-full opacity-50 animate-ping" style={{ backgroundColor: accent }} />}
          <HeartPulse size={14} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider">Heartbeat</span>
        <span className="ml-auto text-[10px] font-medium" style={{ color: accent }}>
          {!job ? 'no data' : beating ? 'healthy' : 'stale'}
        </span>
      </div>

      {!job ? (
        <p className="text-xs text-text-muted">No heartbeat ticks captured yet.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: accent }}>
              {nextMs ? fmtCountdown(countdownMs) : '—'}
            </span>
            <span className="text-[10px] text-text-muted">{nextMs ? 'to next tick' : 'cadence unknown'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-text-secondary truncate">
              <span className="text-text-muted">Last:</span> {job.lastRunLabel || agoShort(job.lastRunAt ?? '')}
              {job.schedule ? ` · ${job.schedule}` : ''}
            </span>
            {job.sample && <span className="text-[10px] text-text-muted truncate">{job.sample.replace(/\s+/g, ' ').slice(0, 90)}</span>}
          </div>
        </>
      )}
    </button>
  )
}

// ─── View ─────────────────────────────────────────────────────────────────────

export function Home({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [todos,     setTodos]     = useState<HomeTodo[]>([])
  const [alerts,    setAlerts]    = useState<FiredAlert[]>([])
  const [approvals, setApprovals] = useState<LiveApproval[]>([])
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([])
  const [inboxCounts, setInboxCounts] = useState<Record<string, number>>({})
  const [savedLinks, setSavedLinks] = useState<LinkItem[]>([])
  const [projects,  setProjects]  = useState<LiveProject[]>([])
  const [usage,     setUsage]     = useState<RadarUsageResponse | null>(null)
  const [sys,       setSys]       = useState<SystemResponse | null>(null)
  const [cronJobs,  setCronJobs]  = useState<AgentCronJob[]>([])
  const [loaded,    setLoaded]    = useState(false)

  const load = useCallback(async () => {
    const [tRes, alRes, apRes, inRes, liRes, prRes, usRes, syRes, hbRes] = await Promise.allSettled([
      fetch('/api/todos').then(r => r.json()),
      fetch('/api/alerts/active').then(r => r.json()),
      approvalsApi.list(),
      inbox.list(),
      links.list(),
      projectsApi.list(),
      radar.usage(7),
      system.components(),
      agentCron.openclaw(),
    ])
    if (tRes.status  === 'fulfilled') setTodos(tRes.value.todos ?? [])
    if (alRes.status === 'fulfilled') setAlerts(alRes.value.alerts ?? [])
    if (apRes.status === 'fulfilled') setApprovals(apRes.value.approvals ?? [])
    if (inRes.status === 'fulfilled') {
      setInboxItems(inRes.value.items ?? [])
      setInboxCounts(inRes.value.counts ?? {})
    }
    if (liRes.status === 'fulfilled') setSavedLinks(liRes.value.links ?? [])
    if (prRes.status === 'fulfilled') setProjects(prRes.value.projects ?? [])
    if (usRes.status === 'fulfilled') setUsage(usRes.value)
    if (syRes.status === 'fulfilled') setSys(syRes.value)
    if (hbRes.status === 'fulfilled') setCronJobs(hbRes.value.jobs ?? [])
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => { if (!isRefreshPaused() && !document.hidden) load() }, 45_000)
    const onData = () => load()
    window.addEventListener(DATA_REFRESH_EVENT, onData)
    return () => { clearInterval(timer); window.removeEventListener(DATA_REFRESH_EVENT, onData) }
  }, [load])

  const clock = useClock()

  const openTodos    = todos.filter(t => !t.done)
  const overdueCount = openTodos.filter(isOverdue).length
  const pending      = approvals.filter(a => a.status === 'pending')
  const activeInboxItems = inboxItems.filter(item => item.status === 'active')
  const activeInbox = Number(inboxCounts.active ?? activeInboxItems.length)
  const snoozedInbox = Number(inboxCounts.snoozed ?? 0)
  const pinnedLinks = savedLinks.filter(link => link.pinned).length
  const components   = sys?.components ?? []
  const healthy      = components.filter(c => c.status === 'healthy').length
  const sysErrors    = components.filter(c => c.status === 'error' || c.status === 'offline')
  const activeProjects = projects.filter(p => p.status === 'active').length
  const attention    = buildAttention(todos, alerts, pending, sys)
  const heapCritical = !!sys?.host?.heapCritical || (sys?.host?.heapUsedPct ?? 0) >= 80
  const criticalAttn = alerts.some(a => a.severity === 'critical') || sysErrors.some(c => c.status === 'error') || heapCritical

  // Heartbeat job: prefer an explicitly heartbeat/health-named cron, else the
  // most frequently-running scheduled job (closest to a recurring tick).
  const heartbeatJob = cronJobs.find(j => /heartbeat|health|check-?in|pulse/i.test(j.name))
    ?? [...cronJobs].sort((a, b) => b.runCount - a.runCount)[0]
    ?? null

  const statusColor = criticalAttn ? ACCENT.red : attention.length > 0 ? ACCENT.amber : ACCENT.green
  const statusText  = criticalAttn
    ? 'Critical issues need attention'
    : attention.length > 0
      ? `${attention.length} item${attention.length === 1 ? '' : 's'} need attention`
      : 'All systems nominal'

  const spend = useCountUp(usage?.totalCost ?? 0, 1100)

  const dateLabel = clock.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const hhmm = clock.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  const ss   = clock.toLocaleTimeString('en-US', { hour12: false, second: '2-digit' })

  const topTodos = [...openTodos]
    .sort((a, b) => {
      const ord: Record<TodoSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
      const ao = isOverdue(a) ? -1 : ord[a.severity]
      const bo = isOverdue(b) ? -1 : ord[b.severity]
      return ao - bo || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
    })
    .slice(0, 6)

  const topProjects = [...projects]
    .sort((a, b) => {
      const ord: Record<LiveProject['status'], number> = { active: 0, planning: 1, paused: 2, completed: 3 }
      return ord[a.status] - ord[b.status] || b.updatedAt.localeCompare(a.updatedAt)
    })
    .slice(0, 5)

  const topInbox = activeInboxItems.slice(0, 4)
  const topLinks = savedLinks.slice(0, 4)

  const tb = usage?.tokenBreakdown

  function openInboxHub(): void {
    openTasksTab('inbox')
  }

  function openLinksHub(): void {
    openDocsTab('links')
    onNavigate('docs')
  }

  function openFocusedInboxItem(item: InboxItem): void {
    focusInboxItem(item.id)
    openTasksTab('inbox')
  }

  // Telemetry ticker — duplicated once in the DOM for a seamless loop.
  const tickerItems: Array<{ label: string; value: string; color: string }> = [
    { label: 'Tokens 7d',  value: usage ? fmtNum(usage.totalTokens) : '—',          color: ACCENT.purple },
    { label: 'AI value 7d', value: usage ? `$${usage.totalCost.toFixed(2)}` : '—',  color: ACCENT.green },
    { label: 'Runs 7d',    value: usage ? fmtNum(usage.totalRuns) : '—',            color: ACCENT.blue },
    { label: 'Open to-dos', value: String(openTodos.length),                        color: overdueCount > 0 ? ACCENT.red : ACCENT.blue },
    { label: 'Inbox',      value: `${activeInbox} active`,                           color: activeInbox > 0 ? ACCENT.amber : ACCENT.green },
    { label: 'Links',      value: `${savedLinks.length} saved`,                      color: pinnedLinks > 0 ? ACCENT.blue : ACCENT.muted },
    { label: 'Overdue',    value: String(overdueCount),                             color: overdueCount > 0 ? ACCENT.red : ACCENT.muted },
    { label: 'Alerts',     value: String(alerts.length),                            color: alerts.length > 0 ? ACCENT.amber : ACCENT.green },
    { label: 'Approvals',  value: `${pending.length} pending`,                      color: ACCENT.purple },
    { label: 'Projects',   value: `${activeProjects} active`,                       color: ACCENT.teal },
    { label: 'Components', value: components.length ? `${healthy}/${components.length} healthy` : '—', color: sysErrors.length > 0 ? ACCENT.amber : ACCENT.green },
  ]

  return (
    <div className="h-full overflow-y-auto bg-base">
      {/* Scoped keyframes — visual flare only, no global CSS or palette changes */}
      <style>{`
        @keyframes home-rise   { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
        @keyframes home-scan   { from { transform: rotate(0deg) }  to { transform: rotate(360deg) } }
        @keyframes home-ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes home-blink  { 0%, 100% { opacity: 1 } 50% { opacity: 0.15 } }
        .home-rise { animation: home-rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both }
        .home-ticker-track { animation: home-ticker 36s linear infinite }
        .home-ticker:hover .home-ticker-track { animation-play-state: paused }
      `}</style>

      {/* ─── Hero ───────────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden bg-surface border-b border-border">
        <div className="relative max-w-[1400px] mx-auto px-5 lg:px-8 pt-8 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-6">

            {/* Left: greeting + status */}
            <div className="min-w-0 home-rise">
              <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-text-primary">
                {greeting()}, Ant.
              </h1>
              <p className="mt-2 text-sm text-text-secondary">
                {dateLabel} — your agents, projects, and pipelines at a glance.
              </p>

              {/* live status pill */}
              <div
                className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
                style={{ backgroundColor: `${statusColor}14` }}
              >
                <span className="relative flex w-2 h-2">
                  <span className="absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping" style={{ backgroundColor: statusColor }} />
                  <span className="relative inline-flex w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
                </span>
                <span className="text-xs font-medium" style={{ color: statusColor }}>{statusText}</span>
              </div>
            </div>

            {/* Right: radar + clock + spend */}
            <div className="flex items-center gap-6 home-rise" style={{ animationDelay: '120ms' }}>
              <RadarSweep alert={criticalAttn} />
              <div className="flex flex-col gap-3.5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Local time</p>
                  <p className="font-mono text-2xl font-semibold tabular-nums text-text-primary leading-none mt-1">
                    {hhmm}<span className="text-text-muted text-base">:{ss}</span>
                  </p>
                </div>
                <button onClick={() => onNavigate('spend')} className="group text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    <TrendingUp size={10} /> Token value · 7 days
                    <ArrowUpRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </p>
                  <p className="text-3xl font-bold tabular-nums leading-none mt-1 text-accent-green">
                    {usage ? `$${spend.toFixed(2)}` : '—'}
                  </p>
                  <p className="text-[10px] text-text-muted tabular-nums mt-1">
                    {usage ? `${fmtNum(usage.totalTokens)} tokens · ${fmtNum(usage.totalRuns)} runs` : 'awaiting telemetry'}
                  </p>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* telemetry ticker */}
        <div className="home-ticker relative border-t border-border-subtle overflow-hidden">
          <div className="home-ticker-track flex items-center w-max py-2">
            {[0, 1].map(copy => (
              <div key={copy} className="flex items-center shrink-0" aria-hidden={copy === 1}>
                {tickerItems.map((it, i) => (
                  <span key={`${copy}-${i}`} className="flex items-center gap-1.5 px-5 text-xs whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: it.color }} />
                    <span className="text-text-muted">{it.label}</span>
                    <span className="text-text-primary font-semibold tabular-nums">{it.value}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto p-4 lg:p-6 space-y-4">

        {/* ─── Command metrics ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          <StatTile icon={<ListTodo size={14} />} label="Open to-dos"
            sub={overdueCount > 0 ? `${overdueCount} overdue — act now` : 'nothing overdue'}
            value={openTodos.length} accent={overdueCount > 0 ? ACCENT.red : ACCENT.blue}
            delay={60} onClick={() => onNavigate('todos')} />
          <StatTile icon={<Inbox size={14} />} label="Approvals"
            sub={pending.length > 0 ? 'awaiting your decision' : 'queue clear'}
            value={pending.length} accent={ACCENT.purple}
            delay={120} onClick={() => openHubTab('todos', 'approvals')} />
          <StatTile icon={<Bell size={14} />} label="Active alerts"
            sub={alerts.length > 0 ? 'firing now' : 'quiet skies'}
            value={alerts.length} accent={alerts.length > 0 ? ACCENT.amber : ACCENT.green}
            delay={180} onClick={() => openHubTab('health', 'alerts')} />
          <StatTile icon={<FolderKanban size={14} />} label="Active projects"
            sub={`${projects.length} total tracked`}
            value={activeProjects} accent={ACCENT.teal}
            delay={240} onClick={() => onNavigate('projects')} />
          <HeartbeatWidget job={heartbeatJob} now={clock} onOpen={() => openHubTab('activity', 'live')} />
        </div>

        {/* ─── Priority queue ──────────────────────────────────────────────── */}
        <section className="home-rise bg-card border border-border rounded-xl overflow-hidden" style={{ animationDelay: '160ms' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <Zap size={13} className="text-accent-amber" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Priority queue — needs your eyes first</h2>
            {loaded && (
              <span
                className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums"
                style={{
                  color: attention.length > 0 ? ACCENT.amber : ACCENT.green,
                  backgroundColor: `${attention.length > 0 ? ACCENT.amber : ACCENT.green}1a`,
                }}
              >
                {attention.length > 0 ? `${attention.length} flagged` : 'clear'}
              </span>
            )}
          </div>
          {attention.length === 0 ? (
            <EmptyNote icon={<CheckCircle2 size={20} className="text-accent-green" />} text={loaded ? 'Nothing urgent. Quiet skies.' : 'Scanning…'} />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-border-subtle">
              {attention.map(item => (
                <li key={item.key} className="bg-card">
                  <button
                    onClick={() => item.tab ? openHubTab(item.view, item.tab) : onNavigate(item.view)}
                    className="group flex items-start gap-3 w-full px-4 py-3 hover:bg-card-hover transition-colors text-left"
                  >
                    <span
                      className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 mt-0.5"
                      style={{ backgroundColor: `${item.color}1a`, color: item.color }}
                    >
                      {item.icon}
                    </span>
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium text-text-primary truncate">{item.title}</span>
                      <span className="text-[11px] text-text-muted truncate mt-0.5">{item.sub}</span>
                    </span>
                    <ArrowUpRight size={12} className="text-text-muted shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─── Triage desk ────────────────────────────────────────────────── */}
        <section className="home-rise bg-card border border-border rounded-xl overflow-hidden" style={{ animationDelay: '200ms' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
            <Inbox size={13} className="text-accent-blue" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Capture & triage</h2>
            <span className="ml-auto text-[10px] text-text-muted">Launcher, inbox, and links in one place</span>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-px bg-border-subtle">
            <div className="bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Unified inbox</p>
                  <p className="mt-1 text-xs text-text-muted">Critical approvals, blocked work, feedback, and publications ready for triage.</p>
                </div>
                <button onClick={openInboxHub} className="flex items-center gap-1 rounded border border-border bg-base px-2.5 py-1 text-[11px] text-text-secondary hover:bg-card-hover hover:text-text-primary transition-colors shrink-0">
                  Open inbox <ArrowRight size={11} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Active', value: activeInbox, color: activeInbox > 0 ? ACCENT.amber : ACCENT.green },
                  { label: 'Snoozed', value: snoozedInbox, color: ACCENT.blue },
                  { label: 'Approvals', value: pending.length, color: ACCENT.purple },
                ].map(stat => (
                  <div key={stat.label} className="rounded-lg border border-border-subtle bg-base px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{stat.label}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums leading-none" style={{ color: stat.color }}>{stat.value}</p>
                  </div>
                ))}
              </div>

              {topInbox.length === 0 ? (
                <EmptyNote icon={<CheckCircle2 size={20} className="text-accent-green" />} text={loaded ? 'Inbox is clear.' : 'Loading inbox…'} />
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {topInbox.map(item => (
                    <li key={item.id}>
                      <button onClick={() => openFocusedInboxItem(item)} className="group flex items-start gap-2.5 w-full rounded-lg px-2.5 py-2 hover:bg-card-hover transition-colors text-left">
                        <span
                          className="mt-0.5 inline-flex h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: item.priority === 'critical'
                              ? ACCENT.red
                              : item.priority === 'high'
                                ? ACCENT.amber
                                : item.priority === 'medium'
                                  ? ACCENT.blue
                                  : ACCENT.muted,
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-text-primary">{item.title}</span>
                            <span className="rounded border border-border-subtle bg-base px-1.5 py-0.5 text-[10px] capitalize text-text-muted shrink-0">{item.kind}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-text-muted">{item.summary}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-text-muted">{item.eventAgo}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">Saved links</p>
                  <p className="mt-1 text-xs text-text-muted">Reference docs, research, and follow-up reading with quick task or note conversion.</p>
                </div>
                <button onClick={openLinksHub} className="flex items-center gap-1 rounded border border-border bg-base px-2.5 py-1 text-[11px] text-text-secondary hover:bg-card-hover hover:text-text-primary transition-colors shrink-0">
                  Open links <ArrowRight size={11} />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Saved', value: savedLinks.length, color: ACCENT.blue },
                  { label: 'Pinned', value: pinnedLinks, color: ACCENT.amber },
                  { label: 'Unread', value: savedLinks.filter(link => !link.openedAt).length, color: ACCENT.teal },
                ].map(stat => (
                  <div key={stat.label} className="rounded-lg border border-border-subtle bg-base px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{stat.label}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums leading-none" style={{ color: stat.color }}>{stat.value}</p>
                  </div>
                ))}
              </div>

              {topLinks.length === 0 ? (
                <EmptyNote icon={<Link2 size={20} className="text-accent-blue" />} text={loaded ? 'No saved links yet.' : 'Loading links…'} />
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {topLinks.map(link => (
                    <li key={link.id}>
                      <button
                        onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                        className="group flex items-start gap-2.5 w-full rounded-lg px-2.5 py-2 hover:bg-card-hover transition-colors text-left"
                      >
                        <Link2 size={13} className="mt-0.5 shrink-0 text-accent-blue" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-text-primary">{link.title}</span>
                            {link.pinned && <span className="rounded border border-amber-900/40 bg-amber-950/20 px-1.5 py-0.5 text-[10px] text-amber-300 shrink-0">Pinned</span>}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-text-muted">{link.domain}{link.note ? ` · ${link.note}` : ''}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-text-muted">{link.updatedAgo}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        {/* ─── Quick-view grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

          {/* Usage — spans 2 */}
          <PanelCard title="Usage — last 7 days" icon={<Radar size={14} />} view="usage" onNavigate={onNavigate}
            accent={ACCENT.purple} delay={220} className="xl:col-span-2">
            {!usage ? (
              <EmptyNote icon={<Activity size={20} />} text={loaded ? 'Usage data unavailable' : 'Loading usage…'} />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Tokens', value: fmtNum(usage.totalTokens),        icon: <Cpu size={11} />,   color: ACCENT.purple },
                    { label: 'Value',  value: `$${usage.totalCost.toFixed(2)}`, icon: <Coins size={11} />, color: ACCENT.green },
                    { label: 'Runs',   value: fmtNum(usage.totalRuns),          icon: <Zap size={11} />,   color: ACCENT.blue },
                  ].map(s => (
                    <div key={s.label} className="px-3 py-2.5 rounded-lg bg-base border border-border-subtle">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{s.icon}{s.label}</div>
                      <p className="mt-1 text-xl font-bold tabular-nums leading-none" style={{ color: s.color }}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <Histogram
                    height={92}
                    gap="gap-1"
                    bars={usage.dailyUsage.map(d => ({ value: d.tokens, color: ACCENT.purple, label: `${d.date}: ${fmtNum(d.tokens)} tok · $${d.cost.toFixed(2)} · ${d.runs} runs` }))}
                  />
                  <div className="flex justify-between mt-1.5">
                    {usage.dailyUsage.map(d => (
                      <span key={d.dateIso} className="flex-1 text-center text-[9px] text-text-muted truncate">{d.date}</span>
                    ))}
                  </div>
                </div>
                {tb && (tb.input + tb.output + tb.cacheRead + tb.cacheWrite > 0) && (
                  <SegmentBar
                    height={8}
                    segments={[
                      { label: 'Input',       value: tb.input,      color: ACCENT.blue },
                      { label: 'Output',      value: tb.output,     color: ACCENT.purple },
                      { label: 'Cache read',  value: tb.cacheRead,  color: ACCENT.teal },
                      { label: 'Cache write', value: tb.cacheWrite, color: ACCENT.amber },
                    ]}
                  />
                )}
              </div>
            )}
          </PanelCard>

          {/* To-dos */}
          <PanelCard title="To-Do" icon={<ListTodo size={14} />} view="todos" onNavigate={onNavigate} accent={ACCENT.blue} delay={280}>
            {topTodos.length === 0 ? (
              <EmptyNote icon={<CheckCircle2 size={20} className="text-accent-green" />} text={loaded ? 'Inbox zero. Nicely done.' : 'Loading…'} />
            ) : (
              <ul className="space-y-1">
                {topTodos.map(t => {
                  const overdue = isOverdue(t)
                  return (
                    <li key={t.id}>
                      <button onClick={() => onNavigate('todos')} className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg hover:bg-card-hover transition-colors text-left">
                        <Circle size={13} className="shrink-0" style={{ color: SEV_COLOR[t.severity] }} fill={t.severity === 'critical' ? ACCENT.red : 'none'} fillOpacity={0.3} />
                        <span className="flex-1 text-sm text-text-primary truncate">{t.title}</span>
                        {t.dueDate && (
                          <span
                            className={clsx('flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums shrink-0', !overdue && !isDueToday(t) && 'bg-card-hover text-text-muted')}
                            style={overdue
                              ? { color: ACCENT.red,   backgroundColor: `${ACCENT.red}1a` }
                              : isDueToday(t) ? { color: ACCENT.amber, backgroundColor: `${ACCENT.amber}1a` } : undefined}
                          >
                            {overdue ? <Flame size={9} /> : <CalendarDays size={9} />}
                            {overdue ? 'overdue' : isDueToday(t) ? 'today' : t.dueDate.slice(5, 10)}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
                {openTodos.length > topTodos.length && (
                  <li className="pt-1 text-center text-[11px] text-text-muted">+{openTodos.length - topTodos.length} more open</li>
                )}
              </ul>
            )}
          </PanelCard>

          {/* Projects */}
          <PanelCard title="Project status" icon={<FolderKanban size={14} />} view="projects" onNavigate={onNavigate} accent={ACCENT.teal} delay={340}>
            {topProjects.length === 0 ? (
              <EmptyNote icon={<FolderKanban size={20} />} text={loaded ? 'No projects yet' : 'Loading…'} />
            ) : (
              <ul className="space-y-3">
                {topProjects.map(p => (
                  <li key={p.id}>
                    <button onClick={() => onNavigate('projects')} className="w-full text-left group">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PROJECT_STATUS_COLOR[p.status] }} />
                        <span className="flex-1 text-sm font-medium text-text-primary truncate">{p.name}</span>
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium capitalize shrink-0"
                          style={{ color: PROJECT_STATUS_COLOR[p.status], backgroundColor: `${PROJECT_STATUS_COLOR[p.status]}1a` }}
                        >
                          {p.status}
                        </span>
                        <span className="text-xs text-text-secondary tabular-nums w-9 text-right shrink-0">{p.progress}%</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-base overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${Math.max(p.progress, 2)}%`, backgroundColor: PROJECT_STATUS_COLOR[p.status] }}
                        />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          {/* Alerts & errors */}
          <PanelCard title="Alerts & errors" icon={<Bell size={14} />} view="health" onNavigate={() => openHubTab('health', 'alerts')} accent={ACCENT.amber} delay={400}>
            {alerts.length === 0 && sysErrors.length === 0 ? (
              <EmptyNote icon={<CheckCircle2 size={20} className="text-accent-green" />} text={loaded ? 'No active alerts — quiet skies' : 'Loading…'} />
            ) : (
              <ul className="space-y-1.5">
                {alerts.slice(0, 4).map(a => (
                  <li key={`${a.ruleId}-${a.firedAt}`} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg bg-base">
                    {a.severity === 'critical'
                      ? <ShieldAlert size={14} className="shrink-0 mt-0.5 text-accent-red" />
                      : <AlertTriangle size={14} className={clsx('shrink-0 mt-0.5', a.severity === 'warning' ? 'text-accent-amber' : 'text-accent-blue')} />}
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary truncate">{a.message}</p>
                      <p className="text-[10px] text-text-muted truncate">{[a.ruleName, a.source, agoShort(a.firedAt)].filter(Boolean).join(' · ')}</p>
                    </div>
                  </li>
                ))}
                {sysErrors.slice(0, 3).map(c => (
                  <li key={c.id} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg bg-base">
                    <ServerCrash size={14} className={clsx('shrink-0 mt-0.5', c.status === 'error' ? 'text-accent-red' : 'text-text-muted')} />
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary truncate">{c.name} <span className="text-text-muted">({c.status})</span></p>
                      {(c.error || c.description) && <p className="text-[10px] text-text-muted truncate">{c.error || c.description}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          {/* System health */}
          <PanelCard title="System health" icon={<Activity size={14} />} view="health" onNavigate={() => openHubTab('health', 'system')} accent={ACCENT.green} delay={460}>
            {components.length === 0 ? (
              <EmptyNote icon={<Cpu size={20} />} text={loaded ? 'No component data' : 'Loading…'} />
            ) : (
              <div className="flex items-center gap-5">
                <Donut
                  size={104}
                  thickness={13}
                  centerTop={`${healthy}/${components.length}`}
                  centerBottom="healthy"
                  segments={[
                    { label: 'Healthy', value: healthy,                                               color: ACCENT.green },
                    { label: 'Warning', value: components.filter(c => c.status === 'warning').length, color: ACCENT.amber },
                    { label: 'Error',   value: components.filter(c => c.status === 'error').length,   color: ACCENT.red },
                    { label: 'Offline', value: components.filter(c => c.status === 'offline').length, color: ACCENT.muted },
                  ]}
                />
                <div className="flex-1 min-w-0 space-y-1.5">
                  {([['healthy', ACCENT.green], ['warning', ACCENT.amber], ['error', ACCENT.red], ['offline', ACCENT.muted]] as const).map(([st, color]) => {
                    const n = components.filter(c => c.status === st).length
                    return (
                      <div key={st} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-xs text-text-secondary capitalize flex-1">{st}</span>
                        <span className="text-xs font-semibold tabular-nums text-text-primary">{n}</span>
                      </div>
                    )
                  })}
                  {sys?.host && (
                    <p className="pt-1.5 text-[10px] text-text-muted truncate border-t border-border-subtle">
                      {sys.host.hostname} · mem {sys.host.usedMemPct}% · load {sys.host.loadAvg.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </PanelCard>

        </div>
      </div>
    </div>
  )
}

export default Home
