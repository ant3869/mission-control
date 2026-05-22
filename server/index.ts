import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { calendarRouter } from './routes/calendar.js'
import { systemRouter } from './routes/system.js'
import { radarRouter } from './routes/radar.js'
import { authRouter } from './routes/auth.js'
import { chatsRouter } from './routes/chats.js'
import { memoryRouter } from './routes/memory.js'
import { docsRouter }   from './routes/docs.js'
import { agentsRouter }   from './routes/agents.js'
import { pipelineRouter } from './routes/pipeline.js'
import { officeRouter }   from './routes/office.js'
import { tasksRouter }    from './routes/tasks.js'
import { projectsRouter }  from './routes/projects.js'
import { approvalsRouter } from './routes/approvals.js'
import { notesRouter }     from './routes/notes.js'
import { inventoryRouter } from './routes/inventory.js'
import { openclawRouter } from './routes/openclaw.js'
import { hermesRouter }   from './routes/hermes.js'
import { settingsRouter } from './routes/settings.js'
import { watchRouter }    from './routes/watch.js'

const app = express()
const PORT = process.env.API_PORT ?? 3001

app.use(cors({ origin: 'http://localhost:5173', credentials: true }))
app.use(express.json())

app.use('/api/auth',     authRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/system',   systemRouter)
app.use('/api/radar',    radarRouter)
app.use('/api/chats',    chatsRouter)
app.use('/api/memory',  memoryRouter)
app.use('/api/docs',    docsRouter)
app.use('/api/agents',   agentsRouter)
app.use('/api/pipeline', pipelineRouter)
app.use('/api/office',   officeRouter)
app.use('/api/tasks',    tasksRouter)
app.use('/api/projects',  projectsRouter)
app.use('/api/approvals', approvalsRouter)
app.use('/api/notes',    notesRouter)
app.use('/api/inventory', inventoryRouter)
app.use('/api/openclaw', openclawRouter)
app.use('/api/hermes',   hermesRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/watch',    watchRouter)

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }))

app.listen(PORT, () => {
  console.log(`Mission Control API → http://localhost:${PORT}`)
})
