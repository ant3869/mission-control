# Mission Control

A command-center dashboard for orchestrating AI agents, projects, content pipelines, and day-to-day ops — all from a single pane of glass.

Built with **React 18 + TypeScript + Tailwind CSS** on the frontend and an **Express 5** API server on the backend.

---

## What's Inside

### Work & Projects

| View | What you can do |
|------|----------------|
| **Tasks** | Create, triage, and filter work items. Assign status and priority. See what's blocked or in flight. |
| **Approvals** | Review agent-generated output before it ships. Approve, reject, or request changes with a single click. |
| **Projects** | Kanban-style boards for tracking initiatives. Drag cards across columns, set owners, and attach notes. |
| **Calendar** | View and manage scheduled tasks. Synced with Google Calendar so your schedule and your agents stay aligned. |
| **Pipeline** | Multi-stage processing pipeline monitor. Switch between a card grid and a Gantt-style timeline. Click any run to open a full execution trace with step-level status, timing, and token usage. Includes a cron jobs panel showing all scheduled agent tasks. |

### Agents & AI

| View | What you can do |
|------|----------------|
| **Agents** | See which agents are running, their current state, and recent activity at a glance. |
| **Watch** | Live feed of exactly what your AI agents are doing right now — tool calls, file reads, terminal commands — streamed from both OpenClaw and Hermes. |
| **Chats** | Browse Claude conversation sessions. See token counts, cost per session, and open the full message history for any conversation. |
| **Memory** | Inspect and manage agent memory stores. Read, search, and update memory entries across all connected agents. |
| **Factory** | Micro-SaaS factory dashboard for tracking AI-powered product builds. |

### Platform Monitoring

| View | What you can do |
|------|----------------|
| **OpenClaw** (Metrics) | Full operational hub for your OpenClaw agent platform. Tabs for: live overview, activity charts, autonomy metrics, session browser, cron schedules, platform breakdowns, system health, memory file editor, Brain event log, Flow session history, Alerts, and Security posture. |
| **Hermes** (Metrics) | Same 11-tab metrics hub as OpenClaw, scoped to your Hermes REST agent. Both views share the same sub-views so you can compare platforms side-by-side in separate browser tabs. |
| **Brain** | Raw agent event log across all platforms. Filter by source and event type. Spot tool-call loops (same tool called 5+ times), view the top tools by frequency, and drill into individual events. |
| **Flow** | Session run history from OpenClaw and Hermes. See token totals, message counts, and timestamps for every session. Click any run to read the complete conversation including tool call and result pairs. |
| **Flow Map** | Interactive node-link topology graph showing which agents, tools, channels, memory stores, and runtimes are communicating — and how much traffic is flowing between them. Supports 1 h / 24 h / 7 d / all time windows. |
| **Model Ops** | Helicone-style model analytics. Track spend, median latency, request volume, and failure rate per model. Includes a cost-vs-latency scatter chart, a daily trend histogram, and a model comparison table. Scope to All traffic, Claude Code sessions, or agent-only calls. |
| **Radar** | Anthropic API usage analytics. See daily token and cost trends, input/output/cache token mix, cost anomaly cards, per-model cost share, and an hour-of-day heatmap showing when your agents are busiest. |
| **Security** | Connector security posture at a glance. Each connector shows token health (ok / missing / disabled / auth_error / unreachable), reachability latency, recent auth error count, and an overall risk level badge. Run live diagnostics probes from this page. |
| **Alerts** | Create and manage alert rules for your agent platforms. Five condition types: error rate, loop detected, session stalled, token spike, and no activity. Set severity (info / warning / critical), thresholds, time windows, and source scope. See all currently fired alerts in one panel. |

### Knowledge & Content

| View | What you can do |
|------|----------------|
| **Content** | Manage drafts, scripts, newsletters, and publishing pipelines. Track items from draft through published. |
| **Docs** | Documentation browser connected to your agent knowledge base. |
| **Notes** | Quick-capture scratchpad. Jot down ideas, snippets, or follow-ups without leaving the dashboard. |

### People & Office

| View | What you can do |
|------|----------------|
| **People** | Contact and collaborator directory. |
| **Office** | Virtual office — spaces, resources, and shared links. |

### Infrastructure & Settings

| View | What you can do |
|------|----------------|
| **Inventory** | Hardware catalog with SQLite-backed persistence. Search and filter items, view status (available / in-use / reserved), trigger per-item agent research, and inline-edit any field. |
| **System** | Server health, uptime, memory file browser, and connector diagnostics. |
| **Settings** | Configure connectors, API keys, and application preferences. |
| **Feedback** | Collected feedback and ratings from deployed products. |

---

## Tech Stack

- **Frontend** — React 18, TypeScript, Tailwind CSS, Vite, Lucide icons
- **Backend** — Express 5, tsx (TypeScript execution), dotenv, Node.js ≥ 18
- **Database** — SQLite (`better-sqlite3`) for inventory and event stores
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
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token |
| `ANTHROPIC_API_KEY` | Anthropic API key (Radar analytics) |

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

---

## License

Private — not licensed for redistribution.

