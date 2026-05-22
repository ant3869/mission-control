// title: Claude Code JSONL live tailer
// path: server/lib/claudeLive.ts
// purpose: Tail the most recently modified JSONL session files and emit
//          LiveEvents for tool_use blocks, producing a real-time activity
//          feed equivalent to openclawLive / hermesLive.

import { readdirSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import type { LiveEvent } from './openclawLive.js'

type Listener = (e: LiveEvent) => void

const BUFFER_MAX = 80
const POLL_MS    = 1500
const TAIL_FILES = 3  // watch the N most recently modified JSONL files

let seq       = 0
let pollTimer: NodeJS.Timeout | null = null
const listeners   = new Set<Listener>()
const buffer: LiveEvent[] = []
const filePositions = new Map<string, number>()  // fp → byte offset

function push(e: LiveEvent) {
  buffer.push(e)
  if (buffer.length > BUFFER_MAX) buffer.shift()
  for (const fn of listeners) { try { fn(e) } catch { /* ignore */ } }
}

function findProjectsDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', '.claude', 'projects'),
    join(homedir(), '.claude', 'projects'),
    join(homedir(), '.config', 'claude', 'projects'),
    join(process.cwd(), '.claude', 'projects'),
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude', 'projects') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude', 'projects') : '',
  ].filter(Boolean)
  return candidates.find(p => { try { return statSync(p).isDirectory() } catch { return false } }) ?? null
}

function primaryInput(input: any): string {
  if (!input || typeof input !== 'object') return typeof input === 'string' ? String(input) : ''
  const v = input.command ?? input.file_path ?? input.path ?? input.url ??
            input.query ?? input.description ?? input.prompt ?? input.content
  if (v !== undefined) return String(v).slice(0, 200)
  const first = Object.values(input as object)[0]
  return first !== undefined ? String(first).slice(0, 200) : ''
}

function tailFile(fp: string) {
  try {
    const st   = statSync(fp)
    const prev = filePositions.get(fp)
    // First visit: start near the end to avoid flooding old history.
    const start = prev !== undefined ? prev : Math.max(0, st.size - 4096)
    if (st.size <= start) return

    const len  = st.size - start
    const buf  = Buffer.allocUnsafe(len)
    const fd   = openSync(fp, 'r')
    try { readSync(fd, buf, 0, len, start) } finally { closeSync(fd) }
    filePositions.set(fp, st.size)

    const sid  = basename(fp, '.jsonl').slice(0, 8)
    const text = buf.toString('utf8')
    const lines = text.split('\n')

    for (const line of lines) {
      if (!line.trim() || !line.includes('"timestamp"')) continue
      let e: any
      try { e = JSON.parse(line) } catch { continue }

      const ts: string = e.timestamp ?? ''
      if (!ts) continue

      // Tool-use blocks inside assistant messages
      const content = e.message?.content ?? e.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type !== 'tool_use') continue
          const toolName  = String(block.name ?? 'tool').toLowerCase()
          const toolInput = primaryInput(block.input ?? {})
          const sub       = toolName + (toolInput ? ': ' + toolInput.slice(0, 120) : '')
          push({
            seq: ++seq, ts, event: 'tool.call', kind: 'tool',
            title: block.name ?? 'tool',
            sub,
            sessionKey: sid,
            meta: { tool: toolName, toolInput },
          })
        }
      }
    }
  } catch { /* skip unreadable */ }
}

async function poll() {
  const dir = findProjectsDir()
  if (!dir) return

  const files: Array<{ fp: string; mtime: number }> = []
  try {
    for (const entry of readdirSync(dir)) {
      const d = join(dir, entry)
      try {
        if (!statSync(d).isDirectory()) continue
        for (const child of readdirSync(d)) {
          if (!child.endsWith('.jsonl')) continue
          const fp = join(d, child)
          try { files.push({ fp, mtime: statSync(fp).mtimeMs }) } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

  files.sort((a, b) => b.mtime - a.mtime)
  for (const { fp } of files.slice(0, TAIL_FILES)) tailFile(fp)
}

export function recent(): LiveEvent[] { return [...buffer] }

export function addListener(fn: Listener): () => void {
  listeners.add(fn)
  if (listeners.size === 1 && !pollTimer) {
    poll()
    pollTimer = setInterval(poll, POLL_MS)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}
