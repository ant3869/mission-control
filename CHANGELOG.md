# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.3.0] — 2026-03-30

### Added

- **Heartbeat collapsing** (Chats view): Heartbeat check-in sessions are now separated from regular conversations and displayed in a collapsible emerald-green stack, preventing them from flooding the session list.
- **OpenClaw in Office view**: OpenClaw now appears as a live integration with dynamic health status (connected/error/disconnected) and last-event timing.
- **OpenClaw in Memory view**: Conversation summaries from OpenClaw sessions are synthesised as memory entries, so the Memory view works even without `.auto-memory/` files.
- Backend `getOpenClawMemoryEntries()` export for cross-route memory synthesis.
- `isHeartbeat` flag on OpenClaw session endpoints for frontend filtering.

---

## [0.2.0] — 2026-03-30

### Fixed

- **Chats view**: Resolved 3 bugs preventing OpenClaw responses from displaying — null-prev race in `fetchTranscript`, duplicate `useEffect` triggering double loads, and unnecessary transcript re-fetches during polling.

### Added

- **OpenClaw agents endpoint** (`GET /api/openclaw/agents`) — derives live agent state from event recency and type.
- **Agents view**: OpenClaw agents now appear alongside Claude agents with amber "Claw" source badges, drawer badge, and separate header counts.
- **System view**: OpenClaw registered as a monitored component with live health status (healthy/warning/offline) based on event recency.
- **Radar view**: OpenClaw activity bar chart with hover tooltips showing per-day event and message counts.
- API types updated with `source` field on `LiveAgent` and `openclawStats` on `RadarUsageResponse`.

---

## [0.1.0] — 2026-03-30

### Added

- **18 dashboard views**: Tasks, Agents, Content, Approvals, Chats, Calendar, Projects, Memory, Docs, Notes, People, Office, System, Radar, Pipeline, Factory, Feedback, and a Team placeholder.
- Express 5 API server with route modules for each domain (`/api/tasks`, `/api/agents`, `/api/chats`, etc.).
- Google Calendar integration via OAuth 2.0 (Calendar view).
- Anthropic API token/cost analytics (Radar view).
- OpenClaw webhook endpoint for external push events.
- Vite + React 18 + TypeScript + Tailwind CSS frontend scaffold.
- View-pane architecture — views are mounted once then toggled via CSS to preserve scroll position and local state across navigation.
- Mock data layer for offline development.
- `.env.example` template for required credentials.
