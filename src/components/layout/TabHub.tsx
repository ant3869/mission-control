// title: TabHub — shared tab-hub shell for consolidated views
// path: src/components/layout/TabHub.tsx
// purpose: One reusable tab shell (matches the original SystemOps/WatchAgents
//          markup) used by the consolidated Activity / Usage / Health views.
//          Supports deep-linking to a specific tab via HUB_TAB_EVENT so links
//          like Home → "system error" land on the right inner tab.

import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import type { View } from '../../types'
import { HUB_TAB_EVENT, readHubTab, writeHubTab } from '../../lib/quickActions'

export type HubTab = {
  id: string
  label: string
  icon: React.ReactNode
  render: () => React.ReactNode
}

export function TabHub({ view, tabs }: { view: View; tabs: HubTab[] }) {
  const [tab, setTab] = useState<string>(() => {
    const stored = readHubTab(view)
    return stored && tabs.some(t => t.id === stored) ? stored : tabs[0].id
  })

  // Deep-links dispatch HUB_TAB_EVENT; switch tab when it targets this hub.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: View; tab?: string }>).detail
      if (detail?.view === view && detail.tab && tabs.some(t => t.id === detail.tab)) {
        setTab(detail.tab)
      }
    }
    window.addEventListener(HUB_TAB_EVENT, handler as EventListener)
    return () => window.removeEventListener(HUB_TAB_EVENT, handler as EventListener)
  }, [view, tabs])

  const active = tabs.find(t => t.id === tab) ?? tabs[0]

  return (
    <div className="flex flex-col h-full">
      <div className="scrollbar-none flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-2 shrink-0 sm:px-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); writeHubTab(view, t.id) }}
            className={clsx('flex min-h-11 items-center gap-1.5 border-b-2 -mb-px px-4 py-2 text-xs font-medium transition-colors whitespace-nowrap sm:min-h-0 sm:px-3 sm:py-2.5',
              tab === t.id ? 'border-text-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {active.render()}
      </div>
    </div>
  )
}
