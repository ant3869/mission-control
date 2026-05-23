// title: Agent-driven inventory research
// path: server/lib/research.ts
// purpose: Ask a connected agent to research a hardware item and return a
//          structured spec sheet. Dashboard-orchestrated: we send a prompt over
//          the gateway, read the agent's reply on the same connection, and parse
//          the JSON ourselves — so it works even if the agent can't reach back.

import { randomUUID } from 'crypto'
import type { AgentSource } from './agentEvents.js'
import { isConnected, request as ocRequest } from './openclawLive.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => (b?.type === 'text' ? String(b.text ?? '') : typeof b === 'string' ? b : '')).join('\n')
  }
  return ''
}

function extractJson(text: string): any | null {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try { return JSON.parse(body.slice(start, end + 1)) } catch { return null }
}

export interface ResearchResult {
  summary?: string
  specs?: Record<string, string>
  manufacturer?: string
  model?: string
  estimatedValue?: number
  category?: string
  condition?: string
  datasheetUrl?: string
  sources?: Array<{ title: string; url: string }>
}

function buildPrompt(item: { name: string; manufacturer?: string; model?: string; category?: string }): string {
  const id = [item.name, item.manufacturer, item.model].filter(Boolean).join(' ')
  return [
    'You are enriching a hardware inventory catalog. Research the item below using web search.',
    'Reply with ONLY a single JSON object (no prose, no markdown fences). Keys:',
    'summary (1-2 sentence overview), specs (object of short key:value spec pairs),',
    'manufacturer, model, estimatedValue (typical used/market price in USD for ONE unit, number),',
    'category (one of: computer, laptop, sbc, microcontroller, storage, battery, power, console, peripheral, cable, component, sensor, network, tool, other),',
    'datasheetUrl (official datasheet/product URL if any), sources (array of {title,url} you used).',
    `Item: "${id}".`,
  ].join(' ')
}

/** Research via OpenClaw: send into an isolated session, poll its history for the JSON reply. */
async function researchOpenClaw(item: { id: string; name: string; manufacturer?: string; model?: string; category?: string }): Promise<ResearchResult> {
  if (!isConnected()) throw new Error('OpenClaw not connected — ensure the live connection is active in Settings')
  const sessionKey = `agent:main:dashboard-research:${item.id.slice(0, 8)}`
  await ocRequest('chat.send', { sessionKey, message: buildPrompt(item), deliver: false, idempotencyKey: randomUUID() }, 12_000)
  // Poll the isolated session for the agent's structured reply (agent runs take ~1-3 min).
  for (let i = 0; i < 36; i++) {
    await sleep(5000)
    const h = await ocRequest('chat.history', { sessionKey, limit: 8, maxChars: 120_000 }, 10_000).catch(() => null)
    const msgs: any[] = h?.messages ?? []
    const lastAssistant = [...msgs].reverse().find(m => String(m.role) === 'assistant')
    const json = extractJson(extractText(lastAssistant?.content))
    if (json && (json.summary || json.specs || json.model)) return json as ResearchResult
  }
  throw new Error('agent did not return structured data within ~3 minutes')
}

export async function researchItem(item: { id: string; name: string; manufacturer?: string; model?: string; category?: string }, source: AgentSource): Promise<ResearchResult> {
  if (source === 'openclaw') return researchOpenClaw(item)
  throw new Error('Auto-research currently supports OpenClaw only (Hermes has no synchronous chat over the dashboard connector).')
}
