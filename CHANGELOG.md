# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.7.11] — 2026-06-07

### Changed

- **Factory is now a real "Idea Factory"** wired to the agent-generated project ideas (`/api/inventory/project-ideas`) instead of mock startup ideas. It shows the real buildable ideas the agents derive from your inventory — title, category, confidence/coolness scores, difficulty, time/cost estimates, have/missing parts, and next step — with status filters (new/liked/snoozed/rejected/completed), hover triage actions (Like / Snooze / Reject / Done via `update`), best-first sorting, and a **Generate ideas** button that triggers a run and polls until it completes. This makes all three Workspace tabs (People, Office, Factory) real.

## [0.7.10] — 2026-06-07

### Changed

- **People is now a real contacts directory** instead of mock collaborators/clients. It derives distinct humans who have actually interacted with the agents from event payloads (Discord/Telegram senders) via a new `derivePeople()` aggregation + `GET /api/{openclaw,hermes}/people`. Each card shows the person's name, platform badge, channels (e.g. `#general`), message count, last-seen, and since-date; with platform filter, search, and live refresh. Grows automatically as new people message the agents — no more fake data.

## [0.7.9] — 2026-06-07

### Changed

- **Calendar (landing page) "Always Running" strip now shows REAL recurring agent jobs.** It was hardcoded mock (`Reaction Pulse`, `Trend Radar`, …). It now pulls live OpenClaw + Hermes cron jobs (`/api/{openclaw,hermes}/cron`), showing each job's name, next-run/schedule, source badge (Claw/Hermes), and a live enabled/paused dot — with **pause/resume on hover** (real `cron action`). Enabled jobs sort first; loading skeletons + an empty state ("connect OpenClaw/Hermes in Settings") included. Removes the last mock data from the default landing page and makes it actionable.

## [0.7.8] — 2026-06-07

### Fixed

- **Endpoint override now works without `/v1`.** The OpenAI-compatible override built `<base>/chat/completions`, so a base URL like `http://host:1234` (LM Studio / Ollama) hit `/chat/completions` and got an empty 200 (every task `empty_response`). It now normalizes the URL — bare host, `/v1`, or full endpoint all resolve to `/v1/chat/completions`. Verified against LM Studio (gemma4-12b) → real responses, 50/50. This is the valid path for comparing *real distinct* models (it honors the model + returns real token usage), unlike OpenClaw chat.send.

## [0.7.7] — 2026-06-07

### Fixed — important benchmark-validity finding

- **OpenClaw runs the agent's configured model, NOT the requested one.** While wiring session-level token usage, discovered that `chat.send` ignores the per-call model selector — across 79 real benchmark sessions every run resolved to the same model (`gemini-3.1-pro-preview`) regardless of what was selected, and it can even change between runs. So earlier "model A vs model B" comparisons were largely the *same* model under different labels — the real reason scores never diverged. (Passing a `model` param to `chat.send` doesn't help: OpenClaw strictly validates params and rejects it, erroring the turn.)
- The runner now reads the **actual** model from the transcript (the assistant message's `model` field), persists it as `resolvedModel`, and raises a clear amber **warning** on the run when it differs from the requested model. The run summary shows the real model in amber.
- **Compare now groups by the model that actually ran** (`resolvedModel`), so differently-labelled OpenClaw runs collapse into the true model instead of appearing as several distinct models.

### Added

- Session-level token fallback: when OpenClaw's per-message `usage` is zero, the runner reads `sessions.list` totals (still zero on dashboard-dispatched sessions today, but correct if the gateway starts reporting). Tokens/cost remain estimates (`~`) until real usage is reported, or use the OpenAI-compatible endpoint override (which returns real `usage` and honours the model).

## [0.7.6] — 2026-06-07

### Added

- **Provider rollup in Compare** — a `Group by: Model / Provider` toggle aggregates rows by model **family** (Anthropic / OpenAI / Google / Meta / Mistral) so you can compare ecosystems, not just individual models. Provider rows are family-coloured and show the model count; all fingerprint metrics aggregate across the family's models per the selected mode.
- **Token-based verbosity + cost** — the runner now captures token usage from each harness (OpenClaw assistant-message `usage`, OpenAI-compatible `usage`) into per-result `output_tokens` / `input_tokens` / `reported_cost` (migrated in place). Compare replaces the chars column with **Tokens** (mean output tokens/task) and adds **Cost** (est. USD per run). Real harness-reported cost is used when present; otherwise tokens are estimated from chars (~4/token) and cost from a pricing table — both marked with a leading `~`. Pricing/family detection live in `server/lib/harnessBenchPricing.ts` (editable).

### Notes

- Surfaces a real ecosystem difference even at equal accuracy: on the Config and Discriminator packs, OpenAI models cost ~20–25× more per run than Google models for the same score. (OpenClaw currently reports zero usage on dashboard-dispatched sessions, so token/cost show as estimates until the gateway populates usage.)

## [0.7.5] — 2026-06-07

### Added

- **Model fingerprint columns in Compare** — beyond Overall/Pass, the comparison table now surfaces the characteristics that differ *even when accuracy is equal*: **Reliab.** (sample pass-consistency), **Speed** (avg latency ± stdev = speed consistency), **Verbose** (mean response length in chars), and **Fences** (% of replies wrapped in ``` — markdown tendency). These give real, differing data points for picking a model (e.g. terser vs chattier, steadier vs spikier latency) instead of a wall of 100%s. Backend computes them per comparison group; reliability falls back to pass rate for single-sample runs.

## [0.7.4] — 2026-06-07

### Added

- **Multi-sample consistency scoring** — a `Samples / task` control (1× / 3× / 5×) runs each task N times and scores on **reliability** (pass-consistency), not a single shot. Each result shows a colour-coded `passed/N` badge in the table and a "reliability X/N" badge in the detail drawer; the score is the mean across samples so flakiness lowers it. This is the differentiator that single-shot accuracy can't provide: frontier models converge on single-shot answers but differ in *reliability*. Backend: `samples` on the run request, per-result `sampleCount`/`passCount` columns (migrated in place).
- **`openclaw-discriminator-pack`** (8 HARD tasks) built to separate frontier models: exactly-five-words format, computed tool argument (`ws://127.0.0.1:18789`), nested strict JSON, distractor-tool resistance, confident false-premise rejection, selective retrieval (right needle vs decoy), dedup counting, and a four-checkpoint multi-constraint PowerShell command.

### Notes

- Empirically: on single-shot, gemini-3.1-pro / gemini-2.5-flash / gpt-5.2 all scored 70/80 on the hard pack with **zero** per-task divergence (all even failed the false-premise task identically) — confirming single-shot deterministic accuracy cannot rank frontier models. At **3 samples** the profiles diverge: gpt-5.2 is more reliable on strict nested JSON (3/3 vs 2/3) while gemini-2.5-flash is more reliable resisting the distractor tool (3/3 vs 2/3).

## [0.7.3] — 2026-06-07

### Changed

- **Partial credit for multi-criteria (regex) tasks** — diagnosis/command/reliability tasks now score by fraction of required patterns matched (e.g. identified the *cause* but not the *fix* → 5/10) instead of all-or-nothing. This gives real gradation between models and stops penalising correct-but-differently-worded answers as hard zeros. Forbidden patterns and destructive commands still hard-fail; exact/JSON/tool-call tasks remain binary. Pass-rate stays strict (full marks only) so the two signals (pass-rate vs score %) are distinct.
- **Partial results render as an amber "Partial"** chip (with `n/max pts`) in the results table and detail drawer, instead of a red "Failed", so the gradation is visible.

## [0.7.2] — 2026-06-07

### Added

- **`openclaw-routing-actions-pack`** (OpenClaw Routing & Actions, 7 tasks) — rounds out OpenClaw lane coverage beyond config/diagnosis: tool-call formatting (routing action), investigate-before-acting tool selection, routing-context fidelity, safe gateway-tunnel command, grounded refusal, multi-turn re-diagnosis (gateway up but tunnel down), and context-window-overflow diagnosis. All deterministic; OpenClaw only.

### Changed

- Loosened the context-window-overflow grader to accept any correct phrasing of the overflow cause + fix (e.g. "200,000-token limit … truncate"), not only the literal words "context window".

## [0.7.1] — 2026-06-06

### Changed

- **Harness Benchmarks · Compare** now defaults to **latest completed run** per model + provider + harness + task pack, so an older low run no longer drags down the current score. Added a **Compare by: Latest / Average / Best** toggle (Latest default) and a Task pack column; runs column shows used/available.
- **Recent runs** are now cards showing model, task pack, score, relative time, ✓/✗ counts, and execution mode (`harness_direct`); the selected run is clearly highlighted.
- **Model fetch failure** is now a compact connector-status line ("OpenClaw models: connected · N / unavailable") with the error in an expandable detail — no longer a prominent warning, and never blocks runs.
- **Task detail drawer** clearly separates **Scored model output (judged · OpenClaw `<final>` unwrapped)** from **Raw harness output (full transcript · saved for debugging)**.

### Added

- **Run cleanup** — delete a single run, **Clear failed** (failed/cancelled runs), and **Clear all** history (with confirmation). New `POST /api/harness-bench/runs/clear`, `GET …/comparison?mode=`.

## [0.7.0] — 2026-06-06

### Added

- **Harness Benchmarks view** — a first-class page (sidebar → Analytics → Harness Bench, FlaskConical icon) that benchmarks how a model performs *through* OpenClaw/Hermes: **App → harness → selected model → tools/context/routing → result**. Distinct from generic/raw model benchmarks. Run controls (harness, model, task pack, OSS/local endpoint override), a run summary (status, total score, pass rate, avg latency, failures, execution mode), nine lane cards that filter the results table, an inspectable per-task detail drawer (prompt, expected behavior, model response, parsed tool call, scoring detail, raw harness output), cross-run model comparison, and JSON export.
- **9 benchmark lanes** — runtime compatibility, instruction adherence, tool selection, tool-call formatting, log/config diagnosis, multi-turn troubleshooting, memory/context, command/action quality, and reliability/failure behavior. Failures normalize into 17 typed categories (timeout, auth_error, model_not_found, invalid_json, wrong_tool, hallucinated_tool, ignored_instruction, ungrounded_claim, wrong_diagnosis, unsafe_command, …).
- **4 seeded task packs** — `quick-smoke-pack`, `openclaw-config-pack`, `hermes-agent-pack`, `oss-model-stability-pack` (22 tasks). No coding benchmarks (HumanEval/MBPP/SWE-bench) and no MMLU-style trivia — agent-harness behavior only.
- **`/api/harness-bench`** — REST surface: packs, live harness/model availability, runs (start/get/list/cancel/rerun-failed/delete/export), and cross-run comparison. Runs execute **real** dispatches (Hermes API server via `hermesChat`, OpenClaw via WS `chat.send`+poll, or any OpenAI-compatible `/v1` endpoint for OSS/local models); unreachable endpoints record real failure types — never fabricated scores.
- **Deterministic scoring** (`harnessBenchScoring`) — exact, regex, json_schema deep-equal, and tool-call match (name + argument subset) with no LLM judge; rubric/manual tasks are honestly returned as `manual_review` rather than guessed.
- **SQLite persistence** (`data/harness_bench.db`) for runs, per-task results, and raw harness output, following the existing `node:sqlite` pattern.

## [0.6.0] — 2026-05-26

### Added

- **Evaluations view** — agent performance evaluation hub with a model scorecard leaderboard, agent-model matrix, trend chart, benchmark task runner, memory benchmark panel, and scoring methodology reference. Accessible from the sidebar (Target icon).
- **`/api/evaluations`** — full evaluation REST API: benchmark task CRUD, live task execution dispatched to the Hermes API server, manual scoring, model and agent scorecards, agent-model matrix, trend data, and scoring methodology.
- **`hermesApiServer`** (`server/lib/hermesApiServer.ts`) — OpenAI-compatible Hermes chat client (`hermesChat`, `hermesApiHealth`). Separates the Hermes chat API (Bearer-auth, `/v1/chat/completions`) from the dashboard (session/log REST API), eliminating the previous approach of polling dashboard endpoints that do not accept chat.
- **Memory benchmark engine** (`memoryEvalEngine` / `memoryEvalStore`) — evaluates agent memory retrieval across six task kinds: recall, multihop, temporal, conflict, applied, and negative. Produces composite scores covering retrieval accuracy, freshness, conflict resolution, false recall penalty, and latency.
- **Hermes API server configuration in Settings** — the Hermes connector panel now exposes separate fields for the OpenAI-compat API server URL and API key (distinct from the dashboard URL and session token). The Test button probes both layers and reports their health independently.

### Changed

- `saveConnector` / `redactConnector` extended to persist and surface `apiBaseUrl` and `apiToken` for the Hermes API server, with the same masking rules applied to the key.
- Settings `PUT /connectors/:id` now accepts `apiBaseUrl` and `apiToken` body fields.
- Settings `POST /connectors/:id/test` for Hermes now calls `hermesApiHealth` and includes an `apiServer` probe object in its response; the top-level `ok` requires both the dashboard and the API server to be healthy.
- `ConnectorInfo` API type extended with `apiBaseUrl`, `hasApiToken`, and `apiTokenHint` fields.
- Inventory research via Hermes now uses `hermesChat` (API server) instead of polling dashboard REST paths.

### Fixed

- Inventory research via Hermes now calls the API server (`POST /v1/chat/completions`) instead of attempting to POST to dashboard REST paths that reject chat messages. Eliminates "no supported REST endpoint found" errors on Hermes research.
- Orphaned `running` benchmark_runs (left over from a previous server process) are set to `error` at startup so they do not spin forever in the UI.
- `updateBenchmarkRun` patch function added to `evalStore` — allows flipping a running placeholder row to its final outcome after async execution completes.

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
