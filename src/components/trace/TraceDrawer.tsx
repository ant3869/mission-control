// Slide-in overlay that fetches a run trace and renders the TraceViewer.
// Falls back to a deterministic mock trace if the backend is unavailable.

import { useEffect, useState } from 'react'
import { X, GitBranch, RefreshCw, AlertTriangle, Loader } from 'lucide-react'
import { pipeline } from '../../lib/api'
import { TraceViewer } from './TraceViewer'
import { buildMockTrace } from './mockTrace'
import type { TraceRun } from './types'

export interface TraceRunRef {
  id:      string
  name?:   string
  model?:  string
  status?: string
  source?: string
}

export function TraceDrawer({ runRef, onClose }: { runRef: TraceRunRef; onClose: () => void }) {
  const [run, setRun] = useState<TraceRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [mocked, setMocked] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true); setMocked(false); setRun(null)
    pipeline.trace(runRef.id, {
      name: runRef.name, model: runRef.model, status: runRef.status, source: runRef.source,
    })
      .then(r => { if (alive) setRun(r.run) })
      .catch(() => {
        if (!alive) return
        setRun(buildMockTrace({ id: runRef.id, name: runRef.name, model: runRef.model, source: runRef.source }))
        setMocked(true)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [runRef.id, runRef.name, runRef.model, runRef.status, runRef.source])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative flex flex-col h-full w-full max-w-[920px] bg-base border-l border-border shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <GitBranch size={15} className="text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">{runRef.name || 'Run trace'}</p>
              <p className="text-xxs text-text-muted truncate">{runRef.id}{mocked && ' · demo data'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-card-hover text-text-muted hover:text-text-primary transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {mocked && (
          <div className="flex items-center gap-2 mx-5 mt-3 px-3 py-2 rounded-lg border border-amber-900/40 bg-amber-950/20 text-amber-300 text-xxs shrink-0">
            <AlertTriangle size={12} className="shrink-0" />
            Showing demo trace — no live trace data wired for this run yet.
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-h-0 p-5">
          {loading ? (
            <div className="flex items-center justify-center h-full text-text-muted gap-2 text-sm">
              <Loader size={16} className="animate-spin" /> Loading trace…
            </div>
          ) : run ? (
            <TraceViewer run={run} className="h-full" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
              <RefreshCw size={20} className="opacity-40" />
              <p className="text-sm">No trace available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
