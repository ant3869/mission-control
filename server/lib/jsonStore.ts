// Atomic JSON file I/O — write to a .tmp sibling, then rename into place.
// On POSIX rename(2) is atomic; on Windows NTFS it's as close as we can get
// without a lock file, and is safe against process crash mid-write.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { captureJsonChange } from './journal.js'

export function loadJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch { /* use fallback */ }
  return fallback
}

export function saveJson(path: string, data: unknown): void {
  const existed = existsSync(path)
  let before: unknown = null
  if (existed) {
    try { before = JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { before = null }
  }
  captureJsonChange({ path, existed, before, after: data })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}
