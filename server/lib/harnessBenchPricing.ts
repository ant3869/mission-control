// title: Model family detection + token pricing (for fingerprint cost estimates)
// path: server/lib/harnessBenchPricing.ts
// purpose: Map a model name to its provider FAMILY (for the provider rollup) and
//          to per-token pricing (for the est. cost column). Prices are best-effort
//          USD per 1M tokens and are clearly surfaced as ESTIMATES in the UI —
//          when OpenClaw reports a real cost we use that instead.

export type ModelFamily = 'Anthropic' | 'OpenAI' | 'Google' | 'Meta' | 'Mistral' | 'Other'

export function deriveFamily(model: string): ModelFamily {
  const m = (model || '').toLowerCase()
  if (/claude|anthropic|opus|sonnet|haiku/.test(m)) return 'Anthropic'
  if (/gpt|openai|^o\d|chatgpt|davinci/.test(m)) return 'OpenAI'
  if (/gemini|gemma|palm|bison|google/.test(m)) return 'Google'
  if (/llama|meta-/.test(m)) return 'Meta'
  if (/mistral|mixtral|magistral/.test(m)) return 'Mistral'
  return 'Other'
}

export interface Price { input: number; output: number } // USD per 1M tokens

// Family-level defaults; model-substring overrides take precedence. These are
// deliberately conservative placeholders — edit to your contracted rates. Cost
// is always shown as an estimate, and real OpenClaw-reported cost overrides it.
const FAMILY_DEFAULT: Record<ModelFamily, Price> = {
  Anthropic: { input: 3.0,  output: 15.0 },
  OpenAI:    { input: 5.0,  output: 15.0 },
  Google:    { input: 1.25, output: 5.0  },
  Meta:      { input: 0.2,  output: 0.2  },
  Mistral:   { input: 0.4,  output: 2.0  },
  Other:     { input: 1.0,  output: 3.0  },
}

const OVERRIDES: Array<{ re: RegExp; price: Price }> = [
  { re: /opus/i,                price: { input: 15.0, output: 75.0 } },
  { re: /sonnet/i,              price: { input: 3.0,  output: 15.0 } },
  { re: /haiku/i,               price: { input: 0.8,  output: 4.0  } },
  { re: /gemini.*flash|flash/i, price: { input: 0.15, output: 0.6  } },
  { re: /gemini.*pro|gemini-\d/i, price: { input: 1.25, output: 5.0 } },
  { re: /gpt.*mini|o\d-mini/i,  price: { input: 0.6,  output: 2.4  } },
  { re: /gpt-5|gpt-4o|gpt-4\.1/i, price: { input: 5.0, output: 15.0 } },
]

export function priceFor(model: string): Price {
  for (const o of OVERRIDES) if (o.re.test(model || '')) return o.price
  return FAMILY_DEFAULT[deriveFamily(model)]
}

/** Estimate USD cost for one task turn given token counts. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(model)
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

/** Rough token estimate from text length (~4 chars/token) when no usage is reported. */
export function estimateTokens(chars: number): number {
  return Math.round(chars / 4)
}
