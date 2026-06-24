// title: Discord → Mission Control bot
// path: server/lib/discordBot.ts
// purpose: Listens for !-prefixed commands in Discord and creates items in
//          Mission Control by calling the local Express API. Starts only when
//          DISCORD_BOT_TOKEN is set. Optionally restrict to specific channel IDs
//          via DISCORD_CHANNEL_IDS (comma-separated).

import {
  Client, Events, GatewayIntentBits, Partials,
  type Message,
} from 'discord.js'

const PREFIX = '!'

// ─── Config ───────────────────────────────────────────────────────────────────

const ALLOWED_CHANNELS = (process.env.DISCORD_CHANNEL_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

function isAllowed(channelId: string): boolean {
  return ALLOWED_CHANNELS.length === 0 || ALLOWED_CHANNELS.includes(channelId)
}

// ─── Local API helper ─────────────────────────────────────────────────────────

let apiBase = ''

async function api(method: string, path: string, body?: object): Promise<any> {
  const r = await fetch(`${apiBase}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json?.error ?? `API ${method} ${path} → HTTP ${r.status}`)
  return json
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function extractSeverity(text: string): { severity: string; rest: string } {
  for (const s of ['critical', 'high', 'medium', 'low']) {
    const re = new RegExp(`\\b${s}\\b`, 'i')
    if (re.test(text)) return { severity: s, rest: text.replace(re, '').replace(/\s{2,}/g, ' ').trim() }
  }
  return { severity: 'medium', rest: text }
}

function extractDue(text: string): { due: string; rest: string } {
  const m = text.match(/\bdue:(\d{4}-\d{2}-\d{2})\b/i)
  return m
    ? { due: m[1], rest: text.replace(m[0], '').replace(/\s{2,}/g, ' ').trim() }
    : { due: '', rest: text }
}

function extractPrice(text: string): { price: number; rest: string } {
  const m = text.match(/\$?(\d+(?:\.\d{1,2})?)/i)
  if (!m) return { price: 0, rest: text }
  return { price: parseFloat(m[1]), rest: text.replace(m[0], '').replace(/\s{2,}/g, ' ').trim() }
}

function extractPriority(text: string): { priority: string; rest: string } {
  for (const p of ['high', 'medium', 'low']) {
    const re = new RegExp(`\\b${p}\\b`, 'i')
    if (re.test(text)) return { priority: p, rest: text.replace(re, '').replace(/\s{2,}/g, ' ').trim() }
  }
  return { priority: 'medium', rest: text }
}

// ─── Notes helpers ────────────────────────────────────────────────────────────

const DISCORD_NOTEBOOK = 'Discord'
const DISCORD_SECTION  = 'Quick Capture'

async function getOrCreateDiscordSection(): Promise<{ notebookId: string; sectionId: string }> {
  const { notebooks } = await api('GET', '/api/notes/notebooks')
  let nb = (notebooks as any[]).find(n => n.name === DISCORD_NOTEBOOK)
  if (!nb) {
    const r = await api('POST', '/api/notes/notebooks', { name: DISCORD_NOTEBOOK, color: '#5865F2', icon: '💬' })
    nb = r.notebook
  }
  const { sections } = await api('GET', `/api/notes/sections?notebookId=${nb.id}`)
  let sec = (sections as any[]).find(s => s.name === DISCORD_SECTION)
  if (!sec) {
    const r = await api('POST', '/api/notes/sections', { notebookId: nb.id, name: DISCORD_SECTION, color: '#5865F2' })
    sec = r.section
  }
  return { notebookId: nb.id, sectionId: sec.id }
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleTodo(args: string): Promise<string> {
  if (!args) return '❌  `!todo <title> [high|medium|low|critical] [due:YYYY-MM-DD]`'
  const { due, rest: afterDue } = extractDue(args)
  const { severity, rest: title } = extractSeverity(afterDue)
  if (!title) return '❌  A title is required — e.g. `!todo Pick up prescription high`'
  const { todo } = await api('POST', '/api/todos', { title, severity, dueDate: due })
  return `✅  **Todo added** — "${todo.title}" · *${todo.severity}*${due ? ` · due ${due}` : ''}`
}

async function handleBuy(args: string): Promise<string> {
  if (!args) return '❌  `!buy <item> [$price] [high|medium|low]`'
  const { priority: p1, rest: afterPriority } = extractPriority(args)
  const { price, rest: afterPrice } = extractPrice(afterPriority)
  const { priority, rest: title } = extractPriority(afterPrice)
  const finalTitle = (title || afterPriority || args).replace(/\bdue:\S+/gi, '').trim()
  if (!finalTitle) return '❌  An item name is required — e.g. `!buy AirPods Pro $249 high`'
  // Use the first priority found (from original string), then re-parse after price removed
  const usedPriority = args !== afterPriority ? p1 : priority
  const { item } = await api('POST', '/api/tobuy', { title: finalTitle, estimatedPrice: price, priority: usedPriority })
  const priceStr = price > 0 ? ` · ~$${price.toFixed(2)}` : ''
  return `🛒  **Buy item added** — "${item.title}" · *${item.priority}*${priceStr}`
}

async function handleSpend(args: string): Promise<string> {
  if (!args) return '❌  `!spend $<amount> <description> [category]`'
  const { price: amount, rest } = extractPrice(args)
  if (!amount) return '❌  Include an amount — e.g. `!spend $5.50 Coffee`'
  // Everything after the price is "description  category" (two+ spaces separate them)
  const parts = rest.split(/\s{2,}/)
  const description = parts[0]?.trim() || rest.trim()
  const category    = parts[1]?.trim() || 'Misc'
  if (!description) return '❌  A description is required — e.g. `!spend $12 Gas`'
  await api('POST', '/api/finance', { amount, description, category, source: 'discord' })
  return `💸  **Expense logged** — $${amount.toFixed(2)} · "${description}"${category !== 'Misc' ? ` · *${category}*` : ''}`
}

async function handleNote(args: string): Promise<string> {
  if (!args) return '❌  `!note <content>`'
  const { sectionId, notebookId } = await getOrCreateDiscordSection()
  const title = args.length > 60 ? args.slice(0, 57) + '…' : args
  await api('POST', '/api/notes/pages', {
    sectionId, notebookId,
    title,
    content: args,
    tags: ['discord'],
  })
  return `📝  **Note saved** — "${title}"`
}

async function handleInventory(args: string): Promise<string> {
  if (!args) return '❌  `!inventory <item name> [--research]`'
  const doResearch = /--research\b/i.test(args)
  const name = args.replace(/--research\b/i, '').replace(/\s{2,}/g, ' ').trim()
  if (!name) return '❌  An item name is required — e.g. `!inventory Raspberry Pi 4`'
  const { item } = await api('POST', '/api/inventory', { name, addedBy: 'discord' })
  if (doResearch) {
    // Fire-and-forget; the UI shows live research progress
    api('POST', `/api/inventory/${item.id}/research`, { source: 'openclaw' }).catch(() => {})
    return `📦  **Inventory added** — "${name}" · research triggered via OpenClaw`
  }
  return `📦  **Inventory added** — "${name}" · add \`--research\` to trigger agent enrichment`
}

async function handleTask(args: string): Promise<string> {
  if (!args) return '❌  `!task <title> [high|medium|low] [due:YYYY-MM-DD]`'
  const { due, rest: afterDue } = extractDue(args)
  const { rest: title } = extractSeverity(afterDue)
  if (!title && !afterDue) return '❌  A title is required — e.g. `!task Review quarterly report`'
  const { task } = await api('POST', '/api/tasks', { title: title || afterDue, dueDate: due })
  return `📋  **Task added** — "${task?.title ?? title || afterDue}"${due ? ` · due ${due}` : ''}`
}

function helpText(): string {
  return [
    '**Mission Control — Discord Commands**',
    '',
    '`!todo <title> [high|medium|low|critical] [due:YYYY-MM-DD]`',
    '`!buy <item> [$price] [high|medium|low]`',
    '`!spend $<amount> <description>  [category]`  *(two spaces before category)*',
    '`!task <title> [due:YYYY-MM-DD]`',
    '`!note <content>`',
    '`!inventory <name> [--research]`',
    '`!help`',
  ].join('\n')
}

// ─── Bot entry point ──────────────────────────────────────────────────────────

export function startDiscordBot(port: number | string): void {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.log('[discord] DISCORD_BOT_TOKEN not set — bot disabled')
    return
  }

  apiBase = `http://localhost:${port}`

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],  // required for DM support
  })

  client.once(Events.ClientReady, c => {
    console.log(`[discord] Bot ready — logged in as ${c.user.tag}`)
    if (ALLOWED_CHANNELS.length) console.log(`[discord] Watching channels: ${ALLOWED_CHANNELS.join(', ')}`)
    else console.log('[discord] Watching all channels (set DISCORD_CHANNEL_IDS to restrict)')
  })

  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return
    if (!message.content.startsWith(PREFIX)) return
    if (!isAllowed(message.channelId)) return

    const raw  = message.content.slice(PREFIX.length).trim()
    const spaceIdx = raw.indexOf(' ')
    const cmd  = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toLowerCase()
    const args = (spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1)).trim()

    let reply: string
    try {
      switch (cmd) {
        case 'todo':      reply = await handleTodo(args);      break
        case 'buy':       reply = await handleBuy(args);       break
        case 'spend':     reply = await handleSpend(args);     break
        case 'note':      reply = await handleNote(args);      break
        case 'inventory': reply = await handleInventory(args); break
        case 'task':      reply = await handleTask(args);      break
        case 'help':      reply = helpText();                  break
        default:          return  // silently ignore unknown commands
      }
    } catch (err) {
      reply = `⚠️  Error: ${err instanceof Error ? err.message : String(err)}`
    }

    await message.reply(reply).catch(e => console.error('[discord] reply failed:', e.message))
  })

  client.login(token).catch(err => {
    console.error('[discord] Login failed:', err.message)
  })
}
