// title: useEscapeKey hook
// path: src/hooks/useEscapeKey.ts
// purpose: Close modals / drawers / panels on the Escape key — the standard
//          expectation for any overlay. Wire `useEscapeKey(onClose)` at the top
//          of an overlay component so Esc dismisses it, not just a backdrop click.

import { useEffect, useRef } from 'react'
import { registerOverlay } from '../lib/overlayStack'

export function useEscapeKey(onEscape: () => void, active = true): void {
  const onEscapeRef = useRef(onEscape)
  onEscapeRef.current = onEscape

  useEffect(() => {
    if (!active) return
    const close = () => onEscapeRef.current()
    const unregister = registerOverlay(close)
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      unregister()
      window.removeEventListener('keydown', handler)
    }
  }, [active])
}
