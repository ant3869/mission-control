import { useEffect } from 'react'
import { clsx } from 'clsx'
import { BookOpen, Link2, NotebookPen } from 'lucide-react'
import { Docs } from './Docs'
import { Notes } from './Notes'
import { Links } from './Links'
import { usePersistedState } from '../hooks/usePersistedState'
import { DOCS_TAB_EVENT, DOCS_TAB_STORAGE_KEY, type DocsTabId } from '../lib/quickActions'

const TABS: Array<{ id: DocsTabId; label: string; icon: React.ReactNode }> = [
  { id: 'docs',  label: 'Docs',  icon: <BookOpen    size={13} /> },
  { id: 'notes', label: 'Notes', icon: <NotebookPen size={13} /> },
  { id: 'links', label: 'Links', icon: <Link2       size={13} /> },
]

export function DocsNotes() {
  const [tab, setTab] = usePersistedState<DocsTabId>(DOCS_TAB_STORAGE_KEY, 'docs')

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ tab?: DocsTabId }>
      if (custom.detail?.tab) setTab(custom.detail.tab)
    }
    window.addEventListener(DOCS_TAB_EVENT, handler as EventListener)
    return () => window.removeEventListener(DOCS_TAB_EVENT, handler as EventListener)
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
        {tab === 'docs'  && <Docs />}
        {tab === 'notes' && <Notes />}
        {tab === 'links' && <Links />}
      </div>
    </div>
  )
}
