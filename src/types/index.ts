// All shared types that are too structural for api.ts (view routing, agent state,
// system health enums, flow-graph schema). Domain-specific API types live in api.ts.

export type View =
  | 'home'        // Landing overview — hero + at-a-glance summaries
  | 'todos'        // Combined To-Do + Tasks + Approvals + Inbox page
  | 'tobuy'        // Personal shopping list with research + running total
  | 'spend'        // Personal money command center (AI cost + things)
  | 'council'     // Chats
  | 'calendar'
  // ── Knowledge ──
  | 'docs'        // Docs + Notes
  | 'news'        // News — live RSS, GitHub trending, social buzz
  | 'memory'
  // ── Build (hardware → ideas → projects) ──
  | 'projects'    // Projects + Pipeline
  | 'inventory'   // Physical hardware inventory
  | 'factory'     // Idea factory (project ideas from inventory)
  // ── AI Ops (consolidated agent telemetry) ──
  | 'activity'     // Live + Sessions + Brain + Agents + Map
  | 'usage'        // Radar + ModelOps (cost / models)
  | 'harness'      // Harness Benchmarks (OpenClaw/Hermes)
  | 'evaluations'
  | 'health'       // System + Security + Alerts + OpenClaw + Hermes
  | 'settings'

export type AgentState =
  | 'thinking'
  | 'coding'
  | 'writing'
  | 'searching'
  | 'planning'
  | 'reading'
  | 'sleeping'
  | 'idle'
  | 'error'

export type SystemComponentType = 'mcp' | 'plugin' | 'skill' | 'extension' | 'command'
export type SystemStatus = 'healthy' | 'warning' | 'error' | 'offline'

// ─── Flow Map (node-link traffic graph) ──────────────────────────────────────

export type FlowNodeType =
  | 'channel'   // Discord, DMs, inbound surfaces
  | 'agent'     // Hermes / OpenClaw agents
  | 'runtime'   // execution runtimes
  | 'cron'      // scheduled / heartbeat jobs
  | 'tool'      // tool groups
  | 'memory'    // memory stores
  | 'external'  // external services / APIs

export type FlowEdgeKind = 'message' | 'invocation' | 'token' | 'handoff'

export type FlowNodeMetrics = {
  messages?:    number
  invocations?: number
  tokens?:      number
  sessions?:    number
}

export type FlowNode = {
  id:      string
  label:   string
  type:    FlowNodeType
  metrics: FlowNodeMetrics
  meta?:   Record<string, string | number>
}

export type FlowEdgeSample = {
  ts?:     string
  label:   string
  detail?: string
}

export type FlowEdgeMetrics = {
  messages?:    number
  invocations?: number
  tokens?:      number
  handoffs?:    number
}

export type FlowEdge = {
  id:      string
  source:  string  // FlowNode id
  target:  string  // FlowNode id
  kind:    FlowEdgeKind
  volume:  number   // primary weight → edge thickness
  metrics: FlowEdgeMetrics
  samples?: FlowEdgeSample[]
}

export type FlowRange = '1h' | '24h' | '7d' | 'all'

export type FlowGraph = {
  nodes:       FlowNode[]
  edges:       FlowEdge[]
  range:       FlowRange
  live:        boolean   // true if any real telemetry fed the graph
  generatedAt: string
  stats: {
    nodeCount:        number
    edgeCount:        number
    totalMessages:    number
    totalInvocations: number
    totalTokens:      number
  }
}
