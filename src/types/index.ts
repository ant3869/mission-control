export type NavSection = {
  label?: string
  items: NavItem[]
}

export type NavItem = {
  id: string
  label: string
  icon: string
  badge?: number
}

export type View =
  | 'tasks'       // Tasks + Approvals
  | 'watch'       // Watch + Agents
  | 'docs'        // Docs + Notes
  | 'projects'    // Projects + Pipeline
  | 'ops'         // Radar + System + ModelOps
  | 'workspace'   // People + Office + Factory
  | 'content'
  | 'council'
  | 'calendar'
  | 'memory'
  | 'inventory'
  | 'feedback'
  | 'settings'
  | 'openclaw'
  | 'hermes'
  | 'flowmap'
  | 'evaluations'
  | 'harness'      // Harness Benchmarks (OpenClaw/Hermes)
  | 'brain'        // Agent event brain / activity stream
  | 'flow'         // Agent run flow
  | 'alerts'       // Alert rules + active alerts
  | 'security'     // Security posture + diagnostics

export type TaskColor =
  | 'red'
  | 'orange'
  | 'amber'
  | 'blue'
  | 'indigo'
  | 'green'
  | 'teal'
  | 'purple'
  | 'violet'
  | 'slate'
  | 'rose'

export type ScheduledTask = {
  id: string
  name: string
  time: string
  timeMinutes: number // for sorting: hour * 60 + min
  color: TaskColor
  days: number[] // 0=Sun … 6=Sat; empty = all days
  agent?: string
}

export type Project = {
  id: string
  name: string
  description: string
  status: 'active' | 'planning' | 'paused' | 'completed'
  progress: number
  priority: 'high' | 'medium' | 'low'
  assignee: string
  updatedAt: string
}

// ─── Docs ──────────────────────────────────────────────────────────────────────

export type DocTag = 'Journal' | 'Newsletter' | 'Doc' | 'Notes' | 'Other'

export type Doc = {
  id: string
  filename: string
  tags: DocTag[]
  updatedAgo: string
  wordCount: number
  content: string // plain text / light markdown
}

// ─── Agents ────────────────────────────────────────────────────────────────────

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

export type Agent = {
  id: string
  name: string
  role: string
  model: string
  state: AgentState
  currentTask?: string
  taskStartedAgo?: string
  sessionCount: number
  tokensToday: number
  costToday: number  // USD
  machine: string
  uptime: string
  systemPromptExcerpt: string
  temperature: number
  maxTokens: number
}

// ─── System ────────────────────────────────────────────────────────────────────

export type SystemComponentType = 'mcp' | 'plugin' | 'skill' | 'extension' | 'command'
export type SystemStatus = 'healthy' | 'warning' | 'error' | 'offline'

// ─── Pipeline ──────────────────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type PipelineStage = {
  name: string
  status: StageStatus
  durationSec?: number
}

export type RunStatus = 'running' | 'queued' | 'completed' | 'failed'

// ─── Tasks ─────────────────────────────────────────────────────────────────────

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'
export type TaskStatus = 'active' | 'queued' | 'blocked' | 'completed'

export type Task = {
  id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  agentName?: string
  project?: string
  createdAgo: string
  dueDate?: string
  tags?: string[]
}

// ─── Approvals ─────────────────────────────────────────────────────────────────

export type ApprovalType   = 'publish' | 'send' | 'merge' | 'purchase' | 'action' | 'deploy'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

// ─── Office ────────────────────────────────────────────────────────────────────

export type IntegrationStatus = 'connected' | 'error' | 'disconnected' | 'pending'
export type IntegrationCategory = 'communication' | 'development' | 'storage' | 'analytics' | 'ai'

// ─── Inventory ─────────────────────────────────────────────────────────────────

export type InventoryStatus = 'in-stock' | 'low' | 'out-of-stock' | 'discontinued'
export type InventoryCategory = 'hardware' | 'software' | 'consumables' | 'documentation' | 'other'
export type InventoryCondition = 'new' | 'good' | 'fair' | 'poor' | 'broken'

export type InventoryItem = {
  id: string
  name: string
  sku: string
  category: InventoryCategory
  quantity: number
  minThreshold: number
  maxThreshold: number
  status: InventoryStatus
  condition?: InventoryCondition
  location?: string
  cost?: number
  supplier?: string
  lastRestockedAgo?: string
  notes?: string
  tags?: string[]
}

// ─── Flow Map (node-link traffic graph) ──────────────────────────────────────────

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
