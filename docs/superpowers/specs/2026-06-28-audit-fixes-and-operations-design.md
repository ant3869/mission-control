# Audit Fixes and Operations Features Design

## Goal

Resolve every issue from the 2026-06-28 audit and add the five approved operational features without adding top-level navigation or speculative infrastructure.

## Delivery rule

Work is strictly sequential. Each phase starts with a failing automated check, receives the smallest implementation that satisfies it, and runs its focused checks plus the full regression suite before the next phase begins.

## Considered approaches

1. **Focused extensions to existing hubs and stores (selected).** Reuse Express routers, `node:sqlite`, `TabHub`, the connector gateways, Discord, and the existing API client. This has the smallest blast radius and keeps the product coherent.
2. **A new workflow/operations platform layer.** A generic command bus, event sourcing framework, and plugin system could unify the features, but would add abstractions before a second implementation exists.
3. **External services for auth, telemetry, and scheduling.** Mature hosted products reduce custom code, but conflict with the local-first application and introduce accounts, network dependencies, and deployment work.

## Phase 1: API access control and device pairing

- The API binds to `127.0.0.1` unless `API_HOST` is explicitly configured.
- A non-loopback host requires `DASHBOARD_TOKEN`; startup fails closed otherwise.
- `POST /api/session/login` exchanges the configured dashboard token for an opaque, HttpOnly session cookie.
- An authenticated client can create a single-use six-digit pairing code valid for five minutes. A second device exchanges it for its own session cookie.
- `/api/health`, session login/pair exchange, Google OAuth callback, and independently authenticated OpenClaw/Hermes push endpoints remain public. Every other API route requires a session when `DASHBOARD_TOKEN` is configured.
- The frontend sends credentials on every request and renders a compact login gate before loading the dashboard. Settings exposes pairing-code creation and logout.

## Phase 2: Truthful traces

- A failed trace request renders the actual error and a retry action.
- No synthetic span, token, model, duration, or cost data is generated.
- The mock trace generator and its exports are deleted.

## Phase 3: reproducible checks and container workflow

- `tsconfig.server.json` typechecks all server production and test code.
- `npm run check` runs frontend typecheck, server typecheck, and the repository's static policy checks.
- A Node 22 Dockerfile performs `npm ci`, `npm run check`, `npm test`, and `npm run build`; the runtime launches the API. No host system packages are installed.
- Express serves `dist` only in production so the runtime container is a complete application.

## Phase 4: design contract

- Production TSX contains no `font-bold`, `rounded-2xl`/`rounded-3xl`, `backdrop-blur*`, `shadow-*`, or gradient utility classes prohibited by `DESIGN.md`.
- A dependency-free static test enforces the contract.
- Semantic status colors, borders, flat scrims, and existing motion remain.

## Phase 5: inactive view lifecycle

- Only the active top-level view is mounted.
- Navigating away runs React effect cleanup and stops polling/listeners for the previous view.
- Navigation persistence and lazy loading remain.

## Phase 6: simplification

- Remove unused `@google/design.md` and `supermemory` dependencies.
- Replace five duplicated fetch helpers with one typed request helper.
- Straightforward JSON stores use the existing `loadJson`/`saveJson`; specialized migrations retain local normalization code.

## Phase 7: operational journal and undo

- Request middleware assigns a request id and actor (`dashboard`, `discord`, `openclaw`, or `hermes`) to every mutating request.
- An append-only SQLite journal records method, path, status, timestamp, actor, request body with secret fields redacted, and reversible file snapshots captured by `saveJson`.
- `GET /api/journal` lists entries. `POST /api/journal/:id/undo` atomically restores a reversible JSON snapshot exactly once and journals the undo.
- Activity receives a **Journal** tab with filters, detail, and an Undo button only for reversible entries.

## Phase 8: unified agent controls

- Activity receives a **Controls** tab built from capabilities already present in the application:
  - pause/resume/trigger scheduled OpenClaw and Hermes cron jobs;
  - cancel running harness benchmark runs;
  - retry failed harness benchmark runs;
  - escalate a live session into the existing approval queue.
- The server validates action/resource combinations and returns `409` when a connector or run cannot perform the requested action.
- Every successful control action is visible in the operational journal.

## Phase 9: incident replay

- Alert evaluation persists stable, deduplicated incidents instead of generating a new `firedAt` identity on each poll.
- Incidents store open/resolved state, first/last seen, count, severity, and the triggering rule.
- A replay endpoint correlates raw agent events and journal actions inside the incident window.
- The Health → Alerts view presents incident history and an expandable chronological replay.

## Phase 10: offline capture sync

- Only additive quick captures—todo, to-buy item, and note—may queue offline.
- Each queued request carries a stable idempotency key. The server persists idempotency results in SQLite so reconnects cannot duplicate successful captures.
- The client flushes FIFO when connectivity returns and displays pending/failed counts in the top bar.
- Updates, deletes, credentials, approvals, spending, and control actions fail closed while offline.

## Phase 11: daily briefing

- Preferences store enables/disables the briefing and configures local `HH:mm` delivery time.
- A pure briefing builder summarizes overdue/today todos, queued/blocked tasks, pending approvals, active critical incidents, current-month expenses, and connector health.
- The latest briefing is available on Home and through `/api/briefing/latest`.
- When Discord notifications are configured, the scheduler sends the same briefing once per local calendar day; repeated server ticks cannot duplicate it.
- The browser raises a Notification for a newly published briefing only after the user grants permission.

## Error handling and trust boundaries

- Authentication and idempotency fail closed.
- Pairing codes are one-time, short-lived, and never logged after exchange.
- Secrets are redacted before journal persistence.
- Unsupported controls return explicit errors; no optimistic success is shown.
- Offline replay never includes destructive requests.
- Trace and incident views never replace missing data with invented data.

## Verification

Every phase has focused Node test-runner coverage. Before completion: `npm run check`, `npm test`, `npm run build`, the static design test, and `docker build` when Docker is available. Frontend behavior is exercised in a real browser for login, pairing, trace errors, journal undo, controls, incident replay, offline queueing, and briefing preferences.
