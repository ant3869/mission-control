// title: Live memory-event collector
// path: server/lib/memoryCollector.ts
// purpose: Tap the OpenClaw live stream (openclawLive) and turn memory-relevant
//          activity — memory tool calls (remember/recall/forget/consolidate) and
//          writes to memory files — into persisted MemoryEvents, then fan them
//          out to the Memory page's own SSE listeners. This is the token-only,
//          no-agent-changes path to near-real-time "the agent just remembered X"
//          visibility. Truly real-time + decision events (skip/dedup) arrive via
//          the push path (POST /api/memory/events) instead.

import { addListener as ocAddListener, type LiveEvent } from './openclawLive.js'
import { recordMemoryEvent, type MemoryEvent, type MemoryEventType } from './memoryStore.js'

type Listener = (e: MemoryEvent) => void
const listeners = new Set<Listener>()
const buffer: MemoryEvent[] = []
const BUFFER_MAX = 120

// Recent signatures to drop duplicates (same op surfaced via normalize() AND the
// history poll). 10s time-bucketed so an identical recall a minute later still
// counts as a new event.
const recentSig = new Map<string, number>()
const SIG_TTL = 60_000

let started = false

export function addMemoryListener(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function recentMemoryEvents(): MemoryEvent[] {
  return [...buffer]
}

function fanout(e: MemoryEvent) {
  buffer.push(e)
  if (buffer.length > BUFFER_MAX) buffer.shift()
  for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
}

// ─── Classification ─────────────────────────────────────────────────────────────

// A tool whose name implies a memory operation.
const MEMORY_TOOL = /memory|remember|recall|forget|consolidat|reflect|knowledge|mem0|embed|note(?!book)/i
// A file path that looks like a memory file (covers SOUL.md, MEMORY.md, daily dumps, .auto-memory/).
const MEMORY_FILE = /(^|[\\/])(soul|memory|memories|daily|journal)\b|\.auto-memory|memory[\\/].*\.md$/i

function classifyType(tool: string): MemoryEventType {
  const t = tool.toLowerCase()
  if (/forget|delete|remove|prune/.test(t)) return 'deleted'
  if (/consolidat|reflect|dream|summar|merge/.test(t)) return 'consolidated'
  if (/embed/.test(t)) return 'embedded'
  if (/recall|retriev|search|query|lookup|load|fetch|read|get|find/.test(t)) return 'retrieved'
  if (/updat|edit|append|patch/.test(t)) return 'updated'
  return 'created'   // remember / save / store / write / note / add
}

// Turn a LiveEvent into a MemoryEvent, or null if it isn't memory-related.
function toMemoryEvent(e: LiveEvent): Omit<MemoryEvent, 'id' | 'ts'> | null {
  if (e.kind !== 'tool') return null
  const tool  = String(e.meta?.tool ?? e.sub ?? '').trim()
  const input = String(e.meta?.toolInput ?? '').trim()
  const isMemTool = MEMORY_TOOL.test(tool)
  const isMemFile = /^(write|edit|create|str_replace|apply_patch|multiedit)/i.test(tool) && MEMORY_FILE.test(input)
  if (!isMemTool && !isMemFile) return null

  const type: MemoryEventType = isMemFile ? (/(create|write)/i.test(tool) ? 'created' : 'updated') : classifyType(tool)
  const summary = (input || tool).slice(0, 200)
  return {
    source: 'openclaw',
    type,
    trigger: e.sessionKey?.includes(':cron:') ? 'cron' : 'auto',
    status: 'ok',
    objectId: null,
    sessionKey: e.sessionKey ?? null,
    tool: tool || null,
    title: isMemFile ? `Memory file ${type}` : `${tool}`,
    summary,
    latencyMs: null,
    origin: 'live',
    payload: { event: e.event, meta: e.meta ?? null },
  }
}

function signatureOf(m: Omit<MemoryEvent, 'id' | 'ts'>): string {
  return `${m.type}|${m.sessionKey ?? ''}|${m.summary.slice(0, 80)}|${Math.round(Date.now() / 10_000)}`
}

function sweepSigs() {
  const now = Date.now()
  for (const [k, t] of recentSig) if (now - t > SIG_TTL) recentSig.delete(k)
}

/** Ingest one LiveEvent — persists + fans out if it's a (non-duplicate) memory op. */
export function ingestLiveEvent(e: LiveEvent) {
  const mem = toMemoryEvent(e)
  if (!mem) return
  const sig = signatureOf(mem)
  if (recentSig.has(sig)) return
  recentSig.set(sig, Date.now())
  if (recentSig.size > 400) sweepSigs()
  const saved = recordMemoryEvent(mem)
  fanout(saved)
}

/** Record an externally-pushed memory event (Plane 3 — agent-side hook). */
export function ingestPushedEvent(saved: MemoryEvent) {
  fanout(saved)
}

/** Attach to the OpenClaw live stream once, at server startup, so memory ops are
 *  captured continuously regardless of whether the Memory tab is open. */
export function startMemoryCollector() {
  if (started) return
  started = true
  ocAddListener(ingestLiveEvent)
  console.log('[Memory] live collector attached to OpenClaw stream')
}
