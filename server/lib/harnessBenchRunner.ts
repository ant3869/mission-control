// title: Harness Benchmark runner (real execution + orchestration)
// path: server/lib/harnessBenchRunner.ts
// purpose: Execute a task pack THROUGH OpenClaw/Hermes (or any OpenAI-compatible
//          /v1 endpoint for OSS/local models), score each task deterministically,
//          classify failures, and persist results. Runs async with cancel +
//          rerun-failed support. Every dispatch is a real call — failures are
//          recorded as real failure types, never fabricated.

import { randomUUID } from 'crypto'
import { hermesChat } from './hermesApiServer.js'
import { isLive } from './connectors.js'
import { ensureConnected, request as ocRequest } from './openclawLive.js'
import { getPack } from './harnessBenchPacks.js'
import { scoreTask, type DispatchSnapshot } from './harnessBenchScoring.js'
import {
  createRun, getRun, updateRun, addResult, listResults, deleteResultsForTask,
} from './harnessBenchStore.js'
import type {
  BenchmarkHarness, BenchmarkTask, StartRunRequest, BenchmarkRun, ExecutionMode,
} from './harnessBenchTypes.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// In-memory cancel flags keyed by runId (cleared when the run settles).
const cancelled = new Set<string>()
export function requestCancel(runId: string) { cancelled.add(runId) }

// ─── low-level dispatch ─────────────────────────────────────────────────────────

interface DispatchResult extends DispatchSnapshot {
  latencyMs:     number
  raw:           unknown
  resolvedModel: string | null
  toolCalls:     number
}

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === 'text' ? String(b.text ?? '') : typeof b === 'string' ? b : '')).join('\n')
  }
  return ''
}

// OpenClaw's codex/agent runtime wraps the model's final answer in
// <final>…</final> (and may precede it with <thinking>…</thinking>). That's a
// harness artifact, not the model's content — scoring the wrapper would unfairly
// fail exact/regex/JSON tasks. Unwrap to the model's actual final answer; the
// raw transcript is still persisted untouched for inspection.
function unwrapFinal(s: string): string {
  const closed = s.match(/<final>([\s\S]*?)<\/final>/i)
  if (closed) return closed[1].trim()
  const open = s.match(/<final>([\s\S]*)$/i)
  if (open) return open[1].trim()
  // No <final> tag: still drop any <thinking>…</thinking> preamble.
  return s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
}

function countToolCalls(messages: any[]): { count: number; first: any } {
  let count = 0; let first: any = null
  for (const m of messages) {
    const calls = m?.tool_calls ?? m?.toolCalls
    if (Array.isArray(calls)) { count += calls.length; first ??= calls[0] }
    if (Array.isArray(m?.content)) for (const b of m.content) {
      const t = String(b?.type ?? '').toLowerCase()
      if (t === 'tool_use' || t === 'toolcall' || t === 'tool_call') { count++; first ??= b }
    }
  }
  return { count, first }
}

/** Generic OpenAI-compatible POST /chat/completions — used for endpoint overrides
 *  (OSS/local models on Ollama/LM Studio/vLLM, or a manual Hermes API URL). */
async function openaiCompatChat(baseUrl: string, token: string, model: string, prompt: string, timeoutMs: number): Promise<DispatchResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ model: model || 'auto', messages: [{ role: 'user', content: prompt }], stream: false }),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - start
    const text = await res.text()
    let raw: any = null
    try { raw = text ? JSON.parse(text) : null } catch { raw = { rawText: text.slice(0, 800) } }
    if (!res.ok) {
      const errText = (raw && (raw.error?.message ?? raw.message ?? raw.detail)) || text.slice(0, 300) || res.statusText
      return { ok: false, answer: '', status: 'error', httpStatus: res.status, error: `HTTP ${res.status} — ${errText}`,
        latencyMs, raw, resolvedModel: null, toolCalls: 0 }
    }
    const choice = raw?.choices?.[0]
    const answer = String(choice?.message?.content ?? choice?.text ?? '')
    const native = choice?.message?.tool_calls?.[0] ?? null
    return { ok: true, answer, status: answer ? 'completed' : 'no-response', httpStatus: res.status, error: null,
      latencyMs, raw, resolvedModel: raw?.model ?? null, nativeToolCall: native, toolCalls: native ? 1 : 0 }
  } catch (err: any) {
    const error = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (err?.message ?? 'fetch failed')
    return { ok: false, answer: '', status: 'error', httpStatus: null, error, latencyMs: Date.now() - start, raw: null, resolvedModel: null, toolCalls: 0 }
  } finally { clearTimeout(timer) }
}

async function dispatchHermes(prompt: string, model: string, timeoutMs: number): Promise<DispatchResult> {
  const r = await hermesChat(prompt, { model, timeoutMs })
  return {
    ok: r.ok, answer: r.answer, status: r.answer ? 'completed' : (r.ok ? 'no-response' : 'error'),
    httpStatus: r.status, error: r.error, latencyMs: r.latencyMs, raw: r.raw,
    resolvedModel: r.model, toolCalls: 0,
  }
}

async function dispatchOpenClaw(prompt: string, sessionKey: string, timeoutMs: number): Promise<DispatchResult> {
  const start = Date.now()
  try {
    await ensureConnected(12_000)
    await ocRequest('chat.send', { sessionKey, message: prompt, deliver: false, idempotencyKey: randomUUID() }, 12_000)
  } catch (err: any) {
    return { ok: false, answer: '', status: 'error', httpStatus: null,
      error: `OpenClaw chat.send failed: ${err?.message ?? err}`, latencyMs: Date.now() - start, raw: null, resolvedModel: null, toolCalls: 0 }
  }
  const deadline = start + timeoutMs
  let lastSig = ''; let stable = 0; let messages: any[] = []
  while (Date.now() < deadline) {
    await sleep(4000)
    const h = await ocRequest('chat.history', { sessionKey, limit: 50, maxChars: 200_000 }, 10_000).catch(() => null)
    messages = (h as any)?.messages ?? []
    const lastAssistant = [...messages].reverse().find(m => String(m.role) === 'assistant')
    const sig = `${messages.length}|${extractText(lastAssistant?.content).slice(-200)}`
    if (sig === lastSig && lastAssistant) { stable++; if (stable >= 2) break } else { stable = 0; lastSig = sig }
  }
  const lastAssistant = [...messages].reverse().find(m => String(m?.role) === 'assistant')
  const answer = unwrapFinal(extractText(lastAssistant?.content).trim())
  const tc = countToolCalls(messages)
  return {
    ok: !!answer, answer, status: answer ? 'completed' : 'no-response', httpStatus: null,
    error: answer ? null : 'OpenClaw returned no assistant reply within the time budget',
    latencyMs: Date.now() - start, raw: messages, resolvedModel: null,
    nativeToolCall: tc.first, toolCalls: tc.count,
  }
}

async function dispatch(req: StartRunRequest, task: BenchmarkTask, runId: string): Promise<DispatchResult> {
  const model = req.model ?? ''
  const perTaskTimeout = req.harness === 'openclaw' ? 150_000 : 120_000
  if (req.endpoint?.trim()) {
    return openaiCompatChat(req.endpoint.trim(), req.token ?? '', model, task.prompt, perTaskTimeout)
  }
  if (req.harness === 'hermes') return dispatchHermes(task.prompt, model, perTaskTimeout)
  const sessionKey = `agent:main:dashboard-benchmark:${runId.slice(0, 8)}-${task.id}`
  return dispatchOpenClaw(task.prompt, sessionKey, perTaskTimeout)
}

// ─── orchestration ──────────────────────────────────────────────────────────────

function tasksForRun(req: StartRunRequest): BenchmarkTask[] {
  const pack = getPack(req.taskPackId)
  if (!pack) return []
  let tasks = pack.tasks.filter(t => t.harnesses.includes(req.harness))
  if (req.onlyTaskIds?.length) tasks = tasks.filter(t => req.onlyTaskIds!.includes(t.id))
  return tasks
}

function autoScoreMax(tasks: BenchmarkTask[]): number {
  // Manual/rubric tasks don't contribute to the scoreable maximum.
  return tasks.filter(t => t.scoringMode !== 'rubric' && t.scoringMode !== 'manual_review')
    .reduce((s, t) => s + t.maxPoints, 0)
}

function recomputeAndFinalize(runId: string, finalStatus: BenchmarkRun['status']) {
  const results = listResults(runId)
  const scored = results.filter(r => r.status === 'passed' || r.status === 'failed')
  const totalScore = scored.reduce((s, r) => s + r.points, 0)
  const passed = scored.filter(r => r.status === 'passed').length
  const lat = results.map(r => r.latencyMs).filter((n): n is number => typeof n === 'number')
  const failureCount = results.filter(r => r.status === 'failed' || r.status === 'error').length
  updateRun(runId, {
    status: finalStatus,
    finishedAt: new Date().toISOString(),
    completedCount: results.length,
    totalScore,
    passRate: scored.length ? Math.round((passed / scored.length) * 100) : null,
    avgLatencyMs: lat.length ? Math.round(lat.reduce((s, n) => s + n, 0) / lat.length) : null,
    failureCount,
  })
  cancelled.delete(runId)
}

async function executeTasks(runId: string, req: StartRunRequest, tasks: BenchmarkTask[]) {
  for (const task of tasks) {
    if (cancelled.has(runId)) { recomputeAndFinalize(runId, 'cancelled'); return }
    let d: DispatchResult
    try {
      d = await dispatch(req, task, runId)
    } catch (err: any) {
      d = { ok: false, answer: '', status: 'error', httpStatus: null, error: String(err?.message ?? err),
        latencyMs: 0, raw: null, resolvedModel: null, toolCalls: 0 }
    }
    const outcome = scoreTask(task, d)
    deleteResultsForTask(runId, task.id) // idempotent for rerun
    addResult({
      runId, taskId: task.id, taskTitle: task.title, lane: task.lane,
      status: outcome.status, points: outcome.points, maxPoints: outcome.maxPoints,
      latencyMs: d.latencyMs, modelResponse: d.answer,
      rawHarnessOutput: d.raw, parsedToolCall: outcome.parsedToolCall,
      errorMessage: d.error ?? null, failureType: outcome.failureType,
      scoreReason: outcome.reason,
      notes: d.resolvedModel ? `resolved model: ${d.resolvedModel}${d.toolCalls ? ` · ${d.toolCalls} tool call(s)` : ''}` : (d.toolCalls ? `${d.toolCalls} tool call(s)` : ''),
      prompt: task.prompt, expectedBehavior: task.expectedBehavior,
    })
    // Incremental progress so the UI poller shows live advancement.
    const partial = listResults(runId)
    updateRun(runId, { completedCount: partial.length })
  }
  recomputeAndFinalize(runId, 'completed')
}

export interface StartResult { ok: boolean; run?: BenchmarkRun; error?: string }

export function startRun(req: StartRunRequest): StartResult {
  const pack = getPack(req.taskPackId)
  if (!pack) return { ok: false, error: `unknown task pack "${req.taskPackId}"` }
  const tasks = tasksForRun(req)
  if (tasks.length === 0) return { ok: false, error: `pack "${pack.name}" has no tasks for ${req.harness}` }

  // Gate: a real harness must be reachable, unless an explicit endpoint override
  // is supplied (OSS/local). We never silently fall back to a mock.
  const usingOverride = !!req.endpoint?.trim()
  if (!usingOverride && !isLive(req.harness)) {
    return { ok: false, error: `${req.harness} is not connected — enable it in Settings, or supply an OpenAI-compatible endpoint override.` }
  }

  const mode: ExecutionMode = req.mode ?? 'harness_direct'
  const provider = req.provider || (usingOverride ? 'custom-openai-compatible' : req.harness)
  const run = createRun({
    harness: req.harness, mode, modelName: req.model || 'auto', provider,
    endpoint: req.endpoint, taskPackId: pack.id, taskPackName: pack.name,
    taskCount: tasks.length, maxScore: autoScoreMax(tasks),
  })
  // Fire-and-forget; errors are captured per-task into result rows.
  executeTasks(run.id, req, tasks).catch(err => {
    updateRun(run.id, { status: 'failed', error: String(err?.message ?? err), finishedAt: new Date().toISOString() })
    cancelled.delete(run.id)
  })
  return { ok: true, run }
}

export function rerunFailed(runId: string): StartResult {
  const run = getRun(runId)
  if (!run) return { ok: false, error: 'run not found' }
  const failedTaskIds = listResults(runId)
    .filter(r => r.status === 'failed' || r.status === 'error')
    .map(r => r.taskId)
  if (failedTaskIds.length === 0) return { ok: false, error: 'no failed tasks to rerun' }

  const req: StartRunRequest = {
    harness: run.harness, taskPackId: run.taskPackId, model: run.modelName,
    provider: run.provider, endpoint: run.endpoint, mode: run.mode, onlyTaskIds: failedTaskIds,
  }
  const tasks = tasksForRun(req)
  if (tasks.length === 0) return { ok: false, error: 'failed tasks no longer exist in the pack' }

  updateRun(runId, { status: 'running', finishedAt: null, error: null })
  executeTasks(runId, req, tasks).catch(err => {
    updateRun(runId, { status: 'failed', error: String(err?.message ?? err), finishedAt: new Date().toISOString() })
    cancelled.delete(runId)
  })
  return { ok: true, run: getRun(runId)! }
}
