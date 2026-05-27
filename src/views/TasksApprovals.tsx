import { useState } from 'react'
import { clsx } from 'clsx'
import { CheckSquare, ThumbsUp } from 'lucide-react'
import { Tasks } from './Tasks'
import { Approvals } from './Approvals'

type TabId = 'tasks' | 'approvals'
const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'tasks',     label: 'Tasks',     icon: <CheckSquare size={13} /> },
  { id: 'approvals', label: 'Approvals', icon: <ThumbsUp    size={13} /> },
]

export function TasksApprovals() {
  const [tab, setTab] = useState<TabId>('tasks')
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-6 border-b border-border shrink-0 overflow-x-auto bg-surface">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx('flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
              tab === t.id ? 'border-text-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'tasks'     && <Tasks />}
        {tab === 'approvals' && <Approvals />}
      </div>
    </div>
  )
}
