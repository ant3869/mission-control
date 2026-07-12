import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import type { View } from '../../types'
import { useNavBadges } from '../../hooks/useNavBadges'
import { NAV_SECTIONS } from './navConfig'

interface SidebarProps {
  activeView: View
  onNavigate: (view: View) => void
}

const iconSize = 15

const sidebarSections = NAV_SECTIONS.filter((section) => section.label !== 'Settings')
const settingsItem = NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.id === 'settings')!
const SettingsIcon = settingsItem.Icon

export function Sidebar({ activeView, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const { getBadge } = useNavBadges()

  return (
    <aside
      className={clsx(
        'flex flex-col h-full border-r border-border bg-surface overflow-hidden transition-all duration-200',
        collapsed ? 'w-12 min-w-12' : 'w-[200px] min-w-[200px]',
      )}
    >
      {/* Logo + title + collapse toggle */}
      <div className="flex items-center h-14 border-b border-border shrink-0 px-2 gap-2">
        <img src="/icon.png" alt="Mission Control" className="w-9 h-9 rounded object-cover shrink-0 select-none" />
        {!collapsed && (
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold tracking-tight text-text-primary leading-tight truncate">Mission Control</span>
            <span className="text-xxs text-text-muted font-mono leading-tight">v{__APP_VERSION__}</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-secondary hover:bg-card transition-colors shrink-0 ml-auto"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col flex-1 py-1.5 gap-0.5 overflow-y-auto min-h-0 px-1.5">
        {sidebarSections.map((section, si) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            {/* Section divider/label */}
            {si > 0 && (
              collapsed
                ? <div className="my-1 mx-auto w-4 border-t border-border" />
                : <div className="mx-2 my-1 border-t border-border" />
            )}
            {!collapsed && (
              <span className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted select-none">
                {section.label}
              </span>
            )}

            {section.items.map((item) => {
              const isActive = activeView === item.id
              const badge    = getBadge(item.id)
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    'group relative flex items-center gap-2.5 w-full rounded text-left transition-all duration-100',
                    collapsed ? 'justify-center px-0 py-[7px]' : 'px-2.5 py-[5px]',
                    isActive
                      ? 'bg-card-hover text-text-primary'
                      : 'text-text-secondary hover:bg-card hover:text-text-primary',
                  )}
                >
                  <span className={clsx(
                    'shrink-0 transition-colors',
                    isActive ? 'text-text-primary' : 'text-text-muted group-hover:text-text-secondary',
                  )}>
                    <item.Icon size={iconSize} />
                  </span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-sm font-medium leading-none">{item.label}</span>
                      {badge !== undefined && (
                        <span className={clsx(
                          'flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-xxs font-semibold tabular-nums',
                          item.id === 'health'
                            ? 'bg-accent-red/20 text-accent-red'
                            : 'bg-accent-blue/20 text-accent-blue',
                        )}>
                          {badge}
                        </span>
                      )}
                      {isActive && (
                        <ChevronRight size={12} className="text-text-muted shrink-0" />
                      )}
                    </>
                  )}
                  {/* Dot indicator when collapsed + badge */}
                  {collapsed && badge !== undefined && (
                    <span className={clsx(
                      'absolute top-1 right-1 w-1.5 h-1.5 rounded-full',
                      item.id === 'health' ? 'bg-accent-red' : 'bg-accent-blue',
                    )} />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Settings — pinned at bottom, above user footer */}
      <div className="shrink-0 border-t border-border px-1.5 py-1.5">
        <button
          onClick={() => onNavigate('settings')}
          title={collapsed ? 'Settings' : undefined}
          className={clsx(
            'group flex items-center gap-2.5 w-full rounded text-left transition-all duration-100',
            collapsed ? 'justify-center px-0 py-[7px]' : 'px-2.5 py-[5px]',
            activeView === 'settings'
              ? 'bg-card-hover text-text-primary'
              : 'text-text-secondary hover:bg-card hover:text-text-primary',
          )}
        >
          <span className={clsx(
            'shrink-0 transition-colors',
            activeView === 'settings' ? 'text-text-primary' : 'text-text-muted group-hover:text-text-secondary',
          )}>
            <SettingsIcon size={iconSize} />
          </span>
          {!collapsed && (
            <span className="flex-1 text-sm font-medium leading-none">{settingsItem.label}</span>
          )}
        </button>
      </div>

    </aside>
  )
}


