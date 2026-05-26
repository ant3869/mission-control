// title: Agent-driven inventory research
// path: server/lib/research.ts
// purpose: Ask a connected agent to research a hardware item and return a
//          structured spec sheet. Dashboard-orchestrated: we send a prompt over
//          the gateway, read the agent's reply on the same connection, and parse
//          the JSON ourselves — so it works even if the agent can't reach back.

import { randomUUID } from 'crypto'
import type { AgentSource } from './agentEvents.js'
import { ensureConnected, request as ocRequest } from './openclawLive.js'
import { hermesChat } from './hermesApiServer.js'

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

function buildPrompt(item: { name: string; manufacturer?: string; model?: string; category?: string; notes?: string; tags?: string[] }): string {
  const hasModel = Boolean(item.model?.trim())
  const hasMfr   = Boolean(item.manufacturer?.trim())

  // Build the most specific identifier possible. Avoid double-repeating tokens
  // that already appear in the name (e.g. name="Dell Precision 5570", model="5570").
  const nameLower  = item.name.toLowerCase()
  const modelPart  = hasModel && !nameLower.includes(item.model!.toLowerCase()) ? item.model! : ''
  const mfrPart    = hasMfr  && !nameLower.includes(item.manufacturer!.toLowerCase()) ? item.manufacturer! : ''
  const searchId   = [item.name, mfrPart, modelPart].filter(Boolean).join(' ')

  const specificityBlock = hasModel
    ? [
        `IMPORTANT: A specific model identifier is present ("${item.model}").`,
        'Research ONLY this exact model/SKU — do NOT summarise the product line or product family.',
        'All spec values must be for this specific model.',
        'If you cannot find information specific to this exact model, say so in the summary field.',
      ].join(' ')
    : [
        'No specific model is recorded for this item.',
        'A general overview of the product line or component type is acceptable.',
      ].join(' ')

  return [
    'You are enriching a hardware inventory catalog. Research the item below using web search.',
    specificityBlock,
    'Reply with ONLY a single JSON object (no prose, no markdown fences). Keys:',
    'summary (2-3 sentence overview specific to this exact item/model),',
    'specs (object of short key:value pairs — only specs that apply to this exact unit),',
    'manufacturer, model (exact model string, e.g. "Precision 5570"),',
    'estimatedValue (typical used/market price in USD for ONE unit, number),',
    'category (one of: computer, laptop, sbc, microcontroller, storage, battery, power, console, peripheral, cable, component, sensor, network, tool, other),',
    'datasheetUrl (official datasheet or product page URL for this specific model, if any),',
    'sources (array of {title,url} you used — prefer sources that mention the exact model).',
    `Item: "${searchId}".`,
    item.tags?.length ? `Known tags: ${item.tags.join(', ')}.` : '',
    item.notes?.trim() ? `User notes: ${item.notes.trim()}` : '',
  ].filter(Boolean).join(' ')
}

/** Research via OpenClaw: send into an isolated session, poll its history for the JSON reply. */
async function researchOpenClaw(item: { id: string; name: string; manufacturer?: string; model?: string; category?: string; notes?: string; tags?: string[] }): Promise<ResearchResult> {
  // Wait up to 12s for the persistent WebSocket to be ready.  This means
  // research works even when the Watch tab is closed; the WS spins up on demand.
  await ensureConnected(12_000)
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

/** Research via Hermes: POST to the API SERVER's OpenAI-compat chat-completion
 *  endpoint (Bearer-auth). The Hermes operator dashboard at 9119/9121 is a
 *  separate service and does NOT accept chat requests — see hermesApiServer.ts. */
async function researchHermes(item: { id: string; name: string; manufacturer?: string; model?: string; category?: string; notes?: string; tags?: string[] }): Promise<ResearchResult> {
  const prompt = buildPrompt(item)
  const r = await hermesChat(prompt, { timeoutMs: 180_000 })
  if (!r.ok) throw new Error(`Hermes API server rejected the request (${r.triedUrl}): ${r.error ?? 'unknown'}`)
  const json = extractJson(r.answer)
  if (json && (json.summary || json.specs || json.model)) return json as ResearchResult
  throw new Error('Hermes returned an answer but no parseable JSON spec sheet.')
}

export async function researchItem(item: { id: string; name: string; manufacturer?: string; model?: string; category?: string; notes?: string; tags?: string[] }, source: AgentSource): Promise<ResearchResult> {
  if (source === 'openclaw') return researchOpenClaw(item)
  if (source === 'hermes') {
    // Try Hermes first; if it has no usable chat API, fall back to OpenClaw.
    return researchHermes(item).catch(err => {
      if (String(err?.message).includes('unavailable') || String(err?.message).includes('no supported')) {
        return researchOpenClaw(item)
      }
      throw err
    })
  }
  throw new Error(`Unknown agent source: ${source}`)
}
