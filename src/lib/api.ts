/**
 * Typed API client for the Mission Control Express backend.
 * All calls go through Vite's /api proxy → localhost:3001.
 */

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
  type:        'mcp' | 'plugin' | 'skill' | 'extension'
  status:      'healthy' | 'warning' | 'error' | 'offline'
  latencyMs?:  number
  error?:      string
  description: string
  lastChecked: string
  version?:    string
}

export interface SystemResponse {
  components: SystemComponentLive[]
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

export interface RadarUsageResponse {
  days:           number
  startDate:      string
  endDate:        string
  totalTokens:    number
  totalCost:      number
  totalRuns:      number
  dailyUsage:     DailyUsageLive[]
  modelBreakdown: Array<{ model: string; tokens: number; cost: number; runs: number }>
  fetchedAt:      string
}

export const radar = {
  usage: (days = 7) => get<RadarUsageResponse>('/radar/usage', { days }),
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
  session:  (id: string) => get<ChatSessionResponse>(`/openclaw/sessions/${id}`),
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

export const pipeline = {
  runs:      () => get<PipelineRunsResponse>('/pipeline/runs'),
  scheduled: () => get<PipelineScheduledResponse>('/pipeline/scheduled'),
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
