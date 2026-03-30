# Mission Control

A command-center dashboard for orchestrating AI agents, projects, content pipelines, and day-to-day ops — all from a single pane of glass.

Built with **React 18 + TypeScript + Tailwind CSS** on the frontend and an **Express 5** API server on the backend.

---

## Views

| View | Description |
|------|-------------|
| **Tasks** | Track and triage work items across agents and projects |
| **Agents** | Monitor AI agent status, activity, and state |
| **Content** | Manage drafts, scripts, newsletters, and publishing pipelines |
| **Approvals** | Review and approve agent-generated output before it ships |
| **Chats** | Browse Claude conversation sessions — tokens, cost, history |
| **Calendar** | Scheduled tasks synced with Google Calendar |
| **Projects** | Kanban-style project boards |
| **Memory** | Inspect and manage agent memory stores |
| **Docs** | Documentation browser |
| **Notes** | Quick-capture notes |
| **People** | Contact & collaborator directory |
| **Office** | Virtual office — spaces, resources, links |
| **System** | Server health, uptime, and diagnostics |
| **Radar** | Token usage analytics and cost tracking (Anthropic) |
| **Pipeline** | Multi-stage processing pipeline monitor |
| **Factory** | Micro-SaaS factory dashboard |
| **Feedback** | Collected feedback and ratings |

---

## Tech Stack

- **Frontend** — React 18, TypeScript, Tailwind CSS, Vite, Lucide icons
- **Backend** — Express 5, tsx (TypeScript execution), dotenv
- **Integrations** — Google Calendar API, Anthropic API (analytics)

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

## Project Structure

```
├── server/              # Express API server
│   ├── index.ts         # Server entry point
│   └── routes/          # Route handlers per domain
├── src/                 # React frontend
│   ├── App.tsx          # Root component & view router
│   ├── components/      # Shared UI components
│   ├── data/            # Mock / seed data
│   ├── lib/             # API client & utilities
│   ├── types/           # TypeScript type definitions
│   └── views/           # One file per dashboard view
├── data/                # Persistent JSON data files
├── .env.example         # Environment variable template
├── vite.config.ts       # Vite configuration
├── tailwind.config.js   # Tailwind configuration
└── tsconfig.json        # TypeScript configuration
```

---

## License

Private — not licensed for redistribution.
