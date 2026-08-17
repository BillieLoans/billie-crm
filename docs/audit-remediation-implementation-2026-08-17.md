# Audit Remediation — Implementation Record

**Date:** 17 Aug 2026 · **Plan:** `docs/audit-remediation-plan-2026-08-17.md`
**State:** All changes are uncommitted working-tree edits on `main` in both repos. Nothing committed, pushed, or deployed — production is untouched. Every change is backwards compatible with what is currently deployed and independently deployable per repo.

**Verification gates (post-all-changes):**
- **billie-crm:** full vitest suite `pnpm test:int` — 215 files, **2,324 passed**, 2 skipped (int specs run against a real Postgres testcontainer); `pnpm build` — compiled successfully, full route manifest; eslint 0 errors; `tsc --noEmit` — zero errors in `src/` (pre-existing test-file baseline unchanged).
- **billie-platform-services:** full `pytest` — **2,643 passed, 0 failed** (baseline before this work: pre-existing collection errors from missing local SDKs; SDKs now installed editable, entire suite runs without live infra); `flake8` + `black --check` clean on all changed files.

---

## Completed — billie-crm

### P0-1 · Client idempotency keys end-to-end (six money routes)
- All six route schemas accept optional `idempotencyKey` (`min(8).max(128)`), forwarded to gRPC; absent → old server-minted key (rollout-safe).
- Hooks/drawers mint the key **once per user intent** (wrapper/onMutate or a per-drawer-session ref), never inside `mutationFn`.
- `paymentId` minted once per intent in `useRecordRepayment` (was re-minted per attempt).
- Failed-actions replay and toast-Retry verified to re-send the same key (the retry listeners previously rebuilt variables and dropped it — fixed).
- 31 new tests.

### P0-2 · Write-off approve route
- Idempotency key is now deterministic: `writeoff-approve-${requestId}` (Date.now() suffix removed).
- gRPC code 9 → 422 non-retryable with the ledger's reason; code 14 stays retryable 503.
- Redis `SET NX` marker `writeoff-ledger-posted:${requestId}` (24h, stores the original ledger transaction IDs) written after the ledger commit and before the event publish — a retry after a failed publish re-publishes without re-posting. Marker failures fail safe (deterministic key still protects). 8 new tests, incl. retry-posts-to-ledger-exactly-once.

### P0-3 + P1-1 · Maker-checker bypass and legacy stack retired
- `/api/ledger/write-off` route deleted (absent from build manifest); gRPC `writeOff` client method retained for the command flow.
- `src/components/LoanAccountServicing/` deleted (2,288 lines, six modals). The `loan-accounts` collection edit view now redirects to `/admin/servicing/<customerIdString>?accountId=<loanAccountId>` (with no-JS fallback link and a no-customer alert path).
- Dead `EnhancedScheduleList` + `useScheduleWithStatus` + tests deleted; importmap regenerated.

### P1-2 · Shared gRPC base + deadlines
- New `src/server/grpc-base.ts`: one proto loader, one credential predicate (localhost/127.x/`.internal`/`.platform` → plaintext; else TLS; per-client `*_GRPC_TLS` env override both directions), promisify-with-deadline. Adopted by all four clients; export names/signatures/error shapes preserved.
- Deadlines: `GRPC_READ_DEADLINE_MS`=10s, `GRPC_WRITE_DEADLINE_MS`=45s, `GRPC_BATCH_DEADLINE_MS`=300s (period-close / portfolio-ECL / exports — a flat 10s would have broken month-end). Server-streaming `watchTransactions` untouched. Marketing client keeps its prior fixed 5s.
- Follow-up applied: gRPC code 4 DEADLINE_EXCEEDED → new retryable `LEDGER_TIMEOUT` (503) with "outcome unknown — safe to retry" copy, in all retryability classifiers.

### P1-3 · Overdue N+1 + snapshot cache
- Aging-overdue route: one batched `payload.find` `in` query + Map (was up to 1,000 finds/request).
- New `src/server/overdue-snapshot-cache.ts`: 20s-TTL (env-tunable) coalescing cache shared by the overdue and collections-cases routes; failures never cached.
- The proto turned out to support pagination — the cache pages through `next_page_token`, fully fixing the >1,000-account silent truncation (page-budget guard + warning if ever exceeded).

### P1-4 · Error handling unified
- `handleApiError` maps gRPC 9→422 (`LEDGER_REJECTED`, real reason surfaced), 6→409 (`DUPLICATE_OPERATION`), 5→404, 14→503; substring heuristics kept as fallback. All six money routes migrated; disburse's code-6-as-success branch preserved.
- Shared `serializeTransaction` extracted (5 copies removed); `createValidationError` reshaped to the dominant convention and adopted in the six routes.
- New `docs/money-movement-policy.md`: evented (maker-checker write-off) vs direct routes; `checkVersion` documented as advisory (also noted in `version-check.ts`).

### P1-5 · Dashboard wrong-number bugs (all four)
- Loopback health fetch (permanently 401 → tile always "offline") replaced with in-process `checkLedgerHealth()` (`src/server/ledger-health.ts`).
- Upcoming payments and disbursement-bucket totals computed in SQL over the whole book (`src/lib/dashboard-aggregates.ts`); count and dollars now agree at any volume (int-tested at 120 active / 210 pending).
- All day windows use new DST-safe Sydney helpers (`sydneyDayStartUtc`/`sydneyDayUtcRange` in `disbursement-cutoff.ts`), exact-boundary-tested on both 2026 DST transitions (25h/23h days). Response shape unchanged.

### Docs
- `CLAUDE.md` corrected: Payload 3.85.x / Next 16; six roles incl. `service` and `marketing` (lending wall).

## Completed — billie-platform-services

### PSEC-1 (safe subset) · Ledger internet exposure removed
- Public `[[services]]` blocks (443 + 50051, TLS handlers → unauthenticated ledger) deleted from **all four** env tomls; TCP health check preserved as top-level `[checks.ledger_grpc]` (works without a public service). Zero functional impact — verified all four CRM envs call `billie-platform-services-<env>.internal:50051`.
- `AUTH_ENABLED` code default flipped to `"true"` in **both** gates (`grpc_server.py` interceptor install and `grpc_servicer.py` per-RPC checks); dev/staging tomls pin `"false"` explicitly so no deployed behavior changes. ERROR-level log whenever auth runs disabled.
- `docs/auth-enablement-plan.md` documents the coordinated Keycloak-token enablement sequence. **Deliberately did NOT enable auth in any env** — the CRM sends no bearer token yet; flipping it would break production.

### LED-2 · Per-account lock on the transaction path
- New `account_lock.py`: Redis `SET NX PX 30s` per-account lock, Lua compare-and-delete release, 10s acquire with backoff+jitter, fail-closed on Redis errors, task-reentrant (ContextVar) for multi-posting operations. Applied to `record_transaction`/`record_repayment`, all five commands, DisburseLoan's full sequence, and both payment event handlers. gRPC maps contention → ABORTED (retryable); event handlers re-raise → redelivery. Closes the concurrent double-post race (XR-6) incl. concurrent write-offs.

### LED-1 · Payment handler idempotency
- `processed:{event_id}` guards added to `handle_payment_received`/`handle_payment_dishonoured`, set **after** effects (PARCH-2 ordering), inside the account lock.
- Durable business-key dedupe checks the ledger's own per-account transaction stream for the `payment_id` (`reference_id`; dishonours stamped `metadata.dishonour_of_payment_id`) — dedupes against the effect itself, no side table to drift. No Alembic migration needed.

### LED-8 · Idempotency layer hardened
- `SET NX EX 60` in-progress reservation on entry (concurrent same-key → one executes, one ABORTED); success upgrades to the 24h cached response; error paths release the reservation (Lua guard can never delete a stored response).
- Fail-closed (UNAVAILABLE) on Redis errors for all seven money RPCs — which turned out to be exactly the 7 (not ~16) call sites, all money-moving.
- Commit-through-cache-store runs under `asyncio.shield` with a strong task ref — a client-deadline cancellation can no longer commit-without-caching. `IDEMPOTENCY.md` documents the contract.

### LED-5 · DisburseLoan amount validation
- `disbursement_amount` is now confirmation-only: non-decimal, ≤0, or ≠ approved principal (Decimal equality) → FAILED_PRECONDITION; absent/empty still falls back to the approved amount. Verified the CRM never sends a differing amount (no partial-disbursement feature). Duplicate-disbursement check moved inside the lock (still ALREADY_EXISTS).

### PARCH-1 / PRES-6 · No more silent event loss
- Expired pending messages now go to the DLQ (write must succeed **before** XACK; DLQ failure → left unacked) in both implementations (BaseService — live for all nine services — and the dead-code `redis.py` copy, fixed identically rather than merged).
- Startup recovery loops until drained (1000-batch cap; per-drain `seen_ids` guard against replaying still-pending entries).
- Periodic `XAUTOCLAIM` sweep (60s interval, 5-min min-idle so live consumers are never robbed) reclaims crashed consumers' messages without a restart; expired reclaims also DLQ.

### PARCH-2 · Marker-after-effect
- The one confirmed site (`handle_transaction_recorded`) now sets its `processed` marker only after all three downstream publishes; both publish helpers report failure instead of swallowing; `accountsService.process_message` raises on a `False`/exception handler result → no ack → redelivery. Downstream idempotency of the re-published events verified (one caveat: `instalment.status.changed.v1` has no in-repo consumer to verify).

---

## Deployment notes (order-free but recommended)
1. Each repo's changes are independently deployable; the CRM sends idempotency keys the ledger already accepts, and the ledger hardening does not change the contract for key-less callers.
2. After the platform deploy: `fly ips list -a billie-platform-services-<env>` and `fly ips release` any public IPs (Fly account state; not controllable from the repo). See `docs/auth-enablement-plan.md`.
3. Machines will no longer auto-stop on the platform apps (the autostop setting was scoped to the deleted public-services block; 6PN callers need always-on machines anyway). Scale is governed by `fly scale count`.

## Deferred (from the plan, in priority order)
- **LED-10 NCC fee cap** — blocked on a compliance decision (does the establishment fee count toward the 5% cap?); the current control is self-contradictory and needs the corrected spec enforced in `record_transaction`. **Needs a human decision first.**
- **AUTH_ENABLED=true rollout** — blocked on issuing the CRM a Keycloak service-account token (see `docs/auth-enablement-plan.md`).
- Platform P1 tail: process-tree supervision + consumer-lag health check + per-machine consumer names (PRES-7/PARCH-5/6); GetPortfolioSummary replay (PPERF-1); Postgres projection of the transaction journal + Redis persistence contract (LED-3/PARCH-4).
- CRM P2 sweep: formatter consolidation + lint bans (P2-1), ECL fallback fabrication (P2-2), event logical-ID dedupe contract (P2-3), Python customer field-map unification (P2-4), conversations utterance hydration (P2-5), marketing error envelopes (P2-7).
- P3 hygiene both repos: export-download fail-closed ownership check, hand-rolled auth consolidation, dead code (`llmUtils.py` ~1,873 lines, `async_subscribe`, etc.), god-file decomposition, index migrations, doc sweeps (several CRM docs still describe the deleted legacy stack).
