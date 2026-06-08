// title: Global "pause auto-refresh" bus
// path: src/lib/refreshBus.ts
// purpose: A tiny app-wide toggle so the TopBar Pause button can freeze all
//          background polling at once. Views guard their refresh intervals with
//          isRefreshPaused(); components reflect state via usePaused().

import { useSyncExternalStore } from 'react'

let paused = false
const listeners = new Set<() => void>()

export function isRefreshPaused(): boolean { return paused }

export function setRefreshPaused(v: boolean): void {
  if (v === paused) return
  paused = v
  listeners.forEach(fn => fn())
}

export function toggleRefreshPaused(): void { setRefreshPaused(!paused) }

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** React hook — re-renders when the global pause state changes. */
export function usePaused(): boolean {
  return useSyncExternalStore(subscribe, isRefreshPaused, isRefreshPaused)
}
