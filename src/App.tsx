import { useState, useEffect, lazy, Suspense } from 'react'
import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ScheduledTasks } from './views/ScheduledTasks'   // eager — default landing view
import type { View } from './types'

// Lazy views: each becomes its own chunk, fetched on first navigation, so the
// initial bundle is just the shell + landing page instead of all ~25 views.
const Memory            = lazy(() => import('./views/Memory').then(m => ({ default: m.Memory })))
const Chats             = lazy(() => import('./views/Chats').then(m => ({ default: m.Chats })))
const TasksApprovals    = lazy(() => import('./views/TasksApprovals').then(m => ({ default: m.TasksApprovals })))
const WatchAgents       = lazy(() => import('./views/WatchAgents').then(m => ({ default: m.WatchAgents })))
const DocsNotes         = lazy(() => import('./views/DocsNotes').then(m => ({ default: m.DocsNotes })))
const ProjectsPipeline  = lazy(() => import('./views/ProjectsPipeline').then(m => ({ default: m.ProjectsPipeline })))
const SystemOps         = lazy(() => import('./views/SystemOps').then(m => ({ default: m.SystemOps })))
const WorkspaceHub      = lazy(() => import('./views/WorkspaceHub').then(m => ({ default: m.WorkspaceHub })))
const Content           = lazy(() => import('./views/Content').then(m => ({ default: m.Content })))
const Feedback          = lazy(() => import('./views/Feedback').then(m => ({ default: m.Feedback })))
const Settings          = lazy(() => import('./views/Settings').then(m => ({ default: m.Settings })))
const OpenClawMetrics   = lazy(() => import('./views/PlatformMetrics').then(m => ({ default: m.OpenClawMetrics })))
const HermesMetrics     = lazy(() => import('./views/PlatformMetrics').then(m => ({ default: m.HermesMetrics })))
const Inventory         = lazy(() => import('./views/Inventory').then(m => ({ default: m.Inventory })))
const FlowMap           = lazy(() => import('./views/FlowMap').then(m => ({ default: m.FlowMap })))
const Evaluations       = lazy(() => import('./views/Evaluations').then(m => ({ default: m.Evaluations })))
const HarnessBenchmarks = lazy(() => import('./views/HarnessBenchmarks').then(m => ({ default: m.HarnessBenchmarks })))
const Brain             = lazy(() => import('./views/Brain'))
const Flow              = lazy(() => import('./views/Flow'))
const Alerts            = lazy(() => import('./views/Alerts'))
const Security          = lazy(() => import('./views/Security'))

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
  brain:       'Brain',
  flow:        'Flow',
  alerts:      'Alerts',
  security:    'Security',
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
      <ErrorBoundary label={VIEW_TITLES[view]}>
        <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 size={20} className="animate-spin text-text-muted" /></div>}>
          {children}
        </Suspense>
      </ErrorBoundary>
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

  // Reflect the active view in the browser tab title (history + tab identification).
  useEffect(() => { document.title = `${VIEW_TITLES[activeView]} · Mission Control` }, [activeView])

  return (
    <div className="flex h-full w-full bg-base overflow-hidden">
      <Sidebar activeView={activeView} onNavigate={navigate} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar
          title={VIEW_TITLES[activeView]}
          onNavigate={navigate}
          views={(Object.entries(VIEW_TITLES) as [View, string][]).map(([id, label]) => ({ id, label }))}
        />
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
          <ViewPane view="brain"       active={activeView} mounted={mounted}><Brain /></ViewPane>
          <ViewPane view="flow"        active={activeView} mounted={mounted}><Flow /></ViewPane>
          <ViewPane view="alerts"      active={activeView} mounted={mounted}><Alerts /></ViewPane>
          <ViewPane view="security"    active={activeView} mounted={mounted}><Security /></ViewPane>

        </main>
      </div>
    </div>
  )
}
