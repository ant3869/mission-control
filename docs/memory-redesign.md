# Memory Section — Audit & Build Spec (OpenClaw-first, Hermes-ready)

> Operational, end-to-end visibility into the OpenClaw / Hermes memory system:
> live memory events, subsystem health, vector DB, daily dumps, consolidation.
> Phase 1 (token-only, no agent changes) is **implemented** — see "Status" below.

## Status

| Plane | What | Status |
|---|---|---|
| 1 — Pull (operator token) | `doctor.memory.status`, `agents.files.list/get`, store size | ✅ `server/lib/memoryDoctor.ts`, `routes/memoryops.ts` |
| 2 — Live (SSE) | classify memory tool-calls / file writes from the OpenClaw stream → persist → fan out | ✅ `server/lib/memoryCollector.ts` (attached at startup) |
| 3 — Push (agent-side) | truly real-time + decision events (skip/dedup/merge/consolidate) | 🔌 endpoints live (`POST /api/memory/events`, `/consolidation`); agent hook TODO |
| 4 — Inspect (agent-side) | direct vector-store stats from the machine | 🔌 endpoint live (`POST /api/memory/vector-stats`); collector TODO |

Frontend: `src/views/Memory.tsx` is now a TabHub — **Activity / Memories / Health / Metrics / Vector DB / Dreaming** — with a source toggle and KPI header. Store: `data/memory.db` (`server/lib/memoryStore.ts`), separate from `evaluations.db` (the memory *quality* benchmark engine).

## A. Why the old view was insufficient
`src/views/Memory.tsx` was a static markdown viewer over (1) Claude Code's own `.auto-memory` and (2) "last message per session" — not OpenClaw's memory system. No events, no metrics, no vector, no daily-dump browser, no health. The operator token already authorizes the full RPC surface (`operator.admin/read/write`); the limit was wiring, not auth.

## B. Architecture
Hybrid, four planes (table above). Pull uses the cached batch in `openclawWs.getMetricsRaw` (already fetches `doctor.memory.status` + `agents.files.list`). Live taps `openclawLive.addListener`. Push/inspect use authenticated ingest (`OPENCLAW_PUSH_TOKEN`).

**Near-real-time ceiling (token-only):** the gateway commits `chat.history` after a turn and no longer pushes per-message, so live memory events lag to ~3s after a turn ends. Sub-second + decision events require the **Plane 3** agent hook.

## C. Page (implemented)
- **Activity** (default) — live SSE timeline, color-coded lanes, click-to-expand raw payload + provenance, filtered (skip/embedded hidden unless Raw), search, live/paused indicator.
- **Memories** — the file / daily-dump browser (filtered readable render + type filters).
- **Health** — `doctor.memory.status` (embedding subsystem + vector view + raw JSON toggle), store size.
- **Metrics** — created/retrieved/errors over time, by-type breakdown, 24h/7d/30d.
- **Vector DB** — records / dims / index / collections + growth series.
- **Dreaming** — consolidation runs (push-fed) + collector-classified `consolidated` events.

## D. Events & metrics
Event types: `created updated retrieved embedded consolidated skipped deleted error` (`memoryStore.MemoryEventType`). Each carries source, trigger (auto/manual/cron), status, sessionKey (provenance), tool, summary, latency, origin (live/push), raw payload. Metrics: counts (total/today/recalls/errors), time-bucketed created/retrieved/errors + latency p50, by-type.

## E. Filtering
Live collector classifies + summarizes (≤200 chars); raw payload preserved for the per-event toggle. Activity hides low-value lanes (`skipped`, `embedded`) until Raw is on. `<think>`/scaffolding stripping is inherited from `openclawLive` normalization.

## F. Data model
`data/memory.db`: `memory_events`, `memory_objects`, `memory_vector_stats`, `memory_consolidation_runs` (DDL in `server/lib/memoryStore.ts`). Quality scores stay in `evaluations.db` (`memory_benchmark_*`).

## G. Next steps
1. **Phase 0 discovery:** `node scripts/memory-discovery.mjs` (dev server running) → dumps real `doctor.memory.status` + file list so renderers match truth. **Run this first.**
2. **Plane 3 hook** in OpenClaw's memory module → `POST /api/memory/events` (and `/consolidation`) for sub-second + decision visibility.
3. **Plane 4 collector** on the agent machine → `POST /api/memory/vector-stats` if the vector store isn't exposed via `doctor.memory.status`.
4. Wire the **quality composite** (`memoryEvaluations`) into the Health tab.
5. Manual controls (trigger/pause consolidation, retention, protect) — pending confirmed RPCs (Phase 0).

## H. Assumptions / unknowns
- `doctor.memory.status` shape is **not fully known** — `memoryDoctor.ts` surfaces the raw payload and best-effort-extracts vector fields. Extend it after Phase 0.
- Whether OpenClaw has a vector DB / dreaming is **unconfirmed**; the UI degrades honestly ("no vector fields found", "no runs yet").
- `agents.files.list` uses `agentId:'main'` (hardcoded in `openclawWs`); multi-agent needs the real id list.
- Write/control RPCs (trigger consolidation, set thresholds, protect) are **not confirmed** to exist — Phase 0 decides.

## Ingest contract (Plane 3 / 4)
```
POST /api/memory/events            Authorization: Bearer $OPENCLAW_PUSH_TOKEN
  { type, source?, trigger?, status?, sessionKey?, tool?, title?, summary?, latencyMs?, payload? }
POST /api/memory/vector-stats      { source?, collection?, recordCount, dimensions?, indexType?, orphanCount?, health? }
POST /api/memory/consolidation     { source?, trigger?, status?, inputs?, merged?, pruned?, summarized?, notes?, durationMs?, startedAt? }
```
