import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import { clsx } from 'clsx'
import { Loader2, ShieldAlert, X } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { TopBar } from './components/layout/TopBar'
import { VIEW_TITLES } from './components/layout/navConfig'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Home } from './views/Home'                       // eager — default landing view
import type { View } from './types'
import { NAVIGATE_EVENT, openHubTab } from './lib/quickActions'
import { startDataRefresh, DATA_REFRESH_EVENT } from './lib/dataRefresh'
import { apiFetch } from './lib/apiTransport.js'
import { closeTopOverlay } from './lib/overlayStack'
import { exitAndroidApp, onAndroidBack } from './lib/native'
import { popView, pushView } from './lib/viewHistory'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useServerConnection } from './contexts/ServerConnectionContext'
import { ServerSetupScreen } from './components/mobile/ServerSetupScreen'
import { MobileBottomNav } from './components/mobile/MobileBottomNav'
import { MobileMoreSheet } from './components/mobile/MobileMoreSheet'
import { ConnectionBanner } from './components/layout/ConnectionBanner'

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
        const data = await apiFetch<{ alerts?: FiredAlert[] }>('/api/alerts/active')
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
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 flex w-auto max-w-sm items-start gap-3 rounded-xl border border-red-800/60 bg-red-950/90 px-4 py-3 shadow-2xl backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-200 md:bottom-4 md:left-auto md:w-full">
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

function AppShell() {
  const [activeView, setActiveView] = useState<View>(initialView)
  const [mounted, setMounted]       = useState<Set<View>>(() => new Set([activeView]))
  const [moreOpen, setMoreOpen]     = useState(false)
  const isPhone                     = useMediaQuery('(max-width: 767px)')
  const activeViewRef               = useRef(activeView)
  const historyRef                  = useRef<View[]>([])

  useEffect(() => {
    activeViewRef.current = activeView
  }, [activeView])

  const replaceView = useCallback((view: View) => {
    activeViewRef.current = view
    setMounted(prev => {
      if (isPhone) return new Set([view])
      if (prev.has(view)) return prev
      return new Set([...prev, view])
    })
    setActiveView(view)
    try { localStorage.setItem(VIEW_STORAGE_KEY, view) } catch { /* ignore */ }
  }, [isPhone])

  const navigate = useCallback((view: View) => {
    const current = activeViewRef.current
    if (view === current) return

    historyRef.current = pushView(historyRef.current, current, view)
    replaceView(view)
  }, [replaceView])

  // Start the SSE data-refresh connection once for the lifetime of the app.
  useEffect(() => startDataRefresh(), [])

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
  }, [navigate])

  // Reflect the active view in the browser tab title (history + tab identification).
  useEffect(() => { document.title = `${VIEW_TITLES[activeView]} · Mission Control` }, [activeView])

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ view?: View }>
      const view = custom.detail?.view
      if (!view) return
      navigate(view)
    }
    window.addEventListener(NAVIGATE_EVENT, handler as EventListener)
    return () => window.removeEventListener(NAVIGATE_EVENT, handler as EventListener)
  }, [navigate])

  useEffect(() => onAndroidBack(() => {
    if (closeTopOverlay()) return

    const popped = popView(historyRef.current)
    historyRef.current = popped.history
    if (popped.view) {
      replaceView(popped.view)
      return
    }

    if (activeViewRef.current !== 'home') {
      replaceView('home')
      return
    }

    void exitAndroidApp()
  }), [replaceView])

  const mountedViews = isPhone ? new Set<View>([activeView]) : mounted

  return (
    <div className="flex h-full w-full bg-base overflow-hidden">
      {!isPhone && <Sidebar activeView={activeView} onNavigate={navigate} />}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar
          title={VIEW_TITLES[activeView]}
          onNavigate={navigate}
          views={(Object.entries(VIEW_TITLES) as [View, string][]).map(([id, label]) => ({ id, label }))}
        />
        <ConnectionBanner onOpenSettings={() => navigate('settings')} />
        <main className="flex-1 overflow-hidden bg-base relative">
          <div className={clsx('absolute inset-0', isPhone && 'bottom-[calc(4rem+env(safe-area-inset-bottom))]')}>

            <ViewPane view="home"        active={activeView} mounted={mountedViews}><Home onNavigate={navigate} /></ViewPane>
            <ViewPane view="todos"       active={activeView} mounted={mountedViews}><TodoTasks /></ViewPane>
            <ViewPane view="tobuy"       active={activeView} mounted={mountedViews}><ToBuy /></ViewPane>
            <ViewPane view="spend"       active={activeView} mounted={mountedViews}><Spend /></ViewPane>
            <ViewPane view="council"     active={activeView} mounted={mountedViews}><Chats /></ViewPane>
            <ViewPane view="calendar"    active={activeView} mounted={mountedViews}><ScheduledTasks /></ViewPane>
            <ViewPane view="docs"        active={activeView} mounted={mountedViews}><DocsNotes /></ViewPane>
            <ViewPane view="links"       active={activeView} mounted={mountedViews}><Links /></ViewPane>
            <ViewPane view="news"        active={activeView} mounted={mountedViews}><News /></ViewPane>
            <ViewPane view="memory"      active={activeView} mounted={mountedViews}><Memory /></ViewPane>
            <ViewPane view="projects"    active={activeView} mounted={mountedViews}><ProjectsPipeline /></ViewPane>
            <ViewPane view="inventory"   active={activeView} mounted={mountedViews}><Inventory /></ViewPane>
            <ViewPane view="factory"     active={activeView} mounted={mountedViews}><Factory /></ViewPane>
            <ViewPane view="activity"    active={activeView} mounted={mountedViews}><Activity /></ViewPane>
            <ViewPane view="usage"       active={activeView} mounted={mountedViews}><Usage /></ViewPane>
            <ViewPane view="harness"     active={activeView} mounted={mountedViews}><HarnessBenchmarks /></ViewPane>
            <ViewPane view="evaluations" active={activeView} mounted={mountedViews}><Evaluations /></ViewPane>
            <ViewPane view="health"      active={activeView} mounted={mountedViews}><Health /></ViewPane>
            <ViewPane view="settings"    active={activeView} mounted={mountedViews}><Settings /></ViewPane>

          </div>
        </main>
      </div>
      {isPhone && (
        <>
          <MobileBottomNav activeView={activeView} onNavigate={navigate} onOpenMore={() => setMoreOpen(true)} />
          {moreOpen && (
            <MobileMoreSheet
              activeView={activeView}
              onNavigate={navigate}
              onClose={() => setMoreOpen(false)}
            />
          )}
        </>
      )}
      <CriticalAlertToast activeView={activeView} onNavigate={navigate} />
    </div>
  )
}

export default function App() {
  const connection = useServerConnection()
  if (connection.status === 'misconfigured') return <ServerSetupScreen />
  return <AppShell />
}
