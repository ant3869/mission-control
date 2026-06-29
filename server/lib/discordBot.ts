// title: Discord ↔ Mission Control bot
// path: server/lib/discordBot.ts
// purpose: Full bidirectional integration.
//   INBOUND  — !-prefixed commands create todos, tasks, shopping items, notes,
//              inventory entries, and expense records in Mission Control.
//   QUERY    — !list, !agenda, !balance, !find read live data back to Discord.
//   BUTTONS  — Approval requests are posted with Approve/Reject buttons;
//              clicking them resolves the approval without opening the UI.
//   PUSH     — Proactive notifications for approvals, research completion,
//              due-date reminders, and fired alerts land in the notify channel.
//
// Required env:
//   DISCORD_BOT_TOKEN          — bot token (mandatory, bot skips if absent)
//   DISCORD_CHANNEL_IDS        — comma-sep channel IDs that accept commands
//                                (empty = all channels the bot can see)
//   DISCORD_NOTIFY_CHANNEL_ID  — channel for proactive push notifications
//                                (empty = push notifications disabled)

import {
  Client, Events, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  type Message, type ButtonInteraction, type TextChannel,
  type MessageCreateOptions, ComponentType,
} from 'discord.js'
import {
  extractSeverity, extractDue, extractPrice, extractPriority, extractFlag, extractFlagInt,
  parseSpend, formatDueDate, fmtList, fmtMoney,
} from './discordParsers.js'
import { discordNotifier, type ApprovalEvent, type ResearchDoneEvent, type AlertFiredEvent, type BriefingEvent } from './discordNotifier.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const PREFIX = '!'

const ALLOWED_CHANNELS = (process.env.DISCORD_CHANNEL_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

const NOTIFY_CHANNEL_ID = (process.env.DISCORD_NOTIFY_CHANNEL_ID ?? '').trim()

function isAllowed(channelId: string): boolean {
  return ALLOWED_CHANNELS.length === 0 || ALLOWED_CHANNELS.includes(channelId)
}

const ALLOWED_USER_IDS = (process.env.DISCORD_ALLOWED_USER_IDS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean)

function isAllowedUser(userId: string): boolean {
  return ALLOWED_USER_IDS.length === 0 || ALLOWED_USER_IDS.includes(userId)
}

// ─── Shared state (set once the bot is ready) ─────────────────────────────────

let apiBase      = ''
let notifyChannel: TextChannel | null = null

// Due-date reminder tracking: maps "itemId:dueDate" to Date it was last notified.
// Cleared daily to allow re-notification the following day.
const notifiedDue = new Set<string>()
// Active alert fingerprints (ruleId+firedAt) already posted to Discord.
const notifiedAlerts = new Set<string>()

// ─── Local API helper ─────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: object): Promise<any> {
  const url  = `${apiBase}${path}`
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const r    = await fetch(url, opts)
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status} ${method} ${path}`)
  return json
}

// ─── Notification channel helper ─────────────────────────────────────────────

async function sendNotification(
  content: string,
  options: Omit<MessageCreateOptions, 'content'> = {},
): Promise<Message | null> {
  if (!notifyChannel) return null
  try {
    return await notifyChannel.send({ content, ...options })
  } catch (e) {
    console.error('[discord] sendNotification failed:', (e as Error).message)
    return null
  }
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

// ─── Create command handlers ──────────────────────────────────────────────────

async function handleTodo(args: string): Promise<string> {
  if (!args) return '❌  `!todo <title> [high|medium|low|critical] [due:YYYY-MM-DD]`'
  const { due, rest: afterDue }       = extractDue(args)
  const { severity, rest: title }     = extractSeverity(afterDue)
  if (!title.trim()) return '❌  A title is required — e.g. `!todo Pick up prescription high`'
  const { todo } = await api('POST', '/api/todos', { title: title.trim(), severity, dueDate: due })
  const dueStr   = due ? ` · due **${formatDueDate(due)}**` : ''
  return `✅  **Todo added** — "${todo.title}" · *${todo.severity}*${dueStr}`
}

async function handleBuy(args: string): Promise<string> {
  if (!args) return '❌  `!buy <item> [$price] [high|medium|low]`'
  const { priority, rest: afterPri }    = extractPriority(args)
  const { price, rest: afterPrice }     = extractPrice(afterPri)
  const { priority: _, rest: title }    = extractPriority(afterPrice)
  const finalTitle = (title || afterPrice || args).replace(/\bdue:\S+/gi, '').trim()
  if (!finalTitle) return '❌  An item name is required — e.g. `!buy AirPods Pro $249 high`'
  const { item } = await api('POST', '/api/tobuy', { title: finalTitle, estimatedPrice: price, priority })
  const priceStr = price > 0 ? ` · ~${fmtMoney(price)}` : ''
  return `🛒  **Buy item added** — "${item.title}" · *${item.priority}*${priceStr}`
}

async function handleSpend(args: string): Promise<string> {
  if (!args) return '❌  `!spend $<amount> <description>  [category]`  *(two spaces before optional category)*'
  const parsed = parseSpend(args)
  if (!parsed) return '❌  Include a $ amount — e.g. `!spend $5.50 Coffee`'
  await api('POST', '/api/finance', { ...parsed, source: 'discord' })
  return `💸  **Expense logged** — ${fmtMoney(parsed.amount)} · "${parsed.description}"${parsed.category !== 'Misc' ? ` · *${parsed.category}*` : ''}`
}

async function handleNote(args: string): Promise<string> {
  if (!args) return '❌  `!note <content>`'
  const { sectionId, notebookId } = await getOrCreateDiscordSection()
  const title = args.length > 60 ? args.slice(0, 57) + '…' : args
  await api('POST', '/api/notes/pages', { sectionId, notebookId, title, content: args, tags: ['discord'] })
  return `📝  **Note saved** — "${title}"`
}

async function handleAccount(args: string): Promise<string> {
  const trimmed = args.trim()

  // !account list — show holdings + net worth
  if (!trimmed || trimmed.toLowerCase() === 'list') {
    const { entries, summary } = await api('GET', '/api/financials')
    const all = entries as any[]
    if (!all.length) return '🏦  No account entries yet. Use `!account <label> $<amount> [asset|liability] [category]` to add one.'
    const assets  = all.filter((e: any) => e.kind === 'asset')
    const liabs   = all.filter((e: any) => e.kind === 'liability')
    const lines: string[] = ['**🏦 Account Holdings**\n']
    if (assets.length) {
      lines.push('**Assets**')
      for (const e of assets) lines.push(`• **${e.label}** — ${fmtMoney(e.amount)} *(${e.category})*`)
    }
    if (liabs.length) {
      lines.push('\n**Liabilities**')
      for (const e of liabs) lines.push(`• **${e.label}** — ${fmtMoney(e.amount)} *(${e.category})*`)
    }
    lines.push(`\n**Net Worth: ${fmtMoney(summary.netWorth)}**  _(assets ${fmtMoney(summary.assets)} − liabilities ${fmtMoney(summary.liabilities)})_`)
    return fmtList(lines, '')
  }

  // Parse: <label> $<amount> [asset|liability] [category]
  // Prefer a $-prefixed amount; fall back to bare number only if no $ found.
  const priceMatch = trimmed.match(/\$([\d,]+(?:\.\d{1,2})?)/) ?? trimmed.match(/(?<!\w)([\d,]+(?:\.\d{1,2})?)(?!\w)/)
  if (!priceMatch) return '❌  Include an amount — e.g. `!account "Checking" $2500 asset bank`'
  const amount   = parseFloat(priceMatch[1].replace(/,/g, ''))
  if (!Number.isFinite(amount) || amount < 0) return '❌  Amount must be a positive number.'
  const matchIdx  = trimmed.indexOf(priceMatch[0])
  const beforeAmt = trimmed.slice(0, matchIdx).trim().replace(/^["']|["']$/g, '')
  const label = beforeAmt || 'Account'
  const afterAmt  = trimmed.slice(matchIdx + priceMatch[0].length).trim().toLowerCase()
  const kind: 'asset' | 'liability' = afterAmt.includes('liability') || afterAmt.includes('debt') ? 'liability' : 'asset'
  const catWords = afterAmt.replace(/liability|asset|debt/g, '').trim().split(/\s+/).filter(Boolean)
  const category = catWords[0] ?? (kind === 'liability' ? 'other' : 'cash')

  // Upsert: update if a same-label entry exists, otherwise create
  const { entries } = await api('GET', '/api/financials')
  const existing = (entries as any[]).find((e: any) => e.label.toLowerCase() === label.toLowerCase())
  if (existing) {
    await api('PATCH', `/api/financials/${existing.id}`, { amount, kind, category })
    return `🏦  **${label}** updated → ${fmtMoney(amount)} *(${kind} · ${category})*`
  }
  await api('POST', '/api/financials', { label, kind, category, amount })
  return `🏦  **${label}** added — ${fmtMoney(amount)} *(${kind} · ${category})*`
}

// !inventory <name> [--cat <category>] [--qty <n>] [--loc <location>]
//                   [--cond working|untested|partial|broken]
//                   [--val $<price>] [--notes <text>]
//                   [--status available|in-use|reserved] [--research]
// !inv status <name> <available|in-use|reserved>   — quick deployment flip
// !inv find  <query>                                — search inventory
async function handleInventory(args: string): Promise<string> {
  if (!args) {
    return [
      '❌  Usage:',
      '`!inventory <name> [--cat <cat>] [--qty <n>] [--loc <location>]`',
      '`               [--cond working|untested|partial|broken] [--val $<price>]`',
      '`               [--notes <text>] [--status available|in-use|reserved] [--research]`',
      '`!inv status <name> <available|in-use|reserved>`',
      '`!inv find <query>`',
    ].join('\n')
  }

  // Sub-commands via !inv alias (routed here with full args)
  const firstWord = args.split(/\s+/)[0].toLowerCase()

  if (firstWord === 'status') {
    const rest  = args.slice(firstWord.length).trim()
    const VALID = ['available', 'in-use', 'reserved'] as const
    const newStatus = VALID.find(s => rest.toLowerCase().endsWith(s))
    if (!newStatus) return `❌  Valid statuses: ${VALID.join(' | ')}`
    const nameQuery = rest.slice(0, rest.toLowerCase().lastIndexOf(newStatus)).trim()
    if (!nameQuery) return '❌  `!inv status <name> <available|in-use|reserved>`'
    const { items } = await api('GET', '/api/inventory')
    const match = (items as any[]).find((i: any) => i.name.toLowerCase().includes(nameQuery.toLowerCase()))
    if (!match) return `❌  No inventory item matching "${nameQuery}"`
    await api('PATCH', `/api/inventory/${match.id}`, { status: newStatus })
    const icon = newStatus === 'in-use' ? '🔴' : newStatus === 'reserved' ? '🟡' : '🟢'
    return `${icon}  **${match.name}** → \`${newStatus}\``
  }

  if (firstWord === 'find') {
    const query = args.slice(firstWord.length).trim()
    if (!query) return '❌  `!inv find <query>`'
    const { items } = await api('GET', '/api/inventory')
    const q = query.toLowerCase()
    const hits = (items as any[]).filter((i: any) =>
      i.name.toLowerCase().includes(q) ||
      i.category?.toLowerCase().includes(q) ||
      i.location?.toLowerCase().includes(q) ||
      i.tags?.some((t: string) => t.toLowerCase().includes(q))
    )
    if (!hits.length) return `🔍  No inventory items matching "${query}".`
    const lines = hits.slice(0, 15).map((i: any) => {
      const s = i.status === 'in-use' ? '🔴' : i.status === 'reserved' ? '🟡' : '🟢'
      const v = i.estimatedValue > 0 ? ` · ~${fmtMoney(i.estimatedValue)}` : ''
      const loc = i.location ? ` · 📍 ${i.location}` : ''
      return `${s} **${i.name}** · ${i.category} · *${i.condition}*${v}${loc}`
    })
    return fmtList(lines, `**📦 Inventory search: "${query}"** · ${hits.length} result${hits.length === 1 ? '' : 's'}`)
  }

  // Create: extract flags, remainder is the item name
  const doResearch = /--research\b/i.test(args)
  let rest = args.replace(/--research\b/i, '').trim()

  const { value: cat,      rest: r1 } = extractFlag(rest, 'cat')
  rest = r1
  const { value: loc,      rest: r2 } = extractFlag(rest, 'loc')
  rest = r2
  const { value: cond,     rest: r3 } = extractFlag(rest, 'cond')
  rest = r3
  const { value: notes,    rest: r4 } = extractFlag(rest, 'notes')
  rest = r4
  const { value: statusRaw,rest: r5 } = extractFlag(rest, 'status')
  rest = r5
  const { value: mfr,      rest: r6 } = extractFlag(rest, 'mfr')
  rest = r6
  const { value: model,    rest: r7 } = extractFlag(rest, 'model')
  rest = r7
  const { value: qtyStr,   rest: r8 } = extractFlag(rest, 'qty')
  rest = r8
  const { price: val,      rest: r9 } = extractPrice(rest.replace(/--val\s*/i, ''))
  // If --val flag was present, use extracted price; otherwise use price from leftover rest
  const hasValFlag = /--val\b/i.test(rest)
  rest = hasValFlag ? r9 : rest

  const qty    = qtyStr ? Math.max(1, parseInt(qtyStr, 10) || 1) : undefined
  const status = ['available', 'in-use', 'reserved'].includes(statusRaw) ? statusRaw : undefined
  const name   = rest.replace(/\s{2,}/g, ' ').trim()

  if (!name) return '❌  An item name is required — e.g. `!inventory Raspberry Pi 4 --cat sbc --qty 2`'

  const body: Record<string, unknown> = { name, addedBy: 'discord' }
  if (cat)    body.category        = cat
  if (qty)    body.quantity        = qty
  if (loc)    body.location        = loc
  if (cond)   body.condition       = cond
  if (notes)  body.notes          = notes
  if (status) body.status         = status
  if (mfr)    body.manufacturer   = mfr
  if (model)  body.model          = model
  if (hasValFlag && val > 0) body.estimatedValue = val

  const { item } = await api('POST', '/api/inventory', body)

  if (doResearch) {
    api('POST', `/api/inventory/${item.id}/research`, { source: 'openclaw' }).catch(() => {})
  }

  const parts: string[] = [`📦  **Inventory added** — "${item.name}"`]
  if (cat)    parts.push(`cat: *${cat}*`)
  if (qty && qty > 1) parts.push(`×${qty}`)
  if (loc)    parts.push(`📍 ${loc}`)
  if (cond)   parts.push(`cond: *${cond}*`)
  if (hasValFlag && val > 0) parts.push(`~${fmtMoney(val)}`)
  if (doResearch) parts.push('research queued via OpenClaw')

  return parts.join(' · ')
}

async function handleTask(args: string): Promise<string> {
  if (!args) return '❌  `!task <title> [due:YYYY-MM-DD]`'
  const { due, rest: afterDue }   = extractDue(args)
  const title = afterDue.trim() || args.trim()
  if (!title) return '❌  A title is required — e.g. `!task Review Q3 report`'
  const { task } = await api('POST', '/api/tasks', { title, dueDate: due })
  const dueStr = due ? ` · due **${formatDueDate(due)}**` : ''
  return `📋  **Task added** — "${task?.title ?? title}"${dueStr}`
}

async function handleDone(args: string): Promise<string> {
  if (!args) return '❌  `!done <todo title or partial match>`'
  const { todos } = await api('GET', '/api/todos')
  const open = (todos as any[]).filter((t: any) => !t.done)
  const query = args.trim().toLowerCase()
  const match = open.find((t: any) => t.title.toLowerCase().includes(query))
  if (!match) return `❌  No open todo matching "${args}"`
  await api('PATCH', `/api/todos/${match.id}`, { done: true })
  return `✅  **Done** — "${match.title}"`
}

async function handleTaskDone(args: string): Promise<string> {
  if (!args) return '❌  `!task done <title or partial match>`'
  const { tasks } = await api('GET', '/api/tasks')
  const active = (tasks as any[]).filter((t: any) => t.status !== 'completed')
  const query  = args.trim().toLowerCase()
  const match  = active.find((t: any) => t.title.toLowerCase().includes(query))
  if (!match) return `❌  No active task matching "${args}"`
  await api('PATCH', `/api/tasks/${match.id}`, { status: 'completed' })
  return `✅  **Task completed** — "${match.title}"`
}

async function handleBudget(): Promise<string> {
  const [budgetRes, metricsOcRes, metricsHRes] = await Promise.allSettled([
    api('GET', '/api/budgets'),
    api('GET', '/api/openclaw/metrics'),
    api('GET', '/api/hermes/metrics'),
  ])

  const budget = budgetRes.status === 'fulfilled' ? budgetRes.value : null
  const today  = new Date().toISOString().slice(0, 10)
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)

  let todayCost = 0, todayTokens = 0, weekCost = 0, weekTokens = 0

  for (const r of [metricsOcRes, metricsHRes]) {
    if (r.status !== 'fulfilled') continue
    const daily: any[] = r.value?.metrics?.daily ?? []
    for (const d of daily) {
      if (d.date === today) { todayCost += d.cost ?? 0; todayTokens += d.tokens ?? 0 }
      if (d.date >= weekAgo) { weekCost  += d.cost ?? 0; weekTokens  += d.tokens ?? 0 }
    }
  }

  const lines: string[] = ['**💰 Budget**', '']

  function gauge(label: string, used: number, limit: number | null, fmt: (n: number) => string): string {
    if (!limit) return `${label}: **${fmt(used)}** *(no limit)*`
    const pct   = Math.min(100, Math.round((used / limit) * 100))
    const emoji = pct >= 90 ? '🔴' : pct >= 70 ? '🟡' : '🟢'
    const bar   = '█'.repeat(Math.round(pct / 10)).padEnd(10, '░')
    return `${emoji} ${label}: **${fmt(used)}** / ${fmt(limit)} · \`${bar}\` ${pct}%`
  }

  const dailyCost   = budget?.daily?.cost   ?? null
  const dailyTok    = budget?.daily?.tokens  ?? null
  const weeklyCost  = budget?.weekly?.cost   ?? null
  const weeklyTok   = budget?.weekly?.tokens ?? null

  lines.push('**Today**')
  lines.push(gauge('Cost',   todayCost,   dailyCost,  fmtMoney))
  if (dailyTok || todayTokens > 0)
    lines.push(gauge('Tokens', todayTokens, dailyTok,  n => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}k` : String(Math.round(n))))

  lines.push('')
  lines.push('**This week**')
  lines.push(gauge('Cost',   weekCost,   weeklyCost, fmtMoney))
  if (weeklyTok || weekTokens > 0)
    lines.push(gauge('Tokens', weekTokens, weeklyTok,  n => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}k` : String(Math.round(n))))

  if (!dailyCost && !dailyTok && !weeklyCost && !weeklyTok) {
    lines.push('\n*No budget limits set. Use the Health → Budget tab in Mission Control to configure.*')
  }

  return lines.join('\n')
}

async function handleStatus(): Promise<string> {
  const [sysRes, alertRes] = await Promise.allSettled([
    api('GET', '/api/system/connectivity'),
    api('GET', '/api/alerts/active'),
  ])
  const lines: string[] = ['**Mission Control · Status**', '']

  if (sysRes.status === 'fulfilled') {
    const indicators: any[] = (sysRes.value as any).indicators ?? []
    for (const ind of indicators) {
      const icon = ind.status === 'ok' ? '🟢' : ind.status === 'degraded' ? '🟠' : '🔴'
      lines.push(`${icon} **${ind.label}** — ${ind.detail}`)
    }
  } else {
    lines.push('⚠️  Could not reach system API')
  }

  if (alertRes.status === 'fulfilled') {
    const active: any[] = (alertRes.value as any).alerts ?? []
    if (active.length === 0) {
      lines.push('\n✅  No active alerts')
    } else {
      lines.push('')
      for (const a of active) {
        const e = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟠' : 'ℹ️'
        lines.push(`${e} **${a.ruleName}** — ${a.message}`)
      }
    }
  }

  return lines.join('\n').slice(0, 2000)
}

// ─── Query command handlers ───────────────────────────────────────────────────

const SEV_EMOJI: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' }
const PRI_EMOJI: Record<string, string> = { high: '🟠', medium: '🟡', low: '⚪', urgent: '🔴' }

async function handleList(sub: string): Promise<string> {
  const [target, filter = ''] = sub.trim().toLowerCase().split(/\s+/)

  switch (target) {
    case 'todo':
    case 'todos': {
      const { todos } = await api('GET', '/api/todos')
      const all = todos as any[]
      const shown = filter === 'all' ? all
        : filter === 'done' ? all.filter((t: any) => t.done)
        : filter === 'high' ? all.filter((t: any) => !t.done && (t.severity === 'high' || t.severity === 'critical'))
        : filter === 'critical' ? all.filter((t: any) => !t.done && t.severity === 'critical')
        : all.filter((t: any) => !t.done)
      if (!shown.length) return `📋  No ${filter || 'open'} todos.`
      const lines = shown.map((t: any) => {
        const e = SEV_EMOJI[t.severity] ?? '⚪'
        const d = t.dueDate ? ` · *${formatDueDate(t.dueDate.slice(0, 10))}*` : ''
        return `${e} **${t.title}**${d}`
      })
      return fmtList(lines, `**Todos** · ${shown.length} ${filter || 'open'}`)
    }

    case 'task':
    case 'tasks': {
      const { tasks } = await api('GET', '/api/tasks')
      const all = tasks as any[]
      const shown = filter === 'all' ? all
        : filter === 'done' || filter === 'completed' ? all.filter((t: any) => t.status === 'completed')
        : filter === 'queued' ? all.filter((t: any) => t.status === 'queued')
        : all.filter((t: any) => t.status === 'active' || t.status === 'queued')
      if (!shown.length) return `📋  No ${filter || 'active'} tasks.`
      const lines = shown.map((t: any) => {
        const e = PRI_EMOJI[t.priority] ?? '⚪'
        const d = t.dueDate ? ` · *${formatDueDate(t.dueDate.slice ? t.dueDate.slice(0, 10) : t.dueDate)}*` : ''
        return `${e} **${t.title}** · \`${t.status}\`${d}`
      })
      return fmtList(lines, `**Tasks** · ${shown.length} ${filter || 'active/queued'}`)
    }

    case 'buy':
    case 'tobuy':
    case 'shopping': {
      const { items } = await api('GET', '/api/tobuy')
      const all = items as any[]
      const shown = filter === 'all' ? all
        : filter === 'done' || filter === 'purchased' ? all.filter((i: any) => i.purchased)
        : all.filter((i: any) => !i.purchased)
      if (!shown.length) return `🛒  No ${filter || 'pending'} shopping items.`
      const lines = shown.map((i: any) => {
        const p  = i.estimatedPrice > 0 ? ` · ~${fmtMoney(i.estimatedPrice)}` : ''
        const e  = PRI_EMOJI[i.priority] ?? '⚪'
        return `${e} **${i.title}**${p}`
      })
      const total = shown.filter((i: any) => !i.purchased).reduce((s: number, i: any) => s + (i.estimatedPrice || 0) * (i.quantity || 1), 0)
      const footer = total > 0 ? `\n*Estimated total: ${fmtMoney(total)}*` : ''
      return fmtList(lines, `**Shopping List** · ${shown.length} ${filter || 'pending'}`, footer)
    }

    case 'spend':
    case 'finance':
    case 'expenses': {
      const { entries, total } = await api('GET', '/api/finance')
      const all = (entries as any[])
      const now    = new Date()
      const shown  = filter === 'all' ? all
        : all.filter((e: any) => {
            const d = new Date(e.createdAt)
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
          })
      if (!shown.length) return `💸  No ${filter === 'all' ? '' : 'this-month '}expense entries.`
      const monthTotal = shown.reduce((s: number, e: any) => s + e.amount, 0)
      const lines = shown.slice(0, 20).map((e: any) => {
        const d = new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        return `• ${d} — **${fmtMoney(e.amount)}** ${e.description} *(${e.category})*`
      })
      const header = filter === 'all'
        ? `**All Expenses** · total ${fmtMoney(total)}`
        : `**Expenses this month** · ${fmtMoney(monthTotal)}`
      return fmtList(lines, header)
    }

    case 'approvals': {
      const { approvals } = await api('GET', '/api/approvals')
      const all = approvals as any[]
      const shown = filter === 'all' ? all : all.filter((a: any) => a.status === 'pending')
      if (!shown.length) return `✅  No ${filter || 'pending'} approvals.`
      const lines = shown.map((a: any) => {
        const u = a.urgency === 'urgent' ? '🔴' : a.urgency === 'normal' ? '🟡' : '⚪'
        const s = a.status === 'approved' ? '✅' : a.status === 'rejected' ? '❌' : '⏳'
        return `${u}${s} **${a.title}** · *${a.agentName}* · \`${a.type}\``
      })
      return fmtList(lines, `**Approvals** · ${shown.length} ${filter || 'pending'}`)
    }

    case 'inventory':
    case 'inv': {
      const { items, stats } = await api('GET', '/api/inventory')
      const all = items as any[]
      // filter can be a category ("sbc", "computer"), a status ("in-use"), or condition
      const shown = !filter || filter === 'all' ? all
        : all.filter((i: any) =>
            i.status === filter || i.category === filter || i.condition === filter
          )
      if (!shown.length) return `📦  No inventory items${filter ? ` matching "${filter}"` : ''}.`
      const S = stats as any
      const lines = shown.slice(0, 20).map((i: any) => {
        const dot  = i.status === 'in-use' ? '🔴' : i.status === 'reserved' ? '🟡' : '🟢'
        const val  = i.estimatedValue > 0 ? ` · ~${fmtMoney(i.estimatedValue)}` : ''
        const qty  = i.quantity > 1 ? ` ×${i.quantity}` : ''
        const loc  = i.location ? ` · 📍 ${i.location}` : ''
        return `${dot} **${i.name}**${qty} · *${i.category}* · ${i.condition}${val}${loc}`
      })
      const header = `**📦 Inventory** · ${shown.length} item${shown.length === 1 ? '' : 's'}` +
        (S?.totalValue > 0 ? ` · ~${fmtMoney(S.totalValue)}` : '')
      return fmtList(lines, header)
    }

    default:
      return [
        '**!list** — available subcommands:',
        '`!list todos [open|done|high|critical|all]`',
        '`!list tasks [active|queued|done|all]`',
        '`!list tobuy [open|purchased|all]`',
        '`!list spend [month|all]`',
        '`!list approvals [pending|all]`',
        '`!list inventory [category|status|condition|all]`',
      ].join('\n')
  }
}

async function handleAgenda(): Promise<string> {
  const now       = new Date()
  const todayStr  = now.toISOString().slice(0, 10)
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()

  const [calResult, todoResult, taskResult] = await Promise.allSettled([
    api('GET', `/api/calendar/events?start=${encodeURIComponent(startOfDay)}&end=${encodeURIComponent(endOfDay)}`),
    api('GET', '/api/todos'),
    api('GET', '/api/tasks'),
  ])

  const label = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const sections: string[] = [`**Agenda · ${label}**\n`]

  // Calendar
  if (calResult.status === 'fulfilled') {
    const events: any[] = calResult.value?.events ?? []
    if (events.length) {
      sections.push('📅 **Calendar**')
      for (const e of events.slice(0, 10)) {
        const start = e.allDay
          ? 'All day'
          : e.startIso
            ? new Date(e.startIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            : 'All day'
        const meet = e.meetLink ? ' 🎥' : ''
        sections.push(`• ${start} — ${e.name ?? '(no title)'}${meet}`)
      }
    } else {
      sections.push('📅 **Calendar** — clear today')
    }
  } else {
    sections.push('📅 **Calendar** — *(not configured)*')
  }

  // Due today / overdue todos
  if (todoResult.status === 'fulfilled') {
    const todos: any[] = (todoResult.value?.todos ?? []).filter((t: any) => {
      if (t.done || !t.dueDate) return false
      const iso = t.dueDate.slice(0, 10)
      return iso <= todayStr
    })
    if (todos.length) {
      sections.push('\n📋 **Due Today / Overdue**')
      for (const t of todos.slice(0, 10)) {
        const e   = SEV_EMOJI[t.severity] ?? '⚪'
        const ago = t.dueDate.slice(0, 10) < todayStr ? ` · *${formatDueDate(t.dueDate.slice(0, 10))}*` : ''
        sections.push(`${e} ${t.title}${ago}`)
      }
    }
  }

  // Active tasks
  if (taskResult.status === 'fulfilled') {
    const tasks: any[] = (taskResult.value?.tasks ?? []).filter((t: any) =>
      t.status === 'active' || t.status === 'queued')
    if (tasks.length) {
      sections.push('\n⚙️ **Active Tasks**')
      for (const t of tasks.slice(0, 8)) {
        const e = PRI_EMOJI[t.priority] ?? '⚪'
        sections.push(`${e} ${t.title} · \`${t.status}\``)
      }
    }
  }

  const full = sections.join('\n')
  return full.length > 1900 ? full.slice(0, 1900) + '\n*…truncated*' : full
}

async function handleBalance(): Promise<string> {
  const [finResult, buyResult, invResult, financialsResult] = await Promise.allSettled([
    api('GET', '/api/finance'),
    api('GET', '/api/tobuy'),
    api('GET', '/api/inventory'),
    api('GET', '/api/financials'),
  ])

  const now = new Date()
  const parts: string[] = ['**💰 Balance Summary**\n']

  if (finResult.status === 'fulfilled') {
    const { entries, total } = finResult.value
    const monthSpend = (entries as any[]).filter((e: any) => {
      const d = new Date(e.createdAt)
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }).reduce((s: number, e: any) => s + e.amount, 0)

    // Category breakdown this month
    const byCat: Record<string, number> = {}
    for (const e of entries as any[]) {
      const d = new Date(e.createdAt)
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        byCat[e.category] = (byCat[e.category] ?? 0) + e.amount
      }
    }
    const catStr = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => `${k} ${fmtMoney(v)}`).join(' · ')

    parts.push(`💸 **Expenses this month** — **${fmtMoney(monthSpend)}**`)
    if (catStr) parts.push(`   ${catStr}`)
    parts.push(`   *All-time total: ${fmtMoney(total)}*`)
  }

  if (buyResult.status === 'fulfilled') {
    const open: any[] = (buyResult.value?.items ?? []).filter((i: any) => !i.purchased)
    const total = open.reduce((s: number, i: any) => s + (i.estimatedPrice || 0) * (i.quantity || 1), 0)
    parts.push(`\n🛒 **Shopping list** — **${open.length} items** · ~${fmtMoney(total)}`)
  }

  if (invResult.status === 'fulfilled') {
    const stats = invResult.value?.stats
    if (stats) {
      parts.push(`\n📦 **Inventory** — **${stats.totalItems} items** · ~${fmtMoney(stats.totalValue)}`)
    }
  }

  if (financialsResult.status === 'fulfilled') {
    const { summary } = financialsResult.value
    if (summary?.count > 0) {
      parts.push(`\n🏦 **Net Worth** — **${fmtMoney(summary.netWorth)}**  _(assets ${fmtMoney(summary.assets)} − liabilities ${fmtMoney(summary.liabilities)})_`)
    }
  }

  return parts.join('\n')
}

async function handleFind(query: string): Promise<string> {
  if (!query) return '❌  `!find <search term>`'
  const q = query.toLowerCase()

  const [todoResult, taskResult, invResult, buyResult, projResult, noteResult] = await Promise.allSettled([
    api('GET', '/api/todos'),
    api('GET', '/api/tasks'),
    api('GET', '/api/inventory'),
    api('GET', '/api/tobuy'),
    api('GET', '/api/projects'),
    api('GET', `/api/notes/pages?search=${encodeURIComponent(query)}`),
  ])

  const sections: string[] = [`**Search: "${query}"**\n`]
  let totalHits = 0

  if (todoResult.status === 'fulfilled') {
    const hits: any[] = (todoResult.value?.todos ?? []).filter((t: any) =>
      t.title.toLowerCase().includes(q) || t.notes?.toLowerCase().includes(q))
    if (hits.length) {
      totalHits += hits.length
      sections.push(`📋 **Todos** (${hits.length})`)
      for (const t of hits.slice(0, 4)) {
        const e = SEV_EMOJI[t.severity] ?? '⚪'
        sections.push(`${e} ${t.title}${t.done ? ' ✓' : ''}`)
      }
    }
  }

  if (taskResult.status === 'fulfilled') {
    const hits: any[] = (taskResult.value?.tasks ?? []).filter((t: any) =>
      t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q))
    if (hits.length) {
      totalHits += hits.length
      sections.push(`\n⚙️ **Tasks** (${hits.length})`)
      for (const t of hits.slice(0, 4)) {
        const e = PRI_EMOJI[t.priority] ?? '⚪'
        sections.push(`${e} ${t.title} · \`${t.status}\``)
      }
    }
  }

  if (buyResult.status === 'fulfilled') {
    const hits: any[] = (buyResult.value?.items ?? []).filter((i: any) =>
      i.title.toLowerCase().includes(q))
    if (hits.length) {
      totalHits += hits.length
      sections.push(`\n🛒 **To-Buy** (${hits.length})`)
      for (const i of hits.slice(0, 4)) {
        const p = i.estimatedPrice > 0 ? ` · ~${fmtMoney(i.estimatedPrice)}` : ''
        sections.push(`• **${i.title}**${p}${i.purchased ? ' ✓' : ''}`)
      }
    }
  }

  if (projResult.status === 'fulfilled') {
    const hits: any[] = (projResult.value?.projects ?? []).filter((p: any) =>
      p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q))
    if (hits.length) {
      totalHits += hits.length
      sections.push(`\n🗂️ **Projects** (${hits.length})`)
      for (const p of hits.slice(0, 4)) {
        const s = p.status === 'active' ? '🟢' : p.status === 'planning' ? '🔵' : p.status === 'paused' ? '🟠' : '✅'
        sections.push(`${s} **${p.name}** · ${p.status}`)
      }
    }
  }

  if (invResult.status === 'fulfilled') {
    const hits: any[] = (invResult.value?.items ?? []).filter((i: any) =>
      i.name.toLowerCase().includes(q) || i.tags?.some((tag: string) => tag.toLowerCase().includes(q)))
    if (hits.length) {
      totalHits += hits.length
      sections.push(`\n📦 **Inventory** (${hits.length})`)
      for (const i of hits.slice(0, 4)) {
        sections.push(`• **${i.name}** · ${i.category} · ${i.condition}`)
      }
    }
  }

  if (noteResult.status === 'fulfilled') {
    const hits: any[] = noteResult.value?.pages ?? []
    if (hits.length) {
      totalHits += hits.length
      sections.push(`\n📝 **Notes** (${hits.length})`)
      for (const p of hits.slice(0, 4)) {
        sections.push(`• ${p.title}`)
      }
    }
  }

  if (totalHits === 0) return `🔍  No results for "${query}".`
  return sections.join('\n')
}

async function handleProject(args: string): Promise<string> {
  const { projects } = await api('GET', '/api/projects')
  const all: any[] = projects ?? []
  if (!all.length) return '🗂️  No projects found.'

  if (!args.trim()) {
    const active  = all.filter(p => p.status === 'active')
    const plan    = all.filter(p => p.status === 'planning')
    const paused  = all.filter(p => p.status === 'paused')
    const done    = all.filter(p => p.status === 'completed')
    const lines: string[] = ['**🗂️ Projects**\n']
    if (active.length)  lines.push(...active.map(p  => `🟢 **${p.name}** · ${p.progress ?? 0}% · *${p.priority}*`))
    if (plan.length)    lines.push(...plan.map(p    => `🔵 **${p.name}** · planning`))
    if (paused.length)  lines.push(...paused.map(p  => `🟠 **${p.name}** · paused`))
    if (done.length > 0) lines.push(`✅ ${done.length} completed`)
    return fmtList(lines, '')
  }

  const q = args.trim().toLowerCase()
  const match = all.find(p => p.name.toLowerCase().includes(q))
  if (!match) return `❌  No project matching "${args}"`

  const s = match.status === 'active' ? '🟢' : match.status === 'planning' ? '🔵' : match.status === 'paused' ? '🟠' : '✅'
  const lines = [
    `${s} **${match.name}**`,
    match.description ? `> ${String(match.description).slice(0, 200)}` : '',
    `**Status:** ${match.status}  ·  **Priority:** ${match.priority}`,
    match.progress != null ? `**Progress:** ${match.progress}%` : '',
    match.assignee ? `**Assignee:** ${match.assignee}` : '',
    match.updatedAt ? `**Updated:** ${new Date(match.updatedAt).toLocaleDateString()}` : '',
  ].filter(Boolean)
  return lines.join('\n')
}

// ─── Eval / Bench / Memory query handlers ─────────────────────────────────────

async function handleEval(args: string): Promise<string> {
  const limit = Math.min(10, Math.max(1, Number(args.trim()) || 5))
  const { models, platforms } = await api('GET', '/api/evaluations/models')
  const all = (models as any[])
  if (!all.length) {
    const unreachable = (platforms as any[]).filter((p: any) => !p.reachable).map((p: any) => p.platform)
    if (unreachable.length === 2) return '📊  No eval data — both platforms unreachable.'
    return '📊  No eval data yet — run some agent sessions to populate the leaderboard.'
  }
  const medals = ['🥇', '🥈', '🥉']
  const lines = all.slice(0, limit).map((m: any, i: number) => {
    const icon  = medals[i] ?? '▫️'
    const score = m.overall != null ? ` · **${m.overall}%**` : ''
    const count = m.evaluatedCount ? ` · ${m.evaluatedCount} runs` : ''
    return `${icon} **${m.modelLabel ?? m.model}**${score}${count} · *${m.platform}*`
  })
  const total = all.length
  const header = `**📊 Eval Leaderboard** · ${total} model${total === 1 ? '' : 's'}`
  return fmtList(lines, header)
}

async function handleBench(args: string): Promise<string> {
  const limit = Math.min(10, Math.max(1, Number(args.trim()) || 5))
  const { runs } = await api('GET', '/api/harness-bench/runs')
  const all = (runs as any[])
  if (!all.length) return '🧪  No benchmark runs yet.'
  const STATUS_ICON: Record<string, string> = {
    done: '✅', running: '⏳', pending: '⏳', cancelled: '🚫', error: '❌',
  }
  const lines = all.slice(0, limit).map((r: any) => {
    const icon  = STATUS_ICON[r.status] ?? '❓'
    const score = r.status === 'done' && r.maxScore > 0
      ? ` · ${r.totalScore}/${r.maxScore}`
      : r.status === 'running' ? ' · running…' : ''
    const d = r.startedAt ? new Date(r.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
    return `${icon} **${r.modelName}** · ${r.taskPackName ?? r.taskPackId}${score} · *${r.harness}*${d ? ` · ${d}` : ''}`
  })
  const header = `**🧪 Harness Benchmarks** · last ${Math.min(limit, all.length)} of ${all.length}`
  return fmtList(lines, header)
}

async function handleMemory(): Promise<string> {
  const { health, recentEvents, source } = await api('GET', '/api/memory/overview')
  const src = String(source ?? 'openclaw')
  const lines: string[] = [`**🧠 Memory · ${src}**`, '']

  if (!health || !health.reachable) {
    const reason = health?.error ?? 'not connected'
    lines.push(`🔴 ${reason}`)
    return lines.join('\n')
  }

  lines.push('🟢 Connected')

  if (health.vector?.recordCount != null) {
    lines.push(`📐 Vector store — **${health.vector.recordCount.toLocaleString('en-US')} records**`)
  }

  if (health.store?.files != null) {
    lines.push(`📂 Memory files — **${health.store.files}**`)
  }

  const eventCount = Array.isArray(recentEvents) ? recentEvents.length : 0
  lines.push(`📡 Recent events captured — **${eventCount}**`)

  return lines.join('\n')
}

// ─── Approval button builder ──────────────────────────────────────────────────

const URGENCY_EMOJI: Record<string, string> = { urgent: '🔴', normal: '🟡', low: '⚪' }
const TYPE_EMOJI:    Record<string, string> = {
  publish: '📤', send: '📨', merge: '🔀', purchase: '🛒', action: '⚡', deploy: '🚀',
}

function buildApprovalPayload(event: ApprovalEvent): MessageCreateOptions {
  const ue  = URGENCY_EMOJI[event.urgency] ?? '🟡'
  const te  = TYPE_EMOJI[event.type] ?? '⚡'
  const payloadBlock = event.payload ? `\n\`\`\`\n${event.payload.slice(0, 800)}\n\`\`\`` : ''
  const projectLine  = event.project ? `**Project:** ${event.project}\n` : ''

  const content = [
    `${ue}  **Approval Request** — ${event.urgency.toUpperCase()}`,
    `${te}  **${event.title}**`,
    `**Agent:** ${event.agentName}`,
    projectLine,
    event.description,
    payloadBlock,
  ].filter(Boolean).join('\n')

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${event.id}`)
      .setLabel('Approve')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reject:${event.id}`)
      .setLabel('Reject')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  )

  return { content, components: [row] }
}

// ─── Button interaction handler ───────────────────────────────────────────────

async function handleApprovalButton(interaction: ButtonInteraction): Promise<void> {
  const [action, approvalId] = interaction.customId.split(':')
  if (!approvalId || (action !== 'approve' && action !== 'reject')) return

  await interaction.deferUpdate()

  try {
    // Check current status first — someone may have already acted via the UI.
    const { approvals } = await api('GET', '/api/approvals')
    const existing = (approvals as any[]).find((a: any) => a.id === approvalId)

    if (existing && existing.status !== 'pending') {
      const already = existing.status === 'approved' ? '✅ already approved' : '❌ already rejected'
      const updated = interaction.message.content + `\n\n*(${already} by ${existing.resolvedBy ?? 'UI'})*`
      await interaction.editReply({ content: updated.slice(0, 2000), components: [] })
      return
    }

    await api('POST', `/api/approvals/${approvalId}/${action}`, {
      resolvedBy: `@${interaction.user.username}`,
    })

    const emoji = action === 'approve' ? '✅' : '❌'
    const word  = action === 'approve' ? 'Approved' : 'Rejected'
    const updated = interaction.message.content + `\n\n${emoji}  **${word}** by @${interaction.user.username}`
    await interaction.editReply({ content: updated.slice(0, 2000), components: [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await interaction.editReply({
      content: interaction.message.content + `\n\n⚠️  Action failed: ${msg}`,
      components: [],
    })
  }
}

// ─── Notifier event handler ───────────────────────────────────────────────────

function setupNotifierListeners(): void {
  discordNotifier.on('discord', async (event) => {
    if (!notifyChannel) return

    if (event.kind === 'approval') {
      const payload = buildApprovalPayload(event as ApprovalEvent)
      await sendNotification(payload.content!, payload)
      return
    }

    if (event.kind === 'research_done') {
      const e = event as ResearchDoneEvent
      const typeLabel = e.itemType === 'todo' ? 'Todo' : e.itemType === 'tobuy' ? 'Buy item' : 'Inventory item'
      if (e.success) {
        const summary = e.summary ? `\n> ${e.summary.slice(0, 300)}` : ''
        await sendNotification(`🔬  **Research done** — ${typeLabel}: "${e.title}"${summary}`)
      } else {
        await sendNotification(`⚠️  **Research failed** — ${typeLabel}: "${e.title}"\n> ${e.error ?? 'unknown error'}`)
      }
      return
    }

    if (event.kind === 'alert') {
      const e = event as AlertFiredEvent
      const fingerprint = `${e.ruleId}:${e.firedAt}`
      if (notifiedAlerts.has(fingerprint)) return
      notifiedAlerts.add(fingerprint)
      const sevEmoji = e.severity === 'critical' ? '🔴' : e.severity === 'warning' ? '🟠' : 'ℹ️'
      await sendNotification(`${sevEmoji}  **Alert: ${e.ruleName}**\n${e.message}`)
      return
    }

    if (event.kind === 'briefing') {
      const e = event as BriefingEvent
      await sendNotification(`☀️  **${e.title}**\n${e.message}`)
    }
  })
}

// ─── Due-date poller ─────────────────────────────────────────────────────────

function startDueDatePoller(): void {
  // Reset daily so items can be re-notified the following day.
  setInterval(() => notifiedDue.clear(), 24 * 60 * 60 * 1_000)

  async function checkDueDates(): Promise<void> {
    if (!notifyChannel) return
    const now     = new Date()
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1_000)
    const todayStr = now.toISOString().slice(0, 10)
    const horizStr = horizon.toISOString().slice(0, 10)

    const lines: string[] = []

    try {
      const [{ todos = [] }, { tasks = [] }] = await Promise.all([
        api('GET', '/api/todos'),
        api('GET', '/api/tasks'),
      ])

      for (const t of todos as any[]) {
        if (t.done || !t.dueDate) continue
        const iso = t.dueDate.slice(0, 10)
        if (iso > horizStr) continue
        const key = `todo:${t.id}:${iso}`
        if (notifiedDue.has(key)) continue
        notifiedDue.add(key)
        const e = SEV_EMOJI[t.severity] ?? '⚪'
        const label = iso < todayStr ? `**overdue** (${formatDueDate(iso)})` : '**due today**'
        lines.push(`${e} Todo — "${t.title}" — ${label}`)
      }

      for (const t of tasks as any[]) {
        if (t.status === 'completed' || !t.dueDate) continue
        const iso = (t.dueDate as string).slice(0, 10)
        if (iso > horizStr) continue
        const key = `task:${t.id}:${iso}`
        if (notifiedDue.has(key)) continue
        notifiedDue.add(key)
        const e = PRI_EMOJI[t.priority] ?? '⚪'
        const label = iso < todayStr ? `**overdue** (${formatDueDate(iso)})` : '**due today**'
        lines.push(`${e} Task — "${t.title}" — ${label}`)
      }
    } catch { /* silently skip on API errors */ }

    if (lines.length) {
      await sendNotification(`⏰  **Upcoming deadlines:**\n${lines.join('\n')}`)
    }
  }

  checkDueDates()                                   // run immediately on startup
  setInterval(checkDueDates, 4 * 60 * 60 * 1_000)  // then every 4 hours
}

// ─── Alert poller ─────────────────────────────────────────────────────────────

function startAlertPoller(): void {
  async function checkAlerts(): Promise<void> {
    if (!notifyChannel) return
    try {
      const { alerts = [] } = await api('GET', '/api/alerts/active')
      for (const a of alerts as any[]) {
        const fingerprint = `${a.ruleId}:${a.firedAt}`
        if (notifiedAlerts.has(fingerprint)) continue
        notifiedAlerts.add(fingerprint)
        const sevEmoji = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟠' : 'ℹ️'
        await sendNotification(`${sevEmoji}  **Alert: ${a.ruleName}**\n${a.message}`)
      }
    } catch { /* ignore — agents may not always be running */ }
  }

  checkAlerts()
  setInterval(checkAlerts, 15 * 60 * 1_000)  // every 15 minutes
}

// ─── Help text ────────────────────────────────────────────────────────────────

function helpText(): string {
  return [
    '**Mission Control · Discord Commands**',
    '',
    '**Create**',
    '`!todo <title> [high|medium|low|critical] [due:YYYY-MM-DD]`',
    '`!task <title> [due:YYYY-MM-DD]`',
    '`!task done <title>`  — mark a task completed',
    '`!buy <item> [$price] [high|medium|low]`',
    '`!spend $<amount> <description>  [category]`  *(double space before category)*',
    '`!note <content>`',
    '',
    '**Inventory**',
    '`!inventory <name> [--cat <cat>] [--qty <n>] [--loc <location>]`',
    '`               [--cond working|untested|partial|broken] [--val $<price>]`',
    '`               [--mfr <maker>] [--model <model>] [--notes <text>]`',
    '`               [--status available|in-use|reserved] [--research]`',
    '`!inv status <name> <available|in-use|reserved>`  — flip deployment status',
    '`!inv find <query>`  — search inventory',
    '`!list inventory [category|status|condition|all]`',
    '',
    '**Query**',
    '`!list todos [open|done|high|critical|all]`',
    '`!list tasks [active|queued|done|all]`',
    '`!list tobuy [open|purchased|all]`',
    '`!list spend [month|all]`',
    '`!list approvals [pending|all]`',
    '`!account <label> $<amount> [asset|liability] [category]`  — upsert a holding',
    '`!account list`  — net worth breakdown',
    '`!agenda`  — today\'s calendar + due items',
    '`!balance`  — spending + net worth summary',
    '`!budget`  — daily/weekly cost + token usage vs limits',
    '`!find <term>`  — search todos, inventory, notes',
    '`!done <title>`  — mark a todo as done',
    '`!status`  — connector health + active alerts',
    '`!project [name]`  — list all projects or query one by name',
    '`!eval [n]`  — top n models by eval score (default 5)',
    '`!bench [n]`  — last n harness benchmark runs (default 5)',
    '`!memory`  — memory health, vector count, recent events',
    '',
    '`!help`  — show this message',
  ].join('\n')
}

// ─── Bot setup ────────────────────────────────────────────────────────────────

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
    partials: [Partials.Channel, Partials.Message],
  })

  client.once(Events.ClientReady, async (c) => {
    console.log(`[discord] Bot ready — ${c.user.tag}`)

    if (NOTIFY_CHANNEL_ID) {
      try {
        const ch = await c.channels.fetch(NOTIFY_CHANNEL_ID)
        if (ch?.isTextBased()) {
          notifyChannel = ch as TextChannel
          console.log(`[discord] Notification channel: #${notifyChannel.name}`)
        } else {
          console.warn('[discord] DISCORD_NOTIFY_CHANNEL_ID is not a text channel — push notifications disabled')
        }
      } catch {
        console.warn('[discord] Could not fetch DISCORD_NOTIFY_CHANNEL_ID — push notifications disabled')
      }
    } else {
      console.log('[discord] DISCORD_NOTIFY_CHANNEL_ID not set — push notifications disabled')
    }

    setupNotifierListeners()
    startDueDatePoller()
    startAlertPoller()

    if (ALLOWED_CHANNELS.length) {
      console.log(`[discord] Watching channels: ${ALLOWED_CHANNELS.join(', ')}`)
    } else {
      console.log('[discord] Watching all channels (set DISCORD_CHANNEL_IDS to restrict)')
    }
  })

  // ── Button interactions (approval approve/reject) ─────────────────────────
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return
    const btn = interaction as ButtonInteraction
    if (btn.customId.startsWith('approve:') || btn.customId.startsWith('reject:')) {
      if (!isAllowedUser(btn.user.id)) {
        await btn.reply({ content: '❌ You are not authorized to use Mission Control buttons.', ephemeral: true })
        return
      }
      await handleApprovalButton(btn)
    }
  })

  // ── Text commands ─────────────────────────────────────────────────────────
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.id === client.user?.id) return
    if (!message.content.startsWith(PREFIX)) return
    if (!isAllowed(message.channelId)) return
    if (!isAllowedUser(message.author.id)) return

    const raw      = message.content.slice(PREFIX.length).trim()
    const spaceIdx = raw.indexOf(' ')
    const cmd      = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).toLowerCase()
    const args     = (spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1)).trim()

    let reply: string
    try {
      switch (cmd) {
        case 'todo':      reply = await handleTodo(args);          break
        case 'buy':       reply = await handleBuy(args);           break
        case 'spend':     reply = await handleSpend(args);         break
        case 'note':      reply = await handleNote(args);          break
        case 'inventory': reply = await handleInventory(args);     break
        case 'inv':       reply = await handleInventory(args);     break   // alias with sub-commands
        case 'task': {
          // !task done <title> — mark task completed; else create
          if (args.toLowerCase().startsWith('done ') || args.toLowerCase() === 'done') {
            reply = await handleTaskDone(args.slice(4).trim())
          } else {
            reply = await handleTask(args)
          }
          break
        }
        case 'list':      reply = await handleList(args);          break
        case 'agenda':    reply = await handleAgenda();            break
        case 'balance':   reply = await handleBalance();           break
        case 'account':   reply = await handleAccount(args);       break
        case 'find':      reply = await handleFind(args);          break
        case 'done':      reply = await handleDone(args);          break
        case 'status':    reply = await handleStatus();            break
        case 'budget':    reply = await handleBudget();            break
        case 'eval':      reply = await handleEval(args);          break
        case 'bench':     reply = await handleBench(args);         break
        case 'memory':    reply = await handleMemory();            break
        case 'project':   reply = await handleProject(args);       break
        case 'help':      reply = helpText();                      break
        default:          return  // ignore unknown commands silently
      }
    } catch (err) {
      reply = `⚠️  Error: ${err instanceof Error ? err.message : String(err)}`
    }

    await message.reply(reply.slice(0, 2000))
      .catch(e => console.error('[discord] reply failed:', (e as Error).message))
  })

  client.login(token).catch(err => {
    console.error('[discord] Login failed:', (err as Error).message)
  })
}
