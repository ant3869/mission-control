// title: usePersistedState hook
// path: src/hooks/usePersistedState.ts
// purpose: A useState that transparently persists to localStorage, so user UI
//          choices (filters, modes, selections) survive a reload. Same API as
//          useState; just pass a stable storage key.

import { useState, useEffect } from 'react'

export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); if (raw != null) return JSON.parse(raw) as T } catch { /* ignore */ }
    return initial
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
  }, [key, value])
  return [value, setValue]
}
