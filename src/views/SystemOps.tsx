import { useState } from 'react'
import { clsx } from 'clsx'
import { Radar as RadarIcon, Settings, BarChart3 } from 'lucide-react'
import { Radar } from './Radar'
import { System } from './System'
import { ModelOps } from './ModelOps'

type TabId = 'radar' | 'system' | 'modelops'
const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'radar',   label: 'Radar',     icon: <RadarIcon size={13} /> },
  { id: 'system',  label: 'System',    icon: <Settings  size={13} /> },
  { id: 'modelops',label: 'Model Ops', icon: <BarChart3 size={13} /> },
]

export function SystemOps() {
  const [tab, setTab] = useState<TabId>('radar')
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
        {tab === 'radar'    && <Radar />}
        {tab === 'system'   && <System />}
        {tab === 'modelops' && <ModelOps />}
      </div>
    </div>
  )
}
