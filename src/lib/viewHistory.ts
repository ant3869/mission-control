import type { View } from '../types'

export function pushView(history: View[], current: View, next: View): View[] {
  if (current === next) return history
  return [...history, current]
}

export function popView(history: View[]): { history: View[]; view: View | null } {
  const view = history[history.length - 1] ?? null
  if (!view) return { history: [], view: null }
  return { history: history.slice(0, -1), view }
}
