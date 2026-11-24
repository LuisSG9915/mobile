# Android Upload Reliability and Progress

*   **Author:** LuisSG9915
*   **Status:** Approved
*   **Date:** 2026-11-12

---

## Overview

The Android upload queue stalls or stops progressing after a few hundred files, with no visible recovery. The goal is to improve upload reliability and progress visibility on Android without breaking SHA-256 deduplication or the R2/D1 architecture, validated on real devices. This design covers the upload subsystem only; gallery zoom responsiveness is tracked separately.

## The Problem

On Android, large backup runs (hundreds of files) stall: the queue stops advancing, progress freezes, and the user has no clear recovery action. The current strategy mixes CPU-bound hashing/thumbnailing with network uploads under a single worker count, uses a fixed 90 s stall watchdog that aborts slow-but-healthy transfers, and persists byte progress to SQLite every 500 ms. There is no cross-process upload lease, so a headless task (a background pass triggered by the OS `photos-backup-sync` task) can race a foreground pass (a pass started by the user in the app). Backoff reaches 2 hours with no jitter, leaving items stuck with no UI indication. These failures never reach Sentry or the backend, so on-call cannot see them.

The proposed solution is to (a) measure first, (b) delete dead code, (c) add telemetry and a feature flag, then (d) apply targeted fixes behind the flag: adaptive thresholds, a persistent upload lease, progress accounting with throttled persistence, and error-class-aware backoff. All changes stay additive and optional, gated behind a feature flag defaulting to off; SHA-256 dedup, R2 keys, and D1 contracts remain unchanged. The web client keeps its existing behavior; shared contracts stay identical. Separate bounded queues per phase are deferred to Phase 2 if Phase 0 measurement shows head-of-line blocking.

## Goals

*   0 unexplained watchdog triggers on a 50-file Android run over Wi-Fi (a stall without a logged retry event).
*   Progress UI updates at least every 1 s while bytes are flowing.
*   Upload success rate at least 99% over Wi-Fi for files up to 500 MB, measured over a 50-file run.
*   Every queue failure (stall, retry, foreground start failure, headless pass failure) emits a PII-safe telemetry event with phase, attempts, backoff, size bucket (<1 MB, 1–10 MB, 10–100 MB, >100 MB), network type, and background flag.
*   Peak memory during a real queue run stays within a provisional budget of 256 MiB for the queue's in-flight memory (concurrent parts × 5 MiB + thumbnail pool of 2 × 50 KB); final value set in Phase 0.
*   All migrations are additive and idempotent; no destructive schema changes.

## Non-Goals

*   Changing the SHA-256 hash algorithm or the R2 key scheme (`users/{userId}/.../{sha256}...`).
*   Bypassing quota reservation (`reserveStorageQuota` / `confirmStorageUsage`).
*   Breaking `.web.ts` API parity or web upload behavior.
*   iOS background behavior (keep system behavior).
*   No new native modules in Phase 1; any native dependency requires a capability probe and store release.
*   Gallery pinch-to-zoom (tracked in a separate PRD).

## Open Questions

*   **Q1**: What is the actual peak RSS and stall rate on a mid-range Android device today? Phase 0 must capture 100 MB and 500 MB runs over Wi-Fi and LTE before any code change.
*   **Q2**: Should the redesign apply to web as well, or stay Android-only with shared contracts kept identical? (Recommendation: Android-only for Phase 1; web keeps existing behavior.)
*   **Q3**: Is the `dataSync` foreground service sufficient for the new strategy, or is WorkManager needed for cross-day resume under the 6 h/24 h Android 15 cap? (`dataSync` is an Android foreground service type capped at 6 h per 24 h on Android 15+; see H-024 in `docs/PLAN_MEJORAS.md`.)
*   **Q4**: Should concurrency be a single tunable constant per phase, or adaptive by device class? (Recommendation: single tunable constant per phase for Phase 1; revisit after Phase 0 data.)
*   **Q5**: Closed — no retry pool exists in `upload-part.ts` (only `uploadPartBlob`); nothing to remove. Reuse the shared backoff helper.

## Key Symbols

*   `recoverInterrupted` (`apps/mobile/src/queue/processor.ts`): resets interrupted items to `queued` with `bytes_sent=0`, preserving `upload_id`/`parts` for resume.
*   `multipartInit` / `multipartComplete` / `MultipartGoneError` (`apps/mobile/src/queue/processor.ts`): multipart upload session lifecycle; `MultipartGoneError` is thrown by `multipartInit`/`multipartComplete` when the R2 session is gone (404), triggering discard-and-reinit.
*   `uploadPartBlob` (`apps/mobile/src/queue/upload-part.ts`): XHR-based PUT of a single part with stall watchdog.
*   `checkHashes` (`apps/mobile/src/api/uploads.ts` or `apps/api/src/routes/uploads.ts`): batched SHA-256 dedup preflight.
*   `processQueue` / `worker()` (`apps/mobile/src/queue/processor.ts`): item-level scheduler with concurrency.
*   `reserveStorageQuota` / `confirmStorageUsage` (`apps/mobile/src/queue/processor.ts`): quota reservation and confirmation.
*   `migrateMultipartColumns` (`apps/mobile/src/queue/db.ts`): idempotent `ALTER TABLE ... ADD COLUMN` migration pattern.
*   `kvGet` / `kvSet` (`apps/mobile/src/queue/db.ts`): plain SQLite key/value store used for the feature flag.
*   `webCors` (`apps/api/src/index.ts`): CORS middleware with `exposeHeaders`.
*   `recordApiMetric` (`apps/api/src/lib/telemetry.ts`): server-side metric recording (never throws, wrapped in try/catch).
*   `withDeadline` / `PhaseTimeoutError` (`apps/mobile/src/queue/shared.ts`): deadline wrapper and timeout error.
*   `BACKOFF_MS` ladder (`apps/mobile/src/queue/shared.ts`): `[60s, 5m, 30m, 2h, …]`.
*   `headless task` / `headless pass`: a background upload pass triggered by the OS `photos-backup-sync` task (Expo background task), as opposed to a `foreground pass` started by the user in the app.
*   `dataSync`: Android foreground service type capped at 6 h per 24 h on Android 15+ (see H-024 in `docs/PLAN_MEJORAS.md`).
*   `capability probe`: a runtime check that a native module/API is available before using it, with graceful degradation to the current implementation.
*   `thumbnail pool`: 2 slots of 256×256 thumbnails, max 50 KB each, used during hash/thumb phase.

## Critical User Journeys (CUJs)

### CUJ 1: Large Android backup completes without stalling

*   **Given**: A user with 500 pending photos on a mid-range Android device on Wi-Fi, app in foreground.
*   **When**: The user starts a backup pass.
*   **Then**: All items reach `done` or `duplicate`; progress advances at least every 1 s while bytes flow; no item stalls beyond 90 s without a logged watchdog event and automatic retry; peak memory stays within budget.

### CUJ 2: Interrupted upload recovers after app kill

*   **Given**: An upload in `uploading_original` (multipart) is killed mid-transfer.
*   **When**: The app restarts and a new pass runs.
*   **Then**: `recoverInterrupted` resets the item to `queued` with `bytes_sent=0` while preserving `upload_id`/`parts`; `multipartInit` resumes or reinitializes via the `MultipartGoneError` path; the item completes without duplicate R2 objects.

### CUJ 3: Auth expiry is surfaced and recovered

*   **Given**: The session token expires mid-pass.
*   **When**: An upload hits 401.
*   **Then**: One token-refresh attempt runs via the auth client (method TBD in Phase 0); on success the item retries without counting as a new attempt; on failure the item enters an explicit "auth required" state with a user-visible message in Spanish and no silent stall.

---

## Technical Plan (Architecture)

The upload pipeline keeps its existing stages and shared helpers; no new platform-agnostic pipeline or adapter framework is introduced in Phase 1. No binaries pass through the Worker; R2 presigned PUTs and D1 metadata writes remain the transport.

```text
Queue (SQLite) -> processQueue/worker() -> [Hash/Thumb lane] -> Dedup (checkHashes)
  -> [Upload lane] -> Init (multipartInit) -> Parts (uploadPartBlob, 5 MiB)
  -> Complete (multipartComplete) -> D1 state update -> UI progress
  \\-- In-memory running flag serializes processors (assumed same-process; to be verified in Phase 0)
  \\-- Telemetry events on every terminal/retry decision
```

**Components and changes:**

*   **Strategy constants** (extend `apps/mobile/src/queue/shared.ts`, not a new `strategy.ts`): single source for concurrency, batch sizes, watchdog thresholds, backoff policy, and memory budget. Migrate inline constants (`STALL_MS`, `WATCHDOG_TICK_MS`, deadlines) into `shared.ts`. Defaults: `HASH_CONCURRENCY=2`, `UPLOAD_CONCURRENCY=1` (Android), `WATCHDOG_STALL_MS=30000` (no-byte-flow trigger), `WATCHDOG_SLO_MS=90000` (SLO/reporting threshold), `BACKOFF_CAP_MS=1800000` (30 min), `PART_SIZE_BYTES=5242880` (5 MiB; 16 MiB option deferred to Phase 2 after measurement), `MEMORY_BUDGET_MB=256` (provisional, final value in Phase 0).
*   **Progress contract** (modify `apps/mobile/src/queue/progress.ts`): one source of truth combining persisted `bytes_sent` and an in-memory tick; throttling in one place (400 ms structural throttle, 500 ms byte tick); survives restart by recomputing from persisted bytes. Reworded from "off-thread progress accounting" to "throttle persistence, keep the UI tick" (no worker thread without a native module).
*   **Backoff policy** (modify `apps/mobile/src/queue/shared.ts`): cap the existing `BACKOFF_MS` ladder lower (max 30 min) and add small jitter to the existing array. Reuse one helper for both standard and part-level paths. No new error-class module unless Phase 0 shows retry storms.
*   **Telemetry** (modify `apps/mobile/src/queue/` telemetry calls and `apps/api/src/lib/telemetry.ts`): PII-safe events for stall watchdog, retry, foreground start failure, headless pass failure, auth expiry, with phase, attempts, backoff, size bucket (<1 MB, 1–10 MB, 10–100 MB, >100 MB), network type, and background flag. Excluded fields: user id, file names, paths, URIs. Server-side: extend `recordApiMetric` to every upload route (`init`, `complete`, `cancel`, `check-hashes`, `multipart/init`, `multipart/presign-parts`, `multipart/finalize`, `multipart/abort`) with `errorCode`/`status`/`requestId`/`partCount`/`partSize`/`resumed`; telemetry never throws (wrap in try/catch).
*   **Request correlation** (defer to Phase 2 unless Phase 0 shows need): generate `X-Request-Id` per request in `apps/mobile/src/api/client.ts`, echo in Worker middleware in `apps/api/src/index.ts` (add to `exposeHeaders` in `webCors`), include in metrics and error responses. Persist last failed request id in a new `last_request_id` column (see DB migrations).
*   **Auth handling** (modify processor): one token-refresh attempt via the auth client before requeue on 401; explicit "auth required" state in the queue store; do not count refresh as an attempt. Specify the auth refresh API and a mutex to avoid concurrent refreshes.
*   **Feature flag** (local kv, default off): key `upload_strategy_v2`, read/write via existing `kvGet`/`kvSet`. Documented rollback lever in `docs/decisions.md`. Graduation gates from Phase 0 (stall rate, success rate, peak RSS); default-on once device gate passes; scheduled removal PR.
*   **DB migrations** (modify `apps/mobile/src/queue/db.ts`): additive columns on `queue`: `upload_lease TEXT` (nullable), `last_request_id TEXT` (nullable). Idempotent via `PRAGMA table_info` checks (`migrateMultipartColumns` pattern). IndexedDB `onupgradeneeded` in `apps/mobile/src/web/queue-store.ts` (bump `DB_VERSION`, add corresponding fields to `items` store, migration of existing rows).
*   **Multipart journal**: keep the existing JSON array in the `parts` column; no version field added in Phase 1. `partSize` is already in the init response and re-fetched on resume. On mismatch, discard and reinit via `MultipartGoneError`.
*   **Upload lease**: reuse the in-memory `running` flag if headless and foreground share a process (verify in Phase 0). If separate processes, use a simple SQLite row lock with heartbeat; prefer an OS primitive that releases on process death (file lock/flock) as primary liveness, heartbeat only as fallback under a generous stale threshold. Document threshold per OS state.
*   **Watchdog**: trigger abort only when no bytes flow for a shorter window (e.g., 30 s); keep 90 s as the SLO/reporting threshold; make both configurable; record which threshold fired in telemetry.
*   **Orphan MPU cleanup**: document R2's 7-day incomplete-MPU lifecycle as the mitigation; add explicit cleanup only if cost measurement shows a leak.
*   **Quota reconciliation**: add a reconciliation step at pass start (and on `recoverInterrupted`) releasing reservations for items no longer in `uploading`; idempotent by item id; log discrepancies as telemetry. (Deferred to Phase 1 if Phase 0 shows stranded quota.)
*   **Dead-letter bucket**: items with permanent errors (403, 413, 415, quota) enter a "needs attention" state with a user-visible retry action; backpressure pauses the queue when failure rate exceeds a threshold. (Phase 2.)
*   **Part-completion tracking on resume**: persist a part-completion bitmap (or query R2 ListParts) in the journal; on resume skip completed parts and re-upload only missing/failed ones. (Phase 2.)
*   **Durable telemetry outbox**: write events to a bounded SQLite/IndexedDB table in the same transaction as the state transition, flushed by a low-priority lane; convert repeated flush failures into backpressure. (Phase 2.)
*   **Non-functional constraints preserved:** SHA-256 computed and checked before every `/init`; R2 keys unchanged; quota reservation unchanged; `.web.ts` parity; no binaries through the Worker.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Headless task races foreground pass | Verify process topology in Phase 0; reuse `running` if same process; otherwise use a simple row/file lock with heartbeat fallback. |
| Watchdog aborts slow-but-healthy transfers | Make threshold throughput-adaptive (minimum bytes + rolling rate); trigger on no-byte-flow (30 s) not wall-clock. |
| Memory exhaustion on mid-range Android | Measure peak RSS in Phase 0; cap in-flight ArrayBuffer memory; reduce item concurrency if memory-driven. |
| Stranded quota on crash | Add reconciliation step at pass start (idempotent by item id); log discrepancies. |
| Orphan multipart uploads in R2 | Document R2 7-day incomplete-MPU lifecycle; add explicit cleanup only if cost measurement shows a leak. |
| Dead code reintroduces drift | Delete unused `upload-part.ts` retry pool and duplicate column set before any redesign (already done for retry pool). |
| Web parity breakage | Shared contract test asserting native and web processors export the same API and state transitions. |
| Rollback leaves stuck uploads | Ensure journal format is backward-readable or safely discardable (treat parse failure as "discard and reinit"). |
| Feature flag rots behind default-off | Define graduation gates from Phase 0 (stall rate, success rate, peak RSS) and a scheduled removal PR. |

## Non-Functional Requirements

*   **Security & Privacy:** Telemetry events exclude user id, file names, paths, URIs. PII-safe by construction; events carry only phase, attempts, backoff, size bucket, network type, background flag.
*   **Performance & Latency:** Progress UI updates at least every 1 s while bytes flow (existing byte tick ~500 ms, structural throttle 400 ms). Peak memory within provisional budget (concurrent parts × 16 MiB + thumbnail pool).
*   **Rollout & Rollback:** Feature flag `upload_strategy_v2` (local kv, default off). Graduation gates from Phase 0. Rollback lever documented in `docs/decisions.md`. Native changes require a store release and capability probe with graceful degradation to current behavior.

---

## Alternatives Considered

### Alternative A: Tune constants only (concurrency, watchdog, backoff)

*   **Pros**: Smallest change; no new modules; low regression risk.
*   **Cons**: Does not address memory unboundedness, missing lease, or silent failures; tuning alone is the cheaper first experiment but not sufficient.
*   **Reason for rejection**: Rejected by author: tuning alone cannot fix stalls caused by overlapping phases or missing resume; measurement first, then targeted changes.

### Alternative B: Replace the whole upload stack with a chunked resumable library

*   **Pros**: Potentially simpler resume semantics; off-the-shelf retry/backoff.
*   **Cons**: Breaks SHA-256 dedup and R2 key scheme; high migration risk; loses integration with quota reservation and multipart journal.
*   **Reason for rejection**: Rejected by author: adapt within the existing protocol instead of replacing it.

### Alternative C: Bundle upload and zoom into one PRD

*   **Pros**: Single review cycle.
*   **Cons**: Different code paths, owners, tests, and rollback; comprehension rejects bundling.
*   **Reason for rejection**: Rejected by author: split into two PRDs that cross-reference shared infra only.

### Alternative D: Delete dead code and measure before any redesign

*   **Pros**: Removes a latent trap (unused retry pool, duplicate column set); establishes a baseline; lowest risk.
*   **Cons**: Does not by itself improve reliability; requires discipline to not skip to redesign.
*   **Reason for rejection**: Not rejected; adopted as Phase 0/1 precondition before structural work.

---

## Detailed Implementation Plan

### Phases

*   **Phase 0 (investigation, no code):** Reproduce stalls on a real Android device; capture 100 MB/500 MB runs over Wi-Fi and LTE; measure peak RSS and pinch frame rate; verify process topology (same vs. separate process). Exit criteria: documented baseline numbers and a decision on process topology.
*   **Phase 1 (compat-safe foundations):** Additive DB migrations (lease column, `last_request_id`), IndexedDB version bump, telemetry events, feature flag (default off), dead-code removal. No behavior change. Exit criteria: typecheck + tests green, migrations idempotent.
*   **Phase 2 (targeted fixes behind flag):** Concurrency/backoff/threshold changes, progress contract, auth handling, quota reconciliation, durable outbox (if justified), foreground/background logging. Exit criteria: real-device matrix passes, memory peak within budget.
*   **Phase 3 (device validation & rollout):** Real-device validation, rollback drill, gradual flag enable, store release if native changes.

### Target Files to Create/Modify

#### 1. `apps/mobile/src/queue/shared.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Keep `withDeadline`/`PhaseTimeoutError`; migrate inline constants (`STALL_MS`, `WATCHDOG_TICK_MS`, deadlines, `BACKOFF_MS`, `PART_PRESIGN_BATCH_SIZE`, `PART_UPLOAD_CONCURRENCY`, `MAX_ATTEMPTS`) into `shared.ts` as the single source. Export strategy defaults consumed by both platforms. No new `strategy.ts` in Phase 1.

#### 2. `apps/mobile/src/queue/backoff.ts` (Create — Phase 2)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Capped exponential backoff with jitter, reused by both standard and part-level paths. Error-class enum: transient (5xx, 408, 429, network), permanent (4xx except 408/429), quota, size, auth/session. Classification function maps HTTP status to class. Formula: `min(cap, base * 2^attempt) * (0.5 + random())` using `Math.random()` with full jitter. Cap: 30 min. Only create if Phase 0 shows retry storms.

#### 3. `apps/mobile/src/queue/processor.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Use the shared constants; acquire/release the per-user upload lease (reuse `running` if same process; otherwise simple SQLite row lock with heartbeat fallback under generous stale threshold); emit telemetry on terminal/retry decisions; use fixed 30 s no-byte-flow trigger + configurable 90 s SLO/reporting threshold; preserve `recoverInterrupted` and SHA-256 dedup. Resolve Q4 as single tunable constant per phase for Phase 1.

#### 4. `apps/mobile/src/queue/processor.web.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Mirror processor changes via shared constants; preserve Web Locks exclusivity and AbortController cancellation; keep IndexedDB schema migration. Parity contract: same state transitions.

#### 5. `apps/mobile/src/queue/progress.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Single progress contract combining persisted `bytes_sent` and an in-memory tick; throttling in one place (400 ms structural throttle, 500 ms byte tick); survives restart by recomputing from persisted bytes.

#### 6. `apps/mobile/src/queue/db.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Additive columns on `queue`: `upload_lease TEXT` (nullable), `last_request_id TEXT` (nullable). Idempotent via `PRAGMA table_info` checks (`migrateMultipartColumns` pattern). Keep `kvGet`/`kvSet` for the feature flag.

#### 7. `apps/mobile/src/queue/db.web.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: IndexedDB `onupgradeneeded` migration mirroring native columns; bump `DB_VERSION` to 2 in `apps/mobile/src/web/queue-store.ts` (currently 1); add corresponding fields to `items` store; migrate existing rows by defaulting new fields.

#### 8. `apps/mobile/src/lib/telemetry.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Add PII-safe queue telemetry events (stall watchdog, retry, foreground start failure, headless pass failure, auth expiry) with phase, attempts, backoff, size bucket (<1 MB, 1–10 MB, 10–100 MB, >100 MB), network type, and background flag. Excluded fields: user id, file names, paths, URIs. Durable outbox (Phase 2) if telemetry loss on crash is measured. Client-side telemetry wraps calls in try/catch so it never throws.

#### 9. `apps/mobile/src/api/client.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Generate `X-Request-Id` per request (Phase 2 unless Phase 0 shows need); persist last failed request id in the queue row via the `last_request_id` column.

#### 10. `apps/api/src/index.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Middleware to echo `X-Request-Id` and include it in metrics and error responses; add `X-Request-Id` to `exposeHeaders` in `webCors` (currently `["set-auth-token"]`).

#### 11. `apps/api/src/lib/telemetry.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Extend `recordApiMetric` to every upload route (`init`, `complete`, `cancel`, `check-hashes`, `multipart/init`, `multipart/presign-parts`, `multipart/finalize`, `multipart/abort`) with `errorCode`/`status`/`requestId`/`partCount`/`partSize`/`resumed`; telemetry never throws (wrap in try/catch).

#### 12. `apps/mobile/src/queue/foreground.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Record `foreground.start_failed`/`foreground.timeout_reached` events with cooldown ms, pending count, OS version; keep existing pause behavior.

#### 13. `apps/mobile/src/queue/background.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Log structured failures with a stable tag plus Sentry when DSN present; track last background result/error for the settings screen.

#### 14. `apps/mobile/src/queue/upload-part.ts` (Modify)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Keep `uploadPartBlob`; no retry pool exists (already removed); reuse the shared backoff helper when `backoff.ts` is created. Part size: 5 MiB (`PART_SIZE_BYTES=5242880`) for Phase 1; 16 MiB option deferred to Phase 2 after measurement. Resolve final part size before implementation.

#### 15. `apps/mobile/src/app/(tabs)/backup.tsx`, `apps/mobile/src/ui/SyncStatusAvatar.tsx` (Modify)

*   **Type / Scope**: TypeScript/TSX modules
*   **Proposed Changes**: Surface "auth required" state and retry countdown; show pause reason for foreground-service timeout.

#### 16. `apps/mobile/src/lib/feature-flags.ts` (Create)

*   **Type / Scope**: TypeScript module
*   **Proposed Changes**: Feature flag `upload_strategy_v2` (local kv, default off) with key name, default, read/write API via `kvGet`/`kvSet`, and rollback lever. Created as a module because graduation-gate logic (stall rate, success rate, peak RSS) needs a shared helper. Graduation gates from Phase 0; default-on once device gate passes; scheduled removal PR.

#### 17. `docs/decisions.md` (Modify)

*   **Type / Scope**: Markdown
*   **Proposed Changes**: Document new strategy constants, feature flag, graduation gates, and rollback lever.

#### 18. Tests (Create/Modify)

*   **Type / Scope**: Test files
*   **Proposed Changes**: Contract test asserting native and web processors export the same API and state transitions; unit tests for backoff policy (cap, base, jitter, error classes), lease acquire/release/stale-recovery, progress monotonicity and cancellation, migration idempotency (pre-existing DB), and rollback scenario (new client creates session → rollback → old client completes or clears). Enumerate test file paths: `apps/mobile/src/queue/processor.test.ts`, `processor.web.test.ts`, `progress.test.ts`, `db.test.ts`, `db.web.test.ts`, `upload-part.test.ts`, `shared.test.ts`.

#### 19. `docs/testing/PLAN_PRUEBAS.md` (Modify)

*   **Type / Scope**: Markdown
*   **Proposed Changes**: Document device measurement gate (Android API 34/35/36, mid-range physical device, Wi-Fi/LTE/offline, screen off/Doze) with capture of 100 MB/500 MB timings, peak RSS, progress cadence, stall rate, notification screenshots, and `dumpsys deviceidle` logs.

### Verification Plan

*   **Compilation/Build**: `pnpm --filter @photos/mobile typecheck`, `pnpm --filter @photos/api typecheck`.
*   **Unit Tests**: `pnpm --filter @photos/mobile test`, `pnpm --filter @photos/api test`, `pnpm test:pipeline`.
*   **Static Analysis & Linting**: `pnpm lint`.
*   **Test Coverage Requirement**: existing suites green; new tests for lease, backoff, progress, migrations, parity.
*   **Goal→Test mapping**:
    *   0 unexplained watchdog triggers → assert no stall watchdog fires without a logged retry event on a 50-file run.
    *   Progress UI ≥1 s while bytes flow → assert byte tick fires within 1 s during active upload.
    *   Upload success ≥99% over Wi-Fi ≤500 MB → assert success count / total ≥ 0.99 on a 50-file run.
    *   Peak memory within budget → assert peak RSS ≤ 256 MiB on a mid-range device.
    *   All migrations additive/idempotent → assert `migrate*` is idempotent on a pre-existing DB.
*   **E2E/Integration**: real-device matrix (Android API 34/35/36, mid-range physical device, Wi-Fi/LTE/offline, screen off/Doze) capturing 100 MB/500 MB timings, peak RSS, progress cadence, stall rate; notification screenshots and `dumpsys deviceidle` logs. Acceptance thresholds: 0 watchdog triggers unexplained, ≥1 s progress cadence, ≥99% success, peak RSS ≤ 256 MiB.

---

*Drafted with EGM*