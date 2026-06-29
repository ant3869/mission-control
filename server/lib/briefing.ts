import { join } from 'node:path'
import { discordNotifier } from './discordNotifier.js'
import { getIncidentStore } from './incidentStore.js'
import { loadJson, saveJson } from './jsonStore.js'
import { getJournalStore } from './journal.js'

export interface BriefingMetrics { openIncidents: number; criticalIncidents: number; overdueTodos: number; dueToday: number; activeProjects: number; recentOperations: number }
export interface DailyBriefing { date: string; generatedAt: string; summary: string; attention: string[]; metrics: BriefingMetrics }
export interface BriefingPreferences { enabled: boolean; time: string; discord: boolean; browser: boolean; lastSentDate: string }

const dataPath = (name: string) => join(process.cwd(), 'data', name)
const defaults: BriefingPreferences = { enabled: false, time: '08:00', discord: false, browser: false, lastSentDate: '' }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function buildBriefing(metrics: BriefingMetrics, now = new Date()): DailyBriefing {
  const attention: string[] = []
  if (metrics.criticalIncidents) attention.push(`${metrics.criticalIncidents} critical incident${metrics.criticalIncidents === 1 ? '' : 's'} needs attention`)
  if (metrics.overdueTodos) attention.push(`${metrics.overdueTodos} overdue to-do${metrics.overdueTodos === 1 ? '' : 's'}`)
  if (metrics.openIncidents > metrics.criticalIncidents) attention.push(`${metrics.openIncidents - metrics.criticalIncidents} other open incident${metrics.openIncidents - metrics.criticalIncidents === 1 ? '' : 's'}`)
  if (metrics.dueToday) attention.push(`${metrics.dueToday} to-do${metrics.dueToday === 1 ? '' : 's'} due today`)
  if (!attention.length) attention.push('No urgent operational issues')
  const lead = metrics.criticalIncidents ? `${metrics.criticalIncidents} critical incident${metrics.criticalIncidents === 1 ? '' : 's'}` : metrics.overdueTodos ? `${metrics.overdueTodos} overdue item${metrics.overdueTodos === 1 ? '' : 's'}` : 'Operations are clear'
  return { date: dateKey(now), generatedAt: now.toISOString(), summary: `${lead}; ${metrics.activeProjects} active projects and ${metrics.recentOperations} recent operations.`, attention, metrics }
}

export function getBriefingPreferences(): BriefingPreferences { return { ...defaults, ...loadJson<Partial<BriefingPreferences>>(dataPath('briefing.json'), {}) } }
export function saveBriefingPreferences(patch: Partial<BriefingPreferences>): BriefingPreferences {
  const next = { ...getBriefingPreferences(), ...patch, time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.time ?? getBriefingPreferences().time)) ? String(patch.time ?? getBriefingPreferences().time) : '08:00' }
  saveJson(dataPath('briefing.json'), next); return next
}

export function generateBriefing(now = new Date()): DailyBriefing {
  const today = dateKey(now)
  const incidents = getIncidentStore().list().filter((item) => item.status === 'open')
  const todos = loadJson<Array<{ done?: boolean; dueDate?: string }>>(dataPath('todos.json'), []).filter((item) => !item.done)
  const projectRaw = loadJson<unknown>(dataPath('projects.json'), []) as any
  const projects: Array<{ status?: string }> = Array.isArray(projectRaw) ? projectRaw : Array.isArray(projectRaw?.projects) ? projectRaw.projects : projectRaw && typeof projectRaw === 'object' ? Object.values(projectRaw) : []
  const since = now.getTime() - 24 * 60 * 60_000
  const briefing = buildBriefing({
    openIncidents: incidents.length, criticalIncidents: incidents.filter((item) => item.severity === 'critical').length,
    overdueTodos: todos.filter((item) => item.dueDate && item.dueDate.slice(0, 10) < today).length,
    dueToday: todos.filter((item) => item.dueDate?.slice(0, 10) === today).length,
    activeProjects: projects.filter((item) => item.status === 'active').length,
    recentOperations: getJournalStore().list(500).filter((item) => new Date(item.createdAt).getTime() >= since).length,
  }, now)
  saveJson(dataPath('briefing-latest.json'), briefing)
  return briefing
}

export function startBriefingScheduler(): () => void {
  const check = () => {
    const prefs = getBriefingPreferences(); if (!prefs.enabled) return
    const now = new Date(); const today = dateKey(now); const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (current < prefs.time || prefs.lastSentDate === today) return
    const briefing = generateBriefing(now)
    if (prefs.discord) discordNotifier.notify({ kind: 'briefing', title: `Daily operations briefing · ${briefing.date}`, message: `${briefing.summary}\n${briefing.attention.map((item) => `• ${item}`).join('\n')}` })
    saveBriefingPreferences({ lastSentDate: today })
  }
  check(); const timer = setInterval(check, 60_000); return () => clearInterval(timer)
}
