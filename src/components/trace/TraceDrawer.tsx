// Slide-in overlay that fetches a run trace and renders the TraceViewer.
// Missing traces stay missing: operational telemetry must never be invented.

import { useEffect, useState } from 'react'
import { X, GitBranch, RefreshCw, AlertTriangle, Loader } from 'lucide-react'
import { pipeline } from '../../lib/api'
import { TraceViewer } from './TraceViewer'
import { failedTraceState, initialTraceState, loadedTraceState } from './traceLoadState'

export interface TraceRunRef {
  id:      string
  name?:   string
  model?:  string
  status?: string
  source?: string
}

export function TraceDrawer({ runRef, onClose }: { runRef: TraceRunRef; onClose: () => void }) {
  const [state, setState] = useState(initialTraceState)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setState(initialTraceState())
    pipeline.trace(runRef.id, {
      name: runRef.name, model: runRef.model, status: runRef.status, source: runRef.source,
    })
      .then(r => { if (alive) setState(loadedTraceState(r.run)) })
      .catch(reason => { if (alive) setState(failedTraceState(reason)) })
    return () => { alive = false }
  }, [runRef.id, runRef.name, runRef.model, runRef.status, runRef.source, attempt])

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
              <p className="text-xxs text-text-muted truncate">{runRef.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-card-hover text-text-muted hover:text-text-primary transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 p-5">
          {state.loading ? (
            <div className="flex items-center justify-center h-full text-text-muted gap-2 text-sm">
              <Loader size={16} className="animate-spin" /> Loading trace…
            </div>
          ) : state.run ? (
            <TraceViewer run={state.run} className="h-full" />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2">
              <AlertTriangle size={20} className="text-amber-400" />
              <p className="text-sm text-text-secondary">Trace unavailable</p>
              <p className="max-w-md text-center text-xs">{state.error || 'The server returned no trace data.'}</p>
              <button onClick={() => setAttempt(value => value + 1)} className="mt-2 flex items-center gap-1.5 rounded border border-border bg-card px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
