import { useState, useEffect, lazy, Suspense } from 'react'
import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Home } from './views/Home'                       // eager — default landing view
import type { View } from './types'
import { NAVIGATE_EVENT } from './lib/quickActions'

// Lazy views: each becomes its own chunk, fetched on first navigation, so the
// initial bundle is just the shell + landing page instead of all ~25 views.
const ScheduledTasks    = lazy(() => import('./views/ScheduledTasks').then(m => ({ default: m.ScheduledTasks })))
const Memory            = lazy(() => import('./views/Memory').then(m => ({ default: m.Memory })))
const Chats             = lazy(() => import('./views/Chats').then(m => ({ default: m.Chats })))
const TasksApprovals    = lazy(() => import('./views/TasksApprovals').then(m => ({ default: m.TasksApprovals })))
const DocsNotes         = lazy(() => import('./views/DocsNotes').then(m => ({ default: m.DocsNotes })))
const ProjectsPipeline  = lazy(() => import('./views/ProjectsPipeline').then(m => ({ default: m.ProjectsPipeline })))
const Settings          = lazy(() => import('./views/Settings').then(m => ({ default: m.Settings })))
const Inventory         = lazy(() => import('./views/Inventory').then(m => ({ default: m.Inventory })))
const Factory           = lazy(() => import('./views/Factory').then(m => ({ default: m.Factory })))
const Evaluations       = lazy(() => import('./views/Evaluations').then(m => ({ default: m.Evaluations })))
const HarnessBenchmarks = lazy(() => import('./views/HarnessBenchmarks').then(m => ({ default: m.HarnessBenchmarks })))
const News              = lazy(() => import('./views/News').then(m => ({ default: m.News })))
const Todos             = lazy(() => import('./views/Todos'))
const ToBuy             = lazy(() => import('./views/ToBuy'))
const Spend             = lazy(() => import('./views/Spend').then(m => ({ default: m.Spend })))
// Consolidated AI-Ops hubs (each pulls its now-tabbed sub-views on first visit)
const Activity          = lazy(() => import('./views/Activity').then(m => ({ default: m.Activity })))
const Usage             = lazy(() => import('./views/Usage').then(m => ({ default: m.Usage })))
const Health            = lazy(() => import('./views/Health').then(m => ({ default: m.Health })))

const VIEW_TITLES: Record<View, string> = {
  home:        'Home',
  todos:       'To-Do',
  tobuy:       'To-Buy',
  spend:       'Spend',
  tasks:       'Tasks & Approvals',
  council:     'Chats',
  calendar:    'Scheduled Tasks',
  docs:        'Docs & Notes',
  news:        'News',
  memory:      'Memory',
  projects:    'Projects & Pipeline',
  inventory:   'Inventory',
  factory:     'Idea Factory',
  activity:    'Activity',
  usage:       'Usage',
  harness:     'Harness Benchmarks',
  evaluations: 'Evaluations',
  health:      'Health',
  settings:    'Settings',
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

const VIEW_STORAGE_KEY = 'mc:lastView'
function initialView(): View {
  try { const s = localStorage.getItem(VIEW_STORAGE_KEY); if (s && s in VIEW_TITLES) return s as View } catch { /* ignore */ }
  return 'home'
}

export default function App() {
  const [activeView, setActiveView] = useState<View>(initialView)
  const [mounted, setMounted]       = useState<Set<View>>(() => new Set([activeView]))

  const navigate = (view: View) => {
    setMounted(prev => new Set([...prev, view]))
    setActiveView(view)
    try { localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* ignore */ }
  }

  // Reflect the active view in the browser tab title (history + tab identification).
  useEffect(() => { document.title = `${VIEW_TITLES[activeView]} · Mission Control` }, [activeView])

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ view?: View }>
      const view = custom.detail?.view
      if (!view) return
      setMounted(prev => new Set([...prev, view]))
      setActiveView(view)
      try { localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* ignore */ }
    }
    window.addEventListener(NAVIGATE_EVENT, handler as EventListener)
    return () => window.removeEventListener(NAVIGATE_EVENT, handler as EventListener)
  }, [])

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

          <ViewPane view="home"        active={activeView} mounted={mounted}><Home onNavigate={navigate} /></ViewPane>
          <ViewPane view="todos"       active={activeView} mounted={mounted}><Todos /></ViewPane>
          <ViewPane view="tobuy"       active={activeView} mounted={mounted}><ToBuy /></ViewPane>
          <ViewPane view="spend"       active={activeView} mounted={mounted}><Spend /></ViewPane>
          <ViewPane view="tasks"       active={activeView} mounted={mounted}><TasksApprovals /></ViewPane>
          <ViewPane view="council"     active={activeView} mounted={mounted}><Chats /></ViewPane>
          <ViewPane view="calendar"    active={activeView} mounted={mounted}><ScheduledTasks /></ViewPane>
          <ViewPane view="docs"        active={activeView} mounted={mounted}><DocsNotes /></ViewPane>
          <ViewPane view="news"        active={activeView} mounted={mounted}><News /></ViewPane>
          <ViewPane view="memory"      active={activeView} mounted={mounted}><Memory /></ViewPane>
          <ViewPane view="projects"    active={activeView} mounted={mounted}><ProjectsPipeline /></ViewPane>
          <ViewPane view="inventory"   active={activeView} mounted={mounted}><Inventory /></ViewPane>
          <ViewPane view="factory"     active={activeView} mounted={mounted}><Factory /></ViewPane>
          <ViewPane view="activity"    active={activeView} mounted={mounted}><Activity /></ViewPane>
          <ViewPane view="usage"       active={activeView} mounted={mounted}><Usage /></ViewPane>
          <ViewPane view="harness"     active={activeView} mounted={mounted}><HarnessBenchmarks /></ViewPane>
          <ViewPane view="evaluations" active={activeView} mounted={mounted}><Evaluations /></ViewPane>
          <ViewPane view="health"      active={activeView} mounted={mounted}><Health /></ViewPane>
          <ViewPane view="settings"    active={activeView} mounted={mounted}><Settings /></ViewPane>

        </main>
      </div>
    </div>
  )
}
