// title: Harness Benchmark types + lane/failure vocabulary
// path: server/lib/harnessBenchTypes.ts
// purpose: Shared types for the Harness Benchmarks feature — benchmarking how a
//          model performs *through* OpenClaw/Hermes (App → harness → model →
//          tools/context/routing → result), NOT raw model API responses. The
//          execution mode on every run/result records whether it was a real
//          harness call ('harness_direct'), a labelled simulation, or imported.

export type BenchmarkHarness = 'openclaw' | 'hermes'

// How a result was produced. We NEVER fabricate scores: a real call that the
// harness rejected is recorded as 'harness_direct' with a failure type — that's
// real data, not a simulation. 'simulated' is reserved for explicitly-labelled
// offline runs; 'imported_result' for results pulled from elsewhere.
export type ExecutionMode = 'harness_direct' | 'simulated' | 'imported_result'

export type BenchmarkLane =
  | 'runtime_compatibility'
  | 'instruction_adherence'
  | 'tool_selection'
  | 'tool_call_formatting'
  | 'log_config_diagnosis'
  | 'multi_turn_troubleshooting'
  | 'memory_context'
  | 'command_action_quality'
  | 'reliability_failure_behavior'

export interface LaneMeta { id: BenchmarkLane; label: string; short: string; blurb: string }

export const LANES: LaneMeta[] = [
  { id: 'runtime_compatibility',       label: 'Runtime Compatibility',     short: 'Runtime',     blurb: 'Can the model run through the harness without auth/config/runtime errors?' },
  { id: 'instruction_adherence',       label: 'Instruction Adherence',     short: 'Adherence',   blurb: 'JSON-only, required schema, forbidden text, obeys system constraints.' },
  { id: 'tool_selection',              label: 'Tool Selection',            short: 'Tool pick',   blurb: 'Chooses the correct tool, abstains when none is needed, never invents tools.' },
  { id: 'tool_call_formatting',        label: 'Tool-Call Formatting',      short: 'Tool fmt',    blurb: 'Valid JSON, schema-valid call, no extra prose, executable by the harness.' },
  { id: 'log_config_diagnosis',        label: 'Log / Config Diagnosis',    short: 'Diagnosis',   blurb: 'Diagnoses harness logs/config, identifies cause, gives an actionable fix.' },
  { id: 'multi_turn_troubleshooting',  label: 'Multi-Turn Troubleshooting',short: 'Multi-turn',  blurb: 'Asks for useful info, updates diagnosis on new output, reaches a fix.' },
  { id: 'memory_context',              label: 'Memory / Context',          short: 'Context',     blurb: 'Uses supplied context correctly, avoids contamination, keeps short-run state.' },
  { id: 'command_action_quality',      label: 'Command / Action Quality',  short: 'Commands',    blurb: 'Valid, minimal, safe commands; respects OS/shell; no destructive defaults.' },
  { id: 'reliability_failure_behavior',label: 'Reliability / Failure',     short: 'Reliability', blurb: 'Fails in classifiable, non-dangerous ways for agent workflows.' },
]

export const LANE_IDS = LANES.map(l => l.id)
export function isLane(v: unknown): v is BenchmarkLane { return typeof v === 'string' && (LANE_IDS as string[]).includes(v) }
export function laneLabel(id: BenchmarkLane): string { return LANES.find(l => l.id === id)?.label ?? id }

export type ScoringMode =
  | 'exact'
  | 'regex'
  | 'json_schema'
  | 'tool_call_match'
  | 'rubric'
  | 'manual_review'

export type BenchmarkFailureType =
  | 'timeout'
  | 'empty_response'
  | 'harness_error'
  | 'auth_error'
  | 'model_not_found'
  | 'invalid_json'
  | 'schema_mismatch'
  | 'wrong_tool'
  | 'hallucinated_tool'
  | 'missing_tool_call'
  | 'wrong_arguments'
  | 'ignored_instruction'
  | 'ungrounded_claim'
  | 'wrong_diagnosis'
  | 'unsafe_command'
  | 'manual_review_required'
  | 'unknown'

export const FAILURE_TYPES: BenchmarkFailureType[] = [
  'timeout', 'empty_response', 'harness_error', 'auth_error', 'model_not_found',
  'invalid_json', 'schema_mismatch', 'wrong_tool', 'hallucinated_tool', 'missing_tool_call',
  'wrong_arguments', 'ignored_instruction', 'ungrounded_claim', 'wrong_diagnosis',
  'unsafe_command', 'manual_review_required', 'unknown',
]

export interface BenchmarkTask {
  id:                 string
  title:              string
  lane:               BenchmarkLane
  harnesses:          BenchmarkHarness[]      // which harnesses this task is meaningful for
  prompt:             string
  expectedBehavior:   string
  scoringMode:        ScoringMode
  expectedAnswer?:    unknown                 // exact string OR concrete object for json_schema deep-equal
  expectedTool?:      string                  // tool_call_match: expected tool name ('' / 'none' → abstain)
  expectedArguments?: Record<string, unknown> // tool_call_match: required args (subset match)
  availableTools?:    string[]                // tools offered in-prompt (for hallucination detection)
  requiredSubstrings?: string[]              // must all be present (regex in 'regex' mode, literal otherwise)
  forbiddenSubstrings?: string[]             // none may be present
  maxPoints:          number
  tags:               string[]
}

export interface TaskPack {
  id:          string
  name:        string
  description: string
  harness:     BenchmarkHarness | 'any'      // which harness the pack is designed for
  tasks:       BenchmarkTask[]
}

export interface PackSummary {
  id: string; name: string; description: string; harness: BenchmarkHarness | 'any'
  taskCount: number
  laneCounts: Partial<Record<BenchmarkLane, number>>
}

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TaskResultStatus = 'passed' | 'failed' | 'manual_review' | 'error'

export interface BenchmarkTaskResult {
  id:              string
  runId:           string
  taskId:          string
  taskTitle:       string
  lane:            BenchmarkLane
  status:          TaskResultStatus
  points:          number
  maxPoints:       number
  latencyMs:       number | null
  modelResponse:   string
  rawHarnessOutput?: unknown
  parsedToolCall?: unknown
  errorMessage?:   string | null
  failureType?:    BenchmarkFailureType | null
  scoreReason?:    string
  notes?:          string
  prompt?:         string
  expectedBehavior?: string
  sampleCount?:    number          // how many times the task was run (consistency)
  passCount?:      number          // how many of those samples fully passed
  outputTokens?:   number          // mean output tokens/sample (0 = none reported)
  inputTokens?:    number          // mean input tokens/sample
  reportedCost?:   number          // mean harness-reported USD/sample (0 = none reported)
  ts:              string
}

export interface BenchmarkRun {
  id:           string
  harness:      BenchmarkHarness
  mode:         ExecutionMode
  modelName:    string          // model the user requested
  resolvedModel?: string | null  // model the harness actually ran (OpenClaw may ignore the request)
  provider:     string
  endpoint?:    string
  taskPackId:   string
  taskPackName: string
  startedAt:    string
  finishedAt?:  string | null
  status:       RunStatus
  taskCount:    number
  completedCount: number
  totalScore:   number
  maxScore:     number
  passRate:     number | null   // 0..100 over scored (non-manual) tasks
  avgLatencyMs: number | null
  failureCount: number
  error?:       string | null
  results?:     BenchmarkTaskResult[]
}

export interface StartRunRequest {
  harness:    BenchmarkHarness
  taskPackId: string
  model?:     string          // model name to request from the harness ('' → harness default)
  provider?:  string
  endpoint?:  string          // optional OpenAI-compatible /v1 base URL override (OSS/local)
  token?:     string          // optional bearer for the override endpoint
  mode?:      ExecutionMode   // defaults to harness_direct
  samples?:   number          // runs per task for consistency scoring (1..5, default 1)
  onlyTaskIds?: string[]      // rerun-failed: restrict to these tasks
}
