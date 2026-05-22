import { useState } from 'react'
import { clsx } from 'clsx'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { ScheduledTasks } from './views/ScheduledTasks'
import { Projects } from './views/Projects'
import { Memory } from './views/Memory'
import { Docs } from './views/Docs'
import { Agents } from './views/Agents'
import { Chats } from './views/Chats'
import { System } from './views/System'
import { Pipeline } from './views/Pipeline'
import { Radar } from './views/Radar'
import { Tasks } from './views/Tasks'
import { Content } from './views/Content'
import { Approvals } from './views/Approvals'
import { Factory } from './views/Factory'
import { People } from './views/People'
import { Office } from './views/Office'
import { Feedback } from './views/Feedback'
import { Notes } from './views/Notes'
import { Settings } from './views/Settings'
import { OpenClawMetrics, HermesMetrics } from './views/PlatformMetrics'
import { ComingSoon } from './views/ComingSoon'
import type { View } from './types'

const VIEW_TITLES: Record<View, string> = {
  tasks:     'Tasks',
  agents:    'Agents',
  content:   'Content',
  approvals: 'Approvals',
  council:   'Chats',
  calendar:  'Scheduled Tasks',
  projects:  'Projects',
  memory:    'Memory',
  docs:      'Docs',
  people:    'People',
  office:    'Office',
  team:      'Team',
  system:    'System',
  radar:     'Radar',
  factory:   'Factory',
  pipeline:  'Pipeline',
  feedback:  'Feedback',
  notes:     'Notes',
  settings:  'Settings',
  openclaw:  'OpenClaw Metrics',
  hermes:    'Hermes Metrics'
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
  const [activeView, setActiveView]   = useState<View>('calendar')
  const [mounted, setMounted]         = useState<Set<View>>(new Set(['calendar' as View]))

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

          <ViewPane view="calendar"  active={activeView} mounted={mounted}><ScheduledTasks /></ViewPane>
          <ViewPane view="projects"  active={activeView} mounted={mounted}><Projects /></ViewPane>
          <ViewPane view="memory"    active={activeView} mounted={mounted}><Memory /></ViewPane>
          <ViewPane view="docs"      active={activeView} mounted={mounted}><Docs /></ViewPane>
          <ViewPane view="agents"    active={activeView} mounted={mounted}><Agents /></ViewPane>
          <ViewPane view="council"   active={activeView} mounted={mounted}><Chats /></ViewPane>
          <ViewPane view="system"    active={activeView} mounted={mounted}><System /></ViewPane>
          <ViewPane view="pipeline"  active={activeView} mounted={mounted}><Pipeline /></ViewPane>
          <ViewPane view="radar"     active={activeView} mounted={mounted}><Radar /></ViewPane>
          <ViewPane view="tasks"     active={activeView} mounted={mounted}><Tasks /></ViewPane>
          <ViewPane view="content"   active={activeView} mounted={mounted}><Content /></ViewPane>
          <ViewPane view="approvals" active={activeView} mounted={mounted}><Approvals /></ViewPane>
          <ViewPane view="factory"   active={activeView} mounted={mounted}><Factory /></ViewPane>
          <ViewPane view="people"    active={activeView} mounted={mounted}><People /></ViewPane>
          <ViewPane view="office"    active={activeView} mounted={mounted}><Office /></ViewPane>
          <ViewPane view="feedback"  active={activeView} mounted={mounted}><Feedback /></ViewPane>
          <ViewPane view="notes"     active={activeView} mounted={mounted}><Notes /></ViewPane>
          <ViewPane view="settings"  active={activeView} mounted={mounted}><Settings /></ViewPane>
          <ViewPane view="openclaw"  active={activeView} mounted={mounted}><OpenClawMetrics onNavigate={navigate} /></ViewPane>
          <ViewPane view="hermes"    active={activeView} mounted={mounted}><HermesMetrics onNavigate={navigate} /></ViewPane>
          <ViewPane view="team"      active={activeView} mounted={mounted}><ComingSoon view="team" /></ViewPane>

        </main>
      </div>
    </div>
  )
}
