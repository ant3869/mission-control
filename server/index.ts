import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { calendarRouter } from './routes/calendar.js'
import { systemRouter } from './routes/system.js'
import { radarRouter } from './routes/radar.js'
import { modelOpsRouter } from './routes/modelops.js'
import { authRouter } from './routes/auth.js'
import { chatsRouter } from './routes/chats.js'
import { memoryRouter } from './routes/memory.js'
import { memoryOpsRouter } from './routes/memoryops.js'
import { startMemoryCollector } from './lib/memoryCollector.js'
import { docsRouter }   from './routes/docs.js'
import { agentsRouter }   from './routes/agents.js'
import { pipelineRouter } from './routes/pipeline.js'
import { tasksRouter }    from './routes/tasks.js'
import { todosRouter }    from './routes/todos.js'
import { toBuyRouter }    from './routes/tobuy.js'
import { financialsRouter } from './routes/financials.js'
import { billsRouter }      from './routes/bills.js'
import { projectsRouter }  from './routes/projects.js'
import { approvalsRouter } from './routes/approvals.js'
import { notesRouter }     from './routes/notes.js'
import { inventoryRouter } from './routes/inventory.js'
import { openclawRouter } from './routes/openclaw.js'
import { hermesRouter }   from './routes/hermes.js'
import { settingsRouter } from './routes/settings.js'
import { watchRouter }    from './routes/watch.js'
import { budgetsRouter }  from './routes/budgets.js'
import { brainRouter }    from './routes/brain.js'
import { flowRouter }     from './routes/flow.js'
import { flowmapRouter }  from './routes/flowmap.js'
import { alertsRouter }   from './routes/alerts.js'
import { securityRouter } from './routes/security.js'
import { evaluationsRouter } from './routes/evaluations.js'
import { harnessBenchRouter } from './routes/harnessBench.js'
import { linksRouter }    from './routes/links.js'
import { inboxRouter }    from './routes/inbox.js'
import { newsRouter }     from './routes/news.js'
import { financeRouter }  from './routes/finance.js'
import { officeRouter }  from './routes/office.js'
import { searchRouter }  from './routes/search.js'
import { exportRouter }  from './routes/export.js'
import { rateLimit }    from './lib/rateLimit.js'
import {
  DashboardAuth,
  assertSafeBinding,
  createDashboardAuthMiddleware,
  resolveApiHost,
} from './lib/dashboardAuth.js'
import { createSessionRouter } from './routes/session.js'
import { createJournalMiddleware, getJournalStore } from './lib/journal.js'
import { journalRouter } from './routes/journal.js'

const app = express()
const PORT = Number(process.env.API_PORT ?? 3001)
const HOST = resolveApiHost(process.env.API_HOST)
const dashboardAuth = new DashboardAuth(process.env.DASHBOARD_TOKEN ?? '')
const journalStore = getJournalStore()
assertSafeBinding(HOST, process.env.DASHBOARD_TOKEN ?? '')

// General API rate limit: 300 req/min (protects against runaway loops)
const generalLimit = rateLimit({ max: 300, windowMs: 60_000 })
// Tight limit for routes that call external AI/search APIs
const aiLimit = rateLimit({ max: 20, windowMs: 60_000, message: 'AI API rate limit reached — wait 60s.' })

app.use(cors({
  origin: [
    'http://localhost:5173',  // Vite dev server
    process.env.APP_URL,
    'http://localhost',       // Android Capacitor WebView
    'capacitor://localhost',  // iOS Capacitor WebView
    'ionic://localhost',      // Ionic/Capacitor legacy scheme
  ].filter((origin): origin is string => Boolean(origin)),
  credentials: true,
}))
app.use(express.json())
app.use('/api/session', createSessionRouter(dashboardAuth))
app.use('/api', createDashboardAuthMiddleware(dashboardAuth))
app.use('/api', generalLimit)
app.use('/api', createJournalMiddleware(journalStore))

app.use('/api/auth',     authRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/system',   systemRouter)
app.use('/api/radar',    aiLimit, radarRouter)
app.use('/api/modelops', aiLimit, modelOpsRouter)
app.use('/api/chats',    chatsRouter)
app.use('/api/memory',  memoryRouter)
app.use('/api/memory',  memoryOpsRouter)
app.use('/api/docs',    docsRouter)
app.use('/api/agents',   agentsRouter)
app.use('/api/pipeline', pipelineRouter)
app.use('/api/tasks',    tasksRouter)
app.use('/api/todos',    todosRouter)
app.use('/api/tobuy',    toBuyRouter)
app.use('/api/financials', financialsRouter)
app.use('/api/bills',      billsRouter)
app.use('/api/projects',  projectsRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/notes',    notesRouter)
app.use('/api/inventory', inventoryRouter)
app.use('/api/openclaw', openclawRouter)
app.use('/api/hermes',   hermesRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/watch',    watchRouter)
app.use('/api/budgets',  budgetsRouter)
app.use('/api/brain',    brainRouter)
app.use('/api/flow',     flowRouter)
app.use('/api/flowmap',  flowmapRouter)
app.use('/api/alerts',   alertsRouter)
app.use('/api/security', securityRouter)
app.use('/api/evaluations', evaluationsRouter)
app.use('/api/harness-bench', harnessBenchRouter)
app.use('/api/links',    linksRouter)
app.use('/api/inbox',    inboxRouter)
app.use('/api/news',     aiLimit, newsRouter)
app.use('/api/finance',  financeRouter)
app.use('/api/office',  officeRouter)
app.use('/api/search',  searchRouter)
app.use('/api/export',  exportRouter)
app.use('/api/journal', journalRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

const distDir = join(process.cwd(), 'dist')
if (process.env.NODE_ENV === 'production' && existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(join(distDir, 'index.html'))
  })
}

// Global error handler — catches any unhandled throw from async route handlers.
// Express 5 propagates async errors automatically; this ensures they're logged
// and return a consistent JSON shape instead of hanging the request.
app.use((err: unknown, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('[api] unhandled error:', message, err)
  if (!res.headersSent) res.status(500).json({ error: message })
})

app.listen(PORT, HOST, () => {
  console.log(`Mission Control API → http://${HOST}:${PORT}`)
  startMemoryCollector()
  if (process.env.DISCORD_BOT_TOKEN) {
    import('./lib/discordBot.js').then(({ startDiscordBot }) => startDiscordBot(PORT))
  }
})
