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
  | 'tasks'
  | 'agents'
  | 'content'
  | 'approvals'
  | 'council'
  | 'calendar'
  | 'projects'
  | 'memory'
  | 'docs'
  | 'people'
  | 'office'
  | 'team'
  | 'system'
  | 'radar'
  | 'factory'
  | 'pipeline'
  | 'feedback'
  | 'notes'

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

export type SystemComponentType = 'mcp' | 'plugin' | 'skill' | 'extension'
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
