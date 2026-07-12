/**
 * Typed API client for the Mission Control Express backend.
 * In dev, calls go through Vite's /api proxy → localhost:3001.
 * In mobile builds, apiTransport can point requests at a saved runtime server
 * origin while desktop/dev keeps same-origin /api paths.
 */

import { apiFetch, apiUrl, ApiError } from './apiTransport.js'
import type { TraceRun } from '../components/trace/types'
export type { TraceRun, TraceSpan, SpanKind, SpanStatus } from '../components/trace/types'

export { apiUrl, ApiError }

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) query.set(key, String(value))
  const suffix = query.toString()
  return apiFetch<T>(`/api${path}${suffix ? `?${suffix}` : ''}`)
}

function post<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function put<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(`/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function del<T>(path: string): Promise<T> {
  return apiFetch<T>(`/api${path}`, { method: 'DELETE' })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type GoogleConnectionState =
  | 'connected' | 'disconnected' | 'reconnect_required'
  | 'missing_scopes' | 'auth_error' | 'not_configured'

export interface AuthStatus {
  google: {
    clientConfigured: boolean
    tokenConfigured:  boolean
    state:            GoogleConnectionState
    connected:        boolean
    email:            string
    scopes:           string[]
    grantedScopes:    string[]
    missingScopes:    string[]
    connectedAt:      string
    checkedAt:        string
    error:            string
  }
  anthropic: { keyConfigured: boolean }
}

export const auth = {
  status:        (force = false) => get<AuthStatus>('/auth/status', force ? { force: 1 } : undefined),
  googleAuthUrl: ()              => apiUrl('/api/auth/google'),
  disconnect:    ()             => post<{ ok: boolean }>('/auth/google/disconnect', {}),
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
  calendarId?:   string
  writable?:     boolean
}

export interface CalendarEventsResponse {
  events:    CalendarEvent[]
  fetchedAt: string
  days:      number
  start?:    string
  end?:      string
}

export interface CalendarEventInput {
  title:        string
  description?: string
  location?:    string
  allDay?:      boolean
  start:        string   // ISO datetime, or YYYY-MM-DD when allDay
  end?:         string
  calendarId?:  string
}

export const calendar = {
  events:        (days = 7)                  => get<CalendarEventsResponse>('/calendar/events', { days }),
  eventsBetween: (start: string, end: string) => get<CalendarEventsResponse>('/calendar/events', { start, end }),
  calendars:     ()                          => get<{ calendars: any[] }>('/calendar/calendars'),
  create:        (body: CalendarEventInput)  => post<{ event: CalendarEvent }>('/calendar/events', body),
  update:        (id: string, body: CalendarEventInput) => patch<{ event: CalendarEvent }>(`/calendar/events/${encodeURIComponent(id)}`, body),
  remove:        (id: string, calendarId?: string) =>
                   del<{ ok: boolean }>(`/calendar/events/${encodeURIComponent(id)}${calendarId ? `?calendarId=${encodeURIComponent(calendarId)}` : ''}`),
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
  // V8 heap budget (added for the heap/process health monitor)
  heapTotalMb?:    number
  heapCapacityMb?: number   // configured ceiling used for the gauge
  heapLimitMb?:    number   // live V8 heap_size_limit
  externalMb?:     number
  arrayBuffersMb?: number
  heapUsedPct?:    number   // heapUsed / capacity, 0..100
  heapCritical?:   boolean  // true once usage ≥ 80% of capacity
  capacitySource?: 'flag' | 'v8' | 'default'
}

export interface SystemResponse {
  components: SystemComponentLive[]
  host?:      SystemHostInfo
  fetchedAt:  string
  source:     string
}

export type ConnectivityStatus = 'ok' | 'degraded' | 'down'
export interface ConnectivityIndicator {
  id:     string
  label:  string
  status: ConnectivityStatus
  detail: string
}
export interface ConnectivityResponse {
  indicators: ConnectivityIndicator[]
  fetchedAt:  string
}

export const system = {
  components:   () => get<SystemResponse>('/system/components'),
  connectivity: () => get<ConnectivityResponse>('/system/connectivity'),
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
export interface MetricSessionRow { key: string; title: string; channel: string; model: string; kind: string; tokens: number; cost: number; updatedAt: string | null; startedAt: string | null; status: string; runtimeMs: number; isHeartbeat: boolean; contextPct: number | null }
export interface MetricCronJob { id: string; name: string; agentId: string; enabled: boolean; schedule: string; delivery: string; lastRunAt: string | null; nextRunAt: string | null }
export interface MetricCronRun { ts: string; jobId: string; status: string; action: string; error: string | null }
export interface MetricChannel { id: string; label: string; enabled: boolean; configured: boolean; running: boolean; lastStartAt: string | null }
export interface MetricMemoryFile { name: string; size: number; updatedAt: string | null; missing: boolean; path?: string }
export interface MetricSubAgent { key: string; title: string; status: string; tokens: number; updatedAt: string | null; parentKey: string | null }
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
  tools:     Array<{ name: string; count: number; errors: number; avgMs: number | null }>
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
  bulk:      (items: InventoryBody[])        => post<{ created: InventoryItem[]; count: number }>('/inventory/bulk', { items }),
  update:    (id: string, body: Partial<InventoryBody>) => patch<{ item: InventoryItem }>(`/inventory/${id}`, body),
  remove:    (id: string)                    => del<{ ok: boolean }>(`/inventory/${id}`),
  setStatus: (id: string, status: 'available' | 'in-use' | 'reserved') => patch<{ item: InventoryItem }>(`/inventory/${id}/status`, { status }),
  research:  (id: string, source?: 'openclaw' | 'hermes') => post<{ ok: boolean; status: string; source: string }>(`/inventory/${id}/research`, source ? { source } : {}),
  researchAll: () => post<{ queued: number; openclaw: number; hermes: number; skipped: number }>('/inventory/research-all', {}),
}

// ─── Financials (manual money figures) ─────────────────────────────────────────

export type FinanceKind = 'asset' | 'liability'

export interface FinanceEntry {
  id:        string
  label:     string
  kind:      FinanceKind
  category:  string
  amount:    number
  notes:     string
  createdAt: string
  updatedAt: string
}

export interface FinanceSummary {
  assets:      number
  liabilities: number
  netWorth:    number
  byCategory:  Record<string, number>
  count:       number
}

export interface FinancialsResponse {
  entries:    FinanceEntry[]
  summary:    FinanceSummary
  categories: { asset: string[]; liability: string[] }
  fetchedAt:  string
}

export type FinanceEntryBody = {
  label:     string
  kind?:     FinanceKind
  category?: string
  amount?:   number
  notes?:    string
}

export const financials = {
  list:   ()                                  => get<FinancialsResponse>('/financials'),
  create: (body: FinanceEntryBody)            => post<{ entry: FinanceEntry }>('/financials', body),
  update: (id: string, body: Partial<FinanceEntryBody>) => patch<{ entry: FinanceEntry }>(`/financials/${id}`, body),
  remove: (id: string)                        => del<{ ok: boolean }>(`/financials/${id}`),
}

// ─── Recurring bills (derived from Google Calendar) ─────────────────────────────

export type BillCategory = 'ai' | 'telecom' | 'insurance' | 'housing' | 'entertainment' | 'health' | 'utilities' | 'other'

export interface Bill {
  id:         string
  name:       string
  amount:     number
  category:   BillCategory
  isAi:       boolean
  dueIso:     string | null
  dueDisplay: string
}

export interface BillsResponse {
  bills:   Bill[]
  ai:      Bill[]
  monthly: { total: number; aiTotal: number; byCategory: Record<string, number> }
  count:   number
  source:  string
  fetchedAt: string
}

export const bills = {
  list: () => get<BillsResponse>('/bills'),
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

export interface ProjectIdeaInfluence {
  inventoryFactors?:       string[]
  matchedCategories?:      string[]
  priorLikedInfluence?:    string[]
  priorRejectedInfluence?: string[]
  rejectionNotes?:         string[]
  preferenceSignals?:      string[]
  contextualFactors?:      string[]
}
export interface ProjectIdeaStatusEntry { status: string; timestamp: string; reason?: string; note?: string }

export interface ProjectIdea {
  id:              string
  title:           string
  description:     string
  whyFit:          string
  usefulnessScore?: number                       // optional richer-shape fields (present when the
  influenceMetadata?: ProjectIdeaInfluence        // generator emits them; the panel renders them if so)
  statusHistory?:  ProjectIdeaStatusEntry[]
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

// ─── Memory operations (live monitoring) ────────────────────────────────────────

export type MemorySource = 'openclaw' | 'hermes'
export type MemoryEventType =
  | 'created' | 'updated' | 'retrieved' | 'embedded'
  | 'consolidated' | 'skipped' | 'deleted' | 'error'

export interface MemoryEvent {
  id:         string
  source:     MemorySource
  type:       MemoryEventType
  trigger:    'auto' | 'manual' | 'cron'
  status:     'ok' | 'fail'
  objectId:   string | null
  sessionKey: string | null
  tool:       string | null
  title:      string
  summary:    string
  latencyMs:  number | null
  origin:     'live' | 'push'
  payload:    any
  ts:         string
}

export interface MemoryVectorView {
  recordCount: number | null
  collections: Array<{ name: string; count: number | null }>
  dimensions:  number | null
  indexType:   string | null
  status:      string
}

export interface MemoryHealth {
  source:    MemorySource
  reachable: boolean
  embedding: any | null
  vector:    MemoryVectorView | null
  store:     { files: number; bytes: number } | null
  doctorRaw: any | null
  error:     string | null
  fetchedAt: string
}

export interface MemoryFileInfo {
  name: string; size: number; updatedAt: string | null; path?: string; missing?: boolean
}

export interface MemoryVectorStat {
  id: string; source: MemorySource; collection: string; recordCount: number
  dimensions: number | null; indexType: string | null; orphanCount: number; health: string; ts: string
}

export interface MemoryConsolidationRun {
  id: string; source: MemorySource; trigger: string; status: string
  inputs: number; merged: number; pruned: number; summarized: number
  notes: string; durationMs: number; startedAt: string; ts: string
}

export interface MemoryOpsOverview {
  source:       MemorySource
  counts:       { total: number; today: number; errors24h: number; retrieved24h: number }
  health:       MemoryHealth | null
  files:        MemoryFileInfo[]
  recentEvents: MemoryEvent[]
  vectorSeries: MemoryVectorStat[]
  fetchedAt:    string
}

export interface MemoryMetrics {
  source: string
  hours:  number
  buckets: Array<{ ts: string; created: number; retrieved: number; consolidated: number; errors: number; total: number; latencyP50: number | null }>
  byType: Record<string, number>
}

export interface DailySession {
  key: string; title: string; channel: string; model: string
  startedAt: string; updatedAt: string; status: string; runtimeMs: number; isHeartbeat: boolean
}
export interface DailyGroup {
  date: string; label: string; sessionCount: number; channels: string[]; sessions: DailySession[]
}
export interface SessionTranscriptMsg { role: string; content: string; timestamp: string }
export interface SessionTranscript {
  id: string; title: string; messageCount: number; messages: SessionTranscriptMsg[]
  source?: string; cwd?: string; startedAt?: string; lastActiveAt?: string
}

// On-disk memory system (read live over SSH from the agent machine)
export interface RemoteMemoryStatus { reachable: boolean; host: string; memDir: string | null; dailyCount: number; dreamCount: number; error: string | null }
export interface DailyLogMeta { date: string; size: number; mtime: string; preview: string }
export interface DreamMeta { phase: string; date: string; size: number }
export interface DreamEvent {
  type: string; timestamp: string; phase?: string; reportPath?: string; lineCount?: number
  query?: string; resultCount?: number; applied?: number; candidates?: Array<{ path: string; score: number; recallCount?: number }>
}
export interface RecallChunk {
  path: string; startLine: number; endLine: number; snippet: string
  recallCount: number; dailyCount: number; totalScore: number; conceptTags: string[]; lastRecalledAt: string | null
}
export interface RecallSummary { total: number; updatedAt: string | null; topChunks: RecallChunk[]; topTags: Array<{ tag: string; count: number }> }
export interface PhaseSignalSummary { total: number; updatedAt: string | null; topSignals: Array<{ key: string; path: string; lightHits: number; remHits: number; lastLightAt: string | null }> }
export interface DailySearchHit { date: string; size: number; snippet: string }
export interface DailyIndexMeta { count: number; lastSynced: string | null; oldest: string | null; newest: string | null; bytes: number; fts: boolean }
export interface MemoryDiskSummary {
  reachable: boolean; dailyLogs: number; dreamReports: number; bytes: number
  recallChunks: number; recallEvents: number; dreams: number; promotions: number
  embedding: 'active' | 'idle' | 'ok' | 'off' | 'error' | 'unknown'
  plugin: 'ok' | 'off' | 'error' | 'unknown'
  vectorStore: { present: boolean; bytes: number; lastWrite: string | null } | null
  freshness: { lastDailyLog: string | null; lastDream: string | null; lastRecallUpdate: string | null; lastEvent: string | null }
  stale: boolean
  fetchedAt: string
}

export const memoryOps = {
  overview:      (source: MemorySource, force = false) =>
    get<MemoryOpsOverview>('/memory/overview', { source, ...(force ? { force: 1 } : {}) }),
  events:        (source?: MemorySource, type = 'all', limit = 200) =>
    get<{ events: MemoryEvent[]; fetchedAt: string }>('/memory/events', { ...(source ? { source } : {}), type, limit }),
  health:        (source: MemorySource) => get<MemoryHealth>('/memory/health', { source }),
  vector:        (source: MemorySource) =>
    get<{ source: MemorySource; current: MemoryVectorView | null; series: MemoryVectorStat[]; fetchedAt: string }>('/memory/vector', { source }),
  metrics:       (source: MemorySource | undefined, hours = 24) =>
    get<MemoryMetrics>('/memory/metrics', { ...(source ? { source } : {}), hours }),
  consolidation: (source?: MemorySource) =>
    get<{ runs: MemoryConsolidationRun[]; fetchedAt: string }>('/memory/consolidation', source ? { source } : undefined),
  files:         (source: MemorySource) =>
    get<{ files: MemoryFileInfo[]; objects: any[]; error?: string }>('/memory/files', { source }),
  file:          (source: MemorySource, name: string) =>
    get<{ name: string; content: string; path: string }>('/memory/file', { source, name }),
  daily:         (source: MemorySource) =>
    get<{ source: MemorySource; total: number; days: DailyGroup[]; error?: string }>('/memory/daily', { source }),
  session:       (source: MemorySource, key: string) =>
    get<{ session: SessionTranscript }>('/memory/session', { source, key }),
  disk: {
    status:       () => get<RemoteMemoryStatus>('/memory/disk/status'),
    summary:      () => get<MemoryDiskSummary>('/memory/disk/summary'),
    daily:        () => get<{ logs: DailyLogMeta[]; fetchedAt: string }>('/memory/disk/daily'),
    dailyContent: (date: string) => get<{ date: string; content: string }>(`/memory/disk/daily/${date}`),
    dreams:       () => get<{ dreams: DreamMeta[]; fetchedAt: string }>('/memory/disk/dreams'),
    dream:        (phase: string, date: string) => get<{ phase: string; date: string; content: string }>('/memory/disk/dream', { phase, date }),
    events:       (limit = 250) => get<{ events: DreamEvent[]; fetchedAt: string }>('/memory/disk/events', { limit }),
    recall:       () => get<RecallSummary>('/memory/disk/recall'),
    phaseSignals: () => get<PhaseSignalSummary>('/memory/disk/phase-signals'),
    longterm:     () => get<{ content: string; fetchedAt: string }>('/memory/disk/longterm'),
    sync:         () => post<{ indexed: number; total: number; error?: string }>('/memory/disk/sync', {}),
    index:        () => get<DailyIndexMeta>('/memory/disk/index'),
    search:       (q: string) => get<{ q: string; results: DailySearchHit[]; index: DailyIndexMeta }>('/memory/disk/search', { q }),
    ragSearch:    (q: string, limit = 8) => get<RagSearchResponse>('/memory/disk/rag-search', { q, limit }),
  },
}

// LanceDB RAG search playground — top-N recalled memory chunks for a query.
export interface RagSearchHit {
  snippet:        string
  source:         string
  startLine:      number | null
  endLine:        number | null
  score:          number   // 0..1 lexical match confidence
  recallCount:    number
  conceptTags:    string[]
  lastRecalledAt: string | null
}
export interface RagSearchResponse {
  q:          string
  results:    RagSearchHit[]
  method:     'lexical'
  total:      number
  updatedAt?: string | null
  error?:     string
  fetchedAt:  string
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

// ─── To-Dos ───────────────────────────────────────────────────────────────────

export type TodoSeverity = 'low' | 'medium' | 'high' | 'critical'
export type TodoHorizon = 'short' | 'long'
export type TodoCalendarSyncStatus = 'idle' | 'synced' | 'pending' | 'error' | 'disabled'

export interface LiveTodo {
  id: string
  title: string
  notes: string
  severity: TodoSeverity
  horizon: TodoHorizon
  dueDate: string
  done: boolean
  createdAt: string
  updatedAt: string
  completedAt: string
  // Google Calendar sync metadata
  calendarSyncEnabled: boolean
  googleCalendarEventId: string
  calendarSyncStatus: TodoCalendarSyncStatus
  lastCalendarSyncAt: string
  calendarSyncError: string
}

export const todosApi = {
  list: () => get<{ todos: LiveTodo[]; fetchedAt: string }>('/todos'),
  create: (body: { title: string; severity?: TodoSeverity; horizon?: TodoHorizon; dueDate?: string; calendarSyncEnabled?: boolean }) =>
    post<{ todo: LiveTodo }>('/todos', body),
  update: (id: string, body: Partial<Pick<LiveTodo, 'title' | 'notes' | 'severity' | 'horizon' | 'dueDate' | 'done' | 'calendarSyncEnabled'>>) =>
    patch<{ todo: LiveTodo }>(`/todos/${id}`, body),
}

// ─── Links ────────────────────────────────────────────────────────────────────

export type LinkSource = 'manual' | 'launcher' | 'inbox'

export interface LinkItem {
  id: string
  url: string
  title: string
  domain: string
  note: string
  tags: string[]
  pinned: boolean
  archived: boolean
  source: LinkSource
  createdAt: string
  updatedAt: string
  openedAt: string
  updatedAgo: string
  openedAgo: string
}

export type LinkCreateBody = {
  url: string
  title?: string
  note?: string
  tags?: string[]
  pinned?: boolean
  source?: LinkSource
}

export type LinkPatchBody = Partial<LinkCreateBody & { archived: boolean; openedAt: string }>

export const links = {
  list: (archived = false) => get<{ links: LinkItem[]; fetchedAt: string }>('/links', archived ? { archived: 'true' } : undefined),
  create: (body: LinkCreateBody) => post<{ link: LinkItem; deduped?: boolean }>('/links', body),
  update: (id: string, body: LinkPatchBody) => patch<{ link: LinkItem }>(`/links/${id}`, body),
  remove: (id: string) => del<{ ok: boolean }>(`/links/${id}`),
}

// ─── To-Buy ──────────────────────────────────────────────────────────────────

export type BuyPriority = 'low' | 'medium' | 'high'

export interface BuyItem {
  id:             string
  title:          string
  notes:          string
  priority:       BuyPriority
  quantity:       number
  estimatedPrice: number
  purchased:      boolean
  createdAt:      string
  updatedAt:      string
  purchasedAt:    string
}

export const toBuy = {
  list: () => get<{ items: BuyItem[] }>('/tobuy'),
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

export type InboxKind = 'approval' | 'task' | 'todo'
export type InboxStatus = 'active' | 'snoozed' | 'done'
export type InboxPriority = 'critical' | 'high' | 'medium' | 'low'

export interface InboxItem {
  id: string
  kind: InboxKind
  itemId: string
  title: string
  summary: string
  content: string
  priority: InboxPriority
  status: InboxStatus
  source: 'local' | 'openclaw' | 'hermes'
  sourceLabel: string
  routeView: 'tasks' | 'todos'
  routeTab: 'tasks' | 'approvals' | 'inbox' | ''
  eventAt: string
  eventAgo: string
  snoozedUntil: string
  reviewedAt: string
  convertedTo: { kind: 'task' | 'note' | 'link'; id: string } | null
  badges: string[]
}

export type InboxPatchBody = {
  status?: InboxStatus
  snoozedUntil?: string
  clearReviewed?: boolean
  convertedTo?: { kind: 'task' | 'note' | 'link'; id: string }
}

export const inbox = {
  list: () => get<{ items: InboxItem[]; counts: Record<string, number>; fetchedAt: string }>('/inbox'),
  update: (id: string, body: InboxPatchBody) => patch<{ item: { id: string; status: InboxStatus } }>(`/inbox/${encodeURIComponent(id)}`, body),
}

// ─── News ─────────────────────────────────────────────────────────────────────

export type NewsCategory = 'ai' | 'computing' | 'code' | 'robotics'
export type GithubSince  = 'daily' | 'weekly' | 'monthly'

export interface NewsArticle {
  id:           string
  title:        string
  url:          string
  summary:      string
  source:       string
  category:     NewsCategory
  domain:       string
  favicon:      string
  image:        string
  publishedAt:  string
  publishedAgo: string
}

export interface GithubRepo {
  id:          string
  name:        string
  owner:       string
  fullName:    string
  url:         string
  description: string
  language:    string | null
  stars:       number
  forks:       number
  topics:      string[]
  avatar:      string
  createdAgo:  string
  pushedAgo:   string
}

export type BuzzSource = 'hackernews' | 'reddit' | 'lobsters'

export interface BuzzItem {
  id:          string
  title:       string
  url:         string
  source:      BuzzSource
  origin:      string
  score:       number
  comments:    number
  commentsUrl: string
  domain:      string
  image:       string
  postedAt:    string
  postedAgo:   string
}

export interface NewsSourceStatus { name: string; ok: boolean; count: number }

export interface NewsFeedResponse   { articles: NewsArticle[]; sources: NewsSourceStatus[]; fetchedAt: string; cached: boolean; error?: string }
export interface GithubReposResponse { repos: GithubRepo[]; since: GithubSince; language: string; fetchedAt: string; cached: boolean; error?: string }
export interface BuzzResponse        { items: BuzzItem[]; sources: NewsSourceStatus[]; fetchedAt: string; cached: boolean; error?: string }

export const news = {
  feed:   ()                                            => get<NewsFeedResponse>('/news/feed'),
  github: (since: GithubSince = 'weekly', lang = '')     => get<GithubReposResponse>('/news/github', lang ? { since, lang } : { since }),
  buzz:   ()                                            => get<BuzzResponse>('/news/buzz'),
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

export const watchHeatmap = () => get<{ hours: number[]; error?: string }>('/watch/heatmap')

// ─── Budget limits ────────────────────────────────────────────────────────────

export interface BudgetLimits {
  daily:  { cost: number | null; tokens: number | null }
  weekly: { cost: number | null; tokens: number | null }
}
export const budgets = {
  get: () => get<BudgetLimits>('/budgets'),
  set: (b: BudgetLimits) => put<BudgetLimits>('/budgets', b),
}

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
  scoreReason?: string; notes?: string; prompt?: string; expectedBehavior?: string
  sampleCount?: number; passCount?: number; ts: string
}
export interface HbRun {
  id: string; harness: BenchmarkHarness; mode: ExecutionMode; modelName: string
  resolvedModel?: string | null
  provider: string; endpoint?: string; taskPackId: string; taskPackName: string
  startedAt: string; finishedAt?: string | null; status: HbRunStatus
  taskCount: number; completedCount: number; totalScore: number; maxScore: number
  passRate: number | null; avgLatencyMs: number | null; failureCount: number
  error?: string | null; results?: HbTaskResult[]
}
export type HbCompareMode = 'latest' | 'average' | 'best'
export type HbCompareGroupBy = 'model' | 'provider'
export type HbModelFamily = 'Anthropic' | 'OpenAI' | 'Google' | 'Meta' | 'Mistral' | 'Other'
export interface HbComparisonRow {
  harness: BenchmarkHarness; modelName: string; provider: string
  family: HbModelFamily; modelCount: number
  taskPackId: string; taskPackName: string
  runs: number; runsUsed: number
  totalScore: number; maxScore: number; overallPct: number | null
  passRate: number | null; avgLatencyMs: number | null; failureCount: number
  laneScores: Record<string, number | null>
  reliabilityPct: number | null; latencyStdevMs: number | null
  avgResponseChars: number; avgOutputTokens: number; tokensEstimated: boolean
  fenceRate: number; estCostUsd: number | null; costEstimated: boolean
  maxSamples: number; trend: number[]; lastRunAt: string
}
export interface HbStartBody {
  harness: BenchmarkHarness; taskPackId: string; model?: string
  provider?: string; endpoint?: string; token?: string; mode?: ExecutionMode; samples?: number
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
  comparison: (mode: HbCompareMode = 'latest', groupBy: HbCompareGroupBy = 'model') => get<{ rows: HbComparisonRow[]; mode: HbCompareMode; groupBy: HbCompareGroupBy; lanes: HbLaneMeta[]; fetchedAt: string }>('/harness-bench/comparison', { mode, groupBy }),
}


// ─── Finance / expense ledger ─────────────────────────────────────────────────

export interface LedgerEntry {
  id:          string
  amount:      number
  description: string
  category:    string
  source:      string   // 'discord' | 'manual'
  createdAt:   string
}

export interface LedgerResponse {
  entries:   LedgerEntry[]
  total:     number   // all-time sum
  fetchedAt: string
}

export const finance = {
  list:   ()                                            => get<LedgerResponse>('/finance'),
  create: (body: Omit<LedgerEntry, 'id' | 'createdAt'>) => post<{ entry: LedgerEntry }>('/finance', body),
  remove: (id: string)                                 => del<{ ok: boolean }>(`/finance/${id}`),
}
