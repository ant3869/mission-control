import { useEffect } from 'react'
import { clsx } from 'clsx'
import { CheckSquare, Inbox as InboxIcon, ThumbsUp } from 'lucide-react'
import { Tasks } from './Tasks'
import { Approvals } from './Approvals'
import { Inbox } from './Inbox'
import { usePersistedState } from '../hooks/usePersistedState'
import { TASKS_TAB_EVENT, TASKS_TAB_STORAGE_KEY, type TasksTabId } from '../lib/quickActions'

const TABS: Array<{ id: TasksTabId; label: string; icon: React.ReactNode }> = [
  { id: 'tasks',     label: 'Tasks',     icon: <CheckSquare size={13} /> },
  { id: 'approvals', label: 'Approvals', icon: <ThumbsUp    size={13} /> },
  { id: 'inbox',     label: 'Inbox',     icon: <InboxIcon   size={13} /> },
]

export function TasksApprovals() {
  const [tab, setTab] = usePersistedState<TasksTabId>(TASKS_TAB_STORAGE_KEY, 'tasks')

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ tab?: TasksTabId }>
      if (custom.detail?.tab) setTab(custom.detail.tab)
    }
    window.addEventListener(TASKS_TAB_EVENT, handler as EventListener)
    return () => window.removeEventListener(TASKS_TAB_EVENT, handler as EventListener)
  }, [setTab])

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
        {tab === 'inbox'     && <Inbox />}
      </div>
    </div>
  )
}
