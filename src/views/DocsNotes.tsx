import { useState } from 'react'
import { clsx } from 'clsx'
import { BookOpen, NotebookPen } from 'lucide-react'
import { Docs } from './Docs'
import { Notes } from './Notes'

type TabId = 'docs' | 'notes'
const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'docs',  label: 'Docs',  icon: <BookOpen    size={13} /> },
  { id: 'notes', label: 'Notes', icon: <NotebookPen size={13} /> },
]

export function DocsNotes() {
  const [tab, setTab] = useState<TabId>('docs')
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
        {tab === 'docs'  && <Docs />}
        {tab === 'notes' && <Notes />}
      </div>
    </div>
  )
}
