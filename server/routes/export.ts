import { Router } from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const exportRouter = Router()

const dataDir = join(process.cwd(), 'data')

function safeRead(file: string): unknown {
  try {
    const p = join(dataDir, file)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch { return null }
}

exportRouter.get('/', (_req, res) => {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    version: 1,
    data: {
      tasks:      safeRead('tasks.json'),
      todos:      safeRead('todos.json'),
      links:      safeRead('links.json'),
      toBuy:      safeRead('tobuy.json'),
      alerts:     safeRead('alerts.json'),
      projects:   safeRead('projects.json'),
      connectors: safeRead('connectors.json'),
    },
  }
  const filename = `nexus-backup-${new Date().toISOString().slice(0, 10)}.json`
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Type', 'application/json')
  res.json(snapshot)
})
