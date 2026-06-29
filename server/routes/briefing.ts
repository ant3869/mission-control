import { Router } from 'express'
import { generateBriefing, getBriefingPreferences, saveBriefingPreferences } from '../lib/briefing.js'

export const briefingRouter = Router()
briefingRouter.get('/', (_req, res) => res.json({ briefing: generateBriefing(), preferences: getBriefingPreferences() }))
briefingRouter.put('/preferences', (req, res) => res.json({ preferences: saveBriefingPreferences(req.body ?? {}) }))
briefingRouter.post('/generate', (_req, res) => res.json({ briefing: generateBriefing() }))
