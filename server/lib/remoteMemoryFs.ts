// title: Remote memory filesystem reader (SSH into the agent machine)
// path: server/lib/remoteMemoryFs.ts
// purpose: OpenClaw's real memory system lives on the agent's Linux box
//          (DFFS-NEXCO) under ~/.openclaw/workspace/memory/ and is NOT served by
//          the gateway (whitelist = 7 root files). It fully controls that box, so
//          we read it live over SSH. This module shells out to `ssh` with a key
//          and exposes typed readers for the memory layers:
//            daily logs · dreaming (light/deep/rem) · .dreams state
//            (short-term-recall, phase-signals, events.jsonl) · MEMORY.md
//          See docs/memory-redesign.md for the full pipeline map.

import { execFile } from 'child_process'
import { homedir } from 'os'
import { join } from 'path'

// ─── Config (env-overridable; defaults = discovered DFFS-NEXCO values) ──────────

// All connection details come from the environment (.env) — never hardcoded, so
// nothing about the operator's machine is committed. `OPENCLAW_SSH_KEY` may be an
// absolute path or a key name resolved under ~/.ssh.
function resolveKey(): string {
  const k = process.env.OPENCLAW_SSH_KEY?.trim()
  if (!k) return ''
  return k.includes('/') || k.includes('\\') ? k : join(homedir(), '.ssh', k)
}
const SSH = {
  host:   process.env.OPENCLAW_SSH_HOST?.trim() ?? '',
  user:   process.env.OPENCLAW_SSH_USER?.trim() ?? '',
  key:    resolveKey(),
  // Remote memory dir, relative to the agent user's $HOME (expanded remotely).
  memSub: process.env.OPENCLAW_MEMORY_SUBDIR?.trim() || '.openclaw/workspace/memory',
}

export function remoteMemoryConfig() {
  return { host: SSH.host, user: SSH.user, key: SSH.key, memSub: SSH.memSub }
}

// ─── SSH exec (execFile — no local shell, so no injection from our side) ────────

const TIMEOUT_MS = 15_000
const MAX_BUF = 12 * 1024 * 1024   // some memory files are MBs

function sshRun(remoteCmd: string): Promise<{ ok: boolean; stdout: string; error: string | null }> {
  if (!SSH.host || !SSH.key) {
    return Promise.resolve({ ok: false, stdout: '', error: 'SSH not configured — set OPENCLAW_SSH_HOST / OPENCLAW_SSH_USER / OPENCLAW_SSH_KEY in .env (see .env.example)' })
  }
  // The remote command runs under the agent's shell, which expands $HOME / $M.
  const wrapped = `M="$HOME/${SSH.memSub}"; ${remoteCmd}`
  const args = [
    '-i', SSH.key,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new',
    `${SSH.user}@${SSH.host}`,
    wrapped,
  ]
  return new Promise(resolve => {
    execFile('ssh', args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUF, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, stdout: String(stdout ?? ''), error: String(stderr || err.message).slice(0, 400) })
      resolve({ ok: true, stdout: String(stdout ?? ''), error: null })
    })
  })
}

// Small TTL cache — SSH round-trips are ~100-300ms; the memory files change at
// most a few times an hour, so caching keeps the UI snappy.
const cache = new Map<string, { at: number; data: any }>()
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T
  const data = await fn()
  cache.set(key, { at: Date.now(), data })
  return data
}
export function clearRemoteMemoryCache() { cache.clear() }

// ─── Validation (defense-in-depth even though execFile won't shell-inject) ──────

const DATE_RE = /^\d{4}-\d{2}-\d{2}(-[a-z0-9-]+)?$/
const PHASES = new Set(['light', 'deep', 'rem'])
const isDate = (s: string) => DATE_RE.test(s)

// ─── Status ─────────────────────────────────────────────────────────────────────

export interface RemoteMemoryStatus {
  reachable: boolean
  host: string
  memDir: string | null
  dailyCount: number
  dreamCount: number
  bytes: number          // total size of the whole memory/ dir (the real store size)
  error: string | null
}

export async function remoteStatus(force = false): Promise<RemoteMemoryStatus> {
  return cached('status', force ? 0 : 20_000, async () => {
    const r = await sshRun('echo "$M"; ls "$M"/????-??-??*.md 2>/dev/null | wc -l; find "$M/dreaming" -type f -name "*.md" 2>/dev/null | wc -l; du -sb "$M" 2>/dev/null | cut -f1')
    if (!r.ok) return { reachable: false, host: SSH.host, memDir: null, dailyCount: 0, dreamCount: 0, bytes: 0, error: r.error }
    const [dir, daily, dream, bytes] = r.stdout.trim().split('\n')
    return { reachable: true, host: SSH.host, memDir: dir ?? null, dailyCount: Number(daily) || 0, dreamCount: Number(dream) || 0, bytes: Number(bytes) || 0, error: null }
  })
}

// ─── Memory-system state (vector store + pipeline freshness) ────────────────────
// The gateway's doctor.memory.status only reports the live recall PLUGIN. The
// real picture is on disk: the LanceDB vector store + when each pipeline stage
// last ran. One SSH call returns it all so the UI can show truth, not on/off.

export interface MemorySystemState {
  lance: { present: boolean; bytes: number; lastWrite: string | null }
  lastDailyLog: string | null
  lastDream: string | null
  lastRecallUpdate: string | null
  lastEvent: string | null
}

export async function readMemorySystemState(force = false): Promise<MemorySystemState> {
  return cached('sysstate', force ? 0 : 30_000, async () => {
    const cmd =
      'L="$HOME/.openclaw/memory/lancedb"; ' +
      '[ -d "$L" ] && echo "lance=1" || echo "lance=0"; ' +
      'echo "lbytes=$(du -sb "$L" 2>/dev/null | cut -f1)"; ' +
      'echo "lwrite=$(find "$L" -type f -printf "%T@\\n" 2>/dev/null | sort -rn | head -1 | cut -d. -f1)"; ' +
      'd=$(ls -t "$M"/????-??-??*.md 2>/dev/null | head -1); [ -n "$d" ] && echo "lastdaily=$(stat -c %Y "$d")"; ' +
      'echo "lastdream=$(find "$M/dreaming" -type f -name "*.md" -printf "%T@\\n" 2>/dev/null | sort -rn | head -1 | cut -d. -f1)"; ' +
      'echo "recallupd=$(jq -r .updatedAt "$M/.dreams/short-term-recall.json" 2>/dev/null)"; ' +
      'echo "lastevent=$(tail -1 "$M/.dreams/events.jsonl" 2>/dev/null | jq -r .timestamp 2>/dev/null)"'
    const r = await sshRun(cmd)
    const kv: Record<string, string> = {}
    if (r.ok) for (const line of r.stdout.split('\n')) { const i = line.indexOf('='); if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1).trim() }
    const iso = (epochSec: string) => { const n = Number(epochSec); return n > 0 ? new Date(n * 1000).toISOString() : null }
    const str = (v: string) => (v && v !== 'null' ? v : null)
    return {
      lance: { present: kv.lance === '1', bytes: Number(kv.lbytes) || 0, lastWrite: iso(kv.lwrite) },
      lastDailyLog: iso(kv.lastdaily),
      lastDream: iso(kv.lastdream),
      lastRecallUpdate: str(kv.recallupd),
      lastEvent: str(kv.lastevent),
    }
  })
}

// ─── Concept-tag cleaning ───────────────────────────────────────────────────────
// OpenClaw's dreaming pass tokenizes its own recall-prompt boilerplate + chat
// filler into conceptTags, so the raw tags are full of system strings. Strip them
// to a real topic list. Exported so the frontend can reuse the same rules.

export const TAG_STOPWORDS = new Set([
  // recall-prompt / system injection
  'user', 'assistant', 'system', 'treat', 'below', 'memories', 'relevant', 'relevant-memories',
  'untrusted', 'historical', 'data', 'context', 'instructions', 'memory', 'reply', 'reply-to',
  'reply-to-current', 'no-reply', 'noreply', 'heartbeat', 'heartbeat-ok', 'message', 'prompt',
  'channel', 'guild', 'thread', 'dm', 'inbound', 'outbound', 'tool', 'toolcall', 'result',
  // timezones / time tokens
  'cdt', 'cst', 'utc', 'est', 'pst', 'gmt', 'am', 'pm', 'today', 'tomorrow', 'yesterday', 'now',
  // conversational filler / stopwords
  "i'm", 'im', 'the', 'and', 'for', 'with', 'this', 'that', 'you', 'your', 'are', 'was', 'were',
  'has', 'have', 'had', 'not', 'but', 'all', 'any', 'can', 'will', 'just', 'get', 'got', 'like',
  'want', 'need', 'know', 'see', 'said', 'says', 'let', 'yes', 'okay', 'hey', 'please', 'thanks',
  'thank', 'about', 'into', 'from', 'they', 'them', 'their', 'there', 'here', 'what', 'when',
  'where', 'which', 'who', 'how', 'why', 'some', 'more', 'than', 'then', 'also', 'still', 'one',
  'two', 'new', 'old', 'good', 'bad', 'use', 'used', 'using', 'make', 'made', 'now', 'out', 'off',
  'set', 'run', 'ran', 'add', 'added', 'check', 'checked', 'check-in', 'checkin', 'done', 'going', 'gonna', 'really',
  // conversational filler + time-of-day heartbeat markers (not topics)
  'yep', 'yeah', 'yup', 'nah', 'huh', 'hmm', 'lol', 'haha', 'oh', 'well', 'sure', 'maybe',
  'actually', 'basically', 'literally', 'kinda', 'sorta', 'morning', 'midday', 'afternoon',
  'evening', 'night', 'day', 'week', 'weekend', 'time', 'found', 'thing', 'things', 'stuff',
  'way', 'lot', 'bit', 'guy', 'guys', 'self', 'people', 'someone', 'something', 'anything',
  'right', 'real', 'already', 'pass', 'still', 'even', 'much', 'many', 'every', 'back', 'next',
  'keep', 'give', 'take', 'call', 'send', 'show', 'look', 'come', 'came', 'try', 'tried', 'nice',
])

// Reject tags that are clearly system strings rather than topics.
const TAG_REJECT = /\.(md|json|jsonl|txt|sh|js|ts|py)$|^id:|:\d|^\d|_id$|^[0-9a-f]{8,}$|https?:|@|^#|\b\d{4}-\d{2}-\d{2}\b|->|reply-to|heartbeat|no-?reply|untrusted|relevant-mem/i

export function cleanConceptTags(tags: Array<{ tag: string; count: number }>): Array<{ tag: string; count: number }> {
  const seen = new Set<string>()
  const out: Array<{ tag: string; count: number }> = []
  for (const t of tags) {
    const raw = String(t.tag ?? '')
    if (/['’`]/.test(raw)) continue         // any apostrophe → contraction (i'm, i’m, don't, it's…)
    const w = raw.toLowerCase().trim()
    if (w.length < 3 || w.length > 28) continue
    if (TAG_STOPWORDS.has(w)) continue
    if (TAG_REJECT.test(w)) continue
    if (!/[a-z]/.test(w)) continue          // must contain letters
    if (seen.has(w)) continue
    seen.add(w)
    out.push({ tag: t.tag, count: t.count })
  }
  return out
}

// ─── Daily logs ─────────────────────────────────────────────────────────────────

export interface DailyLogMeta { date: string; size: number; mtime: string; preview: string }

export async function listDailyLogs(force = false): Promise<DailyLogMeta[]> {
  return cached('daily-list', force ? 0 : 60_000, async () => {
    // One line per file: date <TAB> size <TAB> mtimeEpoch <TAB> firstContentLine
    const cmd =
      'for f in "$M"/????-??-??*.md; do [ -f "$f" ] || continue; ' +
      'b=$(basename "$f" .md); sz=$(stat -c %s "$f"); mt=$(stat -c %Y "$f"); ' +
      'pv=$(grep -m1 -E "^- " "$f" | sed "s/^- //" | cut -c1-160); ' +
      'printf "%s\\t%s\\t%s\\t%s\\n" "$b" "$sz" "$mt" "$pv"; done'
    const r = await sshRun(cmd)
    if (!r.ok) return []
    return r.stdout.trim().split('\n').filter(Boolean).map(line => {
      const [date, size, mt, ...rest] = line.split('\t')
      return { date, size: Number(size) || 0, mtime: new Date(Number(mt) * 1000).toISOString(), preview: rest.join(' ').trim() }
    }).filter(d => d.date).sort((a, b) => b.date.localeCompare(a.date))
  })
}

// Pull EVERY daily log's content in a single SSH round-trip (delimited stream),
// so the local index can be built without 100+ separate connections.
export async function pullAllDailyLogs(): Promise<Array<{ date: string; content: string }>> {
  const cmd =
    'for f in "$M"/????-??-??*.md; do [ -f "$f" ] || continue; ' +
    'printf "\\n<<<<<MEMLOG %s>>>>>\\n" "$(basename "$f" .md)"; cat "$f"; done'
  const r = await sshRun(cmd)
  if (!r.ok) return []
  const parts = r.stdout.split(/\n<<<<<MEMLOG (.+?)>>>>>\n/)
  const out: Array<{ date: string; content: string }> = []
  for (let i = 1; i < parts.length; i += 2) {
    const date = parts[i]?.trim()
    if (date) out.push({ date, content: (parts[i + 1] ?? '').trim() })
  }
  return out
}

export async function readDailyLog(date: string): Promise<string | null> {
  if (!isDate(date)) return null
  return cached(`daily:${date}`, 60_000, async () => {
    const r = await sshRun(`cat "$M/${date}.md" 2>/dev/null`)
    return r.ok && r.stdout ? r.stdout : null
  })
}

// ─── Dreaming (light / deep / rem) ───────────────────────────────────────────────

export interface DreamMeta { phase: string; date: string; size: number }

export async function listDreams(force = false): Promise<DreamMeta[]> {
  return cached('dream-list', force ? 0 : 60_000, async () => {
    const cmd =
      'for p in light deep rem; do for f in "$M/dreaming/$p"/*.md; do [ -f "$f" ] || continue; ' +
      'printf "%s\\t%s\\t%s\\n" "$p" "$(basename "$f" .md)" "$(stat -c %s "$f")"; done; done'
    const r = await sshRun(cmd)
    if (!r.ok) return []
    return r.stdout.trim().split('\n').filter(Boolean).map(l => {
      const [phase, date, size] = l.split('\t')
      return { phase, date, size: Number(size) || 0 }
    }).filter(d => d.date)
  })
}

export async function readDream(phase: string, date: string): Promise<string | null> {
  if (!PHASES.has(phase) || !isDate(date)) return null
  return cached(`dream:${phase}:${date}`, 60_000, async () => {
    const r = await sshRun(`cat "$M/dreaming/${phase}/${date}.md" 2>/dev/null`)
    return r.ok && r.stdout ? r.stdout : null
  })
}

// ─── Dream pipeline events (.dreams/events.jsonl) ───────────────────────────────

export interface DreamEvent {
  type: string
  timestamp: string
  phase?: string
  reportPath?: string
  lineCount?: number
  query?: string
  resultCount?: number
  applied?: number
  candidates?: Array<{ path: string; score: number; recallCount?: number }>
}

export async function readDreamEvents(limit = 250, force = false): Promise<DreamEvent[]> {
  return cached(`events:${limit}`, force ? 0 : 30_000, async () => {
    const r = await sshRun(`tail -n ${Math.min(Math.max(limit, 1), 1000)} "$M/.dreams/events.jsonl" 2>/dev/null`)
    if (!r.ok) return []
    const out: DreamEvent[] = []
    for (const line of r.stdout.trim().split('\n')) {
      if (!line) continue
      try {
        const e = JSON.parse(line)
        out.push({
          type: e.type, timestamp: e.timestamp, phase: e.phase, reportPath: e.reportPath,
          lineCount: e.lineCount, query: e.query, resultCount: e.resultCount, applied: e.applied,
          candidates: Array.isArray(e.candidates) ? e.candidates.map((c: any) => ({ path: c.path, score: c.score, recallCount: c.recallCount })) : undefined,
        })
      } catch { /* skip malformed line */ }
    }
    return out.reverse()   // newest first
  })
}

// ─── Short-term recall + phase signals (summaries, not the raw MBs) ─────────────

export interface RecallChunk {
  path: string; startLine: number; endLine: number; snippet: string
  recallCount: number; dailyCount: number; totalScore: number
  conceptTags: string[]; lastRecalledAt: string | null
}
export interface RecallSummary {
  total: number
  updatedAt: string | null
  topChunks: RecallChunk[]
  topTags: Array<{ tag: string; count: number }>
}

export async function readRecallSummary(force = false): Promise<RecallSummary> {
  return cached('recall', force ? 0 : 60_000, async () => {
    // Extract the most-recalled chunks + a concept-tag histogram, remotely via jq,
    // so we never pull the full 2.3MB file. Ranked by `dailyCount` (times recalled
    // across days) — `recallCount` tracks only direct user recalls and is ~0 for
    // dreaming-recalled chunks, so it's the wrong field to sort/display by.
    const jq =
      `'{total:(.entries|length), updatedAt:.updatedAt, ` +
      `topChunks:(.entries|to_entries|map(.value)|sort_by(-(((.dailyCount//0)*1000) + (.totalScore//0)))|.[0:40]` +
      `|map({path,startLine,endLine,snippet,recallCount,dailyCount,recallDayCount:((.recallDays//[])|length),totalScore,conceptTags,lastRecalledAt})), ` +
      `topTags:(.entries|to_entries|map(.value.conceptTags // [])|flatten|group_by(.)|map({tag:.[0],count:length})|sort_by(-.count)|.[0:120])}'`
    const r = await sshRun(`jq -c ${jq} "$M/.dreams/short-term-recall.json" 2>/dev/null`)
    if (!r.ok || !r.stdout.trim()) return { total: 0, updatedAt: null, topChunks: [], topTags: [] }
    try {
      const j = JSON.parse(r.stdout)
      return {
        total: Number(j.total) || 0,
        updatedAt: j.updatedAt ?? null,
        topChunks: (j.topChunks ?? []).map((c: any) => ({
          path: c.path, startLine: c.startLine, endLine: c.endLine, snippet: String(c.snippet ?? '').slice(0, 400),
          // `recallCount` here = effective recall frequency (dailyCount), which is
          // the meaningful, non-zero signal the dashboard should show.
          recallCount: Number(c.dailyCount ?? c.recallDayCount) || 0,
          dailyCount: Number(c.dailyCount) || 0,
          totalScore: Number(c.totalScore) || 0, conceptTags: c.conceptTags ?? [], lastRecalledAt: c.lastRecalledAt ?? null,
        })),
        topTags: cleanConceptTags((j.topTags ?? []).map((t: any) => ({ tag: String(t.tag), count: Number(t.count) || 0 }))).slice(0, 24),
      }
    } catch { return { total: 0, updatedAt: null, topChunks: [], topTags: [] } }
  })
}

export interface PhaseSignalSummary {
  total: number
  updatedAt: string | null
  topSignals: Array<{ key: string; path: string; lightHits: number; remHits: number; lastLightAt: string | null }>
}

export async function readPhaseSignals(force = false): Promise<PhaseSignalSummary> {
  return cached('phase-signals', force ? 0 : 60_000, async () => {
    const jq =
      `'{total:(.entries|length), updatedAt:.updatedAt, ` +
      `topSignals:(.entries|to_entries|map(.value)|sort_by(-((.lightHits//0)+(.remHits//0)))|.[0:30]` +
      `|map({key,lightHits,remHits,lastLightAt}))}'`
    const r = await sshRun(`jq -c ${jq} "$M/.dreams/phase-signals.json" 2>/dev/null`)
    if (!r.ok || !r.stdout.trim()) return { total: 0, updatedAt: null, topSignals: [] }
    try {
      const j = JSON.parse(r.stdout)
      return {
        total: Number(j.total) || 0, updatedAt: j.updatedAt ?? null,
        topSignals: (j.topSignals ?? []).map((s: any) => ({
          key: String(s.key ?? ''), path: String(s.key ?? '').replace(/^memory:/, '').replace(/:\d+:\d+$/, ''),
          lightHits: Number(s.lightHits) || 0, remHits: Number(s.remHits) || 0, lastLightAt: s.lastLightAt ?? null,
        })),
      }
    } catch { return { total: 0, updatedAt: null, topSignals: [] } }
  })
}

// ─── Long-term memory (MEMORY.md, the promoted/distilled state) ─────────────────

export async function readLongTermMemory(force = false): Promise<string | null> {
  return cached('longterm', force ? 0 : 60_000, async () => {
    const r = await sshRun('cat "$HOME/.openclaw/workspace/MEMORY.md" 2>/dev/null')
    return r.ok && r.stdout ? r.stdout : null
  })
}
