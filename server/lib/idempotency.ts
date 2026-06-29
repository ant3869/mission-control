import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NextFunction, Request, Response } from 'express'

export class IdempotencyStore {
  private db: DatabaseSync
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`CREATE TABLE IF NOT EXISTS idempotency_keys (key TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (key, path))`)
  }
  get(key: string, path: string): { status: number; body: unknown } | null {
    const row = this.db.prepare('SELECT status, body FROM idempotency_keys WHERE key=? AND path=?').get(key, path) as unknown as { status: number; body: string } | undefined
    return row ? { status: Number(row.status), body: JSON.parse(row.body) as unknown } : null
  }
  put(key: string, path: string, status: number, body: unknown): void {
    this.db.prepare('INSERT OR IGNORE INTO idempotency_keys (key,path,status,body,created_at) VALUES (?,?,?,?,?)').run(key, path, status, JSON.stringify(body), new Date().toISOString())
  }
  close(): void { this.db.close() }
}

export function createIdempotencyMiddleware(store: IdempotencyStore) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST') return next()
    const key = req.header('Idempotency-Key')?.trim()
    if (!key) return next()
    if (key.length > 200) { res.status(400).json({ error: 'Idempotency-Key is too long' }); return }
    const cached = store.get(key, req.path)
    if (cached) { res.status(cached.status).json(cached.body); return }
    const sendJson = res.json.bind(res)
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 400) store.put(key, req.path, res.statusCode, body)
      return sendJson(body)
    }) as typeof res.json
    next()
  }
}

let defaultStore: IdempotencyStore | null = null
export function getIdempotencyStore(): IdempotencyStore {
  if (!defaultStore) defaultStore = new IdempotencyStore(join(process.cwd(), 'data', 'operations.db'))
  return defaultStore
}
