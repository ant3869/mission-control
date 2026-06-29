import type { View } from './types'

export function shouldRenderView(active: View, candidate: View): boolean {
  return active === candidate
}
