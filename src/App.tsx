import { useState } from 'react'
import { clsx } from 'clsx'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { ScheduledTasks } from './views/ScheduledTasks'
import { Memory } from './views/Memory'
import { Chats } from './views/Chats'
import { TasksApprovals } from './views/TasksApprovals'
import { WatchAgents } from './views/WatchAgents'
import { DocsNotes } from './views/DocsNotes'
import { ProjectsPipeline } from './views/ProjectsPipeline'
import { SystemOps } from './views/SystemOps'
import { WorkspaceHub } from './views/WorkspaceHub'
import { Content } from './views/Content'
import { Feedback } from './views/Feedback'
import { Settings } from './views/Settings'
import { OpenClawMetrics, HermesMetrics } from './views/PlatformMetrics'
import { Inventory } from './views/Inventory'
import { FlowMap } from './views/FlowMap'
import { Evaluations } from './views/Evaluations'
import { HarnessBenchmarks } from './views/HarnessBenchmarks'
import type { View } from './types'

const VIEW_TITLES: Record<View, string> = {
  tasks:       'Tasks & Approvals',
  watch:       'Watch & Agents',
  docs:        'Docs & Notes',
  projects:    'Projects & Pipeline',
  ops:         'Ops',
  workspace:   'Workspace',
  content:     'Content',
  council:     'Chats',
  calendar:    'Scheduled Tasks',
  memory:      'Memory',
  inventory:   'Inventory',
  feedback:    'Feedback',
  settings:    'Settings',
  openclaw:    'OpenClaw Metrics',
  hermes:      'Hermes Metrics',
  flowmap:     'Flow Map',
  evaluations: 'Evaluations',
  harness:     'Harness Benchmarks',
}

// Render each view once (on first visit) and keep it mounted — hidden via CSS.
// This preserves all local state (scroll position, forms, filters) across navigation.
function ViewPane({
  view, active, mounted, children,
}: {
  view: View; active: View; mounted: Set<View>; children: React.ReactNode
}) {
  if (!mounted.has(view)) return null
  return (
    <div className={clsx('absolute inset-0 overflow-hidden', active !== view && 'hidden')}>
      {children}
    </div>
  )
}

export default function App() {
  const [activeView, setActiveView] = useState<View>('calendar')
  const [mounted, setMounted]       = useState<Set<View>>(new Set(['calendar' as View]))

  const navigate = (view: View) => {
    setMounted(prev => new Set([...prev, view]))
    setActiveView(view)
  }

  return (
    <div className="flex h-full w-full bg-base overflow-hidden">
      <Sidebar activeView={activeView} onNavigate={navigate} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar title={VIEW_TITLES[activeView]} />
        <main className="flex-1 overflow-hidden bg-base relative">

          <ViewPane view="calendar"    active={activeView} mounted={mounted}><ScheduledTasks /></ViewPane>
          <ViewPane view="tasks"       active={activeView} mounted={mounted}><TasksApprovals /></ViewPane>
          <ViewPane view="watch"       active={activeView} mounted={mounted}><WatchAgents /></ViewPane>
          <ViewPane view="docs"        active={activeView} mounted={mounted}><DocsNotes /></ViewPane>
          <ViewPane view="projects"    active={activeView} mounted={mounted}><ProjectsPipeline /></ViewPane>
          <ViewPane view="ops"         active={activeView} mounted={mounted}><SystemOps /></ViewPane>
          <ViewPane view="workspace"   active={activeView} mounted={mounted}><WorkspaceHub /></ViewPane>
          <ViewPane view="memory"      active={activeView} mounted={mounted}><Memory /></ViewPane>
          <ViewPane view="council"     active={activeView} mounted={mounted}><Chats /></ViewPane>
          <ViewPane view="content"     active={activeView} mounted={mounted}><Content /></ViewPane>
          <ViewPane view="feedback"    active={activeView} mounted={mounted}><Feedback /></ViewPane>
          <ViewPane view="settings"    active={activeView} mounted={mounted}><Settings /></ViewPane>
          <ViewPane view="openclaw"    active={activeView} mounted={mounted}><OpenClawMetrics onNavigate={navigate} /></ViewPane>
          <ViewPane view="hermes"      active={activeView} mounted={mounted}><HermesMetrics onNavigate={navigate} /></ViewPane>
          <ViewPane view="inventory"   active={activeView} mounted={mounted}><Inventory /></ViewPane>
          <ViewPane view="flowmap"     active={activeView} mounted={mounted}><FlowMap /></ViewPane>
          <ViewPane view="evaluations" active={activeView} mounted={mounted}><Evaluations /></ViewPane>
          <ViewPane view="harness"     active={activeView} mounted={mounted}><HarnessBenchmarks /></ViewPane>

        </main>
      </div>
    </div>
  )
}
