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

export type AlwaysRunningTask = {
  id: string
  name: string
  frequency: string
  color: TaskColor
}

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

// ─── Memory ────────────────────────────────────────────────────────────────────

export type MemoryBlock = {
  time: string
  title: string
  body: string // markdown-ish plain text
}

export type MemoryEntry = {
  id: string
  date: string        // ISO date "2026-02-26"
  displayDate: string // "2026-02-26 — Thursday"
  wordCount: number
  updatedAgo: string
  blocks: MemoryBlock[]
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

// ─── Chats ─────────────────────────────────────────────────────────────────────

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  tokens?: number
}

export type ChatSession = {
  id: string
  agentId: string
  agentName: string
  date: string
  displayDate: string
  duration: string
  messageCount: number
  firstMessage: string
  project?: string
  tokensUsed: number
  cost: number
  transcript: ChatMessage[]
}

// ─── System ────────────────────────────────────────────────────────────────────

export type SystemComponentType = 'mcp' | 'plugin' | 'skill' | 'extension' | 'command'
export type SystemStatus = 'healthy' | 'warning' | 'error' | 'offline'

export type SystemComponent = {
  id: string
  name: string
  type: SystemComponentType
  status: SystemStatus
  lastChecked: string
  version?: string
  latencyMs?: number
  error?: string
  description: string
}

// ─── Pipeline ──────────────────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type PipelineStage = {
  name: string
  status: StageStatus
  durationSec?: number
}

export type RunStatus = 'running' | 'queued' | 'completed' | 'failed'

export type ActiveRun = {
  id: string
  name: string
  agentName: string
  status: RunStatus
  startedAgo: string
  elapsedSec: number
  stages: PipelineStage[]
  project?: string
  tokensUsed?: number
}

export type CronJob = {
  id: string
  name: string
  schedule: string
  agentName: string
  lastRun: string
  nextRun: string
  enabled: boolean
  successRate: number
  totalRuns: number
}

export type RunHistoryItem = {
  id: string
  name: string
  agentName: string
  status: 'completed' | 'failed'
  duration: string
  completedAgo: string
  tokensUsed: number
}

// ─── Radar ─────────────────────────────────────────────────────────────────────

export type DailyUsage = {
  date: string   // "Mar 21"
  tokens: number
  cost: number
  runs: number
}

export type AgentUsageStat = {
  agentId: string
  agentName: string
  tokens: number
  cost: number
  runs: number
  avgContextPct: number
  color: string
}

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

// ─── Content ───────────────────────────────────────────────────────────────────

export type ContentChannel = 'youtube' | 'newsletter' | 'twitter' | 'linkedin'
export type ContentStatus  = 'draft' | 'scheduled' | 'published' | 'live'

export type ContentItem = {
  id: string
  title: string
  channel: ContentChannel
  status: ContentStatus
  agentName?: string
  project?: string
  scheduledFor?: string
  publishedAgo?: string
  wordCount?: number
  notes?: string
  tags?: string[]
}

// ─── Approvals ─────────────────────────────────────────────────────────────────

export type ApprovalType   = 'publish' | 'send' | 'merge' | 'purchase' | 'action' | 'deploy'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export type ApprovalItem = {
  id: string
  title: string
  description: string
  type: ApprovalType
  status: ApprovalStatus
  agentName: string
  project?: string
  createdAgo: string
  urgency: 'urgent' | 'normal' | 'low'
  payload: string
}

// ─── Factory ───────────────────────────────────────────────────────────────────

export type IdeaStatus = 'researching' | 'qualified' | 'building' | 'parked' | 'killed'

export type IdeaScores = {
  market:      number  // 1-10  (higher = bigger opportunity)
  competition: number  // 1-10  (lower = less competition = better)
  effort:      number  // 1-10  (lower = easier to build)
  viability:   number  // 1-10  (composite)
}

export type FactoryIdea = {
  id: string
  name: string
  tagline: string
  status: IdeaStatus
  scores: IdeaScores
  agentName?: string
  createdAgo: string
  researchSummary?: string
  tags?: string[]
}

// ─── People ────────────────────────────────────────────────────────────────────

export type PersonType = 'collaborator' | 'client' | 'contact' | 'vendor'

export type Person = {
  id: string
  name: string
  role: string
  company?: string
  type: PersonType
  email?: string
  phone?: string
  lastContact?: string
  tags?: string[]
  notes?: string
  initials: string
  avatarColor: string
  url?: string
}

// ─── Office ────────────────────────────────────────────────────────────────────

export type IntegrationStatus = 'connected' | 'error' | 'disconnected' | 'pending'
export type IntegrationCategory = 'communication' | 'development' | 'storage' | 'analytics' | 'ai'

export type Integration = {
  id: string
  name: string
  category: IntegrationCategory
  status: IntegrationStatus
  connectedAs?: string
  lastSync?: string
  error?: string
  icon: string
}

// ─── Feedback ──────────────────────────────────────────────────────────────────

export type FeedbackSentiment = 'positive' | 'neutral' | 'negative'
export type FeedbackSource   = 'email' | 'twitter' | 'direct' | 'form' | 'slack'
export type FeedbackStatus   = 'new' | 'reviewed' | 'archived' | 'actioned'

export type FeedbackItem = {
  id: string
  quote: string
  author?: string
  authorHandle?: string
  source: FeedbackSource
  sentiment: FeedbackSentiment
  status: FeedbackStatus
  receivedAgo: string
  rating?: number
  tags?: string[]
  project?: string
}

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

export type InventoryStat = {
  totalItems: number
  totalValue: number
  lowStockCount: number
  outOfStockCount: number
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
