import { AlertTriangle, Loader2, Settings, Wifi } from 'lucide-react'
import { useServerConnection } from '../../contexts/ServerConnectionContext'

export function ConnectionBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { status, error, baseUrl, retry } = useServerConnection()
  if (status !== 'offline' && status !== 'degraded') return null

  const degraded = status === 'degraded'
  const Icon = degraded ? Wifi : AlertTriangle

  return (
    <div className={degraded
      ? 'border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-50'
      : 'border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-red-50'}
    >
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Icon size={17} className={degraded ? 'mt-0.5 shrink-0 text-amber-300' : 'mt-0.5 shrink-0 text-red-300'} />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{degraded ? 'Connection degraded' : 'Mission Control is offline'}</p>
            <p className="mt-0.5 break-words text-xs opacity-80">
              {error || 'Unable to reach the configured server.'}
              {baseUrl ? ` (${baseUrl})` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          <button
            type="button"
            onClick={() => void retry()}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-current/20 bg-black/20 px-3 text-xs font-semibold hover:bg-black/30"
          >
            <Loader2 size={14} />
            Retry
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-current/20 bg-black/20 px-3 text-xs font-semibold hover:bg-black/30"
          >
            <Settings size={14} />
            Server settings
          </button>
        </div>
      </div>
    </div>
  )
}
