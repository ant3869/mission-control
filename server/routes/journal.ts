import { Router } from 'express'
import { getJournalStore } from '../lib/journal.js'

export const journalRouter = Router()
const store = getJournalStore()

journalRouter.get('/', (req, res) => {
  res.json({ entries: store.list(Number(req.query.limit ?? 100)) })
})

journalRouter.post('/:id/undo', (req, res) => {
  try {
    store.undo(String(req.params.id))
    res.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(message.includes('not found') ? 404 : 409).json({ error: message })
  }
})
