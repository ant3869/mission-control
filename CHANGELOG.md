# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.4.0] — 2026-07-13

### Added

- **Inventory view** — full hardware catalog UI: card grid, detail drawer, inline edit, per-item agent research trigger, bulk actions, search/filter, stats strip, and category/condition/status facets.
- **SQLite persistence** (`data/inventory.db`, WAL mode) replacing the previous JSON file for inventory items. Inline statement preparation pattern used throughout to survive `tsx watch` hot-reloads.
- **`status` field** on inventory items (`available` / `in-use` / `reserved`) so agents can determine what hardware is free vs actively deployed. Operational count reported in stats.
- **`ensureConnected(timeoutMs)`** export on `openclawLive` — waits up to N ms for the persistent WS to authenticate before resolving, so research works without the Watch tab open.
- **`/api/inventory/context`** agent-readable plain-text endpoint summarising catalog for agent consumption.
- **`/api/inventory/:id/set-status`** endpoint for programmatic status transitions.
- **Persistent "Synced X ago" indicator** in the inventory header with 30-second auto-tick refresh.
- Labelled **Sync button** in inventory header with spinner and loading state.

### Changed

- OpenClaw WebSocket lifecycle decoupled from SSE listener presence: the persistent WS now stays connected even when no Watch tab is open, enabling background research and RPC calls.
- `restartLive()` no longer no-ops when there are no active listeners.
- `scheduleReconnect()` reconnects regardless of listener count.
- `addListener` teardown only stops the polling feed; it no longer closes the WebSocket.
- Research (`researchOpenClaw`) now awaits `ensureConnected(12 s)` instead of doing an instant `isConnected()` guard, eliminating false "not connected" errors on first use.
- `buildPrompt()` is model-specificity-aware: injects a hard directive to research only the exact model/SKU when `item.model` is set, avoiding generic product-line summaries.
- Inventory route migrated from `fs`/JSON to `node:sqlite` (`DatabaseSync`) with 24-field schema.
- Toast display durations extended: saved confirmations 2.5 s → 4.5 s, errors 5 s → 6 s.

### Fixed

- SQLite hot-reload bug: prepared statements are now created inline inside each helper function rather than at module scope, preventing "statement belongs to a closed database" errors on `tsx watch` reloads.
- Category and condition dropdowns no longer appear blank on first load — defaults are seeded if the DB has no items yet.

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
