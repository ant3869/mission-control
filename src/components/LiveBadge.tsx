// title: Live / Paused badge
// path: src/components/LiveBadge.tsx
// purpose: A tiny indicator for auto-refreshing views — a pulsing green "Live"
//          dot that flips to amber "Paused" when the global auto-refresh Pause
//          (top bar) is on. Makes silent auto-refresh discoverable and surfaces
//          the pause state consistently across the live views.

import { clsx } from 'clsx'
import { usePaused } from '../lib/refreshBus'

export function LiveBadge({ className }: { className?: string }) {
  const paused = usePaused()
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 text-xxs font-medium select-none', paused ? 'text-amber-400' : 'text-emerald-400', className)}
      title={paused ? 'Auto-refresh paused — resume with Pause in the top bar' : 'This view auto-refreshes'}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', paused ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse')} />
      {paused ? 'Paused' : 'Live'}
    </span>
  )
}
