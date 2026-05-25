# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.5.0] — 2026-05-25

### Added

- **Brain view** — raw agent event log across OpenClaw and Hermes, with tool usage frequency charts, loop-detection signals (same tool called 5+ times in a session), event type breakdown, and a filterable event table. Accessible from the Platform Metrics tab bar or as a standalone route.
- **Flow view** — session run history with per-source filtering (OpenClaw / Hermes / All), token counts, heartbeat collapsing, and a full message drill-down drawer showing the complete conversation including tool call/result pairs.
- **Flow Map view** — interactive node-link topology graph showing which agents, channels, tools, memory stores, and runtimes are communicating. Supports 1h / 24h / 7d / all time ranges with live traffic weights. Sidebar nav entry added.
- **Alerts view** — configurable alert rule management with five condition types (`error_rate`, `loop_detected`, `session_stalled`, `token_spike`, `no_activity`), per-source scoping, severity levels (info / warning / critical), enable/disable toggle, and a live fired-alerts panel evaluated against the event store.
- **Model Ops view** — Helicone-style operational analytics covering spend, median latency, request volume, and failure rate across all model providers. Includes a cost-vs-latency scatter chart, per-model comparison table, daily trend histograms, and scope filtering (All / Claude Code / Agents). Sidebar nav entry added.
- **Security view** — connector security posture dashboard: token health status (ok / missing / disabled / auth_error / unreachable), reachability probes with latency, recent auth error counts, error rate bars, and an overall risk-level badge (ok / warning / critical).
- **Pipeline: Trace drawer** — clicking any pipeline run opens a full execution trace with step-level status, timestamps, token usage, and error details. Powered by `TraceViewer` and `TraceDrawer` components.
- **Pipeline: Timeline / Gantt view** — toggle between card grid and a horizontal timeline visualisation of pipeline stage durations.
- **Pipeline: Cron jobs tab** — lists all scheduled agent cron jobs from both OpenClaw and Hermes with last-run time, status, and schedule expression.
- **Platform Metrics tabs** — the OpenClaw and Hermes metrics pages gain embedded tab bars hosting Brain, Flow, Alerts, and Security as sub-views alongside the existing Overview / Activity / Autonomy / Sessions / Cron / Breakdowns / System tabs.
- **Radar insights** — cost anomaly cards, a heatmap showing activity intensity by hour/day, token mix breakdown (input vs output vs cache read vs cache write), and per-model cost share.
- **`/api/brain`** — events endpoint (`GET /events`) with source, limit, and type filters; stats endpoint (`GET /stats`) with per-source daily volume and type distributions.
- **`/api/flow`** — runs endpoint (`GET /runs`) and per-run message detail (`GET /runs/:source/:id`).
- **`/api/flowmap`** — graph endpoint (`GET /graph?range=`) returning nodes, edges, and traffic weights.
- **`/api/alerts`** — CRUD for alert rules (`GET/POST /rules`, `PUT/DELETE /rules/:id`) and live evaluation (`GET /active`).
- **`/api/modelops`** — unified model analytics across Claude Code JSONL sessions, OpenClaw, and Hermes; includes per-model rows with spend, latency, volume, and failure rate.
- **`/api/security/posture`** — connector security posture with token status, reachability, and error history.
- **`evalEngine` / `evalStore`** — server-side evaluation scoring derived from real session history: outcome classification, composite scores per model/agent pair, benchmark run and manual score storage.
- **`memoryFilesFs`** — filesystem scanner for agent memory files (`SOUL.md`, `AGENTS.md`, `MEMORY.md`, etc.) across well-known Claude/OpenClaw paths. Surfaces files in the System view memory panel.
- **Shared chart library** (`src/components/charts.tsx`) — `MiniStat`, `Histogram`, `Donut`, `Scatter`, `SegmentBar`, `HBar`, `Gauge`, `ChartCard`, `fmtNum` exported for use across all analytics views.
- **`agentSources`** extended — `getSessions`, `getCron`, `getMemory`, and `getToolUsage` aggregators pull from both live gateway and cached event store, so analytics views work without an active connector.

### Changed

- **Platform Metrics** rewritten with an 11-tab layout; Brain, Flow, Alerts, and Security are now embedded sub-views rather than separate pages.
- **Radar view** enhanced with insights panel, anomaly detection, heatmap, and token mix breakdown alongside the existing daily charts.
- **System view** expanded with memory file browser, connector diagnostics, and extended health metrics.
- **Chats view** UI refreshed — improved session cards, better token/cost display, and enhanced filtering.
- **Inventory view** refined — SQLite-backed, improved sync indicator, inline edit polish.
- **gateway** extended with `fetchStatus`, `fetchDiagnostics`, and `fetchSessionMessages` for use by Security and Brain routes.
- **`agentSources`** now provides a unified `getSessionDetail` for message-level drill-down across both platforms.
- **`server/index.ts`** registers brain, flow, flowmap, alerts, modelops, and security routes.
- Removed `INVENTORY_OBSIDIAN_SYNC.md` and `INVENTORY_SYSTEM.md` — functionality is now live in the Inventory view.

### Fixed

- Watch view now reflects Hermes conversation activity (previously only OpenClaw sessions triggered the live indicator).
- Server `tsx watch` no longer restarts on SQLite database file changes in `data/` — the `--ignore data/` flag prevents hot-reload loops.
- Hermes connector status endpoint is now auth-aware and rejects masked/placeholder API tokens before attempting a live probe.
- Connector test response now includes structured diagnostics for easier debugging.

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
