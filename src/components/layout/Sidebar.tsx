import { useState, useEffect } from 'react'
import {
  ListTodo, BookOpen, FolderKanban, Radar,
  MessageSquare, Calendar, Brain, Wallet,
  Activity, Target, Package, Lightbulb,
  Cog, ChevronLeft, ChevronRight, FlaskConical,
  HeartPulse, House, ShoppingCart, Newspaper, Link,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { View } from '../../types'
import { apiFetch } from '../../lib/apiTransport.js'

interface SidebarProps {
  activeView: View
  onNavigate: (view: View) => void
}

const iconSize = 15

type NavItem = { id: View; label: string; icon: React.ReactNode }
type NavSection = { label: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    label: 'Work',
    items: [
      { id: 'home',     label: 'Home',     icon: <House         size={iconSize} /> },
      { id: 'todos',    label: 'To-Do',    icon: <ListTodo      size={iconSize} /> },
      { id: 'tobuy',    label: 'To-Buy',   icon: <ShoppingCart  size={iconSize} /> },
      { id: 'spend',    label: 'Financials', icon: <Wallet        size={iconSize} /> },
      { id: 'council',  label: 'Chats',    icon: <MessageSquare size={iconSize} /> },
      { id: 'calendar', label: 'Calendar', icon: <Calendar      size={iconSize} /> },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'docs',   label: 'Docs',   icon: <BookOpen  size={iconSize} /> },
      { id: 'links',  label: 'Links',  icon: <Link      size={iconSize} /> },
      { id: 'news',   label: 'News',   icon: <Newspaper size={iconSize} /> },
      { id: 'memory', label: 'Memory', icon: <Brain     size={iconSize} /> },
    ],
  },
  {
    label: 'Build',
    items: [
      { id: 'projects',  label: 'Projects',  icon: <FolderKanban size={iconSize} /> },
      { id: 'inventory', label: 'Inventory', icon: <Package      size={iconSize} /> },
      { id: 'factory',   label: 'Ideas',     icon: <Lightbulb    size={iconSize} /> },
    ],
  },
  {
    label: 'AI Ops',
    items: [
      { id: 'activity',    label: 'Activity',   icon: <Activity     size={iconSize} /> },
      { id: 'usage',       label: 'Usage',      icon: <Radar        size={iconSize} /> },
      { id: 'harness',     label: 'Benchmarks', icon: <FlaskConical size={iconSize} /> },
      { id: 'evaluations', label: 'Evals',      icon: <Target       size={iconSize} /> },
      { id: 'health',      label: 'Health',     icon: <HeartPulse   size={iconSize} /> },
    ],
  },
]

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed]           = useState(false)
  const [tasksBadge,     setTasksBadge]     = useState<number | undefined>(undefined)
  const [approvalsBadge, setApprovalsBadge] = useState<number | undefined>(undefined)
  const [inboxBadge,     setInboxBadge]     = useState<number | undefined>(undefined)
  const [todosBadge,     setTodosBadge]     = useState<number | undefined>(undefined)
  const [toBuyBadge,     setToBuyBadge]     = useState<number | undefined>(undefined)
  const [healthBadge,    setHealthBadge]    = useState<number | undefined>(undefined)

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [tRes, aRes, dRes, iRes, bRes, hRes] = await Promise.all([
          apiFetch<{ tasks?: Array<{ status: string }> }>('/api/tasks'),
          apiFetch<{ approvals?: Array<{ status: string }> }>('/api/approvals'),
          apiFetch<{ todos?: Array<{ done: boolean }> }>('/api/todos'),
          apiFetch<{ counts?: { active?: number } }>('/api/inbox'),
          apiFetch<{ items?: Array<{ purchased: boolean }> }>('/api/tobuy'),
          apiFetch<{ alerts?: Array<{ severity: string }> }>('/api/alerts/active'),
        ])
        const activeTasks = (tRes.tasks ?? []).filter(
          (t: { status: string }) => t.status !== 'completed',
        ).length
        const pendingApprovals = (aRes.approvals ?? []).filter(
          (a: { status: string }) => a.status === 'pending',
        ).length
        const openTodos = (dRes.todos ?? []).filter(
          (t: { done: boolean }) => !t.done,
        ).length
        const activeInbox = Number(iRes.counts?.active ?? 0)
        const openToBuy = (bRes.items ?? []).filter(
          (i: { purchased: boolean }) => !i.purchased,
        ).length
        const criticalAlerts = (hRes.alerts ?? []).filter(
          (a: { severity: string }) => a.severity === 'critical' || a.severity === 'warning',
        ).length
        setTasksBadge(activeTasks > 0 ? activeTasks : undefined)
        setApprovalsBadge(pendingApprovals > 0 ? pendingApprovals : undefined)
        setInboxBadge(activeInbox > 0 ? activeInbox : undefined)
        setTodosBadge(openTodos > 0 ? openTodos : undefined)
        setToBuyBadge(openToBuy > 0 ? openToBuy : undefined)
        setHealthBadge(criticalAlerts > 0 ? criticalAlerts : undefined)
      } catch { /* ignore — badges just won't show */ }
    }
    fetchCounts()
    const timer = setInterval(fetchCounts, 30_000)
    return () => clearInterval(timer)
  }, [])

  const getBadge = (id: View): number | undefined => {
    // The To-Do nav item now hosts To-Do + Tasks + Approvals + Inbox, so roll all
    // their open counts into its single badge.
    if (id === 'todos') {
      const total = (todosBadge ?? 0) + (tasksBadge ?? 0) + (approvalsBadge ?? 0) + (inboxBadge ?? 0)
      return total > 0 ? total : undefined
    }
    if (id === 'tobuy') return toBuyBadge
    if (id === 'health') return healthBadge
    return undefined
  }

  return (
    <aside
      className={clsx(
        'flex flex-col h-full border-r border-border bg-surface overflow-hidden transition-all duration-200',
        collapsed ? 'w-12 min-w-12' : 'w-[200px] min-w-[200px]',
      )}
    >
      {/* Logo + title + collapse toggle */}
      <div className="flex items-center h-14 border-b border-border shrink-0 px-2 gap-2">
        <img src="/icon.png" alt="Mission Control" className="w-9 h-9 rounded object-cover shrink-0 select-none" />
        {!collapsed && (
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold tracking-tight text-text-primary leading-tight truncate">Mission Control</span>
            <span className="text-xxs text-text-muted font-mono leading-tight">v{__APP_VERSION__}</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-secondary hover:bg-card transition-colors shrink-0 ml-auto"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col flex-1 py-1.5 gap-0.5 overflow-y-auto min-h-0 px-1.5">
        {NAV.map((section, si) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            {/* Section divider/label */}
            {si > 0 && (
              collapsed
                ? <div className="my-1 mx-auto w-4 border-t border-border" />
                : <div className="mx-2 my-1 border-t border-border" />
            )}
            {!collapsed && (
              <span className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted select-none">
                {section.label}
              </span>
            )}

            {section.items.map((item) => {
              const isActive = activeView === item.id
              const badge    = getBadge(item.id)
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    'group relative flex items-center gap-2.5 w-full rounded text-left transition-all duration-100',
                    collapsed ? 'justify-center px-0 py-[7px]' : 'px-2.5 py-[5px]',
                    isActive
                      ? 'bg-card-hover text-text-primary'
                      : 'text-text-secondary hover:bg-card hover:text-text-primary',
                  )}
                >
                  <span className={clsx(
                    'shrink-0 transition-colors',
                    isActive ? 'text-text-primary' : 'text-text-muted group-hover:text-text-secondary',
                  )}>
                    {item.icon}
                  </span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-sm font-medium leading-none">{item.label}</span>
                      {badge !== undefined && (
                        <span className={clsx(
                          'flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-xxs font-semibold tabular-nums',
                          item.id === 'health'
                            ? 'bg-accent-red/20 text-accent-red'
                            : 'bg-accent-blue/20 text-accent-blue',
                        )}>
                          {badge}
                        </span>
                      )}
                      {isActive && (
                        <ChevronRight size={12} className="text-text-muted shrink-0" />
                      )}
                    </>
                  )}
                  {/* Dot indicator when collapsed + badge */}
                  {collapsed && badge !== undefined && (
                    <span className={clsx(
                      'absolute top-1 right-1 w-1.5 h-1.5 rounded-full',
                      item.id === 'health' ? 'bg-accent-red' : 'bg-accent-blue',
                    )} />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Settings — pinned at bottom, above user footer */}
      <div className="shrink-0 border-t border-border px-1.5 py-1.5">
        <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? 'Settings' : undefined}
          className={clsx(
            'group flex items-center gap-2.5 w-full rounded text-left transition-all duration-100',
            collapsed ? 'justify-center px-0 py-[7px]' : 'px-2.5 py-[5px]',
            activeView === 'settings'
              ? 'bg-card-hover text-text-primary'
              : 'text-text-secondary hover:bg-card hover:text-text-primary',
          )}
        >
          <span className={clsx(
            'shrink-0 transition-colors',
            activeView === 'settings' ? 'text-text-primary' : 'text-text-muted group-hover:text-text-secondary',
          )}>
            <Cog size={iconSize} />
          </span>
          {!collapsed && (
            <span className="flex-1 text-sm font-medium leading-none">Settings</span>
          )}
        </button>
      </div>

    </aside>
  )
}


