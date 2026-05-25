// Run-trace domain types — shared by the trace viewer and the API client.
// Kept deliberately transport-agnostic so real Hermes / OpenClaw trace
// ingestion can populate the same shape later without UI changes.

export type SpanStatus = 'success' | 'running' | 'failed' | 'skipped'

export type SpanKind =
  | 'run'      // the root run span
  | 'plan'     // planning / reasoning step
  | 'agent'    // a sub-agent or grouped execution step
  | 'model'    // an LLM completion call
  | 'tool'     // a tool / function call
  | 'memory'   // a memory / context lookup
  | 'message'  // an emitted user/assistant message

export interface SpanTokens {
  input:  number
  output: number
  total:  number
}

export interface TraceSpan {
  id:          string
  parentId:    string | null     // null = root
  name:        string
  kind:        SpanKind
  status:      SpanStatus
  startMs:     number            // offset from run start, ms
  durationMs:  number
  model?:      string
  tool?:       string
  tokens?:     SpanTokens
  cost?:       number            // USD
  attributes?: Record<string, unknown>  // expandable payload / details
}

export interface TraceRun {
  id:         string
  name:       string
  source?:    string             // claude | openclaw | hermes
  status:     SpanStatus
  startedAt:  string             // ISO
  durationMs: number
  totalTokens: number
  totalCost:  number
  models:     string[]
  spanCount:  number
  spans:      TraceSpan[]        // flat list incl. root; tree built from parentId
}
