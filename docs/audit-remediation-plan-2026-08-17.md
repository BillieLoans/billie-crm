# Billie CRM + Platform Services — Architecture & Clean-Code Audit

**Date:** 17 Aug 2026
**Scope:** Two repositories and the money-movement contract between them.
- **Part I — `billie-crm`** (staff servicing app): 553 TS files (~72.6k LOC excl. generated types), 60 Python files.
- **Part II — `billie-platform-services`** (the CQRS/event-sourcing backend the CRM depends on for all money movement): 333 Python files (~77k LOC), 10 services, gRPC + Redis Streams + Postgres.
- **Part III — the cross-repo contract** (idempotency, gRPC error codes, event fan-out).

**Method:** Each part audited by six independent single-lens passes (duplication, security, performance/resilience, consistency, hardcoding/risk, architecture — plus a dedicated cross-repo contract pass), then an adversarial verification round that re-read every cited `file:line` to refute each claim, re-run greps, check config, and stress-test recommendations. Across both repos ~140 raw findings → ~15 refuted in whole or part, ~20 re-graded, several upgraded, and new findings surfaced during verification. Finding IDs trace the evidence trail: Part I uses RISK/ARCH/DUP/CON/PERF/SEC/HC-n; Part II uses LED/PARCH/PSEC/PPERF/PRES/PDUP-n; Part III uses XR-n.

Severities are **post-verification** grades under the realistic threat model: internal tools on Fly.io private networking behind Cloudflare Access, insider/compromised-app risk, thousands of loan accounts, tens of staff, a regulated Australian small-amount lender.

> **The single most important finding is cross-repo and neither repo can fix alone.** The ledger correctly implements idempotency-key dedup (24h TTL, replay flag) — verified. The CRM defeats it by minting a fresh random key per request — verified. And the ledger's own idempotency check is itself check-then-act, fail-open, and unshielded against deadline cancellation, while having *no* concurrency control on the balance read-modify-write. So money double-posting is reachable from **both** sides: an ordinary CRM retry, and a concurrent pair of ledger RPCs. Fixing only the CRM (Part I, P0) is necessary but **not sufficient** — see Part III.

> **Separately and more urgently than anything in the original CRM audit:** the production ledger config ships with **gRPC authentication disabled** (`AUTH_ENABLED="false"`) on a service whose `fly.toml` declares **public edge ports** (443 + 50051). As committed, that is an internet-reachable, unauthenticated money-movement API. This is Part II, PSEC-1 — the highest-severity item in the entire audit.

---

## Executive summary — Part I (billie-crm)

The macro-architecture is honest to its own documentation: the read/write split holds with **zero** violations (no Payload mutation touches a projection collection), auth coverage is complete, all 47 body-parsing routes validate with Zod, SQL is parameterized on both sides, and no secrets live in the repo.

The material risk concentrates in one place: **money-movement retry semantics**. The ledger implements idempotency-key deduplication with a 24-hour replay window — and the CRM defeats it on every call by minting a fresh `timestamp+random` key server-side per HTTP request. Layered on that: a check-then-act race in write-off approval, a deployed route + admin UI that bypass the maker-checker workflow, and error handling that answers deterministic ledger rejections with "please try again." These compound: the retry the UI encourages is exactly the retry the key scheme fails to dedupe.

The second theme is **drift between generations of code**. The newest domain (collections) already solved every hygiene problem found elsewhere — client-supplied idempotency keys, a mutation-hook factory, a shared gRPC error mapper, bounded deadlines (marketing client), DST-safe Sydney date helpers. The older ledger/servicing code predates those abstractions and never adopted them. Most of the Part I remediation is applying the repo's own best patterns to its own older code.

---

## Remediation plan (descending materiality)

### P0 — Money integrity (Critical)

Double-posting of real transactions is possible today through ordinary user behavior (a retry after a timeout, a double-click, two supervisors acting at once). Small diffs, outsized risk reduction. All three items were independently found by 2–3 audit lenses and survived adversarial verification.

#### P0-1. Idempotency is defeated end-to-end on all seven money routes
*(RISK-1 · ARCH-4 — verified: confirmed, worse than reported)*

`generateIdempotencyKey` (`src/server/grpc-client.ts:1541`) returns `prefix-Date.now()-Math.random()`, minted per HTTP request in the repayment, waive-fee, write-off, adjustment, disburse, late-fee and dishonour-fee routes. The ledger proto explicitly supports client keys with a 24h TTL and an `idempotent_replay` flag (`proto/accounting_ledger.proto:459-534`) — the capability is thrown away.

Verification found four aggravations:
- The client **already generates** a key (`src/lib/utils/idempotency.ts`, used at `useWaiveFee.ts:100`) but only as an optimistic-store ID — never sent in the POST body.
- Both retry paths (toast Retry, failed-actions center) re-POST and get fresh server keys.
- `NETWORK_TIMEOUT` is classified retryable (`src/lib/utils/error.ts:77-85`) — the precise ambiguous-outcome case where the ledger may have committed.
- Repayment `paymentId` is re-minted *inside* `mutationFn` per attempt (`useRecordRepayment.ts:62`), so the ledger can't dedupe on payment reference either.

**Fix:** Plumb the existing client-side key through the POST body and gRPC call — the collections action routes already accept `idempotencyKey: z.string().min(8)`; copy that contract. Mint `paymentId` once per user intent (in `onMutate`/form submit), not per attempt. This is consistency work, not new design.

> **Cross-repo amendment (XR-2, XR-3, LED-8 — verified):** the ledger side of this is real and correctly built — idempotency cache with 24h TTL and `idempotent_replay` flag on all seven transaction RPCs, protos wire-identical between repos. So the CRM key fix is exactly right and will work. **But** the ledger's check is itself check-then-act (plain `GET` then `SETEX`, no `SET NX` reservation), fail-open on any Redis error, and the store happens *after* the money commit with no `asyncio.shield` — so a client deadline that cancels the coroutine between commit and cache-store leaves a committed transaction uncached, and even a correctly-keyed CRM retry then double-posts. **The CRM fix is necessary but not sufficient; pair it with the ledger-side fix in Part II (LED-8).** Do not ship short client deadlines on `DisburseLoan`/`WriteOff` until the ledger shields its commit sequence (Part III, XR-8).

#### P0-2. Write-off approval: check-then-act race + post-commit retry loop
*(RISK-2 · ARCH-1 · RISK-5 — verified: confirmed)*

`src/app/api/commands/writeoff/approve/route.ts` reads `status !== 'pending'` (line 95), posts to the ledger (117–125) with key `writeoff-approve-${requestId}-${Date.now()}` — the time suffix defeats requestId-based dedupe — then publishes to Redis (152). If the publish fails, the route returns 503 "Please try again" **after the ledger committed**; the projection row only flips to `approved` via the very event that failed to publish, so the retry passes the pending check and posts again with a fresh key. Two concurrent approvers race the same window (plain TOCTOU). The route also maps **all** ledger errors — including deterministic business-rule rejections (gRPC code 9) — to that retryable 503, while four sibling routes correctly map code 9 → 422.

**Fix:** Delete the `Date.now()` suffix — `writeoff-approve-${requestId}` lets the ledger's own 24h idempotency cache absorb retries (≈90% of the risk for a one-line change). Then: map code 9 → 422 non-retryable, and record the ledger post (outbox/claim marker keyed by requestId) before publishing so a retry re-publishes without re-posting. The `reapp-block-clear` approve route is the in-repo reference pattern.

> **Cross-repo amendment (XR-6, LED-2 — verified):** the ledger does **not** save you here. Its own write-off guard is check-then-act on the balance (`total_outstanding <= 0`) with **no lock and no account-status check**, and `WRITE_OFF` is explicitly exempted from the negative-balance validation (`accountingLedgerService.py:303`). So two concurrent write-offs — two approvers, or an approval racing the P0-3 direct route — both read a positive balance, both post the full amount, and the balance goes **negative, doubled**, forking the audit hash chain. The deterministic `requestId` key is the real fix on the CRM side (it lets the ledger cache dedupe *sequential* retries), but the *concurrent* race needs the ledger-side per-account lock in Part II (LED-2).

#### P0-3. Maker-checker bypass: a live single-actor write-off path, with UI
*(ARCH-2 · DUP-4 · CON-1 — verified: **upgraded**)*

The original finding said `/api/ledger/write-off` was deployed but UI-orphaned. Verification refuted the orphan half — making it worse: `WriteOffModal.tsx:48` POSTs to it, and the modal mounts inside `LoanAccountServicing`, registered as the edit view for the raw `loan-accounts` collection (`src/collections/LoanAccounts.ts:28`). Any admin reaching `/admin/collections/loan-accounts/:id` gets a clickable, single-actor write-off with no request/approve split, no self-approval guard, no version check, and no trace in `write_off_requests`. Any supervisor can hit the route directly.

**Fix:** Retire the route and the modal together: either rewire the edit view's actions onto the command flow and shared mutation hooks, or replace the edit view with a redirect to the servicing view. Don't delete the route first — the admin screen depends on it.

---

### P1 — High: correctness & resilience

#### P1-1. Legacy LoanAccountServicing stack: a second money UI missing every safeguard
*(DUP-4 · CON-1 — verified: confirmed; reach corrected to admin-only)*

Six modals (~1,300 lines) duplicate the ServicingView drawers with raw `fetch` and zero React Query: no `expectedVersion`, no read-only-mode gate, no failed-actions queue, no idempotency, and a dead `approvedBy` free-text field the API now ignores. One claimed consumer was refuted — `CollectionsCaseView.tsx:194` references it only in a comment — so reach is limited to admins via the collection edit view, but that is exactly where P0-3 lives.

**Fix:** Delete the directory as part of the P0-3 rewire. Also delete the confirmed-dead `EnhancedScheduleList.tsx` (430 lines, imported only by its own test) plus its hook and barrel exports (DUP-5).

#### P1-2. No gRPC deadlines on 3 of 4 clients; credential predicate drifted across 4 copies
*(PERF-2 · RISK-4 · DUP-3 — verified: confirmed, fix amended)*

The ledger, collections and notification clients set no deadline on ~40 RPCs; only the marketing client does, and its own comment calls the others out ("deliberate deviation"). A hung ledger pins Next.js workers indefinitely on money routes. Separately, the insecure-vs-TLS credential predicate exists in four hand-copied variants — the `.platform` plaintext clause was added to only two, so pointing the ledger at a `.platform` host would attempt TLS against plaintext and fail.

**Fix:** Extract a shared `grpc-base.ts` (proto load, one credential predicate, `promisify` with configurable deadline). **Order matters:** deadlines on *write* RPCs create DEADLINE_EXCEEDED ambiguity ("did it commit?") — ship P0-1's idempotency keys first or together, so a deadline-then-retry replays the same key.

#### P1-3. Overdue enrichment: N+1 × 30-second polling, plus a portfolio-dump sibling
*(PERF-1 · PERF-5 — verified: confirmed)*

`src/app/api/ledger/aging/overdue/route.ts:88-127` runs one `payload.find` per account (up to 1,000) per request over a pg pool defaulting to 10 connections, polled every 30s per dashboard viewer. `src/app/api/collections/cases/route.ts:73` separately pulls the full overdue snapshot (`pageSize: 1000`) from gRPC per request to enrich ≤100 rows — and silently loses aging data past 1,000 overdue accounts. The batched pattern already exists in the cases route's own Postgres lookup (`loanAccountId: { in: ... }`).

**Fix:** One `in` query + Map for the enrichment (drop-in copy of the sibling), and a shared short-TTL (15–30s) in-process cache of the overdue snapshot serving both routes — every poller currently re-fetches identical data.

#### P1-4. Ledger error handling split into three regimes; business rejections become 500s
*(DUP-2 · ARCH-3 — verified: confirmed)*

`handleApiError` (`src/lib/utils/api-error.ts:70-118`) matches only message substrings and never maps gRPC code 9, so waive-fee, repayment and disburse convert deterministic rejections (e.g. NCC fee-cap) into generic 500s — while four other routes hand-roll code-9 → 422, and disburse handles code 6 but not 9. `checkVersion` guards 2 of 7 mutating routes. A 15-line transaction serializer is copy-pasted across 6 routes. And there is no articulated rule for which money operations require the maker-checker command flow: write-offs do; principal adjustments — arguably the most dangerous primitive — are direct, single-actor, unversioned, with no CRM-side audit trail.

**Fix:** Add gRPC status-code mapping (9→422, 6→409/idempotent-success, 5→404, 14→503) to `handleApiError`; migrate all seven routes onto it; extract the shared serializer. Then write down the evented-vs-direct rule and apply `checkVersion` policy uniformly — or deliberately not at all (see P2-6 on its advisory nature).

#### P1-5. Dashboard route: four verified wrong-number bugs in one file
*(PERF-8 · PERF-4 · HC-5 · RISK-6 — verified: two upgraded to correctness bugs)*

`src/app/api/dashboard/route.ts` accumulates:
1. A loopback `fetch` to its own auth-required health route **without cookies** — it can only ever 401, so the dashboard's ledger tile is permanently "offline".
2. Upcoming payments computed from an arbitrary 100-account subset (no sort, no truncation flag) — wrong past 100 active accounts.
3. Pending-disbursement **dollar totals** summed over a 200-doc cap while the count uses `totalDocs` — above 200 pending, totals silently understate while counts stay right.
4. `setHours(0,0,0,0)` in server TZ (UTC on Fly) for "due today" — wrong by 10–11 hours daily — plus a fixed `+24h` day window that double-counts or drops one hour of money flows on each DST transition. The DST-safe helper (`nextSydneyDateString` in `src/lib/disbursement-cutoff.ts`) already exists, unused here.

**Fix:** Replace the loopback with a direct in-process health call (or drop the field — clients already poll `useLedgerHealth`); move the upcoming-payments and disbursement aggregates into SQL on the pool this file already uses (`fetchMoneyFlowsToday` pattern); adopt the Sydney date helpers for all day windows.

---

### P2 — Medium: drift that produces user-visible wrongness

#### P2-1. Formatter fragmentation: the $NaN fix never propagated; en-US on financial screens
*(DUP-1 · CON-2 · CON-4 · DUP-6 — verified: confirmed, counts corrected)*

`src/lib/formatters.ts` exists precisely to kill "$NaN" (its docstring says so), yet ~40 component files plus two API routes and the customer page keep guard-less local copies; 13 `'en-US'` sites sit in period-close and export screens; 11 locale-**less** calls render in whatever locale the host machine has. Status-label drift is user-visible: the command palette omits `pending_disbursement` and falls back to a green **"Active"** badge for undisbursed accounts (`LoanAccountSearchResult.tsx:39`). `formatFrequency` renders the same field as `''` in one panel and `'—'` in another.

**Fix:** Mechanical sweep onto `@/lib/formatters`; promote `account-status.ts` from ServicingView to `src/lib/` with a fallback that renders the raw status, never "Active"; add ESLint `no-restricted-syntax` rules banning `Intl.NumberFormat('en-AU'…)` outside formatters, the `'en-US'` literal, and locale-less `toLocaleDateString()`.

#### P2-2. ECL fallback rates are invented in a route handler — twice
*(HC-1 — verified: confirmed + new defects found)*

`src/app/api/ecl-config/route.ts` hardcodes PD defaults (3% / 25% / 55% / 100%) and LGD 0.50, silently merged as "System Default" for any bucket the ledger omits — a provisioning parameter fabricated CRM-side, indistinguishable in the UI from a ledger-stored rate. Verification found the same literals duplicated a second time in the gRPC-unavailable fallback (lines 181-187 — intra-file drift risk), and that `mapBucketName` collapses two ledger buckets into `late_arrears` with key-order-dependent "keep the first" selection.

**Fix:** Return absent buckets as absent and render "not configured" (or flag synthetic rows explicitly); dedupe the two default tables into one config source; make the bucket collapse deterministic.

#### P2-3. Event pipeline: duplicate delivery survivable by convention only
*(ARCH-5 · ARCH-12 — verified: confirmed at medium)*

The publisher retries `XADD` on ambiguous failure (two stream entries, same logical event); the processor dedupes on the Redis **message ID** (`processor.py:577`), so publisher duplicates are invisible to it. Today every handler happens to be idempotent (`ON CONFLICT` upserts) — the processor's own comment admits safety rests on that convention. One future append-style or side-effecting handler (the SMS path exists) loses the protection silently. Related: the approve command lets the client supply `requestNumber`, which rides the audit event unvalidated.

**Fix:** Dedupe additionally on the logical `cause` event ID (already parsed at `processor.py:553`); promote handler idempotency from comment to stated contract with a test; derive `requestNumber` server-side as `reapp-block-clear` already does, and drop it from the command schema.

#### P2-4. Python: customer projection written by two hand-mirrored field maps
*(DUP-8 · CON-6 · CON-7 — verified: confirmed, one claim corrected)*

`customer.py` and `conversation.py:_sync_customer` each maintain their own field table; the conversation path omits `residential_address_street` and never triggers the release-grants back-fill, and each maps fields the other doesn't (`preferred_name` only on the conversation side). Which columns a customer ends up with depends on event arrival order. Separately, `conversation.py` hand-writes the version-bump SQL three times (lines 282, 528, 674) — but the recommended helper (`update_by_key`) has **no** `bump_version` option, so the original "use the helpers" advice was not actionable as written. (The identity.py raw SQL flagged by the audit is justified cross-table re-attribution — leave it.)

**Fix:** Extract one shared `map_customer_values()` feeding both handlers; add `bump_version` to `update_by_key`, then migrate the three inline bumps.

#### P2-5. Conversations grid hydrates every utterance to count them
*(PERF-7 — verified: confirmed)*

The monitoring grid's list query joins the full rich-text utterances child table for every row, then uses only `.length` — while `lastUtteranceTime` already exists as a maintained scalar and the same file already uses `select` correctly for its customer lookup.

**Fix:** `select` excluding utterances; have the processor maintain an `utteranceCount` column alongside `lastUtteranceTime`.

#### P2-6. Optimistic locking fails open, on a timestamp, on some routes
*(ARCH-7 — verified: confirmed, framing tempered)*

`src/lib/utils/version-check.ts` allows the write on missing version, missing account, **and** any internal error ("fail open for resilience"), compares an `updatedAt` string non-atomically, and is applied to 2 of 7 money routes. Verification's important correction: this can never be the money-integrity control (the projection updates asynchronously; failing closed would 409 constantly) — it is an advisory staleness hint, and the real control is P0-1's idempotency plus ledger-side rules.

**Fix:** Either adopt the integer `version` column pattern conversations already use, or explicitly document the check as advisory. Decide once, alongside P1-4.

#### P2-7. Marketing routes: no try/catch, no error envelope
*(CON-8 · DUP-10 — verified: confirmed; 9 of 10 try-less routes are marketing)*

Every ledger/commands route returns a parseable `{ error }` envelope; the marketing module's nine try-less routes bubble raw 500s that client hooks can't render.

**Fix:** A shared `withErrorHandling` wrapper for the module — and note `createValidationError` in `api-error.ts` has **zero** consumers while 19 routes hand-roll its output; adopt or delete it.

---

### P3 — Low: hygiene, hardening, and scheduled debt

#### Security hardening (verified: no open holes)
*(SEC-1..6 · N1 · N2)*

- **Export download ownership fails open** (new, from verification): `export/jobs/[jobId]/result/route.ts:42` skips the ownership check when the ledger omits `createdBy` — a `readonly` user could fetch another user's export. One-line fail-closed fix.
- **No server-side freeze exists**: read-only mode is a ledger-outage UX banner, not a control (correctly re-framed by verification — no privilege boundary is crossed by "bypassing" it). If the business ever needs an enforced freeze (incident, period close), it must be a server-side flag checked in the ledger routes — build it deliberately or don't claim it.
- **ClickSend webhook secret in query string**: a ClickSend platform constraint (inbound rules only accept a URL), not sloppiness — mitigate with rotation, log-scrubbing of `?secret=`, and source-IP allowlisting at Cloudflare.
- **Hand-rolled auth in ~16 routes** (4× the originally claimed scope): all verified currently correct; consolidate onto `requireAuth` to shrink the drift surface.
- **Dev environment**: the "fails open" claim was refuted (NODE_ENV is inlined as `production` at build time in the standalone bundle, so the deployed check fails closed) — but do verify `DISABLE_CF_SECRET_CHECK` is not set on the dev app, and put dev behind the same Access policy.
- Explicit `LEDGER_TLS` flag instead of URL-regex transport selection; `GOOGLE_WORKSPACE_DOMAIN` env var for the two hardcoded `billie.loans` checks; document the CSP's `unsafe-inline`/`unsafe-eval` as accepted Payload-admin risk.

#### Performance tail
*(PERF-3/6/9/10/11/12/13)*

- Add `due_date`/`paid_date` btree indexes via a committed migration (cost grows with the book).
- Parallelize the customer route's independent queries; cap the event publisher's Redis connect wait (~2–3s) so outages fail fast into the failed-actions queue rather than adding up to ~30s to money actions.
- The "polling storm" was overstated (React Query background polling is off by default; hidden tabs are quiet) — the real lever is making the hot endpoints cheap (P1-3/P1-5), plus reconsidering the 3s conversation poll against the existing realtime route.
- Python micro-items (pipelined SET+XACK, batch xclaim, unnest-based schedule upsert) are correct but low-value at current volume — schedule behind everything above.

#### Structural debt
*(DUP-7/9/11/12 · CON-3/5/10/11 · ARCH-9/10/11 · HC-4/7/8 · RISK-7/8)*

- **Decide the hooks-barrel convention**: 154 deep imports vs 9 barrel imports and 49 of 91 hooks unexported — the honest fix is probably retiring the barrel and amending CLAUDE.md, not backfilling 49 exports.
- Extend the `useCollectionsAction` factory (or a `useLedgerAction` sibling) to absorb the 300-line ledger mutation hooks — they need version-store and retry-listener support the factory lacks, so this is an extension, not a drop-in (verification refuted the drop-in framing).
- A `createAdminView` factory for the 14 near-identical `*ViewWithTemplate` wrappers (verified feasible with Payload's importMap — named exports from one module work); decompose `PeriodCloseWizard` (905-line single closure driving an irreversible financial close) into per-step components.
- Export a single `Role` type + client-safe helpers from `access.ts` (~16 literal re-declarations; the union misses the documented `service` **and** `marketing` roles — drift risk, not a live bug).
- **Stale documentation is itself a finding**: CLAUDE.md claims Payload 3.45 / Next 15 / four roles; the repo runs Payload 3.85.1 / Next 16.2.9 / six roles, and the proxy's admin-redirect workaround targets a 3.45 bug that may already be fixed — test on 3.85 and remove if so. Gate schema `push` on an explicit `ALLOW_SCHEMA_PUSH` flag, not `NODE_ENV`. Clear the repo-root scaffolding (BMAD output, stray YMLs, four unlabelled Dockerfiles, a cert-dependent `server.js`).
- Delete dead code found and verified: `EnhancedScheduleList` + hook, `grpc-client.ts`'s shadow `formatCurrency` (zero importers), the client-side `approvedBy: 'current-user'` fields (server ignores them everywhere — verified), the stale health-check-account comment; replace the two `datetime.utcnow()` calls.

---

## Adversarial verification — what changed

### Refuted and re-graded claims

| Claim | Verdict | Why |
|---|---|---|
| SEC-2 | **Refuted** | "Deployed dev fails open without CF_SECRET" — Next.js inlines `NODE_ENV` as `production` at build time in the standalone bundle, so the deployed check fails closed; the branch is reachable only under local `next dev`. |
| HC-6 | **Refuted** | The health-check "magic account" need not exist: the route treats NOT_FOUND/UNIMPLEMENTED as healthy. The stale comment claiming otherwise is the actual defect. |
| HC-4 (part) | **Refuted** | The "missing `service` role" is documented, deliberate, and unreachable by the affected views; the audit also missed a sixth role (`marketing`). |
| CON-1 (part) | **Refuted** | CollectionsCaseView "imports" the legacy modal only in a comment — reach of the legacy stack is admin-only, which lowered its standalone severity (and raised ARCH-2's). |
| CON-9 (part) | **Refuted** | The "security-relevant `as any` in access.ts" was a substring match on a docstring ("…h*as any* valid role"). Zero casts in access.ts. |
| CON-10 | **Mostly refuted** | Approve/reject mutations invalidate the `['write-off-requests']` prefix, covering two of the three key families; residual staleness is one view, ≤30s. |
| RISK-3 | **Downgraded** | "Floats on money paths" — money *sent* to the ledger stays a validated decimal string; the 46 parseFloats are display serialization. Residual: one computed-and-stored float delta in `account.py:256`, and NaN→null JSON artifacts. Targeted fixes, not a Decimal migration. |
| SEC-1 | **Re-framed** | Read-only mode is outage UX, not a bypassed control. The real gap: no enforced freeze mechanism exists at all. |
| PERF-9 | **Corrected** | Background-tab polling multiplication doesn't happen (React Query default). Surviving core: focused staff × expensive endpoints. |
| ARCH-8 | **Downgraded** | The reapp-block-clear non-atomicity is real but its downstream idempotency contract makes it the best-engineered approval flow — the pattern to copy, not another defect. |
| SEC-5, HC-3, HC-7, CON-7, PERF-11/12 | **Downgraded** | Real observations, negligible materiality at this scale / on Fly private networking / by documented design. |

### Upgraded by verification

- **ARCH-2** — the maker-checker bypass has a live admin UI, not just a dormant route.
- **PERF-8** — the dashboard loopback health fetch is a permanent correctness bug (no auth cookies → always 401 → tile always "offline"), not a perf nit.
- **RISK-6** — the worst timezone instance is server-side in the dashboard's money-flow windows (incl. a real DST double-count/drop), not the client-side triage helper.
- **HC-5** — the 200-doc cap produces a dollar-total vs count mismatch, the worst kind of silent truncation.

### New findings from verification

- Export-download ownership fail-open (see P3 security).
- CSP permits `unsafe-inline`/`unsafe-eval` (document as accepted risk).
- ECL default tables duplicated intra-file; key-order-dependent bucket collapse.
- Disburse route handles gRPC code 6 but not code 9 (inconsistency inside the inconsistency).

---

## Verified clean

Positively verified by the audit and independently re-checked by verifiers — should not be re-litigated:

- Read/write split: zero Payload mutations against projection collections
- All 47 body-parsing routes use Zod `safeParse`
- Session or service auth on every non-public route (spot-checked)
- CSRF origin validation fails closed; exemptions are secret-authed
- Maker≠checker enforced server-side in the evented flows (`depth: 0` guard)
- No hardcoded secrets in repo, Dockerfiles, infra, or scripts
- SQL parameterized on both TS and Python sides
- S3 bucket-locked; path traversal and filename sanitization present
- User `role` field admin-only writable
- gRPC + Redis clients are proper singletons; JWT verification is full-signature
- No client component imports server-only code

---

## Suggested sequencing

| # | Work | Effort |
|---|---|---|
| 1 | Deterministic write-off key + code-9 → 422 in the approve route (P0-2 core) | Hours |
| 2 | Client idempotency keys through all seven ledger routes; stable `paymentId` (P0-1) | Days |
| 3 | Retire `/api/ledger/write-off` + LoanAccountServicing stack together (P0-3, P1-1) | Days |
| 4 | Shared gRPC base: one credential predicate, deadlines (after #2) (P1-2) | Days |
| 5 | Overdue batching + snapshot cache; dashboard-route overhaul (P1-3, P1-5) | Days |
| 6 | `handleApiError` unification + evented-vs-direct policy decision (P1-4) | Days + a decision |
| 7 | P2 sweep: formatters/lint rules, ECL fallbacks, event dedupe contract, Python mapper | 1–2 weeks, parallelizable |
| 8 | P3 as scheduled debt; update CLAUDE.md (versions, roles, barrel decision) **first** — it misleads both humans and agents today | Ongoing |

---
---

# Part II — billie-platform-services

**Scope:** `/Users/ashcrick/Documents - Mac/programming/billie-platform-services` — 333 Python files, 10 services (customer, accounts, identity, accounting-ledger, collections, marketing, notification, notification-dispatcher, schedule-aging, base/shared) under one `run.py` entrypoint. Redis Streams for events, Postgres (Neon) for projections, gRPC for the read/command API, Keycloak for (currently-disabled) auth, deployed on Fly.io.

## Executive summary — Part II

The platform has **real financial-engineering maturity in places** — verified sound: consistent `Decimal`/`ROUND_HALF_UP` money math with `numeric` DB columns (no float in the ledger), a hash-chained tamper-evident transaction model, genuinely idempotent accrual with a durable event mirror and rebuild path, and a period-close module that is the strongest code in either repo (distributed finalize lock, contiguous-month gating, finalize-time GL integrity hard-stop, DST-correct AET accrual scheduling). The codebase shows audit-response habits (inline "audit round 2" notes, BTB-ticket cross-references).

But the money-movement core has **three Critical structural gaps**, all cross-confirmed and adversarially verified:

1. **Production auth is off on a publicly-exposed ledger** (PSEC-1). `AUTH_ENABLED="false"` in prod and demo `fly.toml`, plaintext `add_insecure_port`, and `_check_account_access` short-circuits to "allow" when there is no user — while the same `fly.toml` declares public edge ports 443 + 50051. As committed this is an internet-reachable, unauthenticated money API. The JWT/JWKS/RBAC machinery is fully built and correct; it is simply switched off.
2. **Payment event handlers have no idempotency** (LED-1). `handle_payment_received` and `handle_payment_dishonoured` lack the `processed:{event_id}` guard their sibling handlers have, and there is no lower-layer dedupe on `payment_id`. Redis consumer groups are at-least-once, so a crash-and-redeliver applies a customer's payment (or dishonour reversal + fee) **twice**.
3. **No concurrency control on the balance read-modify-write** (LED-2). No `SELECT FOR UPDATE`, no optimistic version, no per-account lock anywhere on the transaction path — and the gRPC server and event consumer run as **separate OS processes**, so a staff repayment genuinely races a dishonour event. The projection writer absolute-sets balances (lost update) while control accounts increment (both deltas land), permanently diverging the sub-ledger from control accounts and forking the "immutable" hash chain.

Underneath those: silent event loss after a >1h outage, an idempotency layer that is itself check-then-act/fail-open/unshielded, an NCC fee cap whose math rejects every legitimate fee while unguarded paths charge uncapped, and a "microservices platform" that is actually one unsupervised process tree behind a TCP-only health check. Plus ~2,400 lines of dead OpenAI/chat code (`llmUtils.py` and friends, copied from a chat product — the origin of the "chatLedger" naming) shipping in the prod image.

### P0 — Platform: Critical

#### PSEC-1. Production ledger: gRPC auth disabled on public edge ports
*(PSEC-1 · PARCH-7 · PPERF-10/PRISK-10 — verified: **CONFIRMED Critical**)*

`infra/fly/fly.prod.toml:14` and `fly.demo.toml:14` set `AUTH_ENABLED="false"`; `grpc_server.py:30` defaults it off; `grpc_server.py:107` uses `add_insecure_port`; `grpc_servicer.py:201-204` — `if user is None: return` (allow) when no interceptor is installed. The services block (`fly.prod.toml:17-35`, byte-identical in demo) declares **public** Fly-edge listeners on `port = 443` and `port = 50051` with TLS handlers forwarding to the unauthenticated plaintext ledger on internal 50051. No flycast anywhere in the repo (`grep -ri flycast` → only a Keycloak comment). Every legitimate consumer already uses the `.internal` 6PN address (`billie-crm/infra/fly/fly.prod.toml:34-37`), so the public ports serve **no one**.

**Fix (two parts, ship the second today — it's free):** (1) set `AUTH_ENABLED=true` in prod/staging/demo, flip the code default to `true`, and make the server **fail closed** — refuse to start write RPCs when auth is off in a non-dev `APP_ENV`; issue the CRM a Keycloak service-account bearer token. (2) Delete the public `[[services.ports]]` block (or make it flycast-only) — zero functional impact, removes the internet exposure immediately. **Confirm with a live `fly ips list -a billie-platform-services-prod`** — the only residual uncertainty is whether a public IP is actually allocated (Fly-account state, not visible in-repo); the config as written declares exposure.

#### LED-1. Payment event handlers have no idempotency guard → double-posted money
*(LED-1 — verified: **CONFIRMED Critical**, no lower-layer save)*

`accountingLedgerService/event_handlers.py:392-439` (`handle_payment_received`) and `441-516` (`handle_payment_dishonoured`) have no `processed:{event_id}` check, while `handle_account_disbursed` (:251-254) and `handle_accrual_event` (:547-557) do. The dispatcher re-raises on failure (no ack), so a failed/crashed payment message is replayed on restart. There is **no business-key dedupe below**: `record_repayment` passes `payment_id` as a bare `reference_id`, `record_transaction` mints a fresh `transaction_id` every call, storage is Redis `XADD` with no uniqueness, and no migration has a unique index on any transaction reference. A full duplicate on a zero-balance account errors out incidentally, but any account with residual balance double-posts silently, and the dishonour handler double-reverses + double-charges the fee unconditionally.

**Fix:** Add the sibling `processed:{event_id}` guard to both handlers, **and** a durable `payment_id`-keyed dedupe inside `record_repayment` (the event-id guard alone inherits LED-8's Redis-TTL fragility).

#### LED-2. No concurrency control on the balance read-modify-write
*(LED-2 — verified: **CONFIRMED Critical**, worse than reported — cross-process race)*

`accountingLedgerService.py:291-351` reads the record, computes the new balance in memory, reads `previous_hash`, and appends — with multiple `await`s and no lock. Repo-wide there is no `FOR UPDATE`, advisory lock, version column, or per-account `SET NX` on the transaction path (the only locks are the accrual scheduler's leader election and the period-close finalize lock). Because `main.py:302-303` runs the gRPC server and the event consumer as **separate OS processes**, a staff `RecordRepayment` and an event-driven `handle_payment_dishonoured` on the same account genuinely execute in parallel. `postgres_ledger_repository.py:398-422` absolute-sets `principal_balance` (lost update, last writer wins) while `update_portfolio_balances` increments (both deltas land) → permanent sub-ledger vs control-account divergence, only caught at month-end close; both racers read the same `previous_hash` → hash-chain fork. `integrity.py` detects but does not prevent.

**Fix:** Serialize per account — a Redis `SET NX` per-account lock around `record_transaction`, or move the balance to a Postgres row updated with `SELECT ... FOR UPDATE` + compare-and-set on `last_transaction_id`. This single change also closes the concurrent-double-post half of CRM P0-2/P0-3 (XR-6) and the LED-6 double-disbursement race.

### P1 — Platform: High

#### PARCH-1 / PRES-6. Silent event loss: expired pending messages are ACKed without processing
*(PARCH-1 · PRES-6 — verified: **CONFIRMED High**, scope corrected to the startup-recovery path)*

`baseService.py:80-87`: on startup pending-recovery, any message whose stream-ID timestamp is older than `message_ttl = 3600` (1h) is `XACK`ed **without processing** and dropped with a WARN — the repo's own `deadLetter.py:5-8` documents the hazard. No service overrides it; all nine inherit it; a duplicate of the same drop lives in `redis.py:530-621`. The generic DLQ is opt-in per-handler and does **not** intercept this path, so any handler that raises (including the ledger's payment handlers) goes unacked → replayed on restart → TTL-dropped if the outage exceeded 1h. Recovery is also a single `count=100` batch (backlog >100 drains one restart at a time) with no `XAUTOCLAIM` reclaim loop. *Verification correction:* the drop is startup-recovery-only, not steady-state — it needs a >1h outage or a redeploy-after-failure to bite, which is exactly the incident scenario.

**Fix:** Route expired pending messages to the DLQ (the plumbing exists) instead of bare-acking; loop pending recovery until drained; add a periodic `XAUTOCLAIM` sweep so retries don't require a restart.

#### PARCH-2. Idempotency marker set before the effect → transient publish failure loses the event permanently
*(PARCH-2 — verified: **CONFIRMED High**, re-scoped to one site, worse there than claimed)*

`accountsService/event_handlers.py:801` sets the `processed` marker **before** the three downstream publishes (807/837/845). Because `accountsService.py:174` discards the handler's return and swallows exceptions, even a *transient* publish error (not just a crash) leaves the message acked and marked, so `account.updated.v1`/`schedule.updated.v1` are never emitted and the account projection silently diverges from the ledger. *Verification correction:* the other three cited sites (1972/2237/2305) mark **after** the work and are fine — this is one location, but a real silent-divergence bug there.

**Fix:** Mark processed *after* the publishes (duplicate publishes are absorbed by the self-consumption handlers' own keys), and stop `process_message` from ignoring a `False` return.

#### PARCH-4 / LED-3. Books-of-record durability depends on an undeclared external Redis
*(PARCH-4 · LED-3 — verified: **CONFIRMED, re-graded** — framing corrected)*

The transaction and portfolio-entry streams are the append-only journal (`storage.py:40-44`) and live **only** in Redis — no migration creates a transaction/portfolio table. *Verification corrections:* (a) account/portfolio *balances* are now Postgres-durable (the "M6" decommission), so this is loss of the **journal + audit hash chain**, not balances; (b) the 10k `maxlen` trim applies only to the `chatLedger` fan-out stream, **not** the journal streams (which are untrimmed) — the 10k cap is a cross-service/CRM event-loss issue (XR-7), not a journal-rebuild issue; (c) prod Redis is externally managed (Upstash per the CRM deploy docs), which does persist by default — but that durability is **invisible to and unenforced by this repo** (no persistence config, no backup contract, `docker-compose.yml` doesn't even define Redis). Still High: a regulated lender's books of record with no Postgres copy and no declared persistence/backup contract.

**Fix:** Project transactions/portfolio entries into append-only Postgres tables (the `accrual_event` pattern already exists and is the team's own stated M6 direction); pin and document the Redis persistence + backup contract as infra-as-code; raise/remove the chatLedger maxlen for anything the CRM's completeness depends on, or make the CRM's ingestion replay-safe.

#### LED-8 / XR-3. Ledger idempotency is check-then-act, fail-open, and unshielded
*(LED-8 · XR-3 — verified: **CONFIRMED High**, all four sub-claims)*

`idempotency.py`: 24h TTL (:27); `get_cached_response` returns `None` on any Redis error (:114-117, fail-open → duplicate rather than block); response stored with plain `SETEX` after success (:155, no `SET NX` reservation) so two concurrent same-key requests both miss and both write; and in `grpc_servicer.py` the cache store (~:905) happens *after* the money commit (~:838) with no `asyncio.shield`, so a client-deadline cancellation between them commits the transaction but never caches it — a correctly-keyed retry then double-posts. Same shape on all seven write RPCs.

**Fix:** Reserve the key with `SET NX` "in-progress" at entry (fixes the concurrent race), `asyncio.shield` the commit-through-cache-store span (fixes cancellation), and **fail closed** (return UNAVAILABLE) on Redis error for money-moving RPCs. This is the ledger half of CRM P0-1.

#### LED-5. DisburseLoan trusts a client-supplied amount with no bound/sign/equality check
*(LED-5 — verified: **CONFIRMED High**)*

`grpc_servicer.py:1441-1444` overrides the approved `record.disbursed_principal` with `Decimal(request.disbursement_amount)` — no comparison to the approved amount, no upper bound, no `> 0` check; `record_transaction` only rejects a resulting negative balance. A caller bug or "46200"-for-"462.00" typo books a 100× receivable that surfaces only at bank reconciliation. (Auth being off, PSEC-1, removes even the "authenticated caller" assumption.)

**Fix:** Reject `disbursement_amount` ≤ 0 or ≠ `record.disbursed_principal` beyond a small tolerance — or drop the override entirely, since the approved amount is already on the record.

#### LED-10. NCC fee cap is inverted: rejects every legitimate fee, while unguarded paths charge uncapped
*(LED-10 — verified: **CONFIRMED High**, including the establishment-fee math, against the repo's own fixtures)*

The 5% cumulative fee cap (`commands.py:79-110`, `160-193`) sums over `FEE_TYPES` — which **includes `ESTABLISHMENT_FEE`**. On the repo's own canonical loan ($462 principal / $38 establishment fee, from its test fixtures), the cap is 5% × $462 = $23.10 < $38, so `apply_late_fee`/`apply_dishonour_fee` reject **every** fee after disbursement (the passing unit tests only survive because their mocked histories omit the establishment-fee transaction). Meanwhile `handle_payment_dishonoured` posts the $15 dishonour fee via `record_transaction` **directly**, bypassing the cap, and `make_adjustment` takes arbitrary positive `fee_delta` uncapped. The control is simultaneously over-enforced (guarded paths) and unenforced (event/adjustment paths), and is self-contradictory by construction.

**Fix:** This is a spec correction, not just plumbing — reconcile with compliance whether the establishment fee counts toward the 5% (a lawful ~20% establishment fee can never fit a 5% all-fees cap), then enforce the *corrected* cap uniformly inside `record_transaction` for all fee-increasing types.

#### PRES-7 / PARCH-5. "Microservices platform" is one unsupervised process tree behind a TCP-only health check
*(PARCH-5 · PRES-7 · PARCH-6 — verified via architecture pass)*

`main.py:299-321` starts 13 `multiprocessing.Process` children (10 services + 3 gRPC servers) and `join()`s them with no restart-on-exit and no liveness monitoring; the only Fly health check is a `tcp_check` on 50051. A dead consumer (ledger, aging, collections…) leaves the machine "healthy" while events pile up and every CRM projection goes stale. Compounding it, `min_machines_running = 2` with a constant `consumer_name` (`baseService.py:22`) means two prod machines XREADGROUP as the *same* consumer, so a restart re-processes messages the other machine holds in the shared PEL — duplicate financial processing, gated only by the leaky idempotency of LED-1/PARCH-2.

**Fix:** Supervise children (restart on exit, or exit the parent so Fly restarts the machine); make the health check verify consumer lag (a consumer-lag RPC already exists at `grpc_servicer.py:3124`); set `consumer_name = f"{agent}_{machine_id}"` and use `XAUTOCLAIM` with a min-idle-time for crash recovery instead of re-reading a shared PEL at boot.

#### PPERF-1. GetPortfolioSummary replays the entire portfolio history + N+1 over every account's stream
*(PPERF-1 — verified via perf pass)*

`reporting.py:491` does an unbounded `XRANGE` of the whole portfolio stream, then `:558-563` loops every ledger record calling `get_transactions` (full per-account stream read) — on the same event loop as every hot CRM RPC. Tens of seconds and growing linearly forever; the parsing/summing starves `GetOverdueAccounts`/`GetBalance`. Period-close already built the bounded stream-ID bracketing this needs.

**Fix:** Serve point-in-time balances from the `ledger_record` Postgres projection; for as-of history, keep daily balance snapshots; adopt the period-close stream-bracket pattern for the reconciliation report (PPERF-2).

### P2 — Platform: Medium

- **PSEC-2 / PSEC-3 — sibling gRPC servers unauthenticated, all internal gRPC plaintext.** Collections/marketing/dispatcher servers wire no interceptor at all and expose state-changing RPCs (`EraseContact`, `SetConsent`, `FlagHardship`, `ClearSuppression`). *Verified: these ports are 6PN-private, not public* — so exploitable only from a compromised app on the org network (downgraded from Critical to Medium). Fly 6PN is WireGuard-encrypted, tempering the plaintext concern. Fix: share the ledger's `AuthInterceptor` across all four servers; treat 6PN as untrusted (mTLS or internal TLS) as defence-in-depth.
- **PSEC-4 — no event provenance; Redis auth/TLS optional in code.** Consumers trust anything on the stream; `redis.py:84-94` adds AUTH/TLS only if env vars are set. *Verified: prod Redis credentials live in gitignored Fly secrets, unknowable from the repo* — so "anyone can XADD" needs a compromised app or leaked credential. New sub-finding: env-var name mismatch — `env.placeholder` documents `REDIS_PERSISTENT_PASSWORD` but code reads `REDIS_PERSISTENT_DB_PASSWORD` (`redis.py:86-87`), so following the placeholder silently omits auth. Fix: require Redis AUTH+TLS in non-local envs (fail closed); add a signed-envelope or trusted-publisher check before handlers mutate state.
- **LED-4 / PARCH-3 — dual-entry spans two stores in four non-atomic steps; no transactional outbox.** The Redis pipeline is atomic but the two Postgres projection writes and the event publish are separate; a crash between them diverges sub-ledger from control accounts (caught only at close) or loses the event. Self-documented as BTB-269. Fix: single Postgres transactional boundary + outbox relay.
- **LED-7 (overpayment half) / PSEC-7.** *Verification refuted the negative-amount corruption* — a negative repayment hits an empty-postings guard and errors out (no write), so it's input-validation hygiene (Low), not a money bug. But overpayment beyond balance is recorded only as metadata with no refund-payable/cash posting (there is no cash/clearing account in the chart at all) — real money vanishes from the accounting view (Medium). Fix: reject `amount <= 0` at the boundary; post overpayments to an explicit liability account.
- **LED-12 / PTZ-13 — business-date timezone inconsistency.** `effective_date = date.today()` (server-local = UTC in prod) for transactions, vs AET accrual scheduling, vs UTC finalize gates. A 9am AEST repayment on the 1st gets a UTC effective date of the previous month; month-end figures misalign with the AU business calendar by up to 11 hours. Fix: one `business_today()` (AET) helper for every business-date default.
- **PARCH-8 — event sourcing has regressed to CRUD-with-events-attached.** The `*_dual_write.py` files are now Postgres-only factories; events are change *notifications*, Postgres is de facto authoritative, but CLAUDE.md still says "state derived from the append-only log." Engineers reasoning from the docs will make wrong assumptions (e.g. "safe to wipe a projection"). Fix: update the docs to the real model, or re-earn the claim with pure event-appliers + rebuild tooling; make `write_state_data` failures raise instead of swallow (`baseService.py:355`), and drop its 24h TTL default on "state."
- **PPERF-3/5/11/12 — hot-path efficiency.** GetOverdueAccounts applies the bucket filter in Python after pagination and recomputes `COUNT(*)` every 30s-poll; the consumer loop processes one message per Redis round trip (`count=1`); the connection-pool sizing assumes 6 processes but 13 run (up to 130 Neon connections) while the single gRPC process shares only 5; exports do sequential 2-3-query-per-account N+1 on the hot event loop. Fix: push filters into SQL + cache the count; batch consumer reads (`count=50-100`, pipelined XACK); role-based pool sizing; batch the export state reads (`WHERE account_id = ANY(:ids)` — the batch helper already exists).
- **PRES-9 — synchronous `requests.post` (Slack) inside async DLQ handlers** blocks the event loop during exactly the incident bursts that trigger alerts. Fix: `asyncio.to_thread` or an async HTTP client.

### P3 — Platform: Low / hygiene

- **PDUP-1/2/3/4/5 — template-copy drift is the dominant maintenance risk.** The hardened self-consumption loop exists in 1 of 5 copies (the other four `xack` even on handler failure — silent projection loss); four separate gRPC idempotency implementations with the per-RPC check/cache block copy-pasted ~16×; chatLedger publishing triplicated despite a shared publisher, with docstring/impl already disagreeing on `seq` type; 8 vendored event-SDK packages with **semantically incompatible** envelope drift (`rec` means "recipient list" in one, "recording timestamp" in another). Fix: hoist the hardened consumer loop into `BaseService`; one `@idempotent` decorator; route publishers through the shared util; extract one `billie_events_core` and reconcile the envelope.
- **PDUP-9/10 — timezone and Decimal-vs-float split by service generation.** Naive `datetime.utcnow()` survives in older services; `accountsService/event_handlers.py` uses `float()` on loan amounts at some lines and `Decimal` on the same fields at others (float-serialized balances feeding Decimal consumers). Fix: `src/utils/time.py` helpers + ban `utcnow`; standardize accountsService on `Decimal` strings.
- **PDUP-8 — god files.** `grpc_servicer.py` (4,741 lines, 49 RPCs, 132 `context.abort`, 7 hand-rolled idempotency blocks) and `period_close_service.py` (3,721). Fix: per-domain servicer mixins; hoist the try/abort + idempotency skeleton into a decorator/interceptor.
- **PDUP-11 / PARCH-11 — dead code.** `llmUtils.py` (1,873 lines of unreferenced OpenAI/chat code with ambient `OPENAI_API_KEY` usage and Redis prompt logging), `streamingUtils.py` and `models/application.py` (import a `backend.src.*` package that doesn't exist — ImportError on touch), `s3Utils.py`, `temp/`, `_bmad-output/`. Fix: delete; drop `openai` from requirements.
- **PSEC-5 / PSEC-6 — downgraded by verification.** The committed `AKIA…` in the Keycloak realm export is an access-key *id* only (the secret half is masked and stripped on import) → Low, scrub + rotate as hygiene. The `GITHUB_TOKEN`-in-image path is real only for local `docker build` (Fly prod deploys never pass the arg, and the token is dead code since SDKs install from `packages/`) → Medium, delete the dead token branch.
- **PARCH-9/10/12/13, PDUP-12/13/14/15 — structural debt.** Projection rebuild is bespoke backfill scripts, not a replay tool; 23 cross-service internal imports (services read each other's Postgres tables) make the boundaries porous; event-schema ownership is forked between vendored `packages/` and the external `billie-event-sdks`; `config.py` logs literal `"{env}"` (non-f-string bug); 10 vestigial `*_dual_write.py` stubs; five divergent metrics modules; four copied gRPC bootstraps.

---
---

# Part III — the cross-repo contract

The two repos are joined by (a) the accounting-ledger gRPC API and (b) Redis event fan-out. Verified findings on the seams:

| # | Contract point | Verdict |
|---|---|---|
| XR-1/XR-4/XR-5 | Ledger implements idempotency keys (24h TTL, `idempotent_replay`), code 9 → business rejection, code 6 → already-exists; protos wire-identical | **Sound** — the CRM's assumptions about the ledger are correct as written |
| XR-2 | CRM sends a fresh random key per request, never a stable one, so the ledger's idempotency never fires | **Confirmed** — CRM P0-1 is the fix |
| XR-3 | Ledger idempotency is check-then-act, fail-open, unshielded against deadline cancellation | **Confirmed** — LED-8 is the ledger-side fix; the two must ship together |
| XR-6 | Concurrent write-off double-writes (no lock, WRITE_OFF exempt from negative-balance guard) | **Confirmed** — LED-2 is the fix |
| XR-7 | `writeoff.*.v1` events are a CRM-internal loop; nothing in the platform consumes CRM streams; platform→CRM fan-out goes through an "Event Router" that exists in **neither repo**; chatLedger trims at 10k | **Confirmed** — the ledger learns of an approved write-off only via the CRM's `WriteOff` gRPC call; CRM projection completeness depends on an invisible router + an untrimmed-journal-but-trimmed-fanout distinction |
| XR-8 | DisburseLoan is an 8-step non-transactional sequence a deadline can bisect (money booked, no fee or no `account.disbursed.v1` → account never activates) | **Confirmed** — do not set short client deadlines on Disburse/WriteOff until the ledger shields the sequence |

**The joined conclusion:** money double-posting is reachable from three independent directions, and no single repo closes all of them.
1. **CRM retry** (XR-2) → fixed by CRM P0-1 (deterministic keys).
2. **Ledger deadline-cancellation window** (XR-3) → fixed by LED-8 (shield + fail-closed).
3. **Concurrent ledger RPCs / event-vs-gRPC race** (XR-6, LED-2) → fixed by LED-2 (per-account lock).

Ship all three. The CRM key fix alone leaves (2) and (3); the ledger fixes alone leave (1). The proto contract, error-code semantics, and the ledger's idempotency *design* are all sound — the gaps are in wiring and concurrency, not in the interface.

---

## Cross-repo sequencing (supersedes the Part I sequence for the money-integrity items)

| Order | Work | Repo | Effort |
|---|---|---|---|
| 0 | **Remove public ledger ports + enable `AUTH_ENABLED`** (PSEC-1) — the port removal is free and closes internet exposure today | platform | Hours + a `fly ips list` check |
| 1 | Deterministic write-off key (drop `Date.now()`) + code 9 → 422 (CRM P0-2) | crm | Hours |
| 2 | Per-account lock on the ledger transaction path (LED-2) — also closes XR-6 and LED-6 | platform | Days |
| 3 | Idempotency guard + `payment_id` dedupe on payment handlers (LED-1) | platform | Days |
| 4 | Client idempotency keys through the 7 ledger routes + stable `paymentId` (CRM P0-1), paired with ledger SET-NX reservation + shield + fail-closed (LED-8/XR-3) | both | Days, coordinated |
| 5 | Retire `/api/ledger/write-off` + LoanAccountServicing modals (CRM P0-3, P1-1) | crm | Days |
| 6 | Route expired pending messages to DLQ + loop recovery + XAUTOCLAIM (PARCH-1/PRES-6); fix marker-before-publish (PARCH-2) | platform | Days |
| 7 | NCC fee-cap spec correction with compliance (LED-10); DisburseLoan amount validation (LED-5) | platform | Days + a decision |
| 8 | Supervise the process tree + consumer-lag health check + per-machine consumer names (PRES-7/PARCH-5/6) | platform | Days |
| 9 | Project transactions to Postgres + pin Redis persistence contract (LED-3/PARCH-4); then the Part I P1/P2 sweep and the platform P2/P3 debt | both | Weeks |

**Documentation is itself a finding in both repos:** the CRM CLAUDE.md is stale on versions/roles; the platform CLAUDE.md/README describe event-sourcing-as-source-of-truth that the code no longer implements (PARCH-8) and a "microservices platform" that is one process tree (PARCH-5). Fix the docs first in each — they currently mislead humans and agents into wrong assumptions about durability and safety.

---

## Platform: verified sound (do not re-audit)

- `Decimal`/`ROUND_HALF_UP` money math throughout the ledger; `numeric(18,2)`/`numeric(12,6)` DB columns; **no float** in ledger money paths
- Accrual: per-day idempotency + absolute (non-incremental) cumulative formula + durable `accrual_event` mirror (`PK (account_id, accrual_date)`, `ON CONFLICT DO NOTHING`) + working rebuild path — re-runs cannot double-accrue
- Period close: distributed finalize lock with token, contiguous-month re-validation, period-elapsed gate, anomaly-ack governance, finalize-time live ECL re-aggregation, finalize-time GL integrity **hard stop**, additive-only corrections, atomic state+event save — the strongest module in either repo
- ECL default rates match the CRM fallbacks exactly (0.03 / 0.25 / 0.55 / 1.00, overlay 1.0)
- Accrual scheduler: `Australia/Sydney` ZoneInfo, DST-correct midnight, restart catch-up, distributed lock
- JWT validation logic (RS256 pinned, iss/aud/exp enforced, JWKS) — correct, just disabled
- SQL is parameterized (SQLAlchemy Core / asyncpg bound params); no injection found
- Redis client resilience: retry that excludes ambiguous `TimeoutError`, jittered backoff, NOGROUP self-healing
- Postgres pool: process-cached engine, bounded pool, pre-ping, verify-full SSL, PgBouncer-aware
- DLQ design is sound (lossless round-trip) — the gap is only that BaseService's default path doesn't use it
- Alembic migration hygiene: single linear history, read-models only
- Hash-chained transaction model is sound as tamper-evidence (though LED-2 can fork it and LED-3 governs its durability)
- No hardcoded app credentials or committed `.env` files; page-size DoS capped at 1000
