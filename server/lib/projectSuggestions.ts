/**
 * Agentic project suggestion engine.
 * Asks a connected agent (OpenClaw or Hermes) to analyse the user's hardware
 * inventory and return a JSON array of realistic build ideas.
 */
import { randomUUID } from 'crypto'
import type { AgentSource } from './agentEvents.js'
import { ensureConnected, request as ocRequest } from './openclawLive.js'
import { hermesChat } from './hermesApiServer.js'

// ─── Minimal item shape needed for prompt construction ──────────────────────

export interface InventoryItemSummary {
  id:           string
  name:         string
  category:     string
  quantity:     number
  condition:    string
  manufacturer: string
  model:        string
  summary:      string
  specs:        Record<string, string>
  tags:         string[]
  notes:        string
  status:       string  // available | in-use | reserved
}

// ─── Result shape (matches JSON the agent returns) ──────────────────────────

export interface ProjectIdeaResult {
  title:          string
  description:    string
  whyFit:         string
  haveParts:      string[]
  missingParts:   string[]
  difficulty:     string   // easy | medium | hard | expert
  timeEstimate:   string
  costEstimate:   string
  confidence:     number   // 0-100
  coolness:       number   // 0-100
  requiredTools:  string[]
  relatedItemIds: string[]
  nextStep:       string
  category:       string
}

// ─── Backlog context passed into prompt & dedupe ────────────────────────────

export interface ProjectBacklogContext {
  rejected: Array<{ title: string; description: string; category: string; rejectionReason: string; haveParts: string[] }>
  liked:    Array<{ title: string; description: string; category: string; haveParts: string[] }>
  snoozed:  Array<{ title: string; description: string; category: string }>
  existing: Array<{ title: string; description: string; category: string; status: string }>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: any) =>
        b?.type === 'text' ? String(b.text ?? '') : typeof b === 'string' ? b : '',
      )
      .join('\n')
  }
  return ''
}

function extractJsonArray(text: string): any[] | null {
  if (!text) return null

  // Strip markdown fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text

  // Try bare JSON array
  const arrStart = body.indexOf('[')
  const arrEnd   = body.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      const arr = JSON.parse(body.slice(arrStart, arrEnd + 1))
      if (Array.isArray(arr) && arr.length > 0) return arr
    } catch { /* fall through */ }
  }

  // Try object wrapper e.g. { "ideas": [...] }
  const objStart = body.indexOf('{')
  const objEnd   = body.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const obj = JSON.parse(body.slice(objStart, objEnd + 1))
      const arr = obj.ideas ?? obj.projects ?? obj.suggestions
      if (Array.isArray(arr) && arr.length > 0) return arr
    } catch { /* fall through */ }
  }

  return null
}

// ─── Similarity & dedupe ─────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(' ').filter(w => w.length > 2))
  const tb = new Set(normalize(b).split(' ').filter(w => w.length > 2))
  const union = new Set([...ta, ...tb]).size
  if (union === 0) return 0
  return [...ta].filter(w => tb.has(w)).length / union
}

// ─── Concept-level (synonym-aware) similarity ────────────────────────────────

/**
 * Maps surface tokens to canonical concept buckets for maker/electronics domain.
 * E.g. dashboard, screen, station, panel → 'display'; Pi, raspberry, rpi → 'pi'.
 * This is the core of semantic deduplication — raw Jaccard misses these.
 */
const SYNONYM_GROUPS: Record<string, string> = {
  // ── Display / output ───────────────────────────────────────────────────────
  dashboard: 'display', display: 'display', screen:    'display', panel:    'display',
  monitor:   'display', station: 'display', readout:   'display', viewer:   'display',
  interface: 'display', hud:     'display', terminal:  'display',
  // ── Sensing / measurement ──────────────────────────────────────────────────
  sensor:        'sensor', sensing:     'sensor', detector:     'sensor',
  temperature:   'sensor', humidity:    'sensor', weather:      'sensor',
  environmental: 'sensor', monitoring:  'sensor',
  // ── Status / data ──────────────────────────────────────────────────────────
  status: 'status', stats: 'status', metrics: 'status', telemetry: 'status',
  // ── Home context ───────────────────────────────────────────────────────────
  home: 'home', house: 'home', domestic: 'home', indoor: 'home',
  // ── Pi / SBC platform ─────────────────────────────────────────────────────
  pi: 'pi', raspberry: 'pi', rpi: 'pi',
  // ── Arduino / MCU ─────────────────────────────────────────────────────────
  arduino: 'mcu', esp32: 'mcu', esp8266: 'mcu', microcontroller: 'mcu',
  // ── Automation / control ──────────────────────────────────────────────────
  automation: 'automation', automated: 'automation', automatic:  'automation',
  controller: 'automation', control:   'automation',
  // ── Robotics ──────────────────────────────────────────────────────────────
  robot: 'robot', robotic: 'robot', arm: 'robot', servo: 'robot',
  // ── Network / wireless ────────────────────────────────────────────────────
  wifi: 'network', wireless: 'network', bluetooth: 'network',
  mqtt: 'network', server:   'network', gateway:   'network',
  // ── Clock / time ──────────────────────────────────────────────────────────
  clock: 'clock', timer: 'clock', alarm: 'clock',
  // ── Media ─────────────────────────────────────────────────────────────────
  audio: 'media', music: 'media', video: 'media', camera: 'media',
  stream: 'media', player: 'media', speaker: 'media',
  // ── Lighting ──────────────────────────────────────────────────────────────
  led: 'lighting', lighting: 'lighting', strip:    'lighting',
  neopixel: 'lighting', rgb: 'lighting',
}

/** Extracts only synonym-mapped concept tokens — discards unmapped noise words. */
function conceptTokens(s: string): Set<string> {
  const mapped: string[] = []
  for (const w of normalize(s).split(' ').filter(w => w.length > 0)) {
    const concept = SYNONYM_GROUPS[w]
    if (concept) mapped.push(concept)
  }
  return new Set(mapped)
}

/** Jaccard similarity on concept tokens (synonym-normalised). */
function conceptOverlap(a: string, b: string): number {
  const ta = conceptTokens(a)
  const tb = conceptTokens(b)
  const union = new Set([...ta, ...tb]).size
  if (union === 0) return 0
  return [...ta].filter(w => tb.has(w)).length / union
}

/** Human-readable label for the concept family an idea belongs to — used in rejection prompt blocks. */
function conceptFamily(title: string, description: string): string {
  const tokens = new Set([...conceptTokens(title), ...conceptTokens(description)])
  const labels: string[] = []
  if (tokens.has('pi'))         labels.push('Pi/SBC platform')
  if (tokens.has('mcu'))        labels.push('Arduino/MCU platform')
  if (tokens.has('display'))    labels.push('screen/display output')
  if (tokens.has('sensor'))     labels.push('sensor/monitoring data')
  if (tokens.has('status'))     labels.push('status/metrics')
  if (tokens.has('home'))       labels.push('home environment')
  if (tokens.has('automation')) labels.push('automation/control')
  if (tokens.has('robot'))      labels.push('robotics/servo')
  if (tokens.has('network'))    labels.push('networking/wireless')
  if (tokens.has('clock'))      labels.push('clock/timer')
  if (tokens.has('media'))      labels.push('audio/video/media')
  if (tokens.has('lighting'))   labels.push('LED/lighting')
  return labels.length > 0 ? labels.join(' + ') : 'general electronics'
}

function pct(n: number): string { return `${(n * 100).toFixed(0)}%` }

/**
 * Semantic concept-level similarity — catches renamed variants that share
 * the same concept family even when raw Jaccard misses them.
 *
 * Examples of what this catches that raw Jaccard misses:
 *   "Pi dashboard" ≈ "sensor display station"   (display + category)
 *   "Pi dashboard" ≈ "Pi monitoring screen"      (pi + display, global)
 *   "Pi dashboard" ≈ "home status display"       (fingerprint + category)
 *
 * Returns { similar, reason } so callers can log exactly why an idea was blocked.
 */
export function isConceptuallySimilar(
  a: { title: string; description: string; category: string; relatedItemIds?: string[]; haveParts?: string[] },
  b: { title: string; description: string; category: string; relatedItemIds?: string[]; haveParts?: string[] },
): { similar: boolean; reason?: string } {
  // 1. Title concept overlap — globally significant
  const titleScore = conceptOverlap(a.title, b.title)
  if (titleScore >= 0.55) {
    return { similar: true, reason: `title concept overlap ${pct(titleScore)}` }
  }

  // 2. Title concept overlap within same category — more lenient
  if (a.category === b.category && titleScore >= 0.30) {
    return { similar: true, reason: `same category '${a.category}' + title concept overlap ${pct(titleScore)}` }
  }

  // 3. Full concept fingerprint: title + description combined
  const aFp = new Set([...conceptTokens(a.title), ...conceptTokens(a.description)])
  const bFp = new Set([...conceptTokens(b.title), ...conceptTokens(b.description)])
  const fpUnion = new Set([...aFp, ...bFp]).size
  if (fpUnion > 0) {
    const fpScore = [...aFp].filter(w => bFp.has(w)).length / fpUnion
    if (fpScore >= 0.55) {
      return { similar: true, reason: `concept fingerprint overlap ${pct(fpScore)}` }
    }
    if (a.category === b.category && fpScore >= 0.35) {
      return { similar: true, reason: `same category + concept fingerprint overlap ${pct(fpScore)}` }
    }
  }

  // 4. Heavy parts overlap + same category implies same purpose
  const aItems = new Set([...(a.relatedItemIds ?? []), ...(a.haveParts ?? [])])
  const bItems = new Set([...(b.relatedItemIds ?? []), ...(b.haveParts ?? [])])
  if (aItems.size >= 2 && bItems.size >= 2) {
    const itemUnion = new Set([...aItems, ...bItems]).size
    const itemScore = [...aItems].filter(w => bItems.has(w)).length / itemUnion
    if (itemScore >= 0.60 && a.category === b.category) {
      return { similar: true, reason: `same category + parts overlap ${pct(itemScore)}` }
    }
  }

  return { similar: false }
}

/** Returns true when two ideas are close enough to count as the same concept. */
export function isSimilar(
  a: { title: string; description: string; category: string },
  b: { title: string; description: string; category: string },
  threshold = 0.38,
): boolean {
  if (tokenOverlap(a.title, b.title) >= threshold) return true
  if (a.category === b.category && tokenOverlap(a.description, b.description) >= 0.5) return true
  return false
}

/**
 * Filters freshly-generated ideas against the backlog context.
 * Returns kept ideas and a log of what was dropped and why.
 */
export type DedupeFilteredEntry = {
  title:                string
  reason:               string   // full explanation with overlap %, signal name, matched title
  matchedTitle:         string   // the existing/rejected idea that triggered the block
  matchedRejectionNote: string   // the user's rejection reason for that idea ('' if none)
  conceptFamily:        string   // concept family of the NEW idea
  matchedConceptFamily: string   // concept family of the MATCHED idea
}

export type DedupeKeptEntry = ProjectIdeaResult & {
  conceptFamily: string          // concept family of this idea (for debug logging)
}

export function dedupeIdeas(
  newIdeas: ProjectIdeaResult[],
  ctx: ProjectBacklogContext,
): { kept: DedupeKeptEntry[]; filtered: DedupeFilteredEntry[] } {
  const filtered: DedupeFilteredEntry[] = []
  const kept: DedupeKeptEntry[] = []
  const nonRejected = ctx.existing.filter(e => e.status !== 'rejected')

  for (const idea of newIdeas) {
    let blocked = false
    const ideaFamily = conceptFamily(idea.title, idea.description)

    // 1. Raw Jaccard against rejected (fast path for close title matches)
    const rejRaw = ctx.rejected.find(r => isSimilar(idea, r, 0.35))
    if (rejRaw) {
      filtered.push({
        title: idea.title,
        reason: `too similar to rejected: "${rejRaw.title}" (title Jaccard)`,
        matchedTitle:         rejRaw.title,
        matchedRejectionNote: rejRaw.rejectionReason ?? '',
        conceptFamily:        ideaFamily,
        matchedConceptFamily: conceptFamily(rejRaw.title, rejRaw.description),
      })
      continue
    }

    // 2. Concept/semantic match against rejected (catches renamed variants)
    for (const r of ctx.rejected) {
      const check = isConceptuallySimilar(idea, r)
      if (check.similar) {
        filtered.push({
          title: idea.title,
          reason: `conceptually similar to rejected: "${r.title}" — ${check.reason}`,
          matchedTitle:         r.title,
          matchedRejectionNote: r.rejectionReason ?? '',
          conceptFamily:        ideaFamily,
          matchedConceptFamily: conceptFamily(r.title, r.description),
        })
        blocked = true
        break
      }
    }
    if (blocked) continue

    // 3. Raw Jaccard against existing non-rejected
    const existRaw = nonRejected.find(e => isSimilar(idea, e, 0.45))
    if (existRaw) {
      filtered.push({
        title: idea.title,
        reason: `duplicate of existing: "${existRaw.title}" (title Jaccard)`,
        matchedTitle:         existRaw.title,
        matchedRejectionNote: '',
        conceptFamily:        ideaFamily,
        matchedConceptFamily: conceptFamily(existRaw.title, existRaw.description),
      })
      continue
    }

    // 4. Concept match against existing non-rejected
    for (const e of nonRejected) {
      const check = isConceptuallySimilar(idea, e)
      if (check.similar) {
        filtered.push({
          title: idea.title,
          reason: `conceptually duplicate of existing: "${e.title}" — ${check.reason}`,
          matchedTitle:         e.title,
          matchedRejectionNote: '',
          conceptFamily:        ideaFamily,
          matchedConceptFamily: conceptFamily(e.title, e.description),
        })
        blocked = true
        break
      }
    }
    if (blocked) continue

    kept.push({ ...idea, conceptFamily: ideaFamily })
  }
  return { kept, filtered }
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

export function buildProjectPrompt(items: InventoryItemSummary[], ctx?: ProjectBacklogContext): string {
  const available = items.filter(i => i.status !== 'in-use')

  // Group by category for readability
  const byCat = new Map<string, InventoryItemSummary[]>()
  for (const it of available) {
    const k = it.category || 'other'
    const arr = byCat.get(k) ?? []
    arr.push(it)
    byCat.set(k, arr)
  }

  let invText = `HARDWARE INVENTORY (${available.length} available items):\n`
  for (const [cat, its] of [...byCat.entries()].sort()) {
    invText += `\n[${cat.toUpperCase()}]\n`
    for (const it of its) {
      const specStr = Object.entries(it.specs ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
      const mfgModel = [it.manufacturer, it.model].filter(Boolean).join(' ')
      const parts = [
        `ID:${it.id}`,
        `${it.name} ×${it.quantity}`,
        mfgModel ? `(${mfgModel})` : '',
        it.condition !== 'working' ? `[${it.condition}]` : '',
        specStr ? `specs: ${specStr}` : '',
        it.summary ? `— ${it.summary}` : '',
        it.tags.length ? `tags: ${it.tags.join(', ')}` : '',
        it.notes ? `notes: ${it.notes}` : '',
      ].filter(Boolean).join(' | ')
      invText += `- ${parts}\n`
    }
  }

  const lines = [
    'You are a creative maker/hacker helping me discover what I can actually build from my hardware inventory.',
    'Analyse the inventory below and produce 8-15 realistic, interesting project ideas.',
    '',
    'STRICT RULES:',
    '- Only reference items that are literally in my inventory. Never invent parts I do not have.',
    '- Do not hallucinate specs or capabilities. Use the specs and summary I provided.',
    '- Prefer projects where I already have most or all required parts.',
    '- Missing parts must be cheap and common (wires, resistors, cheap breakout boards, SD cards, screws).',
    '  Do not suggest missing parts that cost more than ~$30 or are specialty/hard-to-source items.',
    '- Be honest about difficulty. Note when a project needs RF knowledge, advanced soldering, FPGAs, etc.',
    '- Vary difficulty and time: include quick 2-hour builds AND longer weekend or multi-day projects.',
    '- Use the exact item IDs from the inventory in the relatedItemIds field.',
    '',
    'PROJECT CATEGORIES — use exactly one per idea:',
    '  raspberry-pi-build, microcontroller-project, sensor-automation, display-dashboard,',
    '  repair-reuse, lab-equipment, cyberdeck-portable, prop-electronics, home-utility, experimental',
    '',
    ...(ctx?.rejected.length ? [
      '── PREVIOUSLY REJECTED IDEAS — do NOT reproduce these or conceptually similar ideas ──',
      'These ideas were explicitly rejected by the user. NEVER suggest them again, including renamed or',
      'reskinned versions that use the same parts for the same purpose.',
      'The rejection reason reveals the user\'s taste — use it as a preference signal.',
      ...ctx.rejected.flatMap(r => [
        `  REJECTED: "${r.title}" [${r.category}]`,
        `    Concept family: ${conceptFamily(r.title, r.description)}  ← ALL ideas in this family are off-limits`,
        ...(r.rejectionReason ? [`    Reason: "${r.rejectionReason}"  ← also treat this as a negative filter`] : []),
        ...(r.haveParts.length ? [`    Key parts used: ${r.haveParts.slice(0, 4).join(', ')}`] : []),
      ]),
      '',
      'SIMILARITY RULE: title token overlap >35% OR concept-family overlap >30% (same category) = too similar.',
      'Concept equivalences: dashboard=display=screen=station=panel=monitor,',
      '  Pi=raspberry=rpi, sensor=monitoring=temperature=humidity=weather,',
      '  Arduino=ESP32=microcontroller, servo=robot=arm.',
      '',
    ] : []),
    ...(ctx?.liked.length ? [
      '── LIKED / SAVED IDEAS — user positively rated these, generate more in these directions ──',
      ...ctx.liked.map(l =>
        `  LIKED: "${l.title}" [${l.category}]${l.haveParts.length ? ` — parts: ${l.haveParts.slice(0, 3).join(', ')}` : ''}`,
      ),
      '',
    ] : []),
    ...(ctx?.snoozed.length ? [
      '── SNOOZED — user deferred these, do not regenerate them right now ──',
      ...ctx.snoozed.map(s => `  SNOOZED: "${s.title}" [${s.category}]`),
      '',
    ] : []),
    ...(ctx?.existing.length ? [
      '── ALREADY IN BACKLOG — skip these and any near-duplicates ──',
      ...ctx.existing.map(e => `  EXISTS: "${e.title}" [${e.category}]`),
      '',
    ] : []),
    'REPLY FORMAT: Output ONLY a JSON array. No prose before or after, no markdown fences.',
    'Each element of the array must match this exact schema:',
    '{',
    '  "title": "project name (5-8 words)",',
    '  "description": "2-3 sentences: what it does and why it is useful or fun",',
    '  "whyFit": "1-2 sentences: which specific inventory items make this possible right now",',
    '  "haveParts": ["human-readable name of a part I already have"],',
    '  "missingParts": ["thing I need and approximate cost, e.g. \\"MicroSD card ~$5\\""],',
    '  "difficulty": "easy|medium|hard|expert",',
    '  "timeEstimate": "e.g. \\"2-4 hours\\" or \\"1-2 weekends\\"",',
    '  "costEstimate": "e.g. \\"Free — have everything\\" or \\"< $15 for missing parts\\"",',
    '  "confidence": 85,',
    '  "coolness": 72,',
    '  "requiredTools": ["tool or skill needed, e.g. \\"soldering iron\\""],',
    '  "relatedItemIds": ["exact-item-id-from-inventory"],',
    '  "nextStep": "the single most important first action to start this project",',
    '  "category": "one category from the list above"',
    '}',
    '',
    invText,
  ]

  return lines.join('\n')
}

// ─── Agent runners ───────────────────────────────────────────────────────────

async function suggestOpenClaw(items: InventoryItemSummary[], ctx?: ProjectBacklogContext): Promise<ProjectIdeaResult[]> {
  await ensureConnected(12_000)
  const sessionKey = `agent:main:dashboard-projects:${Date.now()}`
  const prompt = buildProjectPrompt(items, ctx)

  await ocRequest(
    'chat.send',
    { sessionKey, message: prompt, deliver: false, idempotencyKey: randomUUID() },
    12_000,
  )

  // Poll up to ~4 minutes (48 × 5 s)
  for (let i = 0; i < 48; i++) {
    await sleep(5_000)
    const h = await ocRequest(
      'chat.history',
      { sessionKey, limit: 8, maxChars: 120_000 },
      10_000,
    ).catch(() => null)
    const msgs: any[] = h?.messages ?? []
    const lastAssistant = [...msgs].reverse().find(m => String(m.role) === 'assistant')
    const arr = extractJsonArray(extractText(lastAssistant?.content))
    if (arr && arr.length > 0) return arr as ProjectIdeaResult[]
  }
  throw new Error('Agent did not return project ideas within ~4 minutes')
}

async function suggestHermes(items: InventoryItemSummary[], ctx?: ProjectBacklogContext): Promise<ProjectIdeaResult[]> {
  const prompt = buildProjectPrompt(items, ctx)
  const r = await hermesChat(prompt, { timeoutMs: 240_000 })
  if (!r.ok) {
    throw new Error(`Hermes rejected the request (${r.triedUrl}): ${r.error ?? 'unknown'}`)
  }
  const arr = extractJsonArray(r.answer)
  if (arr && arr.length > 0) return arr as ProjectIdeaResult[]
  throw new Error('Hermes returned an answer but no parseable JSON project list')
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function suggestProjects(
  items: InventoryItemSummary[],
  source: AgentSource,
  ctx?: ProjectBacklogContext,
): Promise<ProjectIdeaResult[]> {
  if (source === 'openclaw') return suggestOpenClaw(items, ctx)
  if (source === 'hermes') {
    return suggestHermes(items, ctx).catch(err => {
      const msg = String(err?.message ?? '')
      // Fall back to OpenClaw if Hermes is truly unavailable
      if (msg.includes('unavailable') || msg.includes('no supported')) {
        return suggestOpenClaw(items, ctx)
      }
      throw err
    })
  }
  throw new Error(`Unknown agent source: ${source}`)
}
