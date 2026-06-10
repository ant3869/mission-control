import { useState, useEffect } from 'react'
import {
  CheckSquare, ListTodo, Radio, BookOpen, FolderKanban, Radar,
  MessageSquare, Calendar, Brain, FileText, ThumbsUp,
  Activity, Gauge, Target, Workflow, Package,
  Users, Cog, ChevronLeft, ChevronRight, FlaskConical,
  BrainCircuit, GitBranch, Bell, Shield,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { View } from '../../types'

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
      { id: 'todos',    label: 'To-Do',    icon: <ListTodo      size={iconSize} /> },
      { id: 'tasks',    label: 'Tasks',    icon: <CheckSquare   size={iconSize} /> },
      { id: 'watch',    label: 'Watch',    icon: <Radio         size={iconSize} /> },
      { id: 'council',  label: 'Chats',    icon: <MessageSquare size={iconSize} /> },
      { id: 'calendar', label: 'Calendar', icon: <Calendar      size={iconSize} /> },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { id: 'docs',    label: 'Docs',    icon: <BookOpen size={iconSize} /> },
      { id: 'memory',  label: 'Memory',  icon: <Brain    size={iconSize} /> },
      { id: 'content', label: 'Content', icon: <FileText size={iconSize} /> },
    ],
  },
  {
    label: 'Projects',
    items: [
      { id: 'projects',  label: 'Projects',  icon: <FolderKanban size={iconSize} /> },
      { id: 'inventory', label: 'Inventory', icon: <Package      size={iconSize} /> },
      { id: 'feedback',  label: 'Feedback',  icon: <ThumbsUp     size={iconSize} /> },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { id: 'ops',         label: 'Ops',           icon: <Radar        size={iconSize} /> },
      { id: 'evaluations', label: 'Evaluations',   icon: <Target       size={iconSize} /> },
      { id: 'harness',     label: 'Harness Bench', icon: <FlaskConical size={iconSize} /> },
      { id: 'flowmap',     label: 'Flow Map',      icon: <Workflow     size={iconSize} /> },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      { id: 'brain',    label: 'Brain',    icon: <BrainCircuit size={iconSize} /> },
      { id: 'flow',     label: 'Flow',     icon: <GitBranch    size={iconSize} /> },
      { id: 'alerts',   label: 'Alerts',   icon: <Bell         size={iconSize} /> },
      { id: 'security', label: 'Security', icon: <Shield       size={iconSize} /> },
    ],
  },
  {
    label: 'Platform',
    items: [
      { id: 'openclaw', label: 'OpenClaw', icon: <Activity size={iconSize} /> },
      { id: 'hermes',   label: 'Hermes',   icon: <Gauge    size={iconSize} /> },
    ],
  },
  {
    label: 'People',
    items: [
      { id: 'workspace', label: 'Workspace', icon: <Users size={iconSize} /> },
    ],
  },
]

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed]           = useState(false)
  const [tasksBadge,     setTasksBadge]     = useState<number | undefined>(undefined)
  const [approvalsBadge, setApprovalsBadge] = useState<number | undefined>(undefined)
  const [todosBadge,     setTodosBadge]     = useState<number | undefined>(undefined)

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [tRes, aRes, dRes] = await Promise.all([
          fetch('/api/tasks').then(r => r.json()),
          fetch('/api/approvals').then(r => r.json()),
          fetch('/api/todos').then(r => r.json()),
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
        setTasksBadge(activeTasks > 0 ? activeTasks : undefined)
        setApprovalsBadge(pendingApprovals > 0 ? pendingApprovals : undefined)
        setTodosBadge(openTodos > 0 ? openTodos : undefined)
      } catch { /* ignore — badges just won't show */ }
    }
    fetchCounts()
    const timer = setInterval(fetchCounts, 30_000)
    return () => clearInterval(timer)
  }, [])

  const getBadge = (id: View): number | undefined => {
    // Roll tasks + approvals badge into the combined Tasks nav item
    if (id === 'tasks') {
      const total = (tasksBadge ?? 0) + (approvalsBadge ?? 0)
      return total > 0 ? total : undefined
    }
    if (id === 'todos') return todosBadge
    return undefined
  }

  return (
    <aside
      className={clsx(
        'flex flex-col h-full border-r border-border bg-surface overflow-hidden transition-all duration-200',
        collapsed ? 'w-12 min-w-12' : 'w-[200px] min-w-[200px]',
      )}
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center h-12 border-b border-border shrink-0 px-2 gap-1.5">
        <div className="flex items-center justify-center w-7 h-7 rounded bg-text-primary text-black text-xs font-mono font-semibold shrink-0 select-none">
          N
        </div>
        {!collapsed && (
          <span className="flex-1 text-sm font-semibold tracking-tight text-text-primary truncate">
            Mission Control
          </span>
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
                        <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent-blue/20 text-accent-blue text-xxs font-semibold tabular-nums">
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
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent-blue" />
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

      {/* User footer */}
      <div className={clsx('shrink-0 border-t border-border py-3', collapsed ? 'px-1.5' : 'px-4')}>
        {collapsed ? (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 mx-auto" />
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-text-primary truncate">Ant</span>
              <span className="text-xxs text-text-muted truncate">anthon3869@gmail.com</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}


