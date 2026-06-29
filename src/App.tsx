import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Loader2, ShieldAlert, X } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Home } from './views/Home'                       // eager — default landing view
import type { View } from './types'
import { NAVIGATE_EVENT, openHubTab } from './lib/quickActions'
import { startDataRefresh, DATA_REFRESH_EVENT } from './lib/dataRefresh'
import { shouldRenderView } from './viewLifecycle'
import { API_BASE } from './lib/api'
import { startOfflineSync } from './lib/offlineQueue'

// Lazy views: each becomes its own chunk, fetched on first navigation, so the
// initial bundle is just the shell + landing page instead of all ~25 views.
const ScheduledTasks    = lazy(() => import('./views/ScheduledTasks').then(m => ({ default: m.ScheduledTasks })))
const Memory            = lazy(() => import('./views/Memory').then(m => ({ default: m.Memory })))
const Chats             = lazy(() => import('./views/Chats').then(m => ({ default: m.Chats })))
const TodoTasks         = lazy(() => import('./views/TodoTasks').then(m => ({ default: m.TodoTasks })))
const DocsNotes         = lazy(() => import('./views/DocsNotes').then(m => ({ default: m.DocsNotes })))
const ProjectsPipeline  = lazy(() => import('./views/ProjectsPipeline').then(m => ({ default: m.ProjectsPipeline })))
const Settings          = lazy(() => import('./views/Settings').then(m => ({ default: m.Settings })))
const Inventory         = lazy(() => import('./views/Inventory').then(m => ({ default: m.Inventory })))
const Factory           = lazy(() => import('./views/Factory').then(m => ({ default: m.Factory })))
const Evaluations       = lazy(() => import('./views/Evaluations').then(m => ({ default: m.Evaluations })))
const HarnessBenchmarks = lazy(() => import('./views/HarnessBenchmarks').then(m => ({ default: m.HarnessBenchmarks })))
const News              = lazy(() => import('./views/News').then(m => ({ default: m.News })))
const Links             = lazy(() => import('./views/Links').then(m => ({ default: m.Links })))
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
  spend:       'Financials',
  council:     'Chats',
  calendar:    'Scheduled Tasks',
  docs:        'Docs & Notes',
  links:       'Links',
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

// Render only the active view so background polling and subscriptions are torn down.
function ViewPane({
  view, active, children,
}: {
  view: View; active: View; children: React.ReactNode
}) {
  if (!shouldRenderView(active, view)) return null
  return (
    <div className="absolute inset-0 overflow-hidden">
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

// ─── Critical alert toast ─────────────────────────────────────────────────────
// Polls for critical alerts and surfaces a dismissable banner when the user is
// NOT already on Home or Health (where alerts are already visible).

interface FiredAlert { ruleId: string; ruleName: string; severity: string; message: string; firedAt: string }

const SEEN_ALERTS_KEY = 'mc:seen-alerts'

function CriticalAlertToast({ activeView, onNavigate }: { activeView: View; onNavigate: (v: View) => void }) {
  const [toast, setToast]       = useState<FiredAlert | null>(null)
  const seenRef                 = useRef<Set<string>>(new Set(
    (() => { try { return JSON.parse(sessionStorage.getItem(SEEN_ALERTS_KEY) ?? '[]') } catch { return [] } })()
  ))
  const timerRef                = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const poll = async () => {
      if (activeView === 'home' || activeView === 'health') return
      try {
        const res  = await fetch('/api/alerts/active')
        const data = await res.json()
        const critical: FiredAlert[] = (data.alerts ?? []).filter((a: FiredAlert) => a.severity === 'critical')
        const unseen = critical.find(a => !seenRef.current.has(`${a.ruleId}-${a.firedAt}`))
        if (unseen) {
          seenRef.current.add(`${unseen.ruleId}-${unseen.firedAt}`)
          try { sessionStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify([...seenRef.current])) } catch { /* ignore */ }
          setToast(unseen)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setToast(null), 10_000)
        }
      } catch { /* ignore */ }
    }
    const handleRefresh = (ev: Event) => {
      const detail = (ev as CustomEvent<{ domain: string }>).detail
      if (detail?.domain === 'alerts' || detail?.domain === 'all') poll()
    }
    poll()
    const t = setInterval(poll, 45_000)
    window.addEventListener(DATA_REFRESH_EVENT, handleRefresh as EventListener)
    return () => { clearInterval(t); window.removeEventListener(DATA_REFRESH_EVENT, handleRefresh as EventListener); if (timerRef.current) clearTimeout(timerRef.current) }
  }, [activeView])

  const dismiss = () => { setToast(null); if (timerRef.current) clearTimeout(timerRef.current) }
  const view    = () => { dismiss(); openHubTab('health', 'alerts'); onNavigate('health') }

  if (!toast) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-start gap-3 max-w-sm w-full rounded-xl border border-red-800/60 bg-red-950/90  px-4 py-3  animate-in slide-in-from-bottom-2 duration-200">
      <ShieldAlert size={16} className="text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-red-300 uppercase tracking-wider">Critical alert</p>
        <p className="text-sm text-red-100 mt-0.5 leading-snug truncate">{toast.message}</p>
        <button onClick={view} className="mt-1.5 text-[11px] font-medium text-red-300 hover:text-red-100 transition-colors underline underline-offset-2">
          View in Health →
        </button>
      </div>
      <button onClick={dismiss} className="text-red-500 hover:text-red-300 transition-colors shrink-0">
        <X size={14} />
      </button>
    </div>
  )
}

export default function App() {
  const [activeView, setActiveView] = useState<View>(initialView)

  const navigate = (view: View) => {
    setActiveView(view)
    try { localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* ignore */ }
  }

  // Start the SSE data-refresh connection once for the lifetime of the app.
  useEffect(() => startDataRefresh(), [])
  useEffect(() => startOfflineSync(API_BASE || window.location.origin), [])

  // Ctrl+1–9: jump directly to the Nth view (ordered as in VIEW_TITLES).
  useEffect(() => {
    const VIEW_ORDER = Object.keys(VIEW_TITLES) as View[]
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return
      const n = parseInt(e.key, 10)
      if (Number.isNaN(n) || n < 1 || n > 9) return
      const target = VIEW_ORDER[n - 1]
      if (!target) return
      // Don't steal Ctrl+1-9 when typing in a form field
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      e.preventDefault()
      navigate(target)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Reflect the active view in the browser tab title (history + tab identification).
  useEffect(() => { document.title = `${VIEW_TITLES[activeView]} · Mission Control` }, [activeView])

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ view?: View }>
      const view = custom.detail?.view
      if (!view) return
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

          <ViewPane view="home"        active={activeView}><Home onNavigate={navigate} /></ViewPane>
          <ViewPane view="todos"       active={activeView}><TodoTasks /></ViewPane>
          <ViewPane view="tobuy"       active={activeView}><ToBuy /></ViewPane>
          <ViewPane view="spend"       active={activeView}><Spend /></ViewPane>
          <ViewPane view="council"     active={activeView}><Chats /></ViewPane>
          <ViewPane view="calendar"    active={activeView}><ScheduledTasks /></ViewPane>
          <ViewPane view="docs"        active={activeView}><DocsNotes /></ViewPane>
          <ViewPane view="links"       active={activeView}><Links /></ViewPane>
          <ViewPane view="news"        active={activeView}><News /></ViewPane>
          <ViewPane view="memory"      active={activeView}><Memory /></ViewPane>
          <ViewPane view="projects"    active={activeView}><ProjectsPipeline /></ViewPane>
          <ViewPane view="inventory"   active={activeView}><Inventory /></ViewPane>
          <ViewPane view="factory"     active={activeView}><Factory /></ViewPane>
          <ViewPane view="activity"    active={activeView}><Activity /></ViewPane>
          <ViewPane view="usage"       active={activeView}><Usage /></ViewPane>
          <ViewPane view="harness"     active={activeView}><HarnessBenchmarks /></ViewPane>
          <ViewPane view="evaluations" active={activeView}><Evaluations /></ViewPane>
          <ViewPane view="health"      active={activeView}><Health /></ViewPane>
          <ViewPane view="settings"    active={activeView}><Settings /></ViewPane>

        </main>
      </div>
      <CriticalAlertToast activeView={activeView} onNavigate={navigate} />
    </div>
  )
}
