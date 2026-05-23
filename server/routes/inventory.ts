// title: Inventory backend route
// path: server/routes/inventory.ts
// purpose: Catalog of tech devices/components. JSON-backed CRUD plus stats and
//          agent-friendly endpoints (schema, context, bulk) so a connected
//          agent can read "what's on hand" and fill in spec sheets it researched.

import { Router } from 'express'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { isLive } from '../lib/connectors.js'
import { researchItem } from '../lib/research.js'

export const inventoryRouter = Router()

// Canonical categories (the UI knows icons/labels; the API just stores strings).
export const CATEGORIES = [
  'computer', 'laptop', 'sbc', 'microcontroller', 'storage', 'battery', 'power',
  'console', 'peripheral', 'cable', 'component', 'sensor', 'network', 'tool', 'other',
] as const
export const CONDITIONS = ['working', 'untested', 'partial', 'broken', 'unknown'] as const

export interface StoredItem {
  id:             string
  name:           string
  category:       string
  quantity:       number
  location:       string
  condition:      string
  estimatedValue: number   // per-unit, USD
  manufacturer:   string
  model:          string
  tags:           string[]
  notes:          string
  // agent-enriched spec sheet
  summary:        string
  specs:          Record<string, string>
  sources:        Array<{ title: string; url: string }>
  datasheetUrl:   string
  imageUrl:       string
  enriched:       boolean
  addedBy:        string    // 'manual' or an agent name
  researchStatus: string    // idle | pending | done | failed
  researchError:  string
  researchRequestedAt: string
  createdAt:      string
  updatedAt:      string
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function itemsPath(): string {
  const dataDir = join(process.cwd(), 'data')
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  return join(dataDir, 'inventory.json')
}

function blank(): Omit<StoredItem, 'id' | 'name' | 'createdAt' | 'updatedAt'> {
  return {
    category: 'other', quantity: 1, location: '', condition: 'unknown', estimatedValue: 0,
    manufacturer: '', model: '', tags: [], notes: '',
    summary: '', specs: {}, sources: [], datasheetUrl: '', imageUrl: '',
    enriched: false, addedBy: 'manual',
    researchStatus: 'idle', researchError: '', researchRequestedAt: '',
  }
}

function seed(): StoredItem[] {
  const now = new Date().toISOString()
  const mk = (p: Partial<StoredItem> & { name: string }): StoredItem => ({
    id: randomUUID(), createdAt: now, updatedAt: now, ...blank(), ...p,
  })
  return [
    mk({ name: 'Raspberry Pi 4 Model B (4GB)', category: 'sbc', quantity: 2, location: 'Shelf A · bin 1', condition: 'working', estimatedValue: 55, manufacturer: 'Raspberry Pi', model: 'Pi 4B 4GB', tags: ['arm', 'linux'], enriched: true, addedBy: 'agent', summary: 'Quad-core Cortex-A72 single-board computer with 4GB RAM, dual micro-HDMI, USB3, Gigabit Ethernet.', specs: { SoC: 'Broadcom BCM2711', CPU: '4× Cortex-A72 @ 1.5GHz', RAM: '4GB LPDDR4', GPIO: '40-pin', Power: 'USB-C 5V/3A' }, sources: [{ title: 'Raspberry Pi 4 product page', url: 'https://www.raspberrypi.com/products/raspberry-pi-4-model-b/' }] }),
    mk({ name: 'Arduino Uno R3', category: 'microcontroller', quantity: 3, location: 'Shelf A · bin 2', condition: 'working', estimatedValue: 24, manufacturer: 'Arduino', model: 'Uno R3', tags: ['avr', '5v'], enriched: true, addedBy: 'agent', summary: 'ATmega328P 8-bit microcontroller board, 14 digital I/O, 6 analog inputs, 16MHz.', specs: { MCU: 'ATmega328P', 'Flash': '32KB', 'Digital I/O': '14', 'Analog In': '6', Voltage: '5V' }, sources: [{ title: 'Arduino Uno Rev3', url: 'https://store.arduino.cc/products/arduino-uno-rev3' }] }),
    mk({ name: 'WD Blue 1TB 2.5" HDD', category: 'storage', quantity: 4, location: 'Drawer B', condition: 'untested', estimatedValue: 30, manufacturer: 'Western Digital', model: 'WD10SPZX', tags: ['sata', '2.5in'] }),
    mk({ name: 'Assorted 1/4W resistors (carbon film)', category: 'component', quantity: 600, location: 'Component box · row 3', condition: 'working', estimatedValue: 0.02, manufacturer: '', model: '', tags: ['resistor', 'through-hole'] }),
    mk({ name: 'USB-C to USB-A 3.0 cable (1m)', category: 'cable', quantity: 8, location: 'Cable bag', condition: 'working', estimatedValue: 4 }),
    mk({ name: 'Dell Latitude 7490', category: 'laptop', quantity: 1, location: 'Office desk', condition: 'working', estimatedValue: 280, manufacturer: 'Dell', model: 'Latitude 7490', tags: ['i7', '16gb'] }),
    mk({ name: '18650 Li-ion cells', category: 'battery', quantity: 12, location: 'Battery case', condition: 'partial', estimatedValue: 5, tags: ['3.7v', 'rechargeable'], notes: 'Mixed health — test before use.' }),
  ]
}

function loadItems(): StoredItem[] {
  const path = itemsPath()
  if (!existsSync(path)) {
    const seeded = seed()
    writeFileSync(path, JSON.stringify(seeded, null, 2), 'utf8')
    return seeded
  }
  try { return JSON.parse(readFileSync(path, 'utf8')) as StoredItem[] } catch { return [] }
}

function saveItems(items: StoredItem[]): void {
  writeFileSync(itemsPath(), JSON.stringify(items, null, 2), 'utf8')
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
  if (body.enriched !== undefined) s.enriched = !!body.enriched
  else if (s.summary || Object.keys(s.specs).length || s.sources.length) s.enriched = true
  return s
}

function computeStats(items: StoredItem[]) {
  let totalQuantity = 0, totalValue = 0, enrichedCount = 0
  const byCategory = new Map<string, { category: string; count: number; quantity: number; value: number }>()
  const byCondition: Record<string, number> = {}
  const locations = new Set<string>()
  for (const it of items) {
    totalQuantity += it.quantity
    totalValue += it.quantity * it.estimatedValue
    if (it.enriched) enrichedCount++
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
    enrichedCount,
    byCategory: [...byCategory.values()].sort((a, b) => b.value - a.value).map(c => ({ ...c, value: Math.round(c.value * 100) / 100 })),
    byCondition,
    locations: [...locations].sort(),
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

inventoryRouter.get('/', (_req, res) => {
  try {
    const items = loadItems()
    res.json({ items: items.map(toResponse), stats: computeStats(items), categories: CATEGORIES, conditions: CONDITIONS, fetchedAt: new Date().toISOString() })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Machine-readable schema so an agent knows exactly how to fill an item.
inventoryRouter.get('/schema', (_req, res) => {
  res.json({
    categories: CATEGORIES, conditions: CONDITIONS,
    fields: {
      name: 'string (required)', category: `one of ${CATEGORIES.join('|')}`, quantity: 'number',
      location: 'string', condition: `one of ${CONDITIONS.join('|')}`, estimatedValue: 'number (per-unit USD)',
      manufacturer: 'string', model: 'string', tags: 'string[]', notes: 'string',
      summary: 'string (1-2 sentence overview)', specs: 'object of key:value spec pairs',
      sources: 'array of {title,url} you researched online', datasheetUrl: 'string', imageUrl: 'string', addedBy: 'your agent name',
    },
    usage: 'POST /api/inventory to add, PATCH /api/inventory/:id to enrich, GET /api/inventory/context for a plain-text summary of everything on hand.',
  })
})

// Plain-text "what's on hand" for an agent to read into context.
inventoryRouter.get('/context', (_req, res) => {
  const items = loadItems()
  const stats = computeStats(items)
  const byCat = new Map<string, StoredItem[]>()
  for (const it of items) { const a = byCat.get(it.category) ?? []; a.push(it); byCat.set(it.category, a) }
  let out = `# Inventory (${stats.totalItems} entries · ${stats.totalQuantity} units · ~$${stats.totalValue})\n\n`
  for (const [cat, list] of [...byCat.entries()].sort()) {
    out += `## ${cat}\n`
    for (const it of list) {
      out += `- ${it.name} ×${it.quantity}${it.location ? ` @ ${it.location}` : ''} [${it.condition}]${it.model ? ` (${it.manufacturer} ${it.model})` : ''}${it.summary ? ` — ${it.summary}` : ''}\n`
    }
    out += '\n'
  }
  res.type('text/plain').send(out)
})

inventoryRouter.get('/:id', (req, res) => {
  const item = loadItems().find(i => i.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Item not found' })
  res.json({ item: toResponse(item) })
})

inventoryRouter.post('/', (req, res) => {
  try {
    if (!String(req.body?.name ?? '').trim()) return res.status(400).json({ error: 'name is required' })
    const now = new Date().toISOString()
    const item = sanitize(req.body, { id: randomUUID(), name: '', createdAt: now, updatedAt: now, ...blank() } as StoredItem)
    const items = loadItems()
    items.unshift(item)
    saveItems(items)
    res.status(201).json({ item: toResponse(item) })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Bulk add (agent convenience): { items: [...] }
inventoryRouter.post('/bulk', (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.items) ? req.body.items : []
    const now = new Date().toISOString()
    const items = loadItems()
    const created = []
    for (const b of incoming) {
      if (!String(b?.name ?? '').trim()) continue
      const item = sanitize(b, { id: randomUUID(), name: '', createdAt: now, updatedAt: now, ...blank() } as StoredItem)
      items.unshift(item); created.push(toResponse(item))
    }
    saveItems(items)
    res.status(201).json({ created, count: created.length })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

inventoryRouter.patch('/:id', (req, res) => {
  try {
    const items = loadItems()
    const idx = items.findIndex(i => i.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Item not found' })
    items[idx] = { ...sanitize(req.body, items[idx]), id: items[idx].id, createdAt: items[idx].createdAt, updatedAt: new Date().toISOString() }
    saveItems(items)
    res.json({ item: toResponse(items[idx]) })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// Ask a connected agent to research + fill the item's spec sheet (async).
inventoryRouter.post('/:id/research', (req, res) => {
  try {
    const items = loadItems()
    const idx = items.findIndex(i => i.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Item not found' })

    const requested = req.body?.source === 'hermes' ? 'hermes' : req.body?.source === 'openclaw' ? 'openclaw' : null
    const source = requested ?? (isLive('openclaw') ? 'openclaw' : isLive('hermes') ? 'hermes' : null)
    if (!source) return res.status(409).json({ error: 'No connected agent — enable OpenClaw or Hermes in Settings.' })
    if (!isLive(source)) return res.status(409).json({ error: `${source} is not connected.` })
    if (source !== 'openclaw') return res.status(400).json({ error: 'Auto-research currently supports OpenClaw only. Ask your Hermes agent directly (it can read GET /api/inventory/context).' })

    items[idx].researchStatus = 'pending'
    items[idx].researchRequestedAt = new Date().toISOString()
    items[idx].researchError = ''
    saveItems(items)
    const snap = items[idx]

    // Fire-and-forget: research, then merge the result back when it returns.
    researchItem(snap, source).then(r => {
      const cur = loadItems()
      const j = cur.findIndex(i => i.id === snap.id)
      if (j === -1) return
      const merged = sanitize({
        summary: r.summary, specs: r.specs, manufacturer: r.manufacturer, model: r.model,
        estimatedValue: r.estimatedValue, category: r.category, condition: r.condition,
        datasheetUrl: r.datasheetUrl, sources: r.sources, enriched: true, addedBy: source,
      }, cur[j])
      cur[j] = { ...merged, id: cur[j].id, createdAt: cur[j].createdAt, updatedAt: new Date().toISOString() }
      cur[j].researchStatus = 'done'
      cur[j].researchError = ''
      saveItems(cur)
    }).catch(err => {
      const cur = loadItems()
      const j = cur.findIndex(i => i.id === snap.id)
      if (j === -1) return
      cur[j].researchStatus = 'failed'
      cur[j].researchError = String(err?.message ?? err).slice(0, 200)
      saveItems(cur)
    })

    res.json({ ok: true, status: 'pending', source })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

inventoryRouter.delete('/:id', (req, res) => {
  try {
    const items = loadItems()
    const idx = items.findIndex(i => i.id === req.params.id)
    if (idx === -1) return res.status(404).json({ error: 'Item not found' })
    items.splice(idx, 1)
    saveItems(items)
    res.json({ ok: true })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})
