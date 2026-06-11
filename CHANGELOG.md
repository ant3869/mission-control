# Changelog

All notable changes to Mission Control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.7.56] — 2026-06-11

### Changed

- **To-Do & To-Buy polish** — a cohesive pass over both personal-list pages:
  - **Drawer slide-in motion** — the detail drawer now eases in from the right (`drawer-in` keyframe), and agent research results rise in as they land (`rise-in`). On-theme motion, no new styling.
  - **Research agent picker** — both drawers now let you choose **OpenClaw** or **Hermes** for the research run (inline `via …` toggle); the choice is passed through `/api/*/research`, so you can compare how each platform answers.
  - **Active-row accent** — the selected row gets a coloured left rail (emerald for To-Do, sky for To-Buy) so it's clear which item the open drawer belongs to.
  - **Friendlier empty states** — section-appropriate icon plus quick-add token hints (`!high`, `@long`, `tomorrow` / `!high`, `x2`, `$89`) so the natural-language syntax is discoverable.

## [0.7.55] — 2026-06-11

### Added

- **To-Buy page** — a personal shopping list (sidebar → Work → To-Buy, right under To-Do) built on the same click-to-open drawer pattern as To-Do / Inventory:
  - Quick add with priority, quantity, and price tokens (e.g. `cordless power drill !high x1 $89`); per-item priority (low / medium / high), quantity, and estimated unit price.
  - **Running total** of all unbought items shown in the header (`Est. total`); each row shows its line total and a count badge appears on the sidebar nav item.
  - **Agent research** (OpenClaw / Hermes) tailored for buying: general info summary, a typical price + price range, online buy links (with prices), local store options, and key specs — all rendered in the side drawer. If you haven't set a price, the agent's estimate auto-fills the item.
  - Mark items as bought (strikethrough + Bought filter), edit inline, delete, and clear-bought — mirroring the To-Do interactions.
  - Backed by `data/tobuy.json` via a new `/api/tobuy` route; research runs async and the client polls for completion.

## [0.7.54] — 2026-06-10

### Changed

- **Sidebar header** — replaced the "N" placeholder square with the Mission Control badge icon (`public/icon.png`).
- **Sidebar footer** — added version number (`vX.Y.Z`) next to the user name; moved "Mission Control" label below the user name so the app identity is surfaced at the bottom rather than crowding the header.
- **TopBar cleanup** — removed the non-functional "Ping Ant" notification button and the redundant green avatar/Settings shortcut (Settings is accessible from the sidebar); Pause button retained as it controls the global auto-refresh bus.

## [0.7.53] — 2026-06-10

### Added

- **Home landing page** — a new default view (sidebar → Work → Home) that replaces the plain Calendar as the opening screen:
  - **Hero**: personalised greeting, animated radar sweep (turns red on critical alerts), live digital clock, and an eased count-up of 7-day estimated spend.
  - **Telemetry ticker**: auto-scrolling strip showing tokens, spend, runs, open to-dos, overdue count, active alerts, pending approvals, active projects, and component health — all live.
  - **Priority queue**: up to 6 cross-domain attention items (fired alerts, overdue/high-priority to-dos, urgent approvals, system errors) ranked by urgency, each clickable to jump to the relevant view.
  - **Command metrics**: four animated stat tiles for open to-dos, pending approvals, active alerts, and active projects — click to navigate.
  - **Quick-view panels**: 7-day usage histogram (tokens + cost + runs + token-mix segment bar), top to-dos preview, project status with progress bars, active alerts & system errors, and a system-health donut. Every panel header is a one-click shortcut to its full view.
  - Calendar (`ScheduledTasks`) moves to lazy-load; Home is the new eager bundle.

- **App icon** — the Mission Control badge (gold arrow + laurel wreath, blue glow) is now the browser favicon and apple-touch-icon (`public/icon.png`). The badge is also displayed at the top of the README.

### Changed

- **To-Do page: drawer layout** — clicking a row now opens a 380 px detail panel from the right (same pattern as Inventory), replacing the awkward inline expand. The compact row shows circle-toggle + title + severity badge + due date badge + research sparkle; the drawer contains the full edit form, notes, all research output (summary, steps, links, key facts), and Edit/Delete actions.
- **CSS**: Added `color-scheme: dark` to `:root` so Chrome/Edge auto-dark-mode and Dark Reader no longer repaint the already-dark palette.

## [0.7.52] — 2026-06-10

### Added

- **Personal To-Do page** — a quick-capture task list (sidebar → Work → To-Do) with:
  - **Natural-language quick add** (Todoist-style tokens): `!low / !high / !crit` sets severity, `@short / @long` sets horizon, and `today / tomorrow / next week / next month` parses a due date — all from a single input line.
  - **Severity levels**: low / medium / high / critical — colour-coded chips on every row.
  - **Horizon**: short-term vs long-term — a secondary badge alongside severity.
  - **Due dates with smart badges**: overdue items show in red and sort to the top; "today" is amber; future dates show relative days. ISO-stored server-side via a `parseDueDate()` helper.
  - **Inline editing**: pencil icon opens an in-row edit form (title, notes, severity, horizon, date); Enter saves, Esc cancels.
  - **OpenClaw/Hermes research**: sparkle ✨ button fires an async agent research request (`POST /api/todos/:id/research`) — attaches a summary, action steps, relevant links, and key facts/calculations to the task. Status badge shows pending → done; the result panel expands below the row. Polling speeds up to 5 s while any research is in flight, drops to 30 s otherwise.
  - **Filter tabs**: All / Active / Done — each shows its item count; the Done tab has a **Clear completed** button.
  - **Sidebar badge**: the Work → To-Do nav item shows the count of open (not-done) todos, polled every 30 s alongside tasks and approvals.
  - **CRUD backend** (`server/routes/todos.ts`): GET / POST / PATCH / DELETE + `POST /api/todos/clear-done`; JSON-persisted to `data/todos.json`. Orphaned pending-research rows are reset to `failed` on server restart.

## [0.7.51] — 2026-06-09

### Removed

- **Pruned the dead `ScoreBreakdown` cluster from `Scorecards.tsx` (~60 lines).** The exported `ScoreBreakdown` component (plus its private `Fact`/`SubScoreRow` helpers and `BreakdownProps`) had zero references anywhere. Removed the whole cluster and the now-unused imports it pulled in (`Layers`, `Wrench`, `EvalSubScore`) — `tsc` flagged them, confirming nothing else used them. The live exports (`ModelLeaderboard`, `PlatformFactorBar`, `MiniSummaryStat`) are untouched. Verified `tsc` clean, build succeeds, and Evaluations still renders.

## [0.7.50] — 2026-06-09

### Removed

- **Deleted the dead `Methodology.tsx` (`MethodologyPanel`, 8.7k chars).** A second dead-code sweep (unused exported symbols) found it was a duplicate of the live `InlineMethodology` that the Evaluations view actually uses — `MethodologyPanel` had zero references. Removed it. (Left `ScoreBreakdown` in Scorecards.tsx for now — also unused but its helper sub-components/imports would cascade; noted for a careful future prune.) Verified `tsc` clean + `vite build` succeeds.

## [0.7.49] — 2026-06-09

### Added

- **Idea Factory: click an idea to open a full detail panel.** A dead-code sweep found `ProjectIdeaPanel` — a fully-built 480px detail drawer (full description, why-it-fits, parts lists, confidence/coolness/usefulness scores, influence metadata, status history, reject-with-reason) — that was **never imported anywhere**. Wired it into Factory: clicking an idea card now opens the panel (cards were previously click-dead, showing only truncated info); the panel's Save/Snooze/Complete/Reject actions map to the real status updates, and Escape/backdrop closes it. (The iteration-11 type fixes that made this component compile finally pay off.)

### Removed

- Deleted `src/views/ComingSoon.tsx` — an orphaned "Coming next iteration" placeholder with zero imports (all views are real now).

## [0.7.48] — 2026-06-09

### Removed

- **Deleted the orphaned `server/services/` directory (570 lines of dead code).** `inventory-enrichment.ts` (with a stale `// TODO: Update item in database`) and `obsidian-vault-sync.ts` had **zero references anywhere** — the real inventory research/sync is handled by `server/lib/research.ts` and the inventory route. Found via a TODO/dead-code sweep. Removing them clears a misleading half-finished service and the confusing TODO. Verified: `tsc` clean, server tests 90/90, `vite build` succeeds.

## [0.7.47] — 2026-06-08

### Changed

- **Centralized friendly error messages.** Added a reusable `friendlyError(err, subject)` helper that maps raw API failures to short, actionable text — network errors → "Couldn't reach <subject>. Check it's running…", auth errors (401/invalid_grant/expired) → "Authentication failed for <subject>. Reconnect it in Settings." — while passing unrecognised errors through unchanged. Applied to the connection-dependent views that previously printed raw messages (Agents, Chats). Verified tsc + build clean.

## [0.7.46] — 2026-06-08

### Fixed

- **Platform Metrics (OpenClaw/Hermes): friendly "can't reach" message instead of raw "fetch failed".** The not-connected empty state printed the raw network error verbatim. Network-type errors now show actionable guidance — "Couldn't reach the <platform> server — check it's running and that the URL/token are set in Settings" — while non-network errors still show verbatim. (Continuation of the 0.7.45 error-message review.) Verified on the Hermes view (server down): friendly text shown, raw "fetch failed" gone; tsc + build clean.

## [0.7.45] — 2026-06-08

### Fixed

- **Calendar (landing view): friendly Google re-auth prompt instead of a raw error.** When the saved Google OAuth token expires/revokes, the API returns `invalid_grant` — which the view printed verbatim as a cryptic red "Error: invalid_grant" on the first screen users see. Auth failures (`invalid_grant`, expired/invalid token, unauthorized, etc.) are now treated like "not configured": the actionable **"Google Calendar needs reconnecting"** banner with the `/api/auth/google` link is shown, and the raw error is suppressed. Found via a screenshot review of the landing view. Verified: banner + re-auth link show, raw error gone; tsc + build clean.

## [0.7.44] — 2026-06-08

### Changed

- **Monitoring/integration filters now persist across reloads.** Applied the `usePersistedState` hook to the filter controls that previously reset on refresh: Brain (source + event-type), Flow (source), Flow Map (time range), and Office (category). Set a filter, reload, and it's still applied. Verified tsc + build clean; the per-view localStorage keys are written on mount.

## [0.7.43] — 2026-06-08

### Changed

- **Harness Benchmarks remembers your setup across reloads.** Added a reusable `usePersistedState` hook (localStorage-backed `useState`) and applied it to the most-used controls — harness, task pack, sample count, and the Compare view's mode (latest/average/best) and group-by (model/provider). Previously every reload reset these to defaults; now your benchmark configuration and comparison view persist. Verified: changing group-by writes to storage and is restored on load. tsc + build clean.

## [0.7.42] — 2026-06-08

### Changed

- **The app remembers your last view across reloads.** It always reset to Calendar on refresh, losing your place (annoying when working in a specific view like Harness Benchmarks). The active view is now persisted to `localStorage` and restored on load (validated against known views; falls back to Calendar). Verified: navigate to Memory → reload → still on Memory.

## [0.7.41] — 2026-06-08

### Added

- **"Live / Paused" indicator on the auto-refreshing views.** The 0.7.38–0.7.40 auto-refresh was silent, so there was no sign a view was updating itself — or that the global Pause had frozen it. Added a small reusable `LiveBadge` (pulsing green "Live" dot → amber "Paused" when the top-bar Pause is on) to the Brain, Flow, and Flow Map headers. Makes the live behaviour discoverable and surfaces the pause state consistently (matching Watch). Verified: shows "Live", flips to "Paused" on toggle; tsc + build clean.

## [0.7.40] — 2026-06-08

### Changed

- **Flow Map (traffic graph) now auto-refreshes**, completing the live-monitoring set (Watch, Brain, Flow, Flow Map). Silent re-fetch every 20s (no spinner flash, honours the global Pause), so the node-link graph reflects current traffic without a manual Refresh. Fixed the same latent Refresh-button bug (click event passed as the `silent` flag). tsc + build clean, view renders.

## [0.7.39] — 2026-06-08

### Changed

- **Flow (session run history) now auto-refreshes**, matching Brain (0.7.38). It loaded once; now it silently re-fetches every 15s (no spinner flash, honours the global Pause), so new agent sessions appear without a manual Refresh. Also fixed the same latent bug as Brain — the Refresh button was passing its click event as the new `silent` flag. tsc + build clean, view renders.

## [0.7.38] — 2026-06-08

### Changed

- **Brain (agent event stream) now auto-refreshes.** It's billed as a live event brain but only loaded once — you had to hit Refresh to see new agent activity. It now silently re-fetches every 10s (no spinner flash; honours the global Pause toggle), so new tool calls / messages / errors appear on their own. Manual Refresh still works. Verified tsc + build clean and the view renders.

## [0.7.37] — 2026-06-08

### Added

- **App version shown in the sidebar footer.** After many releases there was no way to tell which build you were viewing. The version (from `package.json`, injected at build via a Vite `define` → `__APP_VERSION__`) now appears in the sidebar footer — next to the user in the expanded state, under the avatar when collapsed. Helps confirm deploys and report issues against a specific build.

### Verified

- Runtime-confirmed the 0.7.36 Escape-to-close behaviour end to end (opened the New Project modal, pressed Escape, it closed). Also confirmed Escape coverage is complete — every overlay either uses the shared hook or its own handler; the evaluations task forms are inline (not overlays).

## [0.7.36] — 2026-06-08

### Accessibility

- **Modals & drawers now close on Escape.** Only 3 of ~16 overlays handled the Escape key (most closed only on backdrop click) — a basic a11y/UX expectation. Added a shared `useEscapeKey(onClose)` hook and wired it into the rest: Harness detail drawer, Approvals (note + new-request), New Project, Add Task, Inventory detail, Platform Metrics transcript, Agents drawer, Flow run panel, Flow Map inspector, Security diagnostics, and the Project-Idea panel. Verified: tsc compiles the hook in every target (onClose in scope) + build clean.

## [0.7.35] — 2026-06-08

### Added

- **Harness Benchmarks → per-run results table: sortable columns.** Consistent with the Compare table — Status, Lane, Task, Score, Latency, and Failure headers are now click-to-sort (asc/desc + ▲/▼; latency nulls sink; status ranks passed→error). Default stays in task/pack order until you sort. Makes triaging a run easy — e.g. sort by Score to see the worst tasks first, or by Failure to group failure types. Verified: Task sort reorders alphabetically both directions; build clean.

## [0.7.34] — 2026-06-08

### Added

- **Harness Benchmarks → Compare: sortable columns.** The comparison was locked to overall-% descending, so you couldn't rank models by what you actually care about. Every headline column (Model/Provider, Task pack, Overall, Pass, Reliability, Speed, Tokens, Cost, Fences, Fails, Runs) is now click-to-sort with an asc/desc toggle and a ▲/▼ indicator; nulls always sink to the bottom. Now you can ask "cheapest model that still passes?" or "fastest?" directly. Verified: Cost↓ surfaces the priciest, Cost↑ the cheapest, toggle + arrow work.

## [0.7.33] — 2026-06-08

### Added

- **Harness Benchmarks → Compare: Export CSV.** The per-run results already had an export, but the cross-model **Compare** table — the most shareable view — had none. Added an **Export CSV** button that downloads the full comparison (harness, model/provider, family, task pack, runs, overall %, pass %, reliability, speed ± stdev, tokens, cost, fence %, fails, and every per-lane score) for spreadsheet analysis. Pure client-side from data already loaded; filename encodes group-by + mode + date. Verified: 26-row CSV with the correct header.

## [0.7.32] — 2026-06-08

### Changed

- **Dead-control sweep: removed the last no-op button.** Scanned every view/component for `<button>`s with no `onClick`/handler. The only one left (after the 0.7.31 Office fix) was the System view's per-component **Power (Enable/Disable)** toggle — there's no endpoint to enable/disable a plugin/MCP from the dashboard (that lives in Claude settings), so the button was misleading. Removed it; the working **Recheck** button stays (now with an `aria-label`) and the status badge already shows healthy/offline. The app now has **zero decorative no-op buttons**.

## [0.7.31] — 2026-06-08

### Changed

- **Office: replaced the dead per-row buttons with real expandable details.** Each integration row had a Manage/Fix/Connect/Configure button that did nothing (these statuses are read-only/derived — there's no connect action to call), which was misleading. Rows are now click-to-expand disclosures that reveal full diagnostics — status, category, version, connected-as, last sync, and the **full untruncated error** (the inline line truncates it) — which is what you actually need when an integration is failing. Verified: 0 dead buttons, rows expand with `aria-expanded`, tsc + build clean.

## [0.7.30] — 2026-06-08

### Changed

- **Harness Benchmarks: multi-turn results show the full conversation in the detail drawer.** Completes the 0.7.28 multi-turn feature — the runner now keeps each turn's reply text (not just raw transcripts), and the drawer renders a **"Turn 1 reply · before the follow-up"** section above the scored **"Turn 2 reply · final, judged"** output, so a reviewer can see how the model *revised* its answer after new information (the whole point of the lane) instead of digging through raw JSON. Verified: runner captures `turn1.answer` (e.g. the model's initial diagnosis), tsc + build clean.

## [0.7.29] — 2026-06-08

### Added

- **Harness Benchmarks → Compare: per-model score trend sparkline.** Each row now shows a small inline sparkline of that model+pack's overall % across every completed run (oldest → newest), coloured green/red by net direction, with the exact sequence on hover. Makes regressions/improvements visible at a glance — e.g. a model that swings `100 → 0 → 0 → 0 → 100` reads very differently from a steady `83 → 92`. Computed server-side in `modelComparison` (both Model and Provider group-by); single-run rows show the value instead of a flat line. Verified: API returns trend arrays, 8 multi-run sparklines render.

## [0.7.28] — 2026-06-08

### Changed

- **Harness Benchmarks: multi-turn troubleshooting is now a real 2-turn exchange.** Previously the multi-turn lane crammed both turns into a single prompt (a documented v1 limitation). Tasks can now declare a `followUp`; the runner dispatches turn 1, then a real turn 2, and scores the **final** reply (latency/tokens/cost summed, both transcripts kept under `turn1`/`turn2`). OpenClaw keeps context natively via the shared session key; stateless harnesses get the prior exchange folded into the follow-up. The `ocr-multiturn` task now genuinely tests *revising* a diagnosis after new output. Verified: real 2-turn dispatch, model updates its diagnosis correctly (10/10).

## [0.7.27] — 2026-06-08

### Changed

- **The browser tab title now reflects the active view** (e.g. "Harness Benchmarks · Mission Control"), instead of a static "Mission Control". Improves browser-history readability and tab identification when several views/tabs are open. Verified it updates on navigation.

### Notes

- Health check this cycle: no failed network requests across a full view tour, no remaining unlabeled icon-only buttons, `tsc` clean, build succeeds. The app is in a solid steady state — remaining work is incremental.

## [0.7.26] — 2026-06-08

### Accessibility

- **Labeled the icon-only close buttons.** Nine modal/drawer close (✕) buttons across 7 views (Tasks, Projects, Approvals ×2, Inventory ×2, Notes, Platform Metrics, Harness Benchmarks) were icon-only with no accessible name, so screen-reader users couldn't tell what they did — a real problem in focus-trapping modals. Added `aria-label="Close"` to each. Verified `tsc` clean + build.

## [0.7.25] — 2026-06-08

### Added

- **Per-view error boundary.** Previously a runtime exception in any view would white-screen the entire dashboard (sidebar, top bar, and all other views included). Each view pane is now wrapped in an `ErrorBoundary` that catches render errors and shows a recoverable fallback ("This <view> view hit an error" + the message + a "Try again" button) while the rest of the app keeps working. Verified `tsc` clean + `vite build` succeeds. (The runtime console is otherwise clean — earlier TopBar errors were stale HMR artifacts from mid-edit reloads.)

## [0.7.24] — 2026-06-08

### Fixed

- **Watch no longer shows a red "disconnected" badge when paused.** Pausing closes the SSE stream, which previously read as an error state. The live indicator now has a distinct amber **"paused"** state (vs. green "live" / red "disconnected"), so a deliberate pause doesn't look like a fault.

## [0.7.23] — 2026-06-08

### Changed

- **Pause now also freezes the Watch live feed.** The Watch view's SSE event stream is the noisiest live source; it now closes when auto-refresh is paused and reopens on resume, so Pause genuinely halts all background activity. (The 1s relative-time tick is cosmetic and left running.)
- **The top-right avatar now opens Settings.** It was a decorative `<div>` with a pointer cursor that did nothing; it's now a real button (with aria-label + hover ring) that navigates to Settings.

## [0.7.22] — 2026-06-08

### Changed

- **The TopBar "Pause" button now works** — it was decorative. It toggles a global "pause auto-refresh" bus (`src/lib/refreshBus.ts`); while paused, the dashboard's background polling stops (Alerts, Approvals, Chats, Platform Metrics, Security all guard their intervals with `isRefreshPaused()`), so you can read a live view without it shifting and cut idle network churn. The button shows an active amber state + "Paused" label. Cosmetic animation ticks are unaffected.
- Fixed a changelog date typo (0.7.21 was dated 2026-08-08).

## [0.7.21] — 2026-06-08

### Docs

- **Refreshed the README to match reality.** Added the missing **Harness Benchmarks** page; rewrote the now-real **Factory** (agent idea board), **Content** (agent-published feed), **People** (real participants), and **Feedback** (inbound feed w/ sentiment) descriptions that still described mock data; corrected the DB line (`node:sqlite` `DatabaseSync`, not `better-sqlite3`); and noted the ⌘K command palette + lazy-loaded views. Also confirmed the test suite is green (90/90 — an earlier "1 fail" was a flaky date-dependent run).

## [0.7.20] — 2026-06-08

### Added

- **Alerts: one-click starter rules.** The Alerts view (surfaced in 0.7.12) shipped empty, so the feature looked inert. The empty state now offers **"Add recommended rules"** which creates a curated set evaluated against real agent events — error spike (5/30m), tool-loop detection (8/15m), agents idle (120m), session stalled (30m), and token-usage spike (500k/60m) — plus a "Create custom rule" shortcut. Seeding is idempotent (skips rules that already exist by name). Verified: one click creates all 5 real, persisted rules.

## [0.7.19] — 2026-06-08

### Fixed

- **`tsc --noEmit` is now fully clean (22 errors → 0).** The recovered inventory/evaluations WIP had type errors that built under Vite but failed a strict typecheck. Fixed: `synthesis.ts` now sets `scoringSource` on the "next tests" via the existing `taskScoringSource` helper (which also consumes the previously-unused `autoGradedSlugs`); and `ProjectIdea` gained optional richer-shape fields (`usefulnessScore`, `influenceMetadata`, `statusHistory`) so `ProjectIdeaPanel` typechecks and its map callbacks infer types (no more implicit-any). The backend's simpler shape still works — the panel renders the extra sections only when present. Verified: 0 tsc errors + `vite build` succeeds.

## [0.7.18] — 2026-06-08

### Performance

- **Code-split the views — initial JS bundle 815 kB → ~219 kB (~73% smaller).** Every view was imported eagerly into one chunk; now all ~25 views are `React.lazy` chunks fetched on first navigation (the landing Calendar view stays eager to avoid a first-paint flash), wrapped in per-pane `Suspense` with a spinner fallback. Heavy views (Evaluations, Harness Benchmarks, PlatformMetrics, Brain/Flow/Alerts/Security) no longer load until visited; the build now emits 68 small chunks and the >500 kB chunk warning is gone. Verified `tsc` clean, `vite build` succeeds, and lazy navigation works at runtime.

## [0.7.17] — 2026-06-08

### Removed

- **Deleted the dead mock-data layer.** Now that every view runs on real data, removed `src/data/mockData.ts` (1,036 lines of fake contacts/content/ideas/feedback/etc. that no view imported anymore) and pruned ~25 now-unused mock-only types from `src/types/index.ts` (Person, FeedbackItem, ContentItem, FactoryIdea, ChatSession, SystemComponent, ActiveRun, …). This removes the misleading fixtures that made the app look mock-driven, and shrinks the type surface. Verified: `tsc` clean and `vite build` succeeds.

## [0.7.16] — 2026-06-08

### Changed

- **⌘K is now a real command palette.** The global search previously searched only notes and its results didn't navigate anywhere. It now (1) jumps to any page — live-filtered against all ~25 views — and (2) searches notes, docs, and tasks, with results that navigate to the relevant view. Full keyboard navigation (↑↓ to move, ↵ to open, esc to close), grouped sections (Pages / Notes / Docs / Tasks), and a hint footer. Wired `onNavigate` + the view list from `App` into `TopBar`.

## [0.7.15] — 2026-06-08

### Fixed

- **Security posture falsely reported OpenClaw as "unreachable."** The posture check probed an HTTP `/api/status` endpoint, but OpenClaw is a WebSocket gateway with no such REST route (always 404), so the primary connector showed as down even while live. It now uses the transport-aware `getPlatformMetrics` (WebSocket for OpenClaw, REST for Hermes) — the same reachability signal the rest of the app uses — so OpenClaw correctly shows OK/Connected with its real version, and the posture score reflects reality. Also adds a live auth-error signal (a reachable connector whose authed calls 401/403, e.g. a rotated Hermes token, now surfaces as `auth_error`).

## [0.7.14] — 2026-06-08

### Changed

- **Feedback is now a real inbound-message feed** instead of mock testimonials. It shows what people actually send the agents (real `message:received` events) with a **transparent keyword sentiment** tag (clearly labelled "heuristic sentiment", not an LLM judge): a sentiment proportion bar, positive/neutral/negative filters, sender + channel + time, and full message text. New `deriveInbound()` aggregation + `GET /api/{openclaw,hermes}/inbound`.
- **Milestone: every view now runs on real data** — no mock-data views remain. The five former mock pages (Calendar's Always-Running strip, People, Factory, Content, Feedback) are all wired to live agent data, and four orphaned views (Brain/Flow/Alerts/Security) were surfaced into the nav.

## [0.7.13] — 2026-06-08

### Changed

- **Content is now a real feed of agent-published output** instead of a mock social-media pipeline. It shows the substantial content the agents actually produce and deliver — morning briefings, status reports, digests, and replies — via a new `derivePublications()` aggregation + `GET /api/{openclaw,hermes}/publications`. Each item shows a type badge (briefing/status/heartbeat/digest/reply), channel, word count, time, and an expandable full body with light markdown rendering; with type filter and search. Grows automatically as the agents publish. (Only the Feedback view remains on mock data.)

## [0.7.12] — 2026-06-07

### Added

- **Surfaced four fully-built but orphaned views into a new "Monitoring" nav section** — Brain, Flow, Alerts, and Security existed as complete views (380–453 lines each) with live backends (`/api/brain`, `/api/flow`, `/api/alerts`, `/api/security`) but were never wired into navigation, so they were unreachable. Now accessible:
  - **Security** — connector security posture (token hints, reachability, auth-error/error-rate analysis, posture score) + a security-events tab.
  - **Alerts** — alert-rule CRUD + active alerts.
  - **Brain** — agent event stream with type/source filters and stats (151 real events).
  - **Flow** — agent run flow with summary + per-run detail (109 real runs).

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
