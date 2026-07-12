<div align="center">
  <img src="public/icon.png" alt="Mission Control" width="180" />
</div>

# Mission Control

A personal command-center dashboard for orchestrating AI agents, projects, hardware builds, spend, and day-to-day ops — all from a single pane of glass.

Built with **React 18 + TypeScript + Tailwind CSS** on the frontend and an **Express 5** API server on the backend.

Press **⌘K** (Ctrl+K) anywhere for the command palette — jump to any page or search notes, docs, and tasks. Every view runs on real data from your connected agents; views lazy-load on demand.

---

## What's Inside

The sidebar is grouped into four sections — **Work**, **Knowledge**, **Build**, and **AI Ops** — plus Settings. Related monitoring views are consolidated into tabbed hubs rather than scattered across many sidebar entries.

### Work

| View | What you can do |
|------|----------------|
| **Home** | Landing overview — mission-control hero, an "at a glance" priority queue (alerts, overdue to-dos, pending approvals, system errors), and quick-view cards for usage, to-dos, projects, alerts, and system health. Every card deep-links to the right hub and tab. |
| **To-Do** | Personal quick-capture list plus a built-in view switcher — **To-Do** (default), **Tasks** (kanban board), **Approvals**, and **Inbox** — so personal items and agent work live on one page. To-Do: natural-language quick add (`!crit @long tomorrow`), severity levels (low → critical), short/long horizon, due dates with overdue badges, inline editing, a one-click OpenClaw/Hermes research button (summary, action steps, links, key facts), an optional **Additional Details** sub-panel (date, time, location, phone, cost, URL, contact, category, custom fields) with smart auto-detection, and opt-in **Google Calendar sync** for dated items. **Tasks** is a status-column kanban (Active / Queue / Blocked / Completed); **Approvals** reviews agent output (approve / reject / request changes); **Inbox** is a unified priority-sorted feed of approvals, tasks, and to-dos with snooze. |
| **To-Buy** | Personal shopping list with the same click-to-open drawer as To-Do. Quick add with priority/quantity/price tokens (`power drill !high x1 $89`), a running estimated total, and one-click OpenClaw/Hermes research that returns general info, a fair price + range, online buy links, local store options, and key specs — auto-filling the item's price estimate. |
| **Spend** | Personal money command center. Separates **Claude Code** (a subscription — shown as token-equivalent *value*, not billed per-token) from **OpenClaw/Hermes agents** (real per-token API spend), plus a "things" lane (open To-Buy total + the value of hardware you already own), and an **Expense Ledger** lane fed by manual entries (log via `!spend` in Discord or the API). 30-day trend, projected monthly, and this-month category breakdown. |
| **Chats** | Browse Claude / OpenClaw / Hermes conversation sessions. See token counts, cost per session, and open the full message history for any conversation. |
| **Calendar** | Day / Week / Month / Agenda views of your scheduled tasks and Google Calendar events, with prev / today / next navigation and an in-app event composer (create / edit / delete). |

### Knowledge

| View | What you can do |
|------|----------------|
| **Docs** | Documentation browser connected to your agent knowledge base, with a **Notes** tab (quick-capture scratchpad) and a **Links** tab — save, tag, pin, and archive bookmarks; add manually or via the Inbox "save as link" action. |
| **News** | Real-time curated news dashboard with three tabs: **Feed** (17 RSS/Atom sources across AI, computing, code, and robotics), **GitHub** (trending repos by time range and language), and **Buzz** (top discussions from HN, Reddit, and Lobsters). ADHD-friendly magazine-style hero, cross-source "Top right now" strip, category/platform filters, and 5-minute auto-refresh. |
| **Memory** | A live operational dashboard over your agent's **real memory system**, read over SSH from the agent machine: an **Activity** timeline of memory events (recall / dream / promotion, each expandable to the actual content), **Daily** logs + workspace files with a full-text index over every day, **Recall** (semantic chunks + similarity scores + concept tags), **Dreaming** (the nightly Light / Deep / REM consolidation and promotions into long-term `MEMORY.md`), **Health** (LanceDB vector store + pipeline freshness/staleness), and **Metrics** (per-day volume, dream phases, top concepts). Configure the SSH connection via `OPENCLAW_SSH_*`. |

### Build

The hardware → ideas → projects loop in one place.

| View | What you can do |
|------|----------------|
| **Projects** | Kanban-style boards for tracking initiatives (drag cards across columns, set owners, attach notes), with a **Pipeline** tab — a multi-stage run monitor (card grid or Gantt timeline) with step-level traces and a cron jobs panel. |
| **Inventory** | Hardware catalog with SQLite-backed persistence. Search and filter items, view status (available / in-use / reserved), trigger per-item agent research, and inline-edit any field. **Bulk add** lets you paste a free-form list (bullets, `xN` quantities, `(Model: …)`) — it parses each line into an item, shows a live preview, and can queue agent research on the whole batch so specs, value, and form factor get filled in automatically. |
| **Ideas** | Idea Factory — browse and triage the buildable project ideas the agents generate *from your inventory*. Confidence/coolness score bars, difficulty, cost/time, and parts-on-hand / still-need lists. A **Buildable now** filter surfaces projects you can build with parts you already own; sort by Best / Coolest / Cheapest / Newest, search across ideas, like / snooze / **Built it!** / reject-with-reason, and trigger a new generation run. |

### AI Ops

Five consolidated hubs covering everything your agents do — built on local Claude Code logs plus the OpenClaw (WS) and Hermes (REST) gateways.

| View | What you can do |
|------|----------------|
| **Activity** | Live cross-platform agent monitoring in one place: **Live** (real-time tool calls / file reads / commands streamed from OpenClaw + Hermes), **Sessions** (run history with token/message totals and full transcripts), **Brain** (raw event log with tool-loop detection and top tools), **Agents** (who's running and their current state), and **Map** (node-link traffic topology, 1 h / 24 h / 7 d / all). |
| **Usage** | Cost & model analytics: a Claude Code token/cost view (daily trends, token mix, cost anomalies, per-model share, hour-of-day heatmap) plus a **Models** tab (Helicone-style spend, latency, volume, and failure rate per model with a cost-vs-latency scatter). |
| **Benchmarks** | Benchmark how a model performs *through* OpenClaw/Hermes (App → harness → model → tools/context/routing → result), not raw model APIs. 9 behaviour lanes, 4 task packs, deterministic scoring with normalized failure types, multi-sample **reliability** scoring, a per-task detail drawer, and a model/provider **Compare** fingerprint (reliability, speed ± stdev, verbosity/tokens, est. cost, fences). Runs real dispatches via the Hermes API server, OpenClaw WS, or any OpenAI-compatible `/v1` endpoint (LM Studio / Ollama / vLLM). |
| **Evals** | Agent performance evaluation hub. Model scorecard leaderboard, agent-model matrix, session trend chart, benchmark task runner (dispatched to the Hermes API server), memory benchmark panel (recall / multihop / temporal / conflict / applied / negative), and a scoring methodology reference. |
| **Health** | Platform & connector health: **System** (Claude config / MCP / plugin health, uptime, memory file browser), **Security** (connector token health, reachability, auth-error counts, risk badge, live diagnostics probes), **Alerts** (rule builder — error rate / loop / stalled / token spike / no activity — plus fired alerts), and per-platform deep-dive dashboards for **OpenClaw** and **Hermes**. |

### Settings

Configure connectors, API keys, the **Google** connection (connect / reconnect / disconnect), and application preferences.

---

## Discord Integration

Mission Control has a bidirectional Discord bot. Set `DISCORD_BOT_TOKEN` in `.env` and the bot starts automatically with the server.

### Setup

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → **Bot** → **Reset Token** — copy the token into `DISCORD_BOT_TOKEN`.
2. Under **Bot → Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT**.
3. Invite the bot to your server with OAuth2 scope `bot` and permissions: **Read Messages, Send Messages, Read Message History**.
4. Optionally set `DISCORD_CHANNEL_IDS` (comma-separated) to limit which channels accept commands.
5. Optionally set `DISCORD_NOTIFY_CHANNEL_ID` to a single channel where the bot will post proactive notifications.

> You can reuse an existing bot token (e.g. the OpenClaw or Hermes bot) as long as it's in the same server and has the Message Content Intent enabled.

---

### Commands

All commands start with `!`. The bot replies in the same channel with a confirmation.

#### Create

| Command | What it does |
|---------|-------------|
| `!todo <title> [high\|medium\|low\|critical] [due:YYYY-MM-DD]` | Add a to-do item |
| `!buy <item> [$price] [high\|medium\|low]` | Add to shopping list |
| `!spend $<amount> <description>  [category]` | Log an expense *(double space before optional category)* |
| `!task <title> [due:YYYY-MM-DD]` | Add a task to the kanban board |
| `!note <content>` | Save a quick note to the **Discord / Quick Capture** notebook |
| `!inventory <name> [--research]` | Add to hardware inventory; `--research` triggers OpenClaw enrichment |

#### Query

| Command | What it does |
|---------|-------------|
| `!list todos [open\|done\|high\|critical\|all]` | List to-dos (default: open) |
| `!list tasks [active\|queued\|done\|all]` | List tasks (default: active/queued) |
| `!list tobuy [open\|purchased\|all]` | List shopping items |
| `!list spend [month\|all]` | List expense entries |
| `!list approvals [pending\|all]` | List approval requests |
| `!agenda` | Today's calendar events + items due today or overdue |
| `!balance` | Spending summary: this-month expenses, shopping total, inventory value |
| `!find <term>` | Search across todos, inventory, and notes |
| `!help` | Show all commands |

#### Examples

```
!todo Renew server certificate critical due:2026-07-15
!buy Raspberry Pi 5 $80 high
!spend $12.50 Lunch  Food
!inventory Arduino Mega --research
!agenda
!balance
!find raspberry
!list todos high
```

---

### Proactive Notifications (`DISCORD_NOTIFY_CHANNEL_ID`)

When `DISCORD_NOTIFY_CHANNEL_ID` is set, the bot pushes messages to that channel automatically:

| Event | When it fires |
|-------|--------------|
| **Approval request** | An agent (OpenClaw/Hermes) creates a new approval — posted with **Approve ✅** / **Reject ❌** buttons; clicking resolves it without opening the UI |
| **Research complete** | Agent research on a todo, shopping item, or inventory item finishes (success or failure) |
| **Due-date reminders** | Todos and tasks due today or overdue — checked every 5 minutes, once per item per day |
| **Agent alerts** | Fired alert rules (token spike, loop detected, stalled session, etc.) — checked every 2 minutes |

---

## Tech Stack

- **Frontend** — React 18, TypeScript, Tailwind CSS, Vite, Lucide icons
- **Backend** — Express 5, tsx (TypeScript execution), dotenv, Node.js ≥ 18
- **Database** — SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) for inventory, agent-event, and benchmark stores; JSON files for lighter stores (notes, alerts, connectors)
- **Integrations** — Google Calendar API (OAuth 2), Anthropic API, OpenClaw WebSocket, Hermes REST

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9

### Install

```bash
npm install
```

### Configure

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Required variables (see `.env.example` for details):

| Variable | Purpose |
|----------|---------|
| `API_PORT` | Express server port (default `3001`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (Calendar) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ANTHROPIC_API_KEY` | Anthropic API key (Radar analytics) |
| `GITHUB_TOKEN` | GitHub personal access token — optional; raises the Search API rate limit for the News → GitHub tab |
| `OPENCLAW_SSH_HOST` | Agent machine host — reads the OpenClaw memory system (daily logs, dreaming, LanceDB recall) over SSH for the Memory view |
| `OPENCLAW_SSH_USER` | SSH username on the agent machine |
| `OPENCLAW_SSH_KEY` | SSH private key — absolute path, or a key name resolved under `~/.ssh` |

**Google Calendar:** set the two `GOOGLE_*` values, then connect from **Settings → Google** (or visit `/api/auth/google`). The refresh token is stored in `data/google-tokens.json` and refreshed automatically — no copy-paste. Publish your OAuth consent screen ("In production") in Google Cloud Console; while it is in "Testing" mode Google expires the refresh token after 7 days.

### Run

Start both the API server and Vite dev server:

```bash
npm run dev
```

- **Frontend** → `http://localhost:5173`
- **API** → `http://localhost:3001`

### Build

```bash
npm run build
```

### Android (Pixel 9)

Mission Control ships as a Capacitor Android app with runtime server setup. Use Tailscale Serve HTTPS for normal Pixel 9 access, and use private-LAN HTTP only as a trusted home-network fallback.

See [docs/mobile/PIXEL9_SETUP.md](docs/mobile/PIXEL9_SETUP.md) for the Android prerequisites, secure server-access commands, Capacitor sync, debug APK build, and Pixel 9 validation matrix.

---

## License

Private — not licensed for redistribution.

