/**
 * Filesystem-based memory file discovery and read/write utilities.
 *
 * Scans well-known locations for Claude/OpenClaw agent memory files
 * (SOUL.md, AGENTS.md, MEMORY.md, etc.) so both OpenClaw and Hermes
 * metrics can surface them even when the agent's WebSocket RPC doesn't
 * expose an agents.files.list endpoint.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import type { MemoryFile } from './metrics.js'

// ─── Known memory dirs (ordered by priority) ──────────────────────────────────

export function memoryFileDirs(extraDirs?: string[]): string[] {
  const base = [
    join(homedir(), '.claude'),
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.claude') : '',
    process.env.APPDATA     ? join(process.env.APPDATA,     'Claude')  : '',
    join(homedir(), '.claude', 'memory'),
    join(process.cwd(), '.claude'),
  ].filter(Boolean) as string[]
  if (!extraDirs?.length) return base
  // Extra dirs go first so they take priority over the generic .claude fallbacks
  const combined = [...extraDirs.filter(Boolean), ...base]
  return [...new Set(combined)] as string[]
}

// ─── Discover all .md memory files from FS ────────────────────────────────────

export function discoverMemoryFilesFromFS(extraDirs?: string[]): MemoryFile[] {
  const found: MemoryFile[] = []
  const seenNames = new Set<string>()

  for (const dir of memoryFileDirs(extraDirs)) {
    if (!existsSync(dir)) continue
    try {
      for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.md')) continue
        if (seenNames.has(entry)) continue
        const full = join(dir, entry)
        try {
          const st = statSync(full)
          if (!st.isFile()) continue
          seenNames.add(entry)
          found.push({
            name: entry,
            path: full,
            size: st.size,
            updatedAt: st.mtime.toISOString(),
            missing: false,
          })
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  return found.sort((a, b) => b.size - a.size)
}

// ─── Resolve a file name to its absolute path ─────────────────────────────────

export function resolveMemoryFilePath(name: string, extraDirs?: string[]): string | null {
  for (const dir of memoryFileDirs(extraDirs)) {
    const full = join(dir, name)
    if (existsSync(full)) return full
  }
  return null
}

// ─── Validate that a requested name is safe ───────────────────────────────────

export function isSafeMemoryFileName(name: string): boolean {
  if (!name) return false
  // Must not contain path separators or null bytes
  if (/[/\\?%*:|"<>\0]/.test(name)) return false
  // Must end with .md
  if (!name.endsWith('.md')) return false
  // basename must equal name (no directory component)
  if (basename(name) !== name) return false
  return true
}

// ─── Read / write ─────────────────────────────────────────────────────────────

export function readMemoryFile(name: string, extraDirs?: string[]): { content: string; path: string } | null {
  const p = resolveMemoryFilePath(name, extraDirs)
  if (!p) return null
  try {
    return { content: readFileSync(p, 'utf8'), path: p }
  } catch {
    return null
  }
}

export function writeMemoryFile(name: string, content: string, extraDirs?: string[]): { ok: boolean; path?: string; error?: string } {
  const p = resolveMemoryFilePath(name, extraDirs)
  if (!p) return { ok: false, error: 'file not found' }
  try {
    writeFileSync(p, content, 'utf8')
    return { ok: true, path: p }
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'write failed' }
  }
}
