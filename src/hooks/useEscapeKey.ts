// title: useEscapeKey hook
// path: src/hooks/useEscapeKey.ts
// purpose: Close modals / drawers / panels on the Escape key — the standard
//          expectation for any overlay. Wire `useEscapeKey(onClose)` at the top
//          of an overlay component so Esc dismisses it, not just a backdrop click.

import { useEffect } from 'react'

export function useEscapeKey(onEscape: () => void, active = true): void {
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onEscape, active])
}
