// title: Inventory backend route
// path: server/routes/inventory.ts
// purpose: SQLite-backed hardware catalog. Works independently of any Obsidian
//          vault. Items carry a deployment status so agents know what is
//          available vs actively in use. Provides plain-text /context for agents,
//          schema for structured writes, and async agent-driven research.

import { Router } from 'express'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { DatabaseSync } from 'node:sqlite'
import { isLive } from '../lib/connectors.js'
import { researchItem } from '../lib/research.js'
import { suggestProjects, dedupeIdeas, type ProjectBacklogContext } from '../lib/projectSuggestions.js'

export const inventoryRouter = Router()

export const CATEGORIES = [
  'computer', 'laptop', 'sbc', 'microcontroller', 'storage', 'battery', 'power',
  'console', 'peripheral', 'cable', 'component', 'sensor', 'network', 'tool',
  'breakout', 'camera', 'tablet', 'other',
] as const
export const CONDITIONS = ['working', 'untested', 'partial', 'broken', 'unknown'] as const
export const STATUSES   = ['available', 'in-use', 'reserved'] as const

export interface StoredItem {
  id:             string
  name:           string
  category:       string
  quantity:       number
  location:       string
  condition:      string
  estimatedValue: number
  manufacturer:   string
  model:          string
  tags:           string[]
  notes:          string
  summary:        string
  specs:          Record<string, string>
  sources:        Array<{ title: string; url: string }>
  datasheetUrl:   string
  imageUrl:       string
  enriched:       boolean
  addedBy:        string
  status:         string   // available | in-use | reserved
  researchStatus: string   // idle | pending | done | failed
  researchError:  string
  researchRequestedAt: string
  createdAt:      string
  updatedAt:      string
}

// ─── SQLite setup ─────────────────────────────────────────────────────────────

const dataDir = join(process.cwd(), 'data')
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'inventory.db'))
db.exec('PRAGMA journal_mode = WAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    category            TEXT NOT NULL DEFAULT 'other',
    quantity            INTEGER NOT NULL DEFAULT 1,
    location            TEXT NOT NULL DEFAULT '',
    condition           TEXT NOT NULL DEFAULT 'unknown',
    estimatedValue      REAL NOT NULL DEFAULT 0,
    manufacturer        TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL DEFAULT '',
    tags                TEXT NOT NULL DEFAULT '[]',
    notes               TEXT NOT NULL DEFAULT '',
    summary             TEXT NOT NULL DEFAULT '',
    specs               TEXT NOT NULL DEFAULT '{}',
    sources             TEXT NOT NULL DEFAULT '[]',
    datasheetUrl        TEXT NOT NULL DEFAULT '',
    imageUrl            TEXT NOT NULL DEFAULT '',
    enriched            INTEGER NOT NULL DEFAULT 0,
    addedBy             TEXT NOT NULL DEFAULT 'manual',
    status              TEXT NOT NULL DEFAULT 'available',
    researchStatus      TEXT NOT NULL DEFAULT 'idle',
    researchError       TEXT NOT NULL DEFAULT '',
    researchRequestedAt TEXT NOT NULL DEFAULT '',
    createdAt           TEXT NOT NULL,
    updatedAt           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_status   ON items(status);
  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
  CREATE INDEX IF NOT EXISTS idx_items_updated  ON items(updatedAt DESC);
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS project_ideas (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    whyFit          TEXT NOT NULL DEFAULT '',
    haveParts       TEXT NOT NULL DEFAULT '[]',
    missingParts    TEXT NOT NULL DEFAULT '[]',
    difficulty      TEXT NOT NULL DEFAULT 'medium',
    timeEstimate    TEXT NOT NULL DEFAULT '',
    costEstimate    TEXT NOT NULL DEFAULT '',
    confidence      INTEGER NOT NULL DEFAULT 50,
    coolness        INTEGER NOT NULL DEFAULT 50,
    requiredTools   TEXT NOT NULL DEFAULT '[]',
    relatedItemIds  TEXT NOT NULL DEFAULT '[]',
    nextStep        TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'other',
    status          TEXT NOT NULL DEFAULT 'new',
    rejectionReason TEXT NOT NULL DEFAULT '',
    generationRunId TEXT NOT NULL DEFAULT '',
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ideas_status  ON project_ideas(status);
  CREATE INDEX IF NOT EXISTS idx_ideas_created ON project_ideas(createdAt DESC);

  CREATE TABLE IF NOT EXISTS project_gen_runs (
    id          TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'pending',
    source      TEXT NOT NULL DEFAULT '',
    itemCount   INTEGER NOT NULL DEFAULT 0,
    newIdeas    INTEGER NOT NULL DEFAULT 0,
    error       TEXT NOT NULL DEFAULT '',
    startedAt   TEXT NOT NULL,
    completedAt TEXT NOT NULL DEFAULT ''
  );
`)

// ─── Schema migrations ────────────────────────────────────────────────────────
// Add columns introduced after initial schema. SQLite has no IF NOT EXISTS for
// ALTER TABLE, so wrap each in try/catch.
;[
  `ALTER TABLE project_ideas ADD COLUMN statusHistory    TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE project_ideas ADD COLUMN influenceMetadata TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE project_ideas ADD COLUMN usefulnessScore  REAL NOT NULL DEFAULT 0`,
].forEach(sql => { try { db.prepare(sql).run() } catch { /* column already exists */ } })

// On every startup/hot-reload, any items left in 'pending' from a previous run
// are orphaned (their promises are gone). Reset them so research can be retried.
db.exec(`UPDATE items SET researchStatus = 'idle', researchError = 'Reset: server restarted while research was in progress' WHERE researchStatus = 'pending'`)
db.exec(`UPDATE project_gen_runs SET status = 'failed', error = 'Reset: server restarted while generation was pending', completedAt = datetime('now') WHERE status = 'pending'`)

const COLS = [
  'id','name','category','quantity','location','condition','estimatedValue',
  'manufacturer','model','tags','notes','summary','specs','sources',
  'datasheetUrl','imageUrl','enriched','addedBy','status',
  'researchStatus','researchError','researchRequestedAt','createdAt','updatedAt',
]
// Statements are prepared inline in helpers to survive tsx watch hot-reloads.

function pj<T>(s: string, fb: T): T { try { return JSON.parse(s) as T } catch { return fb } }

function fromRow(r: any): StoredItem {
  return {
    id: String(r.id), name: String(r.name), category: String(r.category ?? 'other'),
    quantity: Number(r.quantity ?? 0), location: String(r.location ?? ''),
    condition: String(r.condition ?? 'unknown'), estimatedValue: Number(r.estimatedValue ?? 0),
    manufacturer: String(r.manufacturer ?? ''), model: String(r.model ?? ''),
    tags: pj(String(r.tags ?? '[]'), []), notes: String(r.notes ?? ''),
    summary: String(r.summary ?? ''), specs: pj(String(r.specs ?? '{}'), {}),
    sources: pj(String(r.sources ?? '[]'), []),
    datasheetUrl: String(r.datasheetUrl ?? ''), imageUrl: String(r.imageUrl ?? ''),
    enriched: Boolean(r.enriched), addedBy: String(r.addedBy ?? 'manual'),
    status: String(r.status ?? 'available'),
    researchStatus: String(r.researchStatus ?? 'idle'), researchError: String(r.researchError ?? ''),
    researchRequestedAt: String(r.researchRequestedAt ?? ''),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  }
}

function toRow(it: StoredItem): Record<string, any> {
  return {
    id: it.id, name: it.name, category: it.category, quantity: it.quantity,
    location: it.location, condition: it.condition, estimatedValue: it.estimatedValue,
    manufacturer: it.manufacturer, model: it.model,
    tags: JSON.stringify(it.tags ?? []), notes: it.notes, summary: it.summary,
    specs: JSON.stringify(it.specs ?? {}), sources: JSON.stringify(it.sources ?? []),
    datasheetUrl: it.datasheetUrl, imageUrl: it.imageUrl,
    enriched: it.enriched ? 1 : 0, addedBy: it.addedBy, status: it.status,
    researchStatus: it.researchStatus, researchError: it.researchError,
    researchRequestedAt: it.researchRequestedAt, createdAt: it.createdAt, updatedAt: it.updatedAt,
  }
}

function loadItems(): StoredItem[] { return (db.prepare('SELECT * FROM items ORDER BY createdAt DESC').all() as any[]).map(fromRow) }
function loadItem(id: string): StoredItem | null { const r = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as any; return r ? fromRow(r) : null }
function dbSave(it: StoredItem): void { db.prepare(`INSERT OR REPLACE INTO items (${COLS.join(',')}) VALUES (${COLS.map(k => `@${k}`).join(',')})`).run(toRow(it)) }
function dbDelete(id: string): void { db.prepare('DELETE FROM items WHERE id = ?').run(id) }

// ─── Blank / seed ─────────────────────────────────────────────────────────────

function blank(): Omit<StoredItem, 'id' | 'name' | 'createdAt' | 'updatedAt'> {
  return {
    category: 'other', quantity: 1, location: '', condition: 'unknown', estimatedValue: 0,
    manufacturer: '', model: '', tags: [], notes: '',
    summary: '', specs: {}, sources: [], datasheetUrl: '', imageUrl: '',
    enriched: false, addedBy: 'manual', status: 'available',
    researchStatus: 'idle', researchError: '', researchRequestedAt: '',
  }
}

function seed(): StoredItem[] {
  const now = new Date().toISOString()
  const mk = (p: Partial<StoredItem> & { name: string }): StoredItem =>
    ({ id: randomUUID(), createdAt: now, updatedAt: now, ...blank(), ...p })
  return [
    mk({ name: 'Raspberry Pi 4 Model B (4GB)', category: 'sbc', quantity: 2, location: 'Shelf A · bin 1', condition: 'working', estimatedValue: 55, manufacturer: 'Raspberry Pi', model: 'Pi 4B 4GB', tags: ['arm', 'linux'], enriched: true, addedBy: 'agent', summary: 'Quad-core Cortex-A72 single-board computer with 4GB RAM, dual micro-HDMI, USB3, Gigabit Ethernet.', specs: { SoC: 'Broadcom BCM2711', CPU: '4× Cortex-A72 @ 1.5GHz', RAM: '4GB LPDDR4', GPIO: '40-pin', Power: 'USB-C 5V/3A' }, sources: [{ title: 'Raspberry Pi 4 product page', url: 'https://www.raspberrypi.com/products/raspberry-pi-4-model-b/' }] }),
    mk({ name: 'Arduino Uno R3', category: 'microcontroller', quantity: 3, location: 'Shelf A · bin 2', condition: 'working', estimatedValue: 24, manufacturer: 'Arduino', model: 'Uno R3', tags: ['avr', '5v'], enriched: true, addedBy: 'agent', summary: 'ATmega328P 8-bit microcontroller board, 14 digital I/O, 6 analog inputs, 16MHz.', specs: { MCU: 'ATmega328P', Flash: '32KB', 'Digital I/O': '14', 'Analog In': '6', Voltage: '5V' }, sources: [{ title: 'Arduino Uno Rev3', url: 'https://store.arduino.cc/products/arduino-uno-rev3' }] }),
    mk({ name: 'WD Blue 1TB 2.5" HDD', category: 'storage', quantity: 4, location: 'Drawer B', condition: 'untested', estimatedValue: 30, manufacturer: 'Western Digital', model: 'WD10SPZX', tags: ['sata', '2.5in'] }),
    mk({ name: 'Assorted 1/4W resistors (carbon film)', category: 'component', quantity: 600, location: 'Component box · row 3', condition: 'working', estimatedValue: 0.02, tags: ['resistor', 'through-hole'] }),
    mk({ name: 'USB-C to USB-A 3.0 cable (1m)', category: 'cable', quantity: 8, location: 'Cable bag', condition: 'working', estimatedValue: 4 }),
    mk({ name: 'Dell Latitude 7490', category: 'laptop', quantity: 1, location: 'Office desk', condition: 'working', estimatedValue: 280, manufacturer: 'Dell', model: 'Latitude 7490', tags: ['i7', '16gb'] }),
    mk({ name: '18650 Li-ion cells', category: 'battery', quantity: 12, location: 'Battery case', condition: 'partial', estimatedValue: 5, tags: ['3.7v', 'rechargeable'], notes: 'Mixed health — test before use.' }),
  ]
}

// Migrate from JSON on first run; seed if empty.
{
  const { n } = db.prepare('SELECT COUNT(*) as n FROM items').get() as { n: number }
  if (n === 0) {
    const jsonPath = join(dataDir, 'inventory.json')
    if (existsSync(jsonPath)) {
      try {
        const rows: any[] = JSON.parse(readFileSync(jsonPath, 'utf8'))
        const now = new Date().toISOString()
        for (const r of rows) {
          dbSave({ ...blank(), id: r.id ?? randomUUID(), name: r.name ?? '', createdAt: r.createdAt ?? now, updatedAt: r.updatedAt ?? now, ...r, status: r.status ?? 'available' })
        }
        console.log(`[Inventory] migrated ${rows.length} items from JSON → SQLite`)
      } catch (e) { console.error('[Inventory] JSON migration failed:', e) }
    } else {
      for (const it of seed()) dbSave(it)
      console.log('[Inventory] seeded with example items')
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function toResponse(it: StoredItem) {
  return { ...it, totalValue: Math.round(it.quantity * it.estimatedValue * 100) / 100, updatedAgo: timeAgo(it.updatedAt) }
}

function sanitize(body: any, base: StoredItem): StoredItem {
  const s = { ...base }
  const str = (v: any, d = '') => (typeof v === 'string' ? v : d)
  if (body.name !== undefined) s.name = str(body.name).trim()
  if (body.category !== undefined) s.category = str(body.category, 'other').toLowerCase()
  if (body.quantity !== undefined) s.quantity = Math.max(0, Number(body.quantity) || 0)
  if (body.location !== undefined) s.location = str(body.location)
  if (body.condition !== undefined) s.condition = str(body.condition, 'unknown').toLowerCase()
  if (body.estimatedValue !== undefined) s.estimatedValue = Math.max(0, Number(body.estimatedValue) || 0)
  if (body.manufacturer !== undefined) s.manufacturer = str(body.manufacturer)
  if (body.model !== undefined) s.model = str(body.model)
  if (body.tags !== undefined) s.tags = Array.isArray(body.tags) ? body.tags.map((t: any) => String(t)).filter(Boolean) : []
  if (body.notes !== undefined) s.notes = str(body.notes)
  if (body.summary !== undefined) s.summary = str(body.summary)
  if (body.specs !== undefined && body.specs && typeof body.specs === 'object') {
    s.specs = Object.fromEntries(Object.entries(body.specs).map(([k, v]) => [String(k), String(v)]))
  }
  if (body.sources !== undefined && Array.isArray(body.sources)) {
    s.sources = body.sources.map((x: any) => ({ title: String(x?.title ?? x?.url ?? ''), url: String(x?.url ?? '') })).filter((x: any) => x.url)
  }
  if (body.datasheetUrl !== undefined) s.datasheetUrl = str(body.datasheetUrl)
  if (body.imageUrl !== undefined) s.imageUrl = str(body.imageUrl)
  if (body.addedBy !== undefined) s.addedBy = str(body.addedBy, 'manual')
  // Mark enriched if the agent supplied a spec sheet (or explicitly set it).
  if (body.status !== undefined && STATUSES.includes(body.status as any)) s.status = body.status
  if (body.enriched !== undefined) s.enriched = !!body.enriched
  else if (s.summary || Object.keys(s.specs).length || s.sources.length) s.enriched = true
  return s
}

function computeStats(items: StoredItem[]) {
  let totalQuantity = 0, totalValue = 0, enrichedCount = 0, operationalCount = 0
  const byCategory = new Map<string, { category: string; count: number; quantity: number; value: number }>()
  const byCondition: Record<string, number> = {}
  const locations = new Set<string>()
  for (const it of items) {
    totalQuantity += it.quantity
    totalValue += it.quantity * it.estimatedValue
    if (it.enriched) enrichedCount++
    if (it.status === 'in-use') operationalCount++
    if (it.location) locations.add(it.location)
    byCondition[it.condition] = (byCondition[it.condition] ?? 0) + 1
    const c = byCategory.get(it.category) ?? { category: it.category, count: 0, quantity: 0, value: 0 }
    c.count++; c.quantity += it.quantity; c.value += it.quantity * it.estimatedValue
    byCategory.set(it.category, c)
  }
  return {
    totalItems: items.length,
    totalQuantity,
    totalValue: Math.round(totalValue * 100) / 100,
    enrichedCount, operationalCount,
    byCategory: [...byCategory.values()].sort((a, b) => b.value - a.value).map(c => ({ ...c, value: Math.round(c.value * 100) / 100 })),
    byCondition,
    locations: [...locations].sort(),
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

inventoryRouter.get('/', (_req, res) => {
  try {
    const items = loadItems()
    res.json({ items: items.map(toResponse), stats: computeStats(items), categories: CATEGORIES, conditions: CONDITIONS, statuses: STATUSES, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

inventoryRouter.get('/schema', (_req, res) => {
  res.json({
    categories: CATEGORIES, conditions: CONDITIONS, statuses: STATUSES,
    fields: {
      name: 'string (required)', category: `one of ${CATEGORIES.join('|')}`, quantity: 'number',
      location: 'string', condition: `one of ${CONDITIONS.join('|')}`, estimatedValue: 'number (per-unit USD)',
      manufacturer: 'string', model: 'string', tags: 'string[]', notes: 'string',
      summary: 'string (1-2 sentence overview)', specs: 'object of key:value spec pairs',
      sources: 'array of {title,url} you researched online', datasheetUrl: 'string', imageUrl: 'string',
      addedBy: 'your agent name', status: 'available | in-use | reserved',
    },
    usage: 'POST /api/inventory to add, PATCH /api/inventory/:id to enrich, GET /api/inventory/context for a plain-text summary.',
  })
})

// Agent-readable context: available items first, in-operation items clearly last.
inventoryRouter.get('/context', (_req, res) => {
  const items = loadItems()
  const stats = computeStats(items)
  const available   = items.filter(i => i.status !== 'in-use')
  const operational = items.filter(i => i.status === 'in-use')

  function renderGroup(list: StoredItem[]): string {
    const byCat = new Map<string, StoredItem[]>()
    for (const it of list) { const a = byCat.get(it.category) ?? []; a.push(it); byCat.set(it.category, a) }
    let s = ''
    for (const [cat, its] of [...byCat.entries()].sort()) {
      s += `### ${cat}\n`
      for (const it of its)
        s += `- ${it.name} ×${it.quantity}${it.location ? ` @ ${it.location}` : ''} [${it.condition}]${it.model ? ` (${it.manufacturer} ${it.model})` : ''}${it.summary ? ` — ${it.summary}` : ''}\n`
    }
    return s
  }

  let out = `# Hardware Inventory (${stats.totalItems} items · ${stats.totalQuantity} units · ~$${stats.totalValue})\n\n`
  out += `## Available for Use (${available.length} items)\n`
  out += renderGroup(available)
  if (operational.length > 0) {
    out += `\n## IN OPERATION — Actively Deployed (${operational.length} items)\n`
    out += `> These items are actively in use. Consider them last when selecting hardware for new projects.\n\n`
    out += renderGroup(operational)
  }
  res.type('text/plain').send(out)
})

// ─── Project Ideas — types ───────────────────────────────────────────────────

interface StoredIdea {
  id:              string
  title:           string
  description:     string
  whyFit:          string
  haveParts:       string[]
  missingParts:    string[]
  difficulty:      string
  timeEstimate:    string
  costEstimate:    string
  confidence:      number
  coolness:        number
  requiredTools:   string[]
  relatedItemIds:  string[]
  nextStep:        string
  category:        string
  status:          string   // new|liked|rejected|snoozed|completed
  rejectionReason: string
  generationRunId: string
  createdAt:       string
  updatedAt:       string
}

interface StoredGenRun {
  id:          string
  status:      string   // pending|done|failed
  source:      string
  itemCount:   number
  newIdeas:    number
  error:       string
  startedAt:   string
  completedAt: string
}

const IDEA_STATUSES = ['new', 'liked', 'rejected', 'snoozed', 'completed'] as const

const IDEA_COLS = [
  'id','title','description','whyFit','haveParts','missingParts','difficulty',
  'timeEstimate','costEstimate','confidence','coolness','requiredTools','relatedItemIds',
  'nextStep','category','status','rejectionReason','generationRunId','createdAt','updatedAt',
]

function fromIdeaRow(r: any): StoredIdea {
  return {
    id: String(r.id), title: String(r.title ?? ''), description: String(r.description ?? ''),
    whyFit: String(r.whyFit ?? ''),
    haveParts: pj(String(r.haveParts ?? '[]'), []), missingParts: pj(String(r.missingParts ?? '[]'), []),
    difficulty: String(r.difficulty ?? 'medium'), timeEstimate: String(r.timeEstimate ?? ''),
    costEstimate: String(r.costEstimate ?? ''), confidence: Number(r.confidence ?? 50),
    coolness: Number(r.coolness ?? 50), requiredTools: pj(String(r.requiredTools ?? '[]'), []),
    relatedItemIds: pj(String(r.relatedItemIds ?? '[]'), []), nextStep: String(r.nextStep ?? ''),
    category: String(r.category ?? 'other'), status: String(r.status ?? 'new'),
    rejectionReason: String(r.rejectionReason ?? ''), generationRunId: String(r.generationRunId ?? ''),
    createdAt: String(r.createdAt), updatedAt: String(r.updatedAt),
  }
}

function ideaToRow(i: StoredIdea): Record<string, any> {
  return {
    id: i.id, title: i.title, description: i.description, whyFit: i.whyFit,
    haveParts: JSON.stringify(i.haveParts), missingParts: JSON.stringify(i.missingParts),
    difficulty: i.difficulty, timeEstimate: i.timeEstimate, costEstimate: i.costEstimate,
    confidence: i.confidence, coolness: i.coolness,
    requiredTools: JSON.stringify(i.requiredTools), relatedItemIds: JSON.stringify(i.relatedItemIds),
    nextStep: i.nextStep, category: i.category, status: i.status,
    rejectionReason: i.rejectionReason, generationRunId: i.generationRunId,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  }
}

function saveIdea(i: StoredIdea): void {
  db.prepare(`INSERT OR REPLACE INTO project_ideas (${IDEA_COLS.join(',')}) VALUES (${IDEA_COLS.map(k => `@${k}`).join(',')})`).run(ideaToRow(i))
}
function loadIdeas(status?: string): StoredIdea[] {
  const rows = status
    ? (db.prepare('SELECT * FROM project_ideas WHERE status = ? ORDER BY createdAt DESC').all(status) as any[])
    : (db.prepare('SELECT * FROM project_ideas ORDER BY createdAt DESC').all() as any[])
  return rows.map(fromIdeaRow)
}
function loadIdea(id: string): StoredIdea | null {
  const r = db.prepare('SELECT * FROM project_ideas WHERE id = ?').get(id) as any
  return r ? fromIdeaRow(r) : null
}
function deleteIdea(id: string): void { db.prepare('DELETE FROM project_ideas WHERE id = ?').run(id) }

function fromRunRow(r: any): StoredGenRun {
  return {
    id: String(r.id), status: String(r.status ?? 'pending'), source: String(r.source ?? ''),
    itemCount: Number(r.itemCount ?? 0), newIdeas: Number(r.newIdeas ?? 0),
    error: String(r.error ?? ''), startedAt: String(r.startedAt), completedAt: String(r.completedAt ?? ''),
  }
}
function saveRun(r: StoredGenRun): void {
  db.prepare('INSERT OR REPLACE INTO project_gen_runs (id,status,source,itemCount,newIdeas,error,startedAt,completedAt) VALUES (@id,@status,@source,@itemCount,@newIdeas,@error,@startedAt,@completedAt)').run(r)
}
function latestRun(): StoredGenRun | null {
  const r = db.prepare('SELECT * FROM project_gen_runs ORDER BY startedAt DESC LIMIT 1').get() as any
  return r ? fromRunRow(r) : null
}

// ─── Project Ideas — routes ───────────────────────────────────────────────────

// List ideas (optional ?status=new|liked|rejected|snoozed|completed)
inventoryRouter.get('/project-ideas', (req, res) => {
  try {
    const st = typeof req.query.status === 'string' ? req.query.status : undefined
    const ideas = loadIdeas(st && IDEA_STATUSES.includes(st as any) ? st : undefined)
    const run = latestRun()
    res.json({ ideas, run, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Status of the latest generation run
inventoryRouter.get('/project-ideas/gen-status', (_req, res) => {
  try {
    res.json({ run: latestRun(), fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Trigger an async generation run
inventoryRouter.post('/project-ideas/generate', (req, res) => {
  try {
    const ocLive = isLive('openclaw')
    const hmLive = isLive('hermes')
    if (!ocLive && !hmLive) {
      return res.status(409).json({ error: 'No connected agent — enable OpenClaw or Hermes in Settings.' })
    }
    const existing = latestRun()
    if (existing && existing.status === 'pending') {
      return res.status(409).json({ error: 'Generation is already in progress.', run: existing })
    }
    const source = (req.body?.source === 'hermes' && hmLive) ? 'hermes' : ocLive ? 'openclaw' : 'hermes'
    const allItems = loadItems()

    // Load full backlog before generation so the agent knows what to avoid
    const allIdeas = loadIdeas()
    const rejectedIdeas = allIdeas.filter(i => i.status === 'rejected')
    const likedIdeas    = allIdeas.filter(i => i.status === 'liked')
    const snoozedIdeas  = allIdeas.filter(i => i.status === 'snoozed')
    const existingIdeas = allIdeas.filter(i => i.status !== 'rejected')
    const rejectedWithReason = rejectedIdeas.filter(i => i.rejectionReason.trim().length > 0).length
    console.log(`[ProjectIdeas] Starting generation — context: ${rejectedIdeas.length} rejected (${rejectedWithReason} with reasons), ${likedIdeas.length} liked, ${snoozedIdeas.length} snoozed, ${existingIdeas.length} existing`)

    const ctx: ProjectBacklogContext = {
      rejected: rejectedIdeas.map(i => ({ title: i.title, description: i.description, category: i.category, rejectionReason: i.rejectionReason, haveParts: i.haveParts })),
      liked:    likedIdeas.map(i => ({ title: i.title, description: i.description, category: i.category, haveParts: i.haveParts })),
      snoozed:  snoozedIdeas.map(i => ({ title: i.title, description: i.description, category: i.category })),
      existing: existingIdeas.map(i => ({ title: i.title, description: i.description, category: i.category, status: i.status })),
    }

    const run: StoredGenRun = {
      id: randomUUID(), status: 'pending', source,
      itemCount: allItems.length, newIdeas: 0, error: '',
      startedAt: new Date().toISOString(), completedAt: '',
    }
    saveRun(run)
    const summaries = allItems.map(it => ({
      id: it.id, name: it.name, category: it.category, quantity: it.quantity,
      condition: it.condition, manufacturer: it.manufacturer, model: it.model,
      summary: it.summary, specs: it.specs, tags: it.tags, notes: it.notes, status: it.status,
    }))
    suggestProjects(summaries, source as any, ctx).then(rawIdeas => {
      const { kept, filtered } = dedupeIdeas(rawIdeas, ctx)

      // ── Dedupe decision report ──────────────────────────────────────────────
      const sep = '─'.repeat(60)
      console.log(`[ProjectIdeas] ${sep}`)
      console.log(`[ProjectIdeas]  Dedupe report — ${rawIdeas.length} idea${rawIdeas.length !== 1 ? 's' : ''} from agent`)
      console.log(`[ProjectIdeas] ${sep}`)
      for (const k of kept) {
        console.log(`[ProjectIdeas]  ✓ KEPT   "${k.title}"`)
        console.log(`[ProjectIdeas]           category: ${k.category}  |  concepts: ${k.conceptFamily}`)
      }
      for (const f of filtered) {
        console.log(`[ProjectIdeas]  ✗ DROP   "${f.title}"`)
        console.log(`[ProjectIdeas]           concepts: ${f.conceptFamily}`)
        console.log(`[ProjectIdeas]           reason:   ${f.reason}`)
        if (f.matchedConceptFamily) {
          console.log(`[ProjectIdeas]           matched:  ${f.matchedConceptFamily}`)
        }
        if (f.matchedRejectionNote) {
          console.log(`[ProjectIdeas]           feedback: "${f.matchedRejectionNote}"`)
        }
      }
      console.log(`[ProjectIdeas] ${sep}`)
      console.log(`[ProjectIdeas]  Saved ${kept.length}  |  Dropped ${filtered.length}  |  Context: ${ctx.rejected.length} rejected, ${ctx.liked.length} liked`)
      console.log(`[ProjectIdeas] ${sep}`)
      // ───────────────────────────────────────────────────────────────────────
      const now = new Date().toISOString()
      for (const idea of kept) {
        saveIdea({
          id: randomUUID(),
          title: String(idea.title ?? '').slice(0, 120),
          description: String(idea.description ?? ''),
          whyFit: String(idea.whyFit ?? ''),
          haveParts: Array.isArray(idea.haveParts) ? idea.haveParts.map(String) : [],
          missingParts: Array.isArray(idea.missingParts) ? idea.missingParts.map(String) : [],
          difficulty: ['easy','medium','hard','expert'].includes(idea.difficulty) ? idea.difficulty : 'medium',
          timeEstimate: String(idea.timeEstimate ?? ''),
          costEstimate: String(idea.costEstimate ?? ''),
          confidence: Math.max(0, Math.min(100, Number(idea.confidence) || 50)),
          coolness: Math.max(0, Math.min(100, Number(idea.coolness) || 50)),
          requiredTools: Array.isArray(idea.requiredTools) ? idea.requiredTools.map(String) : [],
          relatedItemIds: Array.isArray(idea.relatedItemIds) ? idea.relatedItemIds.map(String) : [],
          nextStep: String(idea.nextStep ?? ''),
          category: String(idea.category ?? 'experimental'),
          status: 'new',
          rejectionReason: '',
          generationRunId: run.id,
          createdAt: now,
          updatedAt: now,
        })
      }
      saveRun({ ...run, status: 'done', newIdeas: kept.length, completedAt: new Date().toISOString() })
    }).catch(err => {
      saveRun({ ...run, status: 'failed', error: String(err?.message ?? err).slice(0, 300), completedAt: new Date().toISOString() })
    })
    res.json({ ok: true, run })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Update idea status / rejection reason
inventoryRouter.patch('/project-ideas/:ideaId', (req, res) => {
  try {
    const idea = loadIdea(req.params.ideaId)
    if (!idea) return res.status(404).json({ error: 'Project idea not found' })
    const { status, rejectionReason } = req.body ?? {}
    if (status !== undefined && !IDEA_STATUSES.includes(status as any)) {
      return res.status(400).json({ error: `status must be one of: ${IDEA_STATUSES.join(', ')}` })
    }
    const updated: StoredIdea = {
      ...idea,
      status: typeof status === 'string' ? status : idea.status,
      rejectionReason: typeof rejectionReason === 'string' ? rejectionReason : idea.rejectionReason,
      updatedAt: new Date().toISOString(),
    }
    saveIdea(updated)
    res.json({ idea: updated })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Delete a single idea
inventoryRouter.delete('/project-ideas/:ideaId', (req, res) => {
  try {
    if (!loadIdea(req.params.ideaId)) return res.status(404).json({ error: 'Project idea not found' })
    deleteIdea(req.params.ideaId)
    res.json({ ok: true })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// ─────────────────────────────────────────────────────────────────────────────

inventoryRouter.get('/:id', (req, res) => {
  const item = loadItem(req.params.id)
  if (!item) return res.status(404).json({ error: 'Item not found' })
  res.json({ item: toResponse(item) })
})

inventoryRouter.post('/', (req, res) => {
  try {
    if (!String(req.body?.name ?? '').trim()) return res.status(400).json({ error: 'name is required' })
    const now = new Date().toISOString()
    const item = sanitize(req.body, { id: randomUUID(), name: '', createdAt: now, updatedAt: now, ...blank() } as StoredItem)
    dbSave(item)
    res.status(201).json({ item: toResponse(item) })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Bulk add (agent convenience): { items: [...] }
inventoryRouter.post('/bulk', (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : []
    const now = new Date().toISOString()
    const created = []
    for (const b of incoming) {
      if (!String(b?.name ?? '').trim()) continue
      const item = sanitize(b, { id: randomUUID(), name: '', createdAt: now, updatedAt: now, ...blank() } as StoredItem)
      dbSave(item); created.push(toResponse(item))
    }
    res.status(201).json({ created, count: created.length })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

inventoryRouter.patch('/:id', (req, res) => {
  try {
    const item = loadItem(req.params.id)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    const updated = { ...sanitize(req.body, item), id: item.id, createdAt: item.createdAt, updatedAt: new Date().toISOString() }
    dbSave(updated)
    res.json({ item: toResponse(updated) })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Quick deployment-status flip without touching other fields.
inventoryRouter.patch('/:id/status', (req, res) => {
  try {
    const item = loadItem(req.params.id)
    if (!item) return res.status(404).json({ error: 'Item not found' })
    const status = String(req.body?.status ?? '')
    if (!STATUSES.includes(status as any)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` })
    const updated = { ...item, status, updatedAt: new Date().toISOString() }
    dbSave(updated)
    res.json({ item: toResponse(updated) })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Bulk research: queue all unresearched items, split work between available agents.
inventoryRouter.post('/research-all', (req, res) => {
  try {
    const ocLive = isLive('openclaw')
    const hmLive = isLive('hermes')
    if (!ocLive && !hmLive) return res.status(409).json({ error: 'No connected agent — enable OpenClaw or Hermes in Settings.' })

    const allItems = loadItems()
    const unresearched = allItems.filter(it => !it.enriched && it.researchStatus !== 'pending')
    if (unresearched.length === 0) return res.json({ queued: 0, openclaw: 0, hermes: 0, skipped: allItems.length })

    // Split between available agents; interleave so both get a mix of item types.
    let ocItems: StoredItem[] = []
    let hmItems: StoredItem[] = []
    if (ocLive && hmLive) {
      ocItems = unresearched.filter((_, i) => i % 2 === 0)
      hmItems = unresearched.filter((_, i) => i % 2 === 1)
    } else if (ocLive) {
      ocItems = unresearched
    } else {
      hmItems = unresearched
    }

    // Mark all as pending immediately.
    const now = new Date().toISOString()
    for (const it of unresearched) {
      dbSave({ ...it, researchStatus: 'pending', researchRequestedAt: now, researchError: '' })
    }

    // Fire all research tasks concurrently; each resolves independently.
    const doResearch = (it: StoredItem, source: 'openclaw' | 'hermes') => {
      researchItem(it, source).then(r => {
        const cur = loadItem(it.id)
        if (!cur) return
        const merged = sanitize({
          summary: r.summary, specs: r.specs, manufacturer: r.manufacturer, model: r.model,
          estimatedValue: r.estimatedValue, category: r.category, condition: r.condition,
          datasheetUrl: r.datasheetUrl, sources: r.sources, enriched: true, addedBy: source,
        }, cur)
        dbSave({ ...merged, id: cur.id, createdAt: cur.createdAt, updatedAt: new Date().toISOString(), researchStatus: 'done', researchError: '' })
      }).catch(err => {
        const cur = loadItem(it.id)
        if (!cur) return
        dbSave({ ...cur, researchStatus: 'failed', researchError: String(err?.message ?? err).slice(0, 200), updatedAt: new Date().toISOString() })
      })
    }

    for (const it of ocItems) doResearch(it, 'openclaw')
    for (const it of hmItems) doResearch(it, 'hermes')

    res.json({ queued: unresearched.length, openclaw: ocItems.length, hermes: hmItems.length, skipped: allItems.length - unresearched.length })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Ask a connected agent to research + fill the item's spec sheet (async).
inventoryRouter.post('/:id/research', (req, res) => {
  try {
    const item = loadItem(req.params.id)
    if (!item) return res.status(404).json({ error: 'Item not found' })

    const requested = req.body?.source === 'hermes' ? 'hermes' : req.body?.source === 'openclaw' ? 'openclaw' : null
    const source = requested ?? (isLive('openclaw') ? 'openclaw' : isLive('hermes') ? 'hermes' : null)
    if (!source) return res.status(409).json({ error: 'No connected agent — enable OpenClaw or Hermes in Settings.' })
    if (!isLive(source)) return res.status(409).json({ error: `${source} is not connected.` })

    const snap = { ...item, researchStatus: 'pending', researchRequestedAt: new Date().toISOString(), researchError: '' }
    dbSave(snap)

    researchItem(snap, source).then(r => {
      const cur = loadItem(snap.id)
      if (!cur) return
      const merged = sanitize({
        summary: r.summary, specs: r.specs, manufacturer: r.manufacturer, model: r.model,
        estimatedValue: r.estimatedValue, category: r.category, condition: r.condition,
        datasheetUrl: r.datasheetUrl, sources: r.sources, enriched: true, addedBy: source,
      }, cur)
      dbSave({ ...merged, id: cur.id, createdAt: cur.createdAt, updatedAt: new Date().toISOString(), researchStatus: 'done', researchError: '' })
    }).catch(err => {
      const cur = loadItem(snap.id)
      if (!cur) return
      dbSave({ ...cur, researchStatus: 'failed', researchError: String(err?.message ?? err).slice(0, 200), updatedAt: new Date().toISOString() })
    })

    res.json({ ok: true, status: 'pending', source })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

inventoryRouter.delete('/:id', (req, res) => {
  try {
    if (!loadItem(req.params.id)) return res.status(404).json({ error: 'Item not found' })
    dbDelete(req.params.id)
    res.json({ ok: true })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})
