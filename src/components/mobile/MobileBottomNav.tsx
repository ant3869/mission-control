import { MoreHorizontal } from 'lucide-react'
import { clsx } from 'clsx'
import type { View } from '../../types'
import { BOTTOM_NAV, NAV_SECTIONS } from '../layout/navConfig'
import { useNavBadges } from '../../hooks/useNavBadges'

interface MobileBottomNavProps {
  activeView: View
  onNavigate: (view: View) => void
  onOpenMore: () => void
}

const bottomItems = BOTTOM_NAV.map((view) => {
  const item = NAV_SECTIONS.flatMap((section) => section.items).find((navItem) => navItem.id === view)
  if (!item) throw new Error(`Missing bottom nav item: ${view}`)
  return item
})

export function MobileBottomNav({ activeView, onNavigate, onOpenMore }: MobileBottomNavProps) {
  const { getBadge, healthWarning } = useNavBadges()
  const moreActive = !BOTTOM_NAV.includes(activeView)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop-blur md:hidden">
      <div className="grid grid-cols-5 gap-1">
        {bottomItems.map((item) => {
          const Icon = item.Icon
          const isActive = activeView === item.id
          const badge = getBadge(item.id)

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={clsx(
                'relative flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded px-1 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-text-primary'
                  : 'text-text-muted hover:bg-card hover:text-text-secondary',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={20} aria-hidden="true" />
              <span className="max-w-full truncate leading-none">{item.label}</span>
              {badge !== undefined && (
                <span className="absolute right-2 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-blue px-1 text-[10px] font-semibold leading-none text-white tabular-nums">
                  {badge}
                </span>
              )}
            </button>
          )
        })}
        <button
          type="button"
          onClick={onOpenMore}
          className={clsx(
            'relative flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-1 rounded px-1 text-[11px] font-medium transition-colors',
            moreActive
              ? 'text-text-primary'
              : 'text-text-muted hover:bg-card hover:text-text-secondary',
          )}
          aria-current={moreActive ? 'page' : undefined}
          aria-label="Open more navigation"
        >
          <MoreHorizontal size={21} aria-hidden="true" />
          <span className="max-w-full truncate leading-none">More</span>
          {healthWarning && (
            <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-accent-red" />
          )}
        </button>
      </div>
    </nav>
  )
}
