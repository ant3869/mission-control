import { useState } from 'react'
import { clsx } from 'clsx'
import { Radio, Bot } from 'lucide-react'
import { Watch } from './Watch'
import { Agents } from './Agents'

type TabId = 'watch' | 'agents'
const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'watch',  label: 'Watch',  icon: <Radio size={13} /> },
  { id: 'agents', label: 'Agents', icon: <Bot   size={13} /> },
]

export function WatchAgents() {
  const [tab, setTab] = useState<TabId>('watch')
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
        {tab === 'watch'  && <Watch />}
        {tab === 'agents' && <Agents />}
      </div>
    </div>
  )
}
