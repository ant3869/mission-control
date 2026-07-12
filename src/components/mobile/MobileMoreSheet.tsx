import { X } from 'lucide-react'
import { clsx } from 'clsx'
import type { View } from '../../types'
import { NAV_SECTIONS } from '../layout/navConfig'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useNavBadges } from '../../hooks/useNavBadges'

interface MobileMoreSheetProps {
  activeView: View
  onNavigate: (view: View) => void
  onClose: () => void
}

export function MobileMoreSheet({ activeView, onNavigate, onClose }: MobileMoreSheetProps) {
  const { getBadge } = useNavBadges()
  useEscapeKey(onClose)

  const selectView = (view: View) => {
    onNavigate(view)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] md:hidden" role="presentation">
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-black/60"
        aria-label="Close navigation"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="More navigation"
        className="absolute inset-x-0 bottom-0 flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden border-t border-border bg-base shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold text-text-primary">Mission Control</span>
            <span className="text-xxs font-mono text-text-muted">v{__APP_VERSION__}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded text-text-muted transition-colors hover:bg-card hover:text-text-primary"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {NAV_SECTIONS.map((section, sectionIndex) => (
            <div key={section.label} className={clsx('flex flex-col gap-1', sectionIndex > 0 && 'mt-4')}>
              <span className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {section.label}
              </span>
              {section.items.map((item) => {
                const Icon = item.Icon
                const isActive = activeView === item.id
                const badge = getBadge(item.id)

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectView(item.id)}
                    className={clsx(
                      'flex min-h-[48px] w-full items-center gap-3 rounded px-3 text-left transition-colors',
                      isActive
                        ? 'bg-card-hover text-text-primary'
                        : 'text-text-secondary hover:bg-card hover:text-text-primary',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={19} className={clsx('shrink-0', isActive ? 'text-text-primary' : 'text-text-muted')} />
                    <span className="flex-1 truncate text-sm font-medium">{item.label}</span>
                    {badge !== undefined && (
                      <span className={clsx(
                        'flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                        item.id === 'health'
                          ? 'bg-accent-red/20 text-accent-red'
                          : 'bg-accent-blue/20 text-accent-blue',
                      )}>
                        {badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </section>
    </div>
  )
}
