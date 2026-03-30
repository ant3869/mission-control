import { useState, useEffect } from 'react'
import {
  CheckSquare, Bot, FileText, ThumbsUp, Calendar, FolderKanban,
  Brain, BookOpen, UserCircle, Building2, Network, Settings,
  Radar, Factory, GitBranch, MessageSquare, ChevronRight, NotebookPen,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { View } from '../../types'

interface SidebarProps {
  activeView: View
  onNavigate: (view: View) => void
}

type NavItem = { id: View; label: string; icon: React.ReactNode; badge?: number }
type NavSection = { items: NavItem[] }

const iconSize = 15

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { id: 'tasks',     label: 'Tasks',     icon: <CheckSquare size={iconSize} /> },
      { id: 'agents',    label: 'Agents',    icon: <Bot size={iconSize} /> },
      { id: 'content',   label: 'Content',   icon: <FileText size={iconSize} /> },
      { id: 'approvals', label: 'Approvals', icon: <ThumbsUp size={iconSize} /> },
      { id: 'council',   label: 'Chats',     icon: <MessageSquare size={iconSize} /> },
    ],
  },
  {
    items: [
      { id: 'calendar', label: 'Calendar', icon: <Calendar size={iconSize} /> },
      { id: 'projects', label: 'Projects', icon: <FolderKanban size={iconSize} /> },
      { id: 'memory',   label: 'Memory',   icon: <Brain size={iconSize} /> },
      { id: 'docs',     label: 'Docs',     icon: <BookOpen size={iconSize} /> },
      { id: 'notes',    label: 'Notes',    icon: <NotebookPen size={iconSize} /> },
      { id: 'people',   label: 'People',   icon: <UserCircle size={iconSize} /> },
      { id: 'office',   label: 'Office',   icon: <Building2 size={iconSize} /> },
      { id: 'team',     label: 'Team',     icon: <Network size={iconSize} /> },
    ],
  },
  {
    items: [
      { id: 'system',   label: 'System',   icon: <Settings size={iconSize} /> },
      { id: 'radar',    label: 'Radar',    icon: <Radar size={iconSize} /> },
      { id: 'factory',  label: 'Factory',  icon: <Factory size={iconSize} /> },
      { id: 'pipeline', label: 'Pipeline', icon: <GitBranch size={iconSize} /> },
      { id: 'feedback', label: 'Feedback', icon: <MessageSquare size={iconSize} /> },
    ],
  },
]

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const [tasksBadge,     setTasksBadge]     = useState<number | undefined>(undefined)
  const [approvalsBadge, setApprovalsBadge] = useState<number | undefined>(undefined)

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [tRes, aRes] = await Promise.all([
          fetch('/api/tasks').then(r => r.json()),
          fetch('/api/approvals').then(r => r.json()),
        ])
        const activeTasks = (tRes.tasks ?? []).filter(
          (t: { status: string }) => t.status !== 'completed',
        ).length
        const pendingApprovals = (aRes.approvals ?? []).filter(
          (a: { status: string }) => a.status === 'pending',
        ).length
        setTasksBadge(activeTasks > 0 ? activeTasks : undefined)
        setApprovalsBadge(pendingApprovals > 0 ? pendingApprovals : undefined)
      } catch { /* ignore — badges just won't show */ }
    }
    fetchCounts()
    const timer = setInterval(fetchCounts, 30_000)
    return () => clearInterval(timer)
  }, [])

  const getBadge = (id: View): number | undefined => {
    if (id === 'tasks')     return tasksBadge
    if (id === 'approvals') return approvalsBadge
    return undefined
  }

  return (
    <aside className="flex flex-col w-[220px] min-w-[220px] h-full border-r border-border bg-surface overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-border shrink-0">
        <div className="flex items-center justify-center w-6 h-6 rounded bg-text-primary text-base font-mono font-semibold text-black text-xs leading-none select-none">
          N
        </div>
        <span className="text-sm font-semibold tracking-tight text-text-primary">
          Mission Control
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col flex-1 py-2 gap-4 px-2">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si} className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const isActive = activeView === item.id
              const badge    = getBadge(item.id)
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={clsx(
                    'group flex items-center gap-2.5 w-full px-2.5 py-[7px] rounded text-left transition-all duration-100',
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
                  <span className="flex-1 text-sm font-medium leading-none">{item.label}</span>
                  {badge !== undefined && (
                    <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent-blue/20 text-accent-blue text-xxs font-semibold tabular-nums">
                      {badge}
                    </span>
                  )}
                  {isActive && (
                    <ChevronRight size={12} className="text-text-muted shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-medium text-text-primary truncate">Ant</span>
            <span className="text-xxs text-text-muted truncate">anthon3869@gmail.com</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
