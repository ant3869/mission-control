import { useState } from 'react'
import { clsx } from 'clsx'
import { UserCircle, Building2, Factory as FactoryIcon } from 'lucide-react'
import { People } from './People'
import { Office } from './Office'
import { Factory } from './Factory'

type TabId = 'people' | 'office' | 'factory'
const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'people',  label: 'People',  icon: <UserCircle   size={13} /> },
  { id: 'office',  label: 'Office',  icon: <Building2    size={13} /> },
  { id: 'factory', label: 'Factory', icon: <FactoryIcon  size={13} /> },
]

export function WorkspaceHub() {
  const [tab, setTab] = useState<TabId>('people')
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
        {tab === 'people'  && <People />}
        {tab === 'office'  && <Office />}
        {tab === 'factory' && <Factory />}
      </div>
    </div>
  )
}
