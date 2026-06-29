import type { TraceRun } from './types'

export type TraceLoadState = { loading: boolean; run: TraceRun | null; error: string | null }

export const initialTraceState = (): TraceLoadState => ({ loading: true, run: null, error: null })
export const loadedTraceState = (run: TraceRun): TraceLoadState => ({ loading: false, run, error: null })
export const failedTraceState = (reason: unknown): TraceLoadState => ({
  loading: false,
  run: null,
  error: reason instanceof Error ? reason.message : String(reason),
})
