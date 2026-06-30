import type { View } from './types'

/**
 * Decides whether a given view should be mounted for the current active view.
 *
 * Today this is a strict match — only the active view renders, so each view's
 * polling/SSE subscriptions are torn down on navigation (see App.tsx ViewPane).
 * It stays a named seam (rather than an inline `active === candidate`) so a view
 * can opt into staying mounted/warm in the background — e.g. returning `true`
 * for a `candidate` that must keep a live connection open across navigation —
 * without touching App.tsx's render wiring.
 */
export function shouldRenderView(active: View, candidate: View): boolean {
  return active === candidate
}
