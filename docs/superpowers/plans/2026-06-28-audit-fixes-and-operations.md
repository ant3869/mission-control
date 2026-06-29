# Audit Fixes and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the audit findings and deliver five complete operations features in verified sequential phases.

**Architecture:** Extend existing Express routers, React hubs, `node:sqlite` stores, connector clients, and Discord notification paths. Each phase owns a small server module, route surface, client API, UI integration, focused tests, and a regression gate.

**Tech Stack:** Node 22, TypeScript, Express 5, React 18, Node test runner, `node:sqlite`, Tailwind CSS, Capacitor, Docker.

---

### Task 1: Session authentication, safe binding, and pairing

**Files:**
- Create: `server/lib/dashboardAuth.ts`
- Create: `server/lib/dashboardAuth.test.ts`
- Create: `server/routes/session.ts`
- Create: `src/components/AuthGate.tsx`
- Modify: `server/index.ts`, `src/main.tsx`, `src/lib/api.ts`, `src/lib/dataRefresh.ts`, `src/views/Settings.tsx`, `.env.example`

- [ ] Write tests proving loopback is the default, non-loopback without a token is rejected, login uses constant-time token comparison, cookies authenticate, pairing codes expire and are single-use, and protected routes return 401.
- [ ] Run `node --import tsx --test server/lib/dashboardAuth.test.ts`; expect the new module import to fail.
- [ ] Implement an in-memory session/pairing store, Express middleware, session router, safe-host assertion, credentialed client requests, login gate, and Settings pairing controls.
- [ ] Re-run the focused test, `npm test`, and `npx tsc --noEmit -p tsconfig.json`; all must exit 0 before Task 2.

### Task 2: Truthful trace failures

**Files:**
- Create: `src/components/trace/traceLoadState.ts`
- Create: `src/components/trace/traceLoadState.test.ts`
- Modify: `src/components/trace/TraceDrawer.tsx`, `src/components/trace/index.ts`
- Delete: `src/components/trace/mockTrace.ts`

- [ ] Write a test asserting a rejected trace request preserves its error and never produces a run.
- [ ] Run `node --import tsx --test src/components/trace/traceLoadState.test.ts`; expect failure because the state reducer is absent.
- [ ] Implement the reducer and retry UI, remove every mock-trace import/export, and delete the generator.
- [ ] Run the focused test, full tests, and frontend typecheck; all must exit 0 before Task 3.

### Task 3: Server checks and container workflow

**Files:**
- Create: `tsconfig.server.json`, `Dockerfile`, `.dockerignore`, `server/lib/staticPolicy.test.ts`
- Modify: `package.json`, `package-lock.json`, `server/index.ts`, `README.md`

- [ ] Add a failing static test requiring server typecheck/check scripts and production static serving.
- [ ] Run the static test and confirm failure.
- [ ] Add `typecheck:web`, `typecheck:server`, and `check` scripts; add the server tsconfig and production static serving; add the Node 22 multi-stage container.
- [ ] Run `npm run check`, `npm test`, `npm run build`, and `docker build -t mission-control:verify .` when Docker is available; all attempted checks must pass before Task 4.

### Task 4: Enforce the visual contract

**Files:**
- Create: `src/designContract.test.ts`
- Modify: TSX files reported by the failing contract test.

- [ ] Write a filesystem-based test that rejects prohibited Tailwind tokens in production TSX.
- [ ] Run the test and confirm it reports the current gradient, blur, shadow, excessive-radius, and bold tokens.
- [ ] Replace prohibited tokens with flat surfaces, semantic borders, `rounded-xl`, and `font-semibold` while preserving interactions.
- [ ] Run the contract test, full tests, typechecks, build, and a browser smoke test before Task 5.

### Task 5: Unmount inactive views

**Files:**
- Create: `src/appViewState.ts`, `src/appViewState.test.ts`
- Modify: `src/App.tsx`

- [ ] Write a test asserting the render plan contains exactly the active view.
- [ ] Run it and confirm failure because the helper is absent.
- [ ] Replace the permanent mounted-view set with a single active lazy view and retain navigation persistence.
- [ ] Run focused/full tests, typecheck, build, and browser navigation cleanup checks before Task 6.

### Task 6: Remove audited complexity

**Files:**
- Modify: `src/lib/api.ts`, `server/lib/jsonStore.ts`, straightforward JSON route stores, `package.json`, `package-lock.json`

- [ ] Write request-helper tests for query parameters, credentials, JSON errors, all HTTP verbs, and an atomic JSON-store regression test.
- [ ] Confirm the focused tests fail against the duplicated/private helpers.
- [ ] Add one typed request helper, route existing methods through it, replace only behavior-equivalent JSON wrappers, and remove the two unused dependencies.
- [ ] Run focused/full tests, checks, and build before Task 7.

### Task 7: Operational journal and undo

**Files:**
- Create: `server/lib/requestContext.ts`, `server/lib/journalStore.ts`, `server/lib/journalStore.test.ts`, `server/routes/journal.ts`, `src/views/Journal.tsx`
- Modify: `server/lib/jsonStore.ts`, `server/index.ts`, `src/lib/api.ts`, `src/views/Activity.tsx`

- [ ] Write tests for redaction, mutation recording, reversible snapshots, single-use undo, and failed-request logging.
- [ ] Run focused tests and confirm failure because the journal does not exist.
- [ ] Implement AsyncLocalStorage request context, SQLite journal, saveJson snapshot capture, routes, client API, and Journal tab.
- [ ] Run focused/full tests, checks, build, and browser-create/undo verification before Task 8.

### Task 8: Unified controls

**Files:**
- Create: `server/lib/controlService.ts`, `server/lib/controlService.test.ts`, `server/routes/controls.ts`, `src/views/Controls.tsx`
- Modify: `server/index.ts`, `src/lib/api.ts`, `src/views/Activity.tsx`

- [ ] Write tests for cron pause/resume/trigger, harness cancel/retry, session escalation, invalid action/resource pairs, and unavailable resources.
- [ ] Confirm focused test failure.
- [ ] Implement a thin capability router over existing cron, harness, session, and approval paths plus the Controls tab.
- [ ] Run focused/full tests, checks, build, and browser verification against fixture resources before Task 9.

### Task 9: Persistent incidents and replay

**Files:**
- Create: `server/lib/incidentStore.ts`, `server/lib/incidentStore.test.ts`
- Modify: `server/routes/alerts.ts`, `src/lib/api.ts`, `src/views/Alerts.tsx`

- [ ] Write tests proving deduplication, recurrence counting, resolution, and chronological event/journal correlation.
- [ ] Confirm focused test failure.
- [ ] Persist incidents during alert evaluation, expose history/replay routes, and add the Alerts replay drawer.
- [ ] Run focused/full tests, checks, build, and browser replay verification before Task 10.

### Task 10: Offline additive capture

**Files:**
- Create: `server/lib/idempotencyStore.ts`, `server/lib/idempotencyStore.test.ts`, `src/lib/offlineQueue.ts`, `src/lib/offlineQueue.test.ts`
- Modify: `server/index.ts`, `src/lib/api.ts`, `src/components/layout/TopBar.tsx`

- [ ] Write tests for additive-only admission, FIFO replay, stable idempotency keys, duplicate response reuse, failed-item retention, and destructive-request rejection.
- [ ] Confirm both focused suites fail.
- [ ] Implement SQLite idempotency middleware, localStorage queueing for todo/to-buy/note creates, reconnect flush, and top-bar status.
- [ ] Run focused/full tests, checks, build, and browser offline/reconnect verification before Task 11.

### Task 11: Daily briefing

**Files:**
- Create: `server/lib/briefing.ts`, `server/lib/briefing.test.ts`, `server/routes/briefing.ts`, `src/components/BriefingCard.tsx`
- Modify: `server/lib/discordNotifier.ts`, `server/lib/discordBot.ts`, `server/index.ts`, `server/routes/settings.ts`, `src/lib/api.ts`, `src/views/Home.tsx`, `src/views/Settings.tsx`

- [ ] Write tests for summary counts, local-time due selection, once-per-day delivery, disabled delivery, and Discord event emission.
- [ ] Confirm focused test failure.
- [ ] Implement preference persistence, briefing builder/scheduler/routes, Discord notification event, Home card, Settings controls, and granted browser notifications.
- [ ] Run focused/full tests, checks, build, and browser preference/latest-briefing verification.

### Task 12: Final verification and documentation

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.agent/CONTINUITY.md`

- [ ] Re-read the design and this plan; verify every requirement has code and an automated or browser check.
- [ ] Run fresh `npm run check`, `npm test`, `npm run build`, the design-contract test, and Docker build when available.
- [ ] Run browser journeys for login/pairing, trace failure, journal undo, controls, incident replay, offline replay, and briefing.
- [ ] Update README, changelog, and continuity with exact behavior and any verified environmental limitation.
