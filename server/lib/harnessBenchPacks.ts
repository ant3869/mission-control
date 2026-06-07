// title: Harness Benchmark task packs (seeded, deterministic)
// path: server/lib/harnessBenchPacks.ts
// purpose: The initial task packs run through OpenClaw/Hermes. Every task is
//          scoreable deterministically (exact / regex / json_schema /
//          tool_call_match) except where rubric/manual_review is honestly
//          declared. NO coding benchmarks (HumanEval/MBPP/SWE-bench) and no
//          MMLU-style trivia — this measures agent-harness behavior only.

import type { TaskPack, BenchmarkTask, PackSummary, BenchmarkLane } from './harnessBenchTypes.js'

// Tool catalog presented to the model in tool-selection / formatting tasks. The
// model is told to answer with ONLY {"tool": "<name>", "arguments": {...}} or
// {"tool": "none"}. availableTools on each task lets the scorer flag any tool
// the model invents that isn't on the offered list (→ hallucinated_tool).
const TOOL_CATALOG = [
  'get_logs(service: string) — return recent logs for a service',
  'restart_gateway() — restart the agent gateway',
  'set_config(key: string, value: string) — update a configuration value',
  'search_web(query: string) — search the web',
  'read_file(path: string) — read a file from disk',
].join('\n')
const TOOL_NAMES = ['get_logs', 'restart_gateway', 'set_config', 'search_web', 'read_file']

function toolPrompt(task: string): string {
  return [
    'You are an agent operating through a tool harness. Available tools:',
    TOOL_CATALOG,
    '',
    `Task: ${task}`,
    '',
    'Respond with ONLY a single JSON object: {"tool": "<name>", "arguments": { ... }}.',
    'If no tool is needed, respond with {"tool": "none"}. No prose, no markdown, no code fences.',
  ].join('\n')
}

const BOTH: ('openclaw' | 'hermes')[] = ['openclaw', 'hermes']

// ─── quick-smoke-pack ───────────────────────────────────────────────────────────
const QUICK_SMOKE: BenchmarkTask[] = [
  {
    id: 'qs-runtime-ready', title: 'Harness responds (runtime smoke)', lane: 'runtime_compatibility',
    harnesses: BOTH, scoringMode: 'exact', expectedAnswer: 'READY',
    prompt: 'Reply with exactly the single word READY and nothing else. No punctuation, markdown, or whitespace around it.',
    expectedBehavior: 'The model is reachable through the harness and returns the literal word READY.',
    forbiddenSubstrings: ['```'], maxPoints: 10, tags: ['smoke', 'runtime'],
  },
  {
    id: 'qs-json-only', title: 'JSON-only response', lane: 'instruction_adherence',
    harnesses: BOTH, scoringMode: 'json_schema',
    expectedAnswer: { ok: true, service: 'gateway' },
    prompt: 'Output a single JSON object exactly equal to {"ok": true, "service": "gateway"}. Return ONLY raw JSON — no code fences, no commentary.',
    expectedBehavior: 'Returns the exact JSON object with no fences or prose.',
    forbiddenSubstrings: ['```'], maxPoints: 10, tags: ['smoke', 'json'],
  },
  {
    id: 'qs-abstain', title: 'Abstain when no tool is needed', lane: 'tool_selection',
    harnesses: BOTH, scoringMode: 'tool_call_match', expectedTool: 'none', availableTools: TOOL_NAMES,
    prompt: toolPrompt('A user says "hello, thanks for your help". Decide which tool, if any, to call.'),
    expectedBehavior: 'Recognizes no tool is needed and returns {"tool": "none"}.',
    maxPoints: 10, tags: ['smoke', 'abstain'],
  },
  {
    id: 'qs-tool-pick', title: 'Pick the correct tool', lane: 'tool_selection',
    harnesses: BOTH, scoringMode: 'tool_call_match', expectedTool: 'get_logs',
    expectedArguments: { service: 'gateway' }, availableTools: TOOL_NAMES,
    prompt: toolPrompt('Fetch the most recent logs for the gateway service so we can see why it is erroring.'),
    expectedBehavior: 'Calls get_logs with {"service": "gateway"}.',
    maxPoints: 10, tags: ['smoke', 'tool'],
  },
  {
    id: 'qs-diagnose', title: 'Diagnose a simple log error', lane: 'log_config_diagnosis',
    harnesses: BOTH, scoringMode: 'regex',
    requiredSubstrings: ['api[ _-]?key', '(set|add|configure|provide|missing)'],
    prompt: 'A Hermes gateway log shows: `[ERROR] provider openai: 401 Unauthorized — no API key configured`. In one sentence, state the cause and the fix.',
    expectedBehavior: 'Identifies the missing/invalid API key and says to set/configure it.',
    maxPoints: 10, tags: ['smoke', 'diagnosis'],
  },
]

// ─── openclaw-config-pack ───────────────────────────────────────────────────────
const OC: ('openclaw')[] = ['openclaw']
const OPENCLAW_CONFIG: BenchmarkTask[] = [
  {
    id: 'occ-missing-key', title: 'Missing provider API key', lane: 'log_config_diagnosis',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ['api[ _-]?key', '(set|add|export|configure|env)'],
    forbiddenSubstrings: ['restart the computer', 'reinstall'],
    prompt: 'OpenClaw log: `[ERROR] agent:main run failed: provider anthropic returned 401 — ANTHROPIC_API_KEY not set`. State the cause and the exact fix in one sentence.',
    expectedBehavior: 'Cause = missing ANTHROPIC_API_KEY; fix = set the env var / configure the key.',
    maxPoints: 10, tags: ['openclaw', 'auth'],
  },
  {
    id: 'occ-invalid-alias', title: 'Invalid model alias', lane: 'log_config_diagnosis',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ['(model|alias)', '(not found|unknown|invalid|misspell|typo|available)'],
    prompt: 'OpenClaw log: `model "claud-opus" not found in registry`. What is wrong and how do you fix it? One sentence.',
    expectedBehavior: 'Recognizes the model alias is misspelled/unknown and should be corrected to a valid model id.',
    maxPoints: 10, tags: ['openclaw', 'routing'],
  },
  {
    id: 'occ-default-model', title: 'Set the default model (command)', lane: 'command_action_quality',
    harnesses: OC, scoringMode: 'tool_call_match', expectedTool: 'set_config',
    expectedArguments: { key: 'default_model' }, availableTools: TOOL_NAMES,
    prompt: toolPrompt('Change the OpenClaw default model to claude-opus-4 using a config tool.'),
    expectedBehavior: 'Calls set_config with key "default_model" and the new model value.',
    maxPoints: 10, tags: ['openclaw', 'config'],
  },
  {
    id: 'occ-token-expired', title: 'Gateway token expired', lane: 'log_config_diagnosis',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ['token', '(expired|rotate|renew|re-?auth|new token|regenerate)'],
    prompt: 'OpenClaw dashboard log: `WS connect rejected: gateway token expired`. Cause and fix in one sentence.',
    expectedBehavior: 'Identifies the expired gateway token and says to rotate/renew it.',
    maxPoints: 10, tags: ['openclaw', 'auth'],
  },
  {
    id: 'occ-provider-mismatch', title: 'Provider/model mismatch', lane: 'log_config_diagnosis',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ['(provider|route|mismatch)', '(model|provider)'],
    prompt: 'OpenClaw log: `routing error: model "gpt-4o" requested but provider set to "anthropic"`. Explain the mismatch and the fix in one sentence.',
    expectedBehavior: 'Notes the model belongs to a different provider; fix = align provider with the model (or pick a matching model).',
    maxPoints: 10, tags: ['openclaw', 'routing'],
  },
  {
    id: 'occ-endpoint-down', title: 'Local endpoint unavailable', lane: 'log_config_diagnosis',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ['(connection refused|unreachable|not running|down|start|tunnel|port)'],
    prompt: 'OpenClaw log: `ECONNREFUSED 127.0.0.1:11434 when calling local model`. What is wrong and what is the next action? One sentence.',
    expectedBehavior: 'Local model server (e.g. Ollama on 11434) is not running/reachable; start it or fix the endpoint/port.',
    maxPoints: 10, tags: ['openclaw', 'local', 'oss'],
  },
]

// ─── hermes-agent-pack ──────────────────────────────────────────────────────────
const HM: ('hermes')[] = ['hermes']
const HERMES_AGENT: BenchmarkTask[] = [
  {
    id: 'ha-correct-tool', title: 'Choose the correct tool', lane: 'tool_selection',
    harnesses: HM, scoringMode: 'tool_call_match', expectedTool: 'search_web',
    expectedArguments: {}, availableTools: TOOL_NAMES,
    prompt: toolPrompt('Find the current release version of the Hermes agent runtime online.'),
    expectedBehavior: 'Calls search_web with a relevant query.',
    maxPoints: 10, tags: ['hermes', 'tool'],
  },
  {
    id: 'ha-reject-unavailable', title: 'Reject an unavailable tool', lane: 'tool_selection',
    harnesses: HM, scoringMode: 'tool_call_match', expectedTool: 'none', availableTools: TOOL_NAMES,
    prompt: toolPrompt('Send a Slack message to the on-call engineer. (Note: only the listed tools are available.)'),
    expectedBehavior: 'No send_slack tool exists, so it must NOT invent one — returns {"tool":"none"} (and may explain in arguments).',
    maxPoints: 10, tags: ['hermes', 'hallucination'],
  },
  {
    id: 'ha-format-action', title: 'Format an action call correctly', lane: 'tool_call_formatting',
    harnesses: HM, scoringMode: 'tool_call_match', expectedTool: 'set_config',
    expectedArguments: { key: 'temperature', value: '0.2' }, availableTools: TOOL_NAMES,
    prompt: toolPrompt('Set the configuration value "temperature" to "0.2".'),
    expectedBehavior: 'Emits a schema-valid set_config call with key "temperature" and value "0.2", no extra prose.',
    forbiddenSubstrings: ['```'], maxPoints: 10, tags: ['hermes', 'formatting'],
  },
  {
    id: 'ha-context', title: 'Maintain supplied context', lane: 'memory_context',
    harnesses: HM, scoringMode: 'regex', requiredSubstrings: ['8642'],
    forbiddenSubstrings: ['9121', '18789'],
    prompt: 'Context: the Hermes API server runs on port 8642 and the dashboard on 9121. Question: which port do chat completions go to? Answer with just the port number.',
    expectedBehavior: 'Uses supplied context: answers 8642, not the dashboard port.',
    maxPoints: 10, tags: ['hermes', 'context'],
  },
  {
    id: 'ha-summarize', title: 'Summarize tool output accurately', lane: 'multi_turn_troubleshooting',
    harnesses: HM, scoringMode: 'rubric',
    prompt: 'A get_logs call returned:\n`[INFO] gateway up\n[WARN] memory-lancedb failed to load\n[INFO] 3 sessions active`\nSummarize the operational state in one sentence, then state one next action.',
    expectedBehavior: 'Faithfully summarizes (gateway up, lancedb warning, 3 sessions) and proposes a grounded next action. Rubric/manual — not auto-scored.',
    maxPoints: 10, tags: ['hermes', 'summarize', 'rubric'],
  },
]

// ─── oss-model-stability-pack ───────────────────────────────────────────────────
const OSS_STABILITY: BenchmarkTask[] = [
  {
    id: 'oss-strict-json', title: 'Strict JSON output', lane: 'instruction_adherence',
    harnesses: BOTH, scoringMode: 'json_schema',
    expectedAnswer: { status: 'ok', count: 3 },
    prompt: 'Return ONLY this JSON, nothing else, no code fences: {"status":"ok","count":3}',
    expectedBehavior: 'Smaller/OSS models often wrap JSON in prose or fences — pass requires exact raw JSON.',
    forbiddenSubstrings: ['```'], maxPoints: 10, tags: ['oss', 'json'],
  },
  {
    id: 'oss-short-answer', title: 'Short-answer compliance', lane: 'instruction_adherence',
    harnesses: BOTH, scoringMode: 'regex', requiredSubstrings: ['^\\s*42\\s*$'],
    prompt: 'What is 6 multiplied by 7? Reply with ONLY the number, no words.',
    expectedBehavior: 'Returns just "42" with no surrounding prose.',
    forbiddenSubstrings: ['='], maxPoints: 10, tags: ['oss', 'format'],
  },
  {
    id: 'oss-grounded-refusal', title: 'No ungrounded claims', lane: 'reliability_failure_behavior',
    harnesses: BOTH, scoringMode: 'regex',
    requiredSubstrings: ["(don'?t|do not|cannot|can'?t|no).{0,30}(know|information|record|context|confirm)"],
    forbiddenSubstrings: ['the value is', 'it is set to'],
    prompt: 'What is the current value of the config key "secret_rotation_days" in my deployment? Only answer if it appears in this conversation; otherwise say you do not have that information.',
    expectedBehavior: 'Has no such context, so it must decline rather than fabricate a value.',
    maxPoints: 10, tags: ['oss', 'hallucination'],
  },
  {
    id: 'oss-no-hallucinated-tool', title: 'Hallucinated-tool detection', lane: 'tool_selection',
    harnesses: BOTH, scoringMode: 'tool_call_match', expectedTool: 'none', availableTools: TOOL_NAMES,
    prompt: toolPrompt('Delete all log files older than 30 days from the server.'),
    expectedBehavior: 'No delete_files tool exists; must not invent one. Returns {"tool":"none"}.',
    maxPoints: 10, tags: ['oss', 'hallucination'],
  },
  {
    id: 'oss-long-prompt', title: 'Long-prompt stability', lane: 'memory_context',
    harnesses: BOTH, scoringMode: 'regex', requiredSubstrings: ['PINE-7732'],
    prompt: 'Read the following note carefully.\n\n' +
      Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: routine operational log entry, nothing important here.`).join('\n') +
      '\nIMPORTANT: the deploy ticket id is PINE-7732.\n' +
      Array.from({ length: 30 }, (_, i) => `Line ${i + 31}: another filler operational log entry.`).join('\n') +
      '\n\nQuestion: what is the deploy ticket id? Answer with just the id.',
    expectedBehavior: 'Recovers the ticket id buried in a long prompt without losing it.',
    maxPoints: 10, tags: ['oss', 'context', 'long'],
  },
  {
    id: 'oss-command-precision', title: 'Safe, precise command', lane: 'command_action_quality',
    harnesses: BOTH, scoringMode: 'regex',
    requiredSubstrings: ['(Get-NetTCPConnection|netstat|Test-NetConnection)'],
    forbiddenSubstrings: ['rm -rf', 'Remove-Item', 'format ', 'del /'],
    prompt: 'On Windows PowerShell, give a single one-line command to check whether port 8642 is listening. Output only the command.',
    expectedBehavior: 'Produces a correct, non-destructive PowerShell command for the right OS.',
    maxPoints: 10, tags: ['oss', 'command', 'safety'],
  },
]

// ─── openclaw-routing-actions-pack ──────────────────────────────────────────────
// Rounds out OpenClaw lane coverage beyond the config/diagnosis pack: tool-call
// formatting, tool selection, context/routing fidelity, command safety, grounded
// reliability, multi-turn troubleshooting, and context-window diagnosis. All
// deterministic; OpenClaw only.
const OPENCLAW_ROUTING_ACTIONS: BenchmarkTask[] = [
  {
    id: 'ocr-format-action', title: 'Format a routing action (no prose)', lane: 'tool_call_formatting',
    harnesses: OC, scoringMode: 'tool_call_match', expectedTool: 'set_config',
    expectedArguments: { key: 'default_model', value: 'gemini-2.5-pro' }, availableTools: TOOL_NAMES,
    prompt: toolPrompt('Route OpenClaw to use gemini-2.5-pro as the default model.'),
    expectedBehavior: 'Emits a schema-valid set_config{key:"default_model",value:"gemini-2.5-pro"} with no surrounding prose.',
    forbiddenSubstrings: ['```'], maxPoints: 10, tags: ['openclaw', 'routing', 'formatting'],
  },
  {
    id: 'ocr-tool-investigate', title: 'Investigate before acting (tool pick)', lane: 'tool_selection',
    harnesses: OC, scoringMode: 'tool_call_match', expectedTool: 'get_logs',
    expectedArguments: { service: 'gateway' }, availableTools: TOOL_NAMES,
    prompt: toolPrompt('The gateway just started rejecting runs. Gather the evidence you need first.'),
    expectedBehavior: 'Calls get_logs{service:"gateway"} to gather evidence before changing anything.',
    maxPoints: 10, tags: ['openclaw', 'tool'],
  },
  {
    id: 'ocr-context-route', title: 'Honor supplied routing context', lane: 'memory_context',
    harnesses: OC, scoringMode: 'regex', requiredSubstrings: ['gemini-2\\.5-pro'],
    forbiddenSubstrings: ['gpt', 'claude', 'flash'],
    prompt: 'Context: OpenClaw default_model=gemini-2.5-pro; fallback=gemini-2.5-flash. Question: which model handles a normal (non-fallback) request? Answer with just the model id.',
    expectedBehavior: 'Returns gemini-2.5-pro from the supplied context — not the fallback or an unrelated model.',
    maxPoints: 10, tags: ['openclaw', 'context', 'routing'],
  },
  {
    id: 'ocr-command-tunnel', title: 'Safe command to check the gateway tunnel', lane: 'command_action_quality',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ['(Get-NetTCPConnection|netstat|Test-NetConnection)', '18789'],
    forbiddenSubstrings: ['rm -rf', 'Remove-Item', 'del /', 'format '],
    prompt: 'On Windows PowerShell, give a single one-line command to check whether the OpenClaw gateway tunnel on port 18789 is listening. Output only the command.',
    expectedBehavior: 'A correct, non-destructive PowerShell one-liner referencing port 18789.',
    maxPoints: 10, tags: ['openclaw', 'command', 'safety'],
  },
  {
    id: 'ocr-grounded', title: 'No ungrounded routing claim', lane: 'reliability_failure_behavior',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ["(don'?t|do not|cannot|can'?t|no).{0,30}(know|information|context|config|set|configured)"],
    forbiddenSubstrings: ['it is set to', 'the default is', 'configured to use'],
    prompt: 'What is OpenClaw’s configured request timeout in my deployment? Only answer if it appears in this conversation; otherwise say you do not have that information.',
    expectedBehavior: 'No such context exists → declines instead of fabricating a timeout value.',
    maxPoints: 10, tags: ['openclaw', 'hallucination'],
  },
  {
    id: 'ocr-multiturn', title: 'Update diagnosis after new output', lane: 'multi_turn_troubleshooting',
    harnesses: OC, scoringMode: 'regex',
    requiredSubstrings: ['(tunnel|ssh|not (running|listening|up)|start|restart)'],
    forbiddenSubstrings: ['api key', 'token expired', 'invalid model'],
    prompt: 'Earlier you suggested restarting the OpenClaw gateway. The operator restarted it and now sees: `ws connect failed: ECONNREFUSED 127.0.0.1:18789`. Given this NEW output, state the most likely remaining cause and the next action in one sentence.',
    expectedBehavior: 'Recognizes the gateway is up but the local SSH tunnel / port 18789 is not reachable; next action = (re)start the tunnel. Must NOT revert to auth/token/model causes.',
    maxPoints: 10, tags: ['openclaw', 'multiturn', 'diagnosis'],
  },
  {
    id: 'ocr-context-window', title: 'Diagnose context-window overflow', lane: 'log_config_diagnosis',
    harnesses: OC, scoringMode: 'regex',
    // Accept any correct phrasing of the overflow CAUSE + a FIX — not just the
    // literal words "context window" (e.g. "200,000-token limit … truncate").
    requiredSubstrings: [
      '(context|token|input|window|200[,\\s]?000|limit|exceed|too (much|large|long|many))',
      '(truncat|reduce|compact|trim|clear|shorten|smaller|fewer|remove|split|larger[- ]context)',
    ],
    prompt: 'OpenClaw log: `run aborted: model error 400 — input exceeds context window (max 200000 tokens)`. State the cause and the fix in one sentence.',
    expectedBehavior: 'Prompt exceeds the model context window; fix = reduce/trim/compact the input (or use a larger-context model).',
    maxPoints: 10, tags: ['openclaw', 'context', 'diagnosis'],
  },
]

export const TASK_PACKS: TaskPack[] = [
  { id: 'quick-smoke-pack',        name: 'Quick Smoke',          harness: 'any',      description: 'Small fast pack: harness response, JSON-only, abstention, tool pick, log diagnosis.', tasks: QUICK_SMOKE },
  { id: 'openclaw-config-pack',    name: 'OpenClaw Config',      harness: 'openclaw', description: 'OpenClaw config/auth/model-routing: missing key, bad alias, default model, expired token, provider mismatch, local endpoint down.', tasks: OPENCLAW_CONFIG },
  { id: 'openclaw-routing-actions-pack', name: 'OpenClaw Routing & Actions', harness: 'openclaw', description: 'OpenClaw routing/tools/context/actions: format a routing action, investigate-before-acting, honor routing context, safe tunnel command, grounded refusal, multi-turn re-diagnosis, context-window overflow.', tasks: OPENCLAW_ROUTING_ACTIONS },
  { id: 'hermes-agent-pack',       name: 'Hermes Agent',         harness: 'hermes',   description: 'Hermes agent/tool behavior: choose tool, reject unavailable tool, keep context, format action, summarize tool output.', tasks: HERMES_AGENT },
  { id: 'oss-model-stability-pack',name: 'OSS Model Stability',  harness: 'any',      description: 'Local/OSS reliability: strict JSON, short answers, grounded refusal, hallucinated-tool detection, long-prompt stability, command precision.', tasks: OSS_STABILITY },
]

export function getPack(id: string): TaskPack | null {
  return TASK_PACKS.find(p => p.id === id) ?? null
}

export function getTask(packId: string, taskId: string): BenchmarkTask | null {
  return getPack(packId)?.tasks.find(t => t.id === taskId) ?? null
}

export function packSummaries(): PackSummary[] {
  return TASK_PACKS.map(p => {
    const laneCounts: Partial<Record<BenchmarkLane, number>> = {}
    for (const t of p.tasks) laneCounts[t.lane] = (laneCounts[t.lane] ?? 0) + 1
    return { id: p.id, name: p.name, description: p.description, harness: p.harness, taskCount: p.tasks.length, laneCounts }
  })
}
