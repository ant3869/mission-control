// In-memory cache of the most recent spend figures, updated by the radar route.
// The alerts evaluator reads this to generate budget_exceeded synthetic alerts
// without re-parsing JSONL logs on every /api/alerts/active call.

interface SpendSnapshot {
  dailyCost:  number   // today's spend so far
  weeklyCost: number   // last 7 days
  dailyTokens:  number
  weeklyTokens: number
  updatedAt: string
}

let snapshot: SpendSnapshot | null = null

export function setSpendSnapshot(s: SpendSnapshot): void {
  snapshot = s
}

export function getSpendSnapshot(): SpendSnapshot | null {
  return snapshot
}
