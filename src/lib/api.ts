/**
 * Typed API client for the Mission Control Express backend.
 * All calls go through Vite's /api proxy → localhost:3001.
 */

import type { TraceRun } from '../components/trace/types'
export type { TraceRun, TraceSpan, SpanKind, SpanStatus } from '../components/trace/types'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }
  }
  const res  = await fetch(url.toString())
  const json = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText)
  return json as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res  = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText)
  return json as T
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res  = await fetch(`/api${path}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText)
  return json as T
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res  = await fetch(`/api${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText)
  return json as T
}

async function del<T>(path: string): Promise<T> {
  const res  = await fetch(`/api${path}`, { method: 'DELETE' })
  const json = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText)
  return json as T
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthStatus {
  google:    { clientConfigured: boolean; tokenConfigured: boolean }
  anthropic: { keyConfigured: boolean }
}

export const auth = {
  status: ()          => get<AuthStatus>('/auth/status'),
  googleAuthUrl: ()   => '/api/auth/google',
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id:            string
  name:          string
  description:   string
  location:      string
  htmlLink:      string
  status:        string
  allDay:        boolean
  startIso:      string | null
  endIso:        string | null
  timeDisplay:   string
  timeMinutes:   number
  dayOfWeek:     number | null
  organizer:     string
  attendees:     Array<{ email: string; displayName?: string; responseStatus: string; self: boolean }>
  calendarColor: string | null
  recurrence:    boolean
  meetLink:      string | null
}

export interface CalendarEventsResponse {
  events:    CalendarEvent[]
  fetchedAt: string
  days:      number
}

export const calendar = {
  events:    (days = 7)  => get<CalendarEventsResponse>('/calendar/events', { days }),
  calendars: ()          => get<{ calendars: any[] }>('/calendar/calendars'),
}

// ─── System ───────────────────────────────────────────────────────────────────

export interface SystemComponentLive {
  id:          string
  name:        string
  type:        'mcp' | 'plugin' | 'skill' | 'extension' | 'command'
  status:      'healthy' | 'warning' | 'error' | 'offline'
  latencyMs?:  number
  error?:      string
  description: string
  lastChecked: string
  version?:    string
  transport?:  'http' | 'stdio' | 'unknown'
}

export interface SystemHostInfo {
  hostname:    string
  platform:    string
  release:     string
  arch:        string
  nodeVersion: string
  cpuModel:    string
  cpuCount:    number
  loadAvg:     number
  totalMemMb:  number
  freeMemMb:   number
  usedMemPct:  number
  rssMb:       number
  heapUsedMb:  number
  uptimeSec:   number
}

export interface SystemResponse {
  components: SystemComponentLive[]
  host?:      SystemHostInfo
  fetchedAt:  string
  source:     string
}

export const system = {
  components: () => get<SystemResponse>('/system/components'),
}

// ─── Radar ────────────────────────────────────────────────────────────────────

export interface DailyUsageLive {
  date:    string
  dateIso: string
  tokens:  number
  cost:    number
  runs:    number
}

export interface RadarTokenBreakdown {
  input:      number
  output:     number
  cacheWrite: number
  cacheRead:  number
}

export interface RadarUsageResponse {
  days:           number
  startDate:      string
  endDate:        string
  totalTokens:    number
  totalCost:      number
  totalRuns:      number
  tokenBreakdown: RadarTokenBreakdown
  dailyUsage:     DailyUsageLive[]
  modelBreakdown: Array<{ model: string; tokens: number; cost: number; runs: number }>
  openclawStats?: Array<{ date: string; events: number; messages: number }>
  fetchedAt:      string
}

export interface HeatmapCell    { day: number; hour: number; count: number }

export interface InsightsTopSession {
  sessionId: string
  date:      string
  model:     string
  tokens:    number
  cost:      number
}

export interface InsightsToolAnomaly {
  sessionId:      string
  date:           string
  tool:           string
  maxConsecutive: number
  totalCalls:     number
  severity:       'high' | 'medium' | 'low'
}

export interface RadarInsightsResponse {
  days: number
  heatmap: {
    cells:       HeatmapCell[]
    maxCount:    number
    peakDay:     number
    peakHour:    number
    totalEvents: number
  }
  runRate: {
    avgDailyCost:         number
    projectedMonthlyCost: number
    projectedWeeklyCost:  number
    daysWithData:         number
    trendPct:             number
    topSessions:          InsightsTopSession[]
  }
  toolAnomalies: InsightsToolAnomaly[]
  fetchedAt:     string
}

export const radar = {
  usage:    (days = 7)  => get<RadarUsageResponse>('/radar/usage', { days }),
  insights: (days = 30) => get<RadarInsightsResponse>('/radar/insights', { days }),
}

// ─── Model Ops (operational model analytics) ────────────────────────────────────

export type ModelOpsSourceId = 'claude' | 'openclaw' | 'hermes' | 'mock' | string

export interface ModelOpsModelRow {
  source:       ModelOpsSourceId
  sourceLabel:  string
  model:        string
  modelLabel:   string
  provider:     string
  runs:         number
  tokens:       number
  inputTokens:  number
  outputTokens: number
  cacheTokens:  number
  cost:         number
  avgLatencyMs: number
  p95LatencyMs: number
  failures:     number
  failureRate:  number  // 0..1
  estimated:    boolean // true when latency was synthesized (no real samples)
}

export interface ModelOpsProviderRow {
  provider:     string
  runs:         number
  tokens:       number
  cost:         number
  avgLatencyMs: number
  failureRate:  number
}

export interface ModelOpsSourceRow {
  source:       ModelOpsSourceId
  label:        string
  reachable:    boolean
  error:        string | null
  models:       number
  runs:         number
  tokens:       number
  cost:         number
  avgLatencyMs: number
  failureRate:  number
  topModels:    Array<{ modelLabel: string; cost: number }>
}

export interface ModelOpsScatterPoint {
  id:           string
  source:       ModelOpsSourceId
  model:        string
  modelLabel:   string
  provider:     string
  cost:         number
  tokens:       number
  runs:         number
  avgLatencyMs: number
  failureRate:  number
  date:         string
}

export interface ModelOpsRun {
  id:           string
  source:       ModelOpsSourceId
  sourceLabel:  string
  model:        string
  modelLabel:   string
  provider:     string
  date:         string
  tokens:       number
  cost:         number
  avgLatencyMs: number
  failures:     number
  failureRate:  number
}

export interface ModelOpsTrendPoint {
  date:         string  // "Mar 21"
  dateIso:      string
  requests:     number
  cost:         number
  tokens:       number
  avgLatencyMs: number
  failures:     number
}

export interface ModelOpsSummary {
  totalSpend:    number
  avgLatencyMs:  number
  totalRequests: number
  failures:      number
  failureRate:   number
  modelCount:    number
  providerCount: number
  spendTrendPct: number
}

export type ModelOpsScope = 'all' | 'claude' | 'agents'

export interface ModelOpsResponse {
  scope:               ModelOpsScope
  days:                number
  startDate:           string
  endDate:             string
  source:              'jsonl' | 'mock' | 'mixed'
  estimatedDimensions: string[]
  summary:             ModelOpsSummary
  models:              ModelOpsModelRow[]
  providers:           ModelOpsProviderRow[]
  bySource:            ModelOpsSourceRow[]
  scatter:             ModelOpsScatterPoint[]
  trend:               ModelOpsTrendPoint[]
  expensiveRuns:       ModelOpsRun[]
  slowRuns:            ModelOpsRun[]
  fetchedAt:           string
}

export const modelOps = {
  summary: (days = 7, scope: ModelOpsScope = 'all') =>
    get<ModelOpsResponse>('/modelops/summary', { days, scope }),
}

// ─── Chats ────────────────────────────────────────────────────────────────────

export interface LiveChatMessage {
  role:      'user' | 'assistant'
  content:   string
  timestamp: string
  tokens?:   number
}

export interface LiveSession {
  id:           string
  projectSlug:  string
  title:        string
  firstMessage: string
  messages:     LiveChatMessage[]
  messageCount: number
  startedAt:    string
  lastActiveAt: string
  cwd:          string
  inputTokens:  number
  outputTokens: number
  isHeartbeat?: boolean
}

export interface ChatsListResponse {
  sessions:    LiveSession[]
  fetchedAt:   string
  projectsDir?: string
  error?:      string
}

export interface ChatSessionResponse {
  session:   LiveSession
  fetchedAt: string
}

export const chats = {
  sessions: (limit = 50) => get<ChatsListResponse>('/chats/sessions', { limit }),
  session:  (id: string) => get<ChatSessionResponse>(`/chats/sessions/${id}`),
}

export const openclawChats = {
  sessions: (limit = 50) => get<ChatsListResponse>('/openclaw/sessions', { limit }),
  session:  (id: string) => get<ChatSessionResponse>(`/openclaw/sessions/${encodeURIComponent(id)}`),
}

export const hermesChats = {
  sessions: (limit = 50) => get<ChatsListResponse>('/hermes/sessions', { limit }),
  session:  (id: string) => get<ChatSessionResponse>(`/hermes/sessions/${encodeURIComponent(id)}`),
}

// ─── Agent platform connectors (Settings) ──────────────────────────────────────

export type ConnectorId = 'openclaw' | 'hermes'
export type ConnectorStatus = 'connected' | 'error' | 'incomplete' | 'disabled'

export interface ConnectorInfo {
  id:              ConnectorId
  label:           string
  baseUrl:         string
  enabled:         boolean
  hasToken:        boolean
  tokenHint:       string
  // Hermes-only: separate OpenAI-compat API server (POST /v1/chat/completions).
  // The dashboard at baseUrl returns 405 for /v1, so chat must go here.
  apiBaseUrl?:     string
  hasApiToken?:    boolean
  apiTokenHint?:   string
  status:          ConnectorStatus
  reachable:       boolean
  version:         string | null
  gatewayStatus?:  string | null
  platforms?:      Array<{ name: string; status: string }>
  activeSessions:  number | null
  latencyMs:       number
  error:           string | null
}

export interface ConnectorsResponse {
  connectors: ConnectorInfo[]
  fetchedAt:  string
}

export interface ConnectorApiServerProbe {
  ok:         boolean
  baseUrl:    string
  hasToken:   boolean
  reachable:  boolean
  latencyMs:  number
  modelCount: number | null
  models:     string[]
  error:      string | null
  triedPaths: Array<{ path: string; status: number | null; ok: boolean; error?: string }>
}

export interface ConnectorTestResult {
  ok:             boolean
  reachable:      boolean
  version:        string | null
  gatewayStatus?: string | null
  platforms?:     Array<{ name: string; status: string }>
  activeSessions: number | null
  latencyMs:      number
  error:          string | null
  // Hermes only: independent probe of the OpenAI-compat API server.
  apiServer?:     ConnectorApiServerProbe
}

export type ConnectorUpdateBody = {
  baseUrl?: string; token?: string; enabled?: boolean
  apiBaseUrl?: string; apiToken?: string
}

export const settings = {
  connectors: ()                                          => get<ConnectorsResponse>('/settings/connectors'),
  update:     (id: ConnectorId, body: ConnectorUpdateBody) => put<{ connector: ConnectorInfo }>(`/settings/connectors/${id}`, body),
  test:       (id: ConnectorId)                            => post<ConnectorTestResult>(`/settings/connectors/${id}/test`, {}),
}

// ─── Agent cron jobs (OpenClaw / Hermes) ───────────────────────────────────────

export interface AgentCronJob {
  id:           string
  rawId:        string
  source:       ConnectorId
  name:         string
  schedule:     string
  cronExpr:     string
  prompt:       string
  deliver:      string
  enabled:      boolean
  nextRunAt:    string | null
  lastRunAt:    string | null
  nextRunLabel: string
  lastRunLabel: string
  runCount:     number
  successRate:  number
  origin:       'live' | 'derived'
  sample:       string
}

export interface AgentCronResponse {
  jobs:      AgentCronJob[]
  fetchedAt: string
}

export type CronAction = 'pause' | 'resume' | 'trigger'

export const agentCron = {
  openclaw: () => get<AgentCronResponse>('/openclaw/cron'),
  hermes:   () => get<AgentCronResponse>('/hermes/cron'),
  action:   (source: ConnectorId, jobId: string, action: CronAction) =>
              post<{ ok: boolean; error?: string }>(`/${source}/cron/${encodeURIComponent(jobId)}/${action}`, {}),
}

// ─── Platform metrics (OpenClaw / Hermes dashboards) ───────────────────────────

export interface MetricBreakdown { name: string; tokens: number; cost: number; count: number }
export interface MetricSessionRow { key: string; title: string; channel: string; model: string; kind: string; tokens: number; cost: number; updatedAt: string | null; startedAt: string | null; status: string; runtimeMs: number; isHeartbeat: boolean }
export interface MetricCronJob { id: string; name: string; agentId: string; enabled: boolean; schedule: string; delivery: string; lastRunAt: string | null; nextRunAt: string | null }
export interface MetricCronRun { ts: string; jobId: string; status: string; action: string; error: string | null }
export interface MetricChannel { id: string; label: string; enabled: boolean; configured: boolean; running: boolean; lastStartAt: string | null }
export interface MetricMemoryFile { name: string; size: number; updatedAt: string | null; missing: boolean; path?: string }
export interface MetricSubAgent { key: string; title: string; status: string; tokens: number; updatedAt: string | null }
export interface MetricAutonomyFactor { label: string; score: number; detail: string }
export interface MetricAutonomy { score: number; level: string; factors: MetricAutonomyFactor[] }

export interface PlatformMetrics {
  source:    ConnectorId
  reachable: boolean
  version:   string | null
  error:     string | null
  latencyMs: number
  fetchedAt: string
  tokens:    { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  cost:      { total: number; input: number; output: number; cacheRead: number; cacheWrite: number }
  daily:     Array<{ date: string; tokens: number; cost: number; input: number; output: number }>
  messages:  { total: number; user: number; assistant: number; toolCalls: number; errors: number } | null
  tools:     Array<{ name: string; count: number }>
  byModel:    MetricBreakdown[]
  byProvider: MetricBreakdown[]
  byAgent:    MetricBreakdown[]
  byChannel:  MetricBreakdown[]
  latency:   { count?: number; avgMs?: number; minMs?: number; maxMs?: number; p95Ms?: number } | null
  sessions:  { total: number }
  sessionList: MetricSessionRow[]
  channels:  MetricChannel[]
  cron:      { total: number; enabled: boolean; nextWakeAt: string | null; jobs: MetricCronJob[]; runs: MetricCronRun[]; runsTotal: number; failures: number; successRate: number }
  models:    Array<{ id: string; name: string; provider: string }>
  skills:    Array<{ name: string; description: string }>
  health:    { ok: boolean; eventLoop: any | null; memory: any | null; updateAvailable: boolean }
  heartbeat: Array<{ agentId: string; every: string; enabled: boolean }>
  memoryFiles: MetricMemoryFile[]
  subAgents: { total: number; recent: MetricSubAgent[] }
  autonomy:  MetricAutonomy
}

export interface PlatformMetricsResponse { metrics: PlatformMetrics; fetchedAt: string }

export const metrics = {
  openclaw: (force = false) => get<PlatformMetricsResponse>('/openclaw/metrics', force ? { force: 1 } : undefined),
  hermes:   (force = false) => get<PlatformMetricsResponse>('/hermes/metrics',   force ? { force: 1 } : undefined),
}

export const memoryFile = {
  read:  (source: ConnectorId, name: string) =>
    get<{ name: string; content: string; path: string }>(`/${source}/memory-file`, { name }),
  write: (source: ConnectorId, name: string, content: string) =>
    put<{ ok: boolean; path: string }>(`/${source}/memory-file?name=${encodeURIComponent(name)}`, { content }),
}

// ─── Inventory ─────────────────────────────────────────────────────────────────

export type InventoryCondition = 'working' | 'untested' | 'partial' | 'broken' | 'unknown'

export interface InventoryItem {
  id:             string
  name:           string
  category:       string
  quantity:       number
  location:       string
  condition:      string
  estimatedValue: number
  manufacturer:   string
  model:          string
  tags:           string[]
  notes:          string
  summary:        string
  specs:          Record<string, string>
  sources:        Array<{ title: string; url: string }>
  datasheetUrl:   string
  imageUrl:       string
  enriched:       boolean
  addedBy:        string
  status:         string   // available | in-use | reserved
  researchStatus: string
  researchError:  string
  researchRequestedAt: string
  createdAt:      string
  updatedAt:      string
  totalValue:     number
  updatedAgo:     string
}

export interface InventoryStats {
  totalItems:       number
  totalQuantity:    number
  totalValue:       number
  enrichedCount:    number
  operationalCount: number
  byCategory:       Array<{ category: string; count: number; quantity: number; value: number }>
  byCondition:      Record<string, number>
  locations:        string[]
}

export interface InventoryResponse {
  items:      InventoryItem[]
  stats:      InventoryStats
  categories: string[]
  conditions: string[]
  statuses:   string[]
  fetchedAt:  string
}

export type InventoryBody = Partial<Omit<InventoryItem, 'id' | 'totalValue' | 'updatedAgo' | 'createdAt' | 'updatedAt'>> & { name: string }

export const inventory = {
  list:      ()                              => get<InventoryResponse>('/inventory'),
  get:       (id: string)                    => get<{ item: InventoryItem }>(`/inventory/${id}`),
  create:    (body: InventoryBody)           => post<{ item: InventoryItem }>('/inventory', body),
  update:    (id: string, body: Partial<InventoryBody>) => patch<{ item: InventoryItem }>(`/inventory/${id}`, body),
  remove:    (id: string)                    => del<{ ok: boolean }>(`/inventory/${id}`),
  setStatus: (id: string, status: 'available' | 'in-use' | 'reserved') => patch<{ item: InventoryItem }>(`/inventory/${id}/status`, { status }),
  research:  (id: string, source?: 'openclaw' | 'hermes') => post<{ ok: boolean; status: string; source: string }>(`/inventory/${id}/research`, source ? { source } : {}),
  researchAll: () => post<{ queued: number; openclaw: number; hermes: number; skipped: number }>('/inventory/research-all', {}),
}

// ─── Inventory Project Ideas ───────────────────────────────────────────────────

export type ProjectIdeaStatus = 'new' | 'liked' | 'rejected' | 'snoozed' | 'completed'

export interface InfluenceMetadata {
  inventoryFactors: string[];
  matchedCategories: string[];
  priorLikedInfluence: string[];
  priorRejectedInfluence: string[];
  rejectionNotes: string[];
  preferenceSignals: string[];
  contextualFactors: string[];
}

export interface ProjectIdea {
  id:              string
  title:           string
  description:     string
  whyFit:          string
  haveParts:       string[]
  missingParts:    string[]
  difficulty:      string    // easy | medium | hard | expert
  timeEstimate:    string
  costEstimate:    string
  confidence:      number    // 0-100
  coolness:        number    // 0-100
  requiredTools:   string[]
  relatedItemIds:  string[]
  nextStep:        string
  category:        string
  status:          ProjectIdeaStatus
  rejectionReason: string
  generationRunId: string
  createdAt:       string
  updatedAt:       string
}

export interface ProjectGenRun {
  id:          string
  status:      'pending' | 'done' | 'failed'
  source:      string
  itemCount:   number
  newIdeas:    number
  error:       string
  startedAt:   string
  completedAt: string
}

export interface ProjectIdeasResponse {
  ideas:      ProjectIdea[]
  run:        ProjectGenRun | null
  fetchedAt:  string
}

export const projectIdeas = {
  list:     (status?: ProjectIdeaStatus) =>
    get<ProjectIdeasResponse>('/inventory/project-ideas', status ? { status } : undefined),
  genStatus: () =>
    get<{ run: ProjectGenRun | null; fetchedAt: string }>('/inventory/project-ideas/gen-status'),
  generate: (source?: 'openclaw' | 'hermes') =>
    post<{ ok: boolean; run: ProjectGenRun }>('/inventory/project-ideas/generate', source ? { source } : {}),
  update:   (id: string, body: { status?: ProjectIdeaStatus; rejectionReason?: string }) =>
    patch<{ idea: ProjectIdea }>(`/inventory/project-ideas/${id}`, body),
  remove:   (id: string) =>
    del<{ ok: boolean }>(`/inventory/project-ideas/${id}`),
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export type MemoryEntryType = 'user' | 'feedback' | 'project' | 'reference' | 'other'

export interface LiveMemoryEntry {
  id:          string
  filename:    string
  name:        string
  description: string
  type:        MemoryEntryType
  content:     string
  wordCount:   number
  updatedAt:   number
  updatedAgo:  string
  source?:     'openclaw' | 'hermes'
}

export interface MemoryEntriesResponse {
  entries:   LiveMemoryEntry[]
  dir?:      string
  fetchedAt: string
  error?:    string
}

export const memory = {
  entries: () => get<MemoryEntriesResponse>('/memory/entries'),
  index:   () => get<{ content: string | null; fetchedAt: string }>('/memory/index'),
}

// ─── Docs ─────────────────────────────────────────────────────────────────────

export interface LiveDocFile {
  id:         string
  filename:   string
  path:       string
  ext:        string
  tags:       string[]
  wordCount:  number
  updatedAt:  number
  updatedAgo: string
  preview:    string
  content?:   string
}

export interface DocsListResponse {
  files:     LiveDocFile[]
  workspace?: string
  fetchedAt: string
  error?:    string
}

export const docs = {
  files: ()           => get<DocsListResponse>('/docs/files'),
  file:  (id: string) => get<{ file: LiveDocFile; fetchedAt: string }>(`/docs/files/${id}`),
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export type AgentState =
  | 'thinking' | 'coding' | 'writing' | 'searching'
  | 'planning'  | 'reading' | 'sleeping' | 'idle' | 'error'

export interface LiveAgent {
  id:            string
  name:          string
  cwd:           string
  state:         AgentState
  currentTask:   string
  lastTool:      string | null
  lastToolInput: string
  model:         string
  systemPrompt:  string
  sessionCount:  number
  inputTokens:   number
  outputTokens:  number
  totalTokens:   number
  cost:          number
  lastActiveAt:  string
  lastActiveAgo: string
  startedAt:     string
  source?:       'claude' | 'openclaw' | 'hermes'
  cronRuns?:     number
}

export interface AgentsResponse {
  agents:       LiveAgent[]
  fetchedAt:    string
  projectsDir?: string
  error?:       string
}

export const agents = {
  projects: () => get<AgentsResponse>('/agents/projects'),
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export type StageStatus = 'completed' | 'running' | 'failed' | 'pending' | 'skipped'
export type RunStatus   = 'running'   | 'queued'  | 'completed' | 'failed'
export type SegmentKind = 'queue' | 'stage' | 'retry' | 'wait' | 'failed'

export interface PipelineSegment {
  kind:        SegmentKind
  label:       string
  startMs:     number
  durationMs:  number
  status?:     StageStatus
  stageName?:  string
  attempt?:    number
}

export interface PipelineStage {
  name:         string
  status:       StageStatus
  durationSec?: number
  toolCount?:   number
}

export interface PipelineRun {
  id:           string
  name:         string
  projectSlug:  string
  status:       RunStatus
  stages:       PipelineStage[]
  elapsedSec:   number
  inputTokens:  number
  outputTokens: number
  totalTokens:  number
  startedAt:    string
  lastActiveAt: string
  elapsedLabel: string
  completedAgo?: string
  model:        string
  cwd:          string
  // Execution-timeline (Gantt) fields
  queuedAt:     string
  completedAt:  string | null
  queueMs:      number
  waitMs:       number
  retries:      number
  totalMs:      number
  timeline:     PipelineSegment[]
}

export interface ScheduledTask {
  taskId:       string
  description:  string
  schedule:     string
  cronExpr:     string
  enabled:      boolean
  nextRunAt:    string | null
  lastRunAt:    string | null
  nextRunLabel: string
  lastRunLabel: string
}

export interface PipelineRunsResponse {
  active:    PipelineRun[]
  history:   PipelineRun[]
  fetchedAt: string
  error?:    string
}

export interface PipelineScheduledResponse {
  tasks:     ScheduledTask[]
  fetchedAt: string
}

export interface TraceResponse { run: TraceRun; fetchedAt: string }

export const pipeline = {
  runs:      () => get<PipelineRunsResponse>('/pipeline/runs'),
  scheduled: () => get<PipelineScheduledResponse>('/pipeline/scheduled'),
  trace:     (id: string, opts?: { name?: string; model?: string; status?: string; source?: string }) =>
               get<TraceResponse>(`/pipeline/runs/${encodeURIComponent(id)}/trace`, opts as Record<string, string> | undefined),
}

// ─── Office ───────────────────────────────────────────────────────────────────

export type IntegrationStatus   = 'connected' | 'error' | 'disconnected' | 'pending'
export type IntegrationCategory = 'auth' | 'plugin' | 'productivity' | 'communication' | 'development' | 'ai' | 'analytics' | 'storage'

export interface LiveIntegration {
  id:           string
  name:         string
  description:  string
  category:     IntegrationCategory
  status:       IntegrationStatus
  icon:         string
  connectedAs?: string
  error?:       string
  lastSync?:    string
  version?:     string
  detail?:      string
  source:       'auth' | 'plugin' | 'mcp' | 'system'
  url?:         string
}

export interface OfficeResponse {
  integrations: LiveIntegration[]
  fetchedAt:    string
  error?:       string
}

export const office = {
  integrations: () => get<OfficeResponse>('/office/integrations'),
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'
export type TaskStatus   = 'active' | 'queued' | 'blocked' | 'completed'

export interface LiveTask {
  id:           string
  title:        string
  description?: string
  status:       TaskStatus
  priority:     TaskPriority
  agentName?:   string
  project?:     string
  createdAgo:   string
  createdAt:    string
  dueDate?:     string
  dueDateIso?:  string
  tags?:        string[]
  completedAt?: string
}

export interface TasksResponse {
  tasks:     LiveTask[]
  fetchedAt: string
  error?:    string
}

export type TaskCreateBody = {
  title:        string
  description?: string
  priority?:    TaskPriority
  status?:      TaskStatus
  agentName?:   string
  project?:     string
  dueDate?:     string
  tags?:        string[]
}

export type TaskPatchBody = Partial<Omit<TaskCreateBody, 'title'> & { title: string; status: TaskStatus }>

export const tasks = {
  list:   ()                           => get<TasksResponse>('/tasks'),
  create: (body: TaskCreateBody)       => post<{ task: LiveTask }>('/tasks', body),
  update: (id: string, body: TaskPatchBody) => patch<{ task: LiveTask }>(`/tasks/${id}`, body),
  remove: (id: string)                 => del<{ ok: boolean }>(`/tasks/${id}`),
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export type ProjectStatus   = 'active' | 'planning' | 'paused' | 'completed'
export type ProjectPriority = 'high' | 'medium' | 'low'

export interface LiveProject {
  id:           string
  name:         string
  description:  string
  status:       ProjectStatus
  priority:     ProjectPriority
  progress:     number
  assignee:     string
  tags:         string[]
  sessionCount: number
  totalTokens:  number
  cwd:          string
  model:        string
  updatedAgo:   string
  updatedAt:    string
  createdAt:    string
  source:       'discovered' | 'manual'
}

export interface ProjectsResponse {
  projects:  LiveProject[]
  fetchedAt: string
  error?:    string
}

export type ProjectCreateBody = {
  name:         string
  description?: string
  status?:      ProjectStatus
  priority?:    ProjectPriority
  progress?:    number
  assignee?:    string
  tags?:        string[]
  cwd?:         string
}

export type ProjectPatchBody = Partial<ProjectCreateBody & { status: ProjectStatus }>

export const projects = {
  list:   ()                                  => get<ProjectsResponse>('/projects'),
  create: (body: ProjectCreateBody)           => post<{ project: LiveProject }>('/projects', body),
  update: (id: string, body: ProjectPatchBody) => patch<{ project: LiveProject }>(`/projects/${id}`, body),
  remove: (id: string)                        => del<{ ok: boolean }>(`/projects/${id}`),
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export type ApprovalType    = 'publish' | 'send' | 'merge' | 'purchase' | 'action' | 'deploy'
export type ApprovalUrgency = 'urgent' | 'normal' | 'low'
export type ApprovalStatus  = 'pending' | 'approved' | 'rejected'

export interface LiveApproval {
  id:          string
  type:        ApprovalType
  urgency:     ApprovalUrgency
  status:      ApprovalStatus
  title:       string
  description: string
  payload:     string
  agentName:   string
  project?:    string
  resolvedBy?: string
  resolvedAt?: string
  note?:       string
  createdAt:   string
  createdAgo:  string
  updatedAt:   string
}

export interface ApprovalsResponse {
  approvals: LiveApproval[]
  pending:   number
  resolved:  number
  fetchedAt: string
}

export type ApprovalCreateBody = {
  type?:        ApprovalType
  urgency?:     ApprovalUrgency
  title:        string
  description?: string
  payload?:     string
  agentName?:   string
  project?:     string
  note?:        string
}

export const approvals = {
  list:    ()                                     => get<ApprovalsResponse>('/approvals'),
  create:  (body: ApprovalCreateBody)             => post<{ approval: LiveApproval }>('/approvals', body),
  update:  (id: string, body: Partial<LiveApproval>) => patch<{ approval: LiveApproval }>(`/approvals/${id}`, body),
  approve: (id: string, note?: string)            => post<{ approval: LiveApproval }>(`/approvals/${id}/approve`, { note }),
  reject:  (id: string, note?: string)            => post<{ approval: LiveApproval }>(`/approvals/${id}/reject`, { note }),
  remove:  (id: string)                           => del<{ ok: boolean }>(`/approvals/${id}`),
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export interface NoteNotebook {
  id:           string
  name:         string
  color:        string
  icon:         string
  createdAt:    string
  updatedAt:    string
  sectionCount?: number
  pageCount?:   number
}

export interface NoteSection {
  id:         string
  notebookId: string
  name:       string
  color:      string
  createdAt:  string
  updatedAt:  string
  pageCount?: number
}

export interface NotePage {
  id:         string
  sectionId:  string
  notebookId: string
  title:      string
  content?:   string   // omitted in list endpoint, present in detail
  tags:       string[]
  pinned:     boolean
  wordCount:  number
  createdAt:  string
  updatedAt:  string
  updatedAgo: string
}

export interface NotebooksResponse { notebooks: NoteNotebook[]; fetchedAt: string }
export interface SectionsResponse  { sections:  NoteSection[];  fetchedAt: string }
export interface PagesResponse     { pages: NotePage[]; total: number; fetchedAt: string }
export interface PageResponse      { page: NotePage; fetchedAt: string }

export const notes = {
  // Notebooks
  listNotebooks:   ()                                              => get<NotebooksResponse>('/notes/notebooks'),
  createNotebook:  (body: Pick<NoteNotebook, 'name' | 'color' | 'icon'>) => post<{ notebook: NoteNotebook }>('/notes/notebooks', body),
  updateNotebook:  (id: string, body: Partial<NoteNotebook>)      => patch<{ notebook: NoteNotebook }>(`/notes/notebooks/${id}`, body),
  deleteNotebook:  (id: string)                                   => del<{ ok: boolean }>(`/notes/notebooks/${id}`),

  // Sections
  listSections:    (notebookId?: string)                          => get<SectionsResponse>('/notes/sections', notebookId ? { notebookId } : undefined),
  createSection:   (body: Pick<NoteSection, 'notebookId' | 'name' | 'color'>) => post<{ section: NoteSection }>('/notes/sections', body),
  updateSection:   (id: string, body: Partial<NoteSection>)      => patch<{ section: NoteSection }>(`/notes/sections/${id}`, body),
  deleteSection:   (id: string)                                   => del<{ ok: boolean }>(`/notes/sections/${id}`),

  // Pages
  listPages:       (params?: { sectionId?: string; notebookId?: string; search?: string; pinned?: boolean }) =>
                     get<PagesResponse>('/notes/pages', params as any),
  getPage:         (id: string)                                   => get<PageResponse>(`/notes/pages/${id}`),
  createPage:      (body: Pick<NotePage, 'sectionId' | 'notebookId' | 'title'> & { content?: string; tags?: string[]; pinned?: boolean }) =>
                     post<PageResponse>('/notes/pages', body),
  updatePage:      (id: string, body: Partial<Pick<NotePage, 'title' | 'content' | 'tags' | 'pinned'>>) =>
                     patch<PageResponse>(`/notes/pages/${id}`, body),
  deletePage:      (id: string)                                   => del<{ ok: boolean }>(`/notes/pages/${id}`),
}

// ─── Watch / live activity stream ────────────────────────────────────────────

export type WatchSource = 'openclaw' | 'hermes' | 'claude'

export interface WatchEventMeta {
  tool?:      string
  toolInput?: string
  channel?:   string
  direction?: 'in' | 'out'
}

export interface WatchEvent {
  seq:        number
  ts:         string
  event:      string
  kind:       'message' | 'tool' | 'cron' | 'error' | 'health' | 'session' | 'system'
  title:      string
  sub:        string
  sessionKey?: string
  health?:    any
  meta?:      WatchEventMeta
  source:     WatchSource
}

// EventSource URL (not a fetch — opened with `new EventSource(...)`)
export const WATCH_STREAM_URL = '/api/watch/stream'

// ─── Evaluations (Hermes + OpenClaw only) ──────────────────────────────────────

export type EvalPlatform = 'hermes' | 'openclaw'
export type RunOutcome   = 'success' | 'recovered' | 'partial' | 'stalled' | 'failure' | 'unresolved'

export interface EvaluationRun {
  id:              string
  platform:        EvalPlatform
  agent:           string
  model:           string
  modelLabel:      string
  startedAt:       string | null
  lastActiveAt:    string | null
  durationMs:      number
  tokens:          number
  cost:            number
  outcome:         RunOutcome
  hadError:        boolean
  recovered:       boolean
  toolCalls:       number
  repeatedToolCalls: number
  oscillations:    number
  noProgressTools: number
  wastedToolCalls: number
  toolSequence:    string[]
  transcriptAvailable: boolean
  heuristic:       true
}

export interface EvalSubScore { key: string; label: string; value: number | null; weight: number; detail: string }

export interface ModelScorecard {
  platform:       EvalPlatform
  model:          string
  modelLabel:     string
  runCount:       number
  evaluatedCount: number
  outcomes:       Record<RunOutcome, number>
  successRate:    number | null
  failureRate:    number | null
  partialRate:    number | null
  stalledRate:    number | null
  repeatRate:     number | null
  loopRuns:       number
  toolCalls:      number
  wastedToolCalls: number
  wasteRate:      number | null
  avgToolsPerSuccess: number | null
  avgToolsPerFailure: number | null
  recoveryRate:   number | null
  avgDurationMs:  number
  avgTokens:      number
  avgCost:        number
  historicalScore: number | null
  benchmarkScore:  number | null
  benchmarkRuns:   number
  manualScore:     number | null
  manualScores:    number
  consistencyScore: number | null
  confidence:     number
  previousOverall: number | null
  overall:        number
  subScores:      EvalSubScore[]
}

export interface AgentModelCell {
  agent: string; model: string; modelLabel: string
  runCount: number; evaluatedCount: number
  successRate: number | null; wasteRate: number | null; recoveryRate: number | null; overall: number | null
}

export interface EvalTrendPoint {
  date: string; runs: number; evaluated: number
  successRate: number | null; wasteRate: number | null
}

export interface EvalFactor { key: string; label: string; value: number | null }

export interface PlatformEvalOverview {
  platform:   EvalPlatform
  reachable:  boolean
  error:      string | null
  fetchedAt:  string
  summary: {
    runCount: number; evaluatedCount: number; modelCount: number; agentCount: number
    successRate: number | null; failureRate: number | null; wasteRate: number | null
    recoveryRate: number | null; topModel: string | null; topModelScore: number | null
  }
  leaderboard:    ModelScorecard[]
  agentModelMatrix: { agents: string[]; models: string[]; cells: AgentModelCell[] }
  trend:          EvalTrendPoint[]
  factorBreakdown: EvalFactor[]
  representativeFailures: EvaluationRun[]
  loopRuns:       EvaluationRun[]
  wastefulRuns:   EvaluationRun[]
  recentRuns:     EvaluationRun[]
}

export interface BenchmarkTask {
  id: string; platform: EvalPlatform; agent: string
  title: string; prompt: string; rubric: string
  expectedTools: string[]; notes: string
  builtIn: boolean; builtInSlug: string
  createdAt: string; updatedAt: string
}

export interface BenchmarkRun {
  id: string; taskId: string; platform: EvalPlatform; agent: string; model: string
  status: string; outcome: string
  toolCalls: number; wastedToolCalls: number; retries: number
  durationMs: number; tokens: number; cost: number
  rubricScore: number | null; notes: string
  // Inspectable detail captured on every completed run.
  answer: string
  toolSequence: string[]
  repeatedToolCalls: number
  oscillations: number
  noProgressTools: number
  ts: string
}

export interface ManualScoreRecord {
  id: string; platform: EvalPlatform; agent: string; model: string; runId: string
  score: number; rubric: Record<string, number>; notes: string; scoredBy: string; ts: string
}

export interface ModelSnapshot {
  id: string; platform: EvalPlatform; model: string; windowDays: number
  overall: number; subScores: Record<string, number | null>
  runCount: number; evaluatedCount: number; ts: string
}

export interface EvalModelsResponse {
  models: ModelScorecard[]
  platforms: Array<{ platform: EvalPlatform; reachable: boolean; error: string | null; modelCount: number }>
  fetchedAt: string
}

export interface EvalAgentRow {
  platform: EvalPlatform; agent: string
  runCount: number; evaluatedCount: number
  successRate: number | null; modelCount: number; topModel: string | null
}

export interface AgentModelMatrixResponse {
  matrices: Array<{ platform: EvalPlatform; reachable: boolean; error: string | null; agents: string[]; models: string[]; cells: AgentModelCell[] }>
  fetchedAt: string
}

export interface EvalModelDrilldown {
  model: string; modelLabel: string
  results: Array<{
    platform: EvalPlatform; reachable: boolean; error: string | null
    scorecard?: ModelScorecard; runs?: EvaluationRun[]; benchmarkRuns?: BenchmarkRun[]
    manualScores?: ManualScoreRecord[]; snapshots?: ModelSnapshot[]
  }>
  fetchedAt: string
}

export interface EvalAgentDrilldown {
  agent: string
  results: Array<{
    platform: EvalPlatform; reachable: boolean; error: string | null
    agent?: string; scorecards?: ModelScorecard[]; runs?: EvaluationRun[]
  }>
  fetchedAt: string
}

export interface ScoringMethodology {
  overview: string
  outcomes: Array<{ key: string; label: string; detail: string; score: number | null }>
  subScores: Array<{ key: string; label: string; weight: number }>
  weights: Record<string, number>
  composition: string[]
  config: Record<string, any>
  // Built-in benchmark slugs that have a deterministic auto-grader registered.
  // The UI uses this to render an "auto-graded" pill on those tasks so users
  // can tell which tasks produce a real rubricScore on dispatch vs which need
  // a manual rubric pass.
  autoGradedBuiltinSlugs?: string[]
  fetchedAt: string
}

export type BenchmarkTaskBody = {
  platform: EvalPlatform; agent?: string; title: string; prompt: string
  rubric?: string; expectedTools?: string[]; notes?: string
}

export type BenchmarkRunBody = { taskId: string; platform?: EvalPlatform; agent?: string; model?: string }

export type ManualScoreBody = {
  platform: EvalPlatform; agent?: string; model: string; runId?: string
  score: number; rubric?: Record<string, number>; notes?: string; scoredBy?: string
}

// ─── Memory benchmarks (subset of Evaluations) ─────────────────────────────────

export type MemoryKind = 'recall' | 'multihop' | 'temporal' | 'conflict' | 'applied' | 'negative'
export type MemoryProviderType = 'workspace-files' | 'session-history' | 'vector-db' | 'mem0' | 'wiki' | 'obsidian' | 'other'

export interface MemoryProviderInfo {
  name:       string
  label:      string
  type:       MemoryProviderType
  platform:   EvalPlatform
  baseline:   boolean
  configured: boolean
  itemCount:  number | null
  notes:      string
}

export interface MemoryHit {
  provider: string
  source:   string
  score:    number
  ts:       string | null
  excerpt:  string
  matchedFacts: string[]
}

export interface MemoryBenchmarkTask {
  id:             string
  platform:       EvalPlatform
  agent:          string
  title:          string
  kind:           MemoryKind
  query:          string
  expectedFacts:  string[]
  forbiddenFacts: string[]
  providers:      string[]
  newerHints:     string[]
  rubric:         string
  notes:          string
  builtIn:        boolean
  builtInSlug:    string
  createdAt:      string
  updatedAt:      string
}

export interface MemoryBenchmarkRun {
  id:             string
  taskId:         string
  platform:       EvalPlatform
  agent:          string
  model:          string
  status:         string
  providersUsed:  string[]
  hits:           MemoryHit[]
  expectedFound:  number
  expectedTotal:  number
  forbiddenFound: number
  irrelevantHits: number
  agentAnswer:    string | null
  answerHasExpected: number
  answerHasForbidden: number
  retrievalAccuracy:  number | null
  usageAccuracy:      number | null
  freshnessScore:     number | null
  conflictResolution: number | null
  falseRecallPenalty: number
  latencyScore:       number | null
  coverageScore:      number | null
  composite:          number
  latencyMs:          number
  notes:              string
  // Negative-control telemetry — surfaced so the UI can show whether a
  // negative-kind run was scored as a correct refusal (denial detected) vs a
  // fabrication, and the human-readable scoring decision.
  denialDetected:     boolean
  scoringNote:        string
  ts:                 string
}

export interface MemoryScorecard {
  scope:     string
  label:     string
  runCount:  number
  composite: number
  subScores: Record<string, number | null>
  falseRecallPenalty: number
  confidence: number
  consistency: number | null
  trend:      Array<{ ts: string; composite: number }>
}

export interface ProviderComparison {
  provider:   string
  type:       MemoryProviderType
  baseline:   boolean
  runs:       number
  retrievalAccuracy: number | null
  freshnessScore:    number | null
  falsePositives:    number | null
  avgLatencyMs:      number
}

export interface MemoryOverview {
  platform:   EvalPlatform
  reachable:  boolean
  error:      string | null
  fetchedAt:  string
  providers:  MemoryProviderInfo[]
  summary: {
    runCount: number
    avgComposite: number | null
    avgRetrieval: number | null
    avgUsage: number | null
    avgFalseRecall: number | null
    bestModel: { scope: string; composite: number } | null
    bestProvider: { scope: string; composite: number } | null
  }
  modelLeaderboard:    MemoryScorecard[]
  providerLeaderboard: MemoryScorecard[]
  agentLeaderboard:    MemoryScorecard[]
  providerComparison:  ProviderComparison[]
  recentRuns:          MemoryBenchmarkRun[]
}

export interface MemoryScoringMethodology {
  overview: string
  kinds: Array<{ key: MemoryKind; label: string; detail: string }>
  subScores: Array<{ key: string; label: string; weight: number }>
  weights: Record<string, number>
  composition: string[]
  config: Record<string, any>
  fetchedAt: string
}

export type MemoryTaskBody = {
  platform:      EvalPlatform
  agent?:        string
  title:         string
  kind?:         MemoryKind
  query:         string
  expectedFacts?:  string[]
  forbiddenFacts?: string[]
  providers?:    string[]
  newerHints?:   string[]
  rubric?:       string
  notes?:        string
}

export const memoryEvaluations = {
  providers:    (platform?: EvalPlatform) =>
    get<{ providers: MemoryProviderInfo[]; fetchedAt: string }>('/evaluations/memory/providers', platform ? { platform } : undefined),
  overview:     (platform: EvalPlatform) =>
    get<{ overview: MemoryOverview }>('/evaluations/memory/overview', { platform }).then(r => r.overview),
  tasks:        (platform?: EvalPlatform) =>
    get<{ tasks: MemoryBenchmarkTask[]; fetchedAt: string }>('/evaluations/memory/tasks', platform ? { platform } : undefined),
  taskDetail:   (id: string) =>
    get<{ task: MemoryBenchmarkTask; runs: MemoryBenchmarkRun[] }>(`/evaluations/memory/tasks/${encodeURIComponent(id)}`),
  createTask:   (body: MemoryTaskBody) =>
    post<{ task: MemoryBenchmarkTask }>('/evaluations/memory/tasks', body),
  deleteTask:   (id: string) =>
    del<{ ok: boolean }>(`/evaluations/memory/tasks/${encodeURIComponent(id)}`),
  runs:         (params?: { platform?: EvalPlatform; taskId?: string; model?: string; provider?: string }) => {
    const clean: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') clean[k] = v as string | number
    return get<{ runs: MemoryBenchmarkRun[]; fetchedAt: string }>('/evaluations/memory/runs', Object.keys(clean).length ? clean : undefined)
  },
  run:          (body: { taskId: string; model?: string; agent?: string }) =>
    post<{ ok: boolean; status: string; taskId: string }>('/evaluations/memory/run', body),
  methodology:  () => get<MemoryScoringMethodology>('/evaluations/memory/scoring-methodology'),
}

export const evaluations = {
  overview:   (platform: EvalPlatform) =>
    get<{ overview: PlatformEvalOverview }>(`/evaluations/${platform}/overview`).then(r => r.overview),
  models:     () => get<EvalModelsResponse>('/evaluations/models'),
  agents:     () => get<{ agents: EvalAgentRow[]; fetchedAt: string }>('/evaluations/agents'),
  matrix:     (platform?: EvalPlatform) =>
    get<AgentModelMatrixResponse>('/evaluations/agent-model-matrix', platform ? { platform } : undefined),
  model:      (name: string, platform?: EvalPlatform) =>
    get<EvalModelDrilldown>(`/evaluations/model/${encodeURIComponent(name)}`, platform ? { platform } : undefined),
  agent:      (name: string, platform?: EvalPlatform) =>
    get<EvalAgentDrilldown>(`/evaluations/agent/${encodeURIComponent(name)}`, platform ? { platform } : undefined),
  runs:       (params?: { platform?: EvalPlatform; model?: string; agent?: string; outcome?: RunOutcome; limit?: number }) => {
    const clean: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== '') clean[k] = v as string | number
    return get<{ runs: EvaluationRun[]; total: number; fetchedAt: string }>('/evaluations/runs', Object.keys(clean).length ? clean : undefined)
  },
  benchmarks: (platform?: EvalPlatform) =>
    get<{ tasks: BenchmarkTask[]; runs: BenchmarkRun[]; fetchedAt: string }>('/evaluations/benchmarks', platform ? { platform } : undefined),
  benchmarkTask:   (id: string) =>
    get<{ task: BenchmarkTask; runs: BenchmarkRun[] }>(`/evaluations/benchmarks/tasks/${encodeURIComponent(id)}`),
  createTask:      (body: BenchmarkTaskBody) =>
    post<{ task: BenchmarkTask }>('/evaluations/benchmarks/tasks', body),
  deleteTask:      (id: string) =>
    del<{ ok: boolean }>(`/evaluations/benchmarks/tasks/${encodeURIComponent(id)}`),
  runBenchmark:    (body: BenchmarkRunBody) =>
    post<{ ok: boolean; status: string; taskId: string; platform: EvalPlatform }>('/evaluations/benchmarks/run', body),
  manualScore:     (body: ManualScoreBody) =>
    post<{ manualScore: ManualScoreRecord }>('/evaluations/manual-score', body),
  methodology:     () => get<ScoringMethodology>('/evaluations/scoring-methodology'),
}

// ─── Harness Benchmarks ─────────────────────────────────────────────────────────
// App → OpenClaw/Hermes → selected model → tools/context/routing → result.

export type BenchmarkHarness  = 'openclaw' | 'hermes'
export type ExecutionMode     = 'harness_direct' | 'simulated' | 'imported_result'
export type HbRunStatus       = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type HbResultStatus    = 'passed' | 'failed' | 'manual_review' | 'error'
export type HbLane =
  | 'runtime_compatibility' | 'instruction_adherence' | 'tool_selection'
  | 'tool_call_formatting' | 'log_config_diagnosis' | 'multi_turn_troubleshooting'
  | 'memory_context' | 'command_action_quality' | 'reliability_failure_behavior'
export type HbFailureType =
  | 'timeout' | 'empty_response' | 'harness_error' | 'auth_error' | 'model_not_found'
  | 'invalid_json' | 'schema_mismatch' | 'wrong_tool' | 'hallucinated_tool' | 'missing_tool_call'
  | 'wrong_arguments' | 'ignored_instruction' | 'ungrounded_claim' | 'wrong_diagnosis'
  | 'unsafe_command' | 'manual_review_required' | 'unknown'

export interface HbLaneMeta { id: HbLane; label: string; short: string; blurb: string }
export interface HbPackSummary {
  id: string; name: string; description: string; harness: BenchmarkHarness | 'any'
  taskCount: number; laneCounts: Partial<Record<HbLane, number>>
}
export interface HbTask {
  id: string; title: string; lane: HbLane; harnesses: BenchmarkHarness[]
  prompt: string; expectedBehavior: string; scoringMode: string
  expectedTool?: string; expectedArguments?: Record<string, unknown>
  requiredSubstrings?: string[]; forbiddenSubstrings?: string[]; maxPoints: number; tags: string[]
}
export interface HbTaskResult {
  id: string; runId: string; taskId: string; taskTitle: string; lane: HbLane
  status: HbResultStatus; points: number; maxPoints: number; latencyMs: number | null
  modelResponse: string; rawHarnessOutput?: unknown; parsedToolCall?: unknown
  errorMessage?: string | null; failureType?: HbFailureType | null
  scoreReason?: string; notes?: string; prompt?: string; expectedBehavior?: string; ts: string
}
export interface HbRun {
  id: string; harness: BenchmarkHarness; mode: ExecutionMode; modelName: string
  provider: string; endpoint?: string; taskPackId: string; taskPackName: string
  startedAt: string; finishedAt?: string | null; status: HbRunStatus
  taskCount: number; completedCount: number; totalScore: number; maxScore: number
  passRate: number | null; avgLatencyMs: number | null; failureCount: number
  error?: string | null; results?: HbTaskResult[]
}
export type HbCompareMode = 'latest' | 'average' | 'best'
export interface HbComparisonRow {
  harness: BenchmarkHarness; modelName: string; provider: string
  taskPackId: string; taskPackName: string
  runs: number; runsUsed: number
  totalScore: number; maxScore: number; overallPct: number | null
  passRate: number | null; avgLatencyMs: number | null; failureCount: number
  laneScores: Record<string, number | null>; lastRunAt: string
}
export interface HbStartBody {
  harness: BenchmarkHarness; taskPackId: string; model?: string
  provider?: string; endpoint?: string; token?: string; mode?: ExecutionMode
}

export const harnessBench = {
  packs:      () => get<{ packs: HbPackSummary[]; lanes: HbLaneMeta[]; failureTypes: HbFailureType[]; fetchedAt: string }>('/harness-bench/packs'),
  pack:       (id: string) => get<{ pack: { id: string; name: string; description: string; harness: string; tasks: HbTask[] } }>(`/harness-bench/packs/${encodeURIComponent(id)}`),
  connectors: () => get<{ harnesses: Array<{ id: BenchmarkHarness; label: string; live: boolean; baseUrl: string; apiBaseUrl?: string; enabled: boolean }>; fetchedAt: string }>('/harness-bench/connectors'),
  models:     (harness: BenchmarkHarness) => get<{ harness: BenchmarkHarness; reachable: boolean; models: string[]; error: string | null; source: string }>('/harness-bench/models', { harness }),
  runs:       () => get<{ runs: HbRun[]; fetchedAt: string }>('/harness-bench/runs'),
  run:        (id: string) => get<{ run: HbRun }>(`/harness-bench/runs/${encodeURIComponent(id)}`),
  start:      (body: HbStartBody) => post<{ ok: boolean; run: HbRun }>('/harness-bench/runs', body),
  cancel:     (id: string) => post<{ ok: boolean }>(`/harness-bench/runs/${encodeURIComponent(id)}/cancel`, {}),
  rerunFailed:(id: string) => post<{ ok: boolean; run: HbRun }>(`/harness-bench/runs/${encodeURIComponent(id)}/rerun-failed`, {}),
  remove:     (id: string) => del<{ ok: boolean }>(`/harness-bench/runs/${encodeURIComponent(id)}`),
  clear:      (scope: 'failed' | 'all') => post<{ ok: boolean; scope: string; removed: number }>('/harness-bench/runs/clear', { scope }),
  exportUrl:  (id: string) => `/api/harness-bench/runs/${encodeURIComponent(id)}/export`,
  comparison: (mode: HbCompareMode = 'latest') => get<{ rows: HbComparisonRow[]; mode: HbCompareMode; lanes: HbLaneMeta[]; fetchedAt: string }>('/harness-bench/comparison', { mode }),
}
