import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface IncidentAlert { ruleId: string; ruleName: string; severity: string; message: string; firedAt: string }
export interface Incident {
  id: string; ruleId: string; title: string; severity: string; message: string
  status: 'open' | 'resolved'; firstSeenAt: string; lastSeenAt: string
  occurrences: number; resolvedAt: string | null
}

function fromRow(row: Record<string, unknown>): Incident {
  return {
    id: String(row.id), ruleId: String(row.rule_id), title: String(row.title), severity: String(row.severity), message: String(row.message),
    status: String(row.status) as Incident['status'], firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at),
    occurrences: Number(row.occurrences), resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  }
}

export class IncidentStore {
  private db: DatabaseSync
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, rule_id TEXT UNIQUE NOT NULL, title TEXT NOT NULL, severity TEXT NOT NULL,
      message TEXT NOT NULL, status TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 1, resolved_at TEXT
    )`)
  }

  sync(alerts: IncidentAlert[]): void {
    const active = new Set(alerts.map((alert) => alert.ruleId))
    for (const alert of alerts) {
      const existing = this.db.prepare('SELECT id FROM incidents WHERE rule_id = ?').get(alert.ruleId) as unknown as { id: string } | undefined
      if (existing) {
        this.db.prepare(`UPDATE incidents SET title=?, severity=?, message=?, status='open', last_seen_at=?, occurrences=occurrences+1, resolved_at=NULL WHERE id=?`)
          .run(alert.ruleName, alert.severity, alert.message, alert.firedAt, existing.id)
      } else {
        const id = createHash('sha256').update(alert.ruleId).digest('hex').slice(0, 20)
        this.db.prepare(`INSERT INTO incidents (id, rule_id, title, severity, message, status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
          .run(id, alert.ruleId, alert.ruleName, alert.severity, alert.message, alert.firedAt, alert.firedAt)
      }
    }
    const now = new Date().toISOString()
    const openRows = this.db.prepare(`SELECT id, rule_id FROM incidents WHERE status='open'`).all() as unknown as Array<{ id: string; rule_id: string }>
    for (const row of openRows) if (!active.has(row.rule_id)) this.db.prepare(`UPDATE incidents SET status='resolved', resolved_at=? WHERE id=?`).run(now, row.id)
  }

  list(): Incident[] {
    return (this.db.prepare(`SELECT * FROM incidents ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, last_seen_at DESC`).all() as unknown as Array<Record<string, unknown>>).map(fromRow)
  }

  get(id: string): Incident | null {
    const row = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as unknown as Record<string, unknown> | undefined
    return row ? fromRow(row) : null
  }

  resolve(id: string): boolean {
    return Number(this.db.prepare(`UPDATE incidents SET status='resolved', resolved_at=? WHERE id=?`).run(new Date().toISOString(), id).changes) > 0
  }

  close(): void { this.db.close() }
}

let defaultStore: IncidentStore | null = null
export function getIncidentStore(): IncidentStore {
  if (!defaultStore) defaultStore = new IncidentStore(join(process.cwd(), 'data', 'operations.db'))
  return defaultStore
}
