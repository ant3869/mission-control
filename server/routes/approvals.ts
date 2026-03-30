/**
 * Approvals — /api/approvals
 *
 * A persistent, file-backed approval queue. Agents (or any external process)
 * can POST approval requests to this endpoint; the Mission Control UI lets the
 * user approve or reject them in real time.
 *
 * Stored at: <workspace>/../approvals.json
 *
 * GET    /api/approvals              → LiveApproval[]
 * POST   /api/approvals              → create a new request
 * PATCH  /api/approvals/:id          → update status / fields
 * DELETE /api/approvals/:id          → permanently remove
 * POST   /api/approvals/:id/approve  → convenience shorthand
 * POST   /api/approvals/:id/reject   → convenience shorthand
 */
import { Router, Request, Response } from 'express'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

export const approvalsRouter = Router()

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalType   = 'publish' | 'send' | 'merge' | 'purchase' | 'action' | 'deploy'
export type ApprovalUrgency = 'urgent' | 'normal' | 'low'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface LiveApproval {
  id:          string
  type:        ApprovalType
  urgency:     ApprovalUrgency
  status:      ApprovalStatus
  title:       string
  description: string
  payload:     string           // raw detail / code / diff shown in mono block
  agentName:   string
  project?:    string
  resolvedBy?: string           // who approved/rejected
  resolvedAt?: string           // ISO
  note?:       string           // optional resolution note
  createdAt:   string           // ISO
  createdAgo:  string
  updatedAt:   string
}

// ─── Store ────────────────────────────────────────────────────────────────────

function storeFile(): string {
  return join(process.cwd(), '..', 'approvals.json')
}

function readStore(): LiveApproval[] {
  try {
    const f = storeFile()
    if (!existsSync(f)) return []
    return JSON.parse(readFileSync(f, 'utf8')) as LiveApproval[]
  } catch { return [] }
}

function writeStore(items: LiveApproval[]) {
  try {
    writeFileSync(storeFile(), JSON.stringify(items, null, 2), 'utf8')
  } catch (e) {
    console.error('[approvals] write error', e)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string): string {
  const sec = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (sec < 60)         return 'just now'
  if (sec < 3600)       return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400)      return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d ago`
  return `${Math.floor(sec / (86400 * 30))}mo ago`
}

function hydrate(items: LiveApproval[]): LiveApproval[] {
  return items.map(item => ({ ...item, createdAgo: timeAgo(item.createdAt) }))
}

function sortItems(items: LiveApproval[]): LiveApproval[] {
  const urgOrder: Record<ApprovalUrgency, number> = { urgent: 0, normal: 1, low: 2 }
  const stOrder:  Record<ApprovalStatus,  number> = { pending: 0, approved: 1, rejected: 2 }
  return [...items].sort((a, b) => {
    const sd = stOrder[a.status] - stOrder[b.status]
    if (sd !== 0) return sd
    const ud = urgOrder[a.urgency] - urgOrder[b.urgency]
    if (ud !== 0) return ud
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

// ─── Routes ───────────────────────────────────────────────────────────────────

approvalsRouter.get('/', (_req: Request, res: Response) => {
  const items = sortItems(hydrate(readStore()))
  const pending  = items.filter(i => i.status === 'pending').length
  const resolved = items.filter(i => i.status !== 'pending').length
  res.json({ approvals: items, pending, resolved, fetchedAt: new Date().toISOString() })
})

approvalsRouter.post('/', (req: Request, res: Response) => {
  const {
    type = 'action', urgency = 'normal', title, description,
    payload = '', agentName = 'Agent', project, note,
  } = req.body as Partial<LiveApproval>

  if (!title?.trim()) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const now  = new Date().toISOString()
  const item: LiveApproval = {
    id:          createHash('sha1').update(title + now).digest('hex').slice(0, 12),
    type:        type as ApprovalType,
    urgency:     urgency as ApprovalUrgency,
    status:      'pending',
    title:       title!,
    description: description ?? '',
    payload:     payload ?? '',
    agentName:   agentName ?? 'Agent',
    project,
    note,
    createdAt:   now,
    createdAgo:  'just now',
    updatedAt:   now,
  }

  const items = readStore()
  items.unshift(item)
  writeStore(items)

  res.status(201).json({ approval: item })
})

approvalsRouter.patch('/:id', (req: Request, res: Response) => {
  const { id }  = req.params
  const items   = readStore()
  const idx     = items.findIndex(i => i.id === id)
  if (idx === -1) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const now = new Date().toISOString()
  items[idx] = { ...items[idx], ...req.body, id, updatedAt: now }
  writeStore(items)
  res.json({ approval: hydrate([items[idx]])[0] })
})

approvalsRouter.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const items  = readStore()
  const next   = items.filter(i => i.id !== id)
  if (next.length === items.length) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  writeStore(next)
  res.json({ ok: true })
})

// Convenience approve / reject endpoints
approvalsRouter.post('/:id/approve', (req: Request, res: Response) => {
  const { id } = req.params
  const items  = readStore()
  const idx    = items.findIndex(i => i.id === id)
  if (idx === -1) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const now = new Date().toISOString()
  items[idx] = {
    ...items[idx],
    status:     'approved',
    resolvedBy: req.body?.resolvedBy ?? 'user',
    resolvedAt: now,
    note:       req.body?.note,
    updatedAt:  now,
  }
  writeStore(items)
  res.json({ approval: hydrate([items[idx]])[0] })
})

approvalsRouter.post('/:id/reject', (req: Request, res: Response) => {
  const { id } = req.params
  const items  = readStore()
  const idx    = items.findIndex(i => i.id === id)
  if (idx === -1) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const now = new Date().toISOString()
  items[idx] = {
    ...items[idx],
    status:     'rejected',
    resolvedBy: req.body?.resolvedBy ?? 'user',
    resolvedAt: now,
    note:       req.body?.note,
    updatedAt:  now,
  }
  writeStore(items)
  res.json({ approval: hydrate([items[idx]])[0] })
})
