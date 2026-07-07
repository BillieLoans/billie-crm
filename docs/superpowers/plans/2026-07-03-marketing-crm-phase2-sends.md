# Marketing CRM Phase 2 (Stream A — Sends through the platform) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 Stream A of the marketing CRM: make the platform actually **send** marketing messages and close the lifecycle loop — batches + invites, welcome/nurture, referral attribution + waitlist positions, feedback intake + queue, ClickSend inbound replies, a dashboard feed, and the Apps Script send-log cutover — all through the existing notificationService/dispatcher (no interim integration). This extends the Phase-1 `marketingService`; it does **not** build the customerService customer-state projection (that is Stream B — see "Not in this plan").

**Architecture:** Strict event-first CQRS per platform convention. `marketingService` is the **campaign brain**: gRPC command handlers create + publish domain events and emit notification-dispatch commands; they write **no state**; the self-consume consumer group derives the `marketing.*` projection. `notificationService/dispatcher` is the **only send path** — it already enforces marketing consent, suppression, quiet hours (§6). The CRM stays intake gateway + command surface + projection UI. New cross-service events reach consumers via chatLedger → billieChat Broker → inbox (routes.json). Spec: `docs/superpowers/specs/2026-07-02-marketing-crm-customer-lifecycle-design.md` (§2.3, §2.4, §5.3, §5.4, §6, §8, §9).

**Tech Stack:** Python 3.12 (Pydantic v2, redis-py async, SQLAlchemy Core + asyncpg, Alembic, grpcio :50054, pytest + testcontainers), Payload CMS 3.45 / Next.js 15 (TypeScript, zod v4, React Query, vitest), Redis Streams, Jinja2 (notification templates).

## Current state (verified 2026-07-03 — build on this, don't rebuild)
- `marketingService` exists (event-first, gRPC :50054, self-consume `marketing.*`, Alembic 0008, matcher, waitlist import). RPCs shipped in P1: UpsertContact / UpdateContact / SetConsent / LogInteraction / EraseContact(basic). **Confirm at Task 0** which of CreateBatch/AssignBatch/TriggerBatchInvitations/SubmitFeedback are stubs vs unimplemented in `proto/marketing.proto`.
- **SDK event enums already defined** (`packages/marketing/billie_marketing_events/enums.py`): `batch.created.v1`, `contact.batch.assigned.v1`, `feedback.received.v1`, `feedback.status.changed.v1`, `referral.attributed.v1`, `contact.interaction.logged.v1`. Phase 2 adds the **Pydantic models + parser cases** for the ones lacking them and bumps the SDK.
- **Referral codes are already minted** at contact creation (P1). Phase 2 adds **attribution** only.
- **notificationDispatcher already has marketing gating**: `marketing_opt_in`, `category=="marketing"` hard-block, `SUPPRESSION_MODE_MARKETING_ONLY`. So consent/suppression enforcement is DONE — Phase 2 adds contact-addressing, templates, the consent read-model sync, and the dispatch-command emitters.
- **The intake fallback now publishes via the broker** (billie-crm PR#40 + billieChat PR#123): gRPC-primary, on failure publish a command to `chatLedger` and let the Broker route it. **Reuse this exact pattern** for the public feedback intake — do NOT write directly to `inbox:marketing`.

## Global Constraints
- Repos (co-located): platform = `/Users/rohansharp/workspace/billie-platform-services`; billieChat = `/Users/rohansharp/workspace/billieChat`; CRM = `/Users/rohansharp/workspace/billie-crm`.
- Event names `{domain}.{entity}.{action}.v{n}`; envelope `conv, agt, usr, seq, cls, typ, cause, payload` (payload = JSON string). marketingService publisher `agt=marketingService`; CRM `agt=billie-crm`.
- Streams: internal self-consume `marketingService:events:marketing`, group `marketingService-projection-writers`; inbox `inbox:marketing`. New cross-service events need a **routes.json** entry in billieChat (source `agt`, matched exact→prefix→wildcard); `agent_inbox_mapping` already maps `${agent_marketingService}`→`inbox:marketing`.
- Alembic: next revision `0009_marketing_phase2` (batches, batch_members, feedback + any referral columns), `down_revision = "0008_marketing_schema"`.
- `marketing.*` NEVER holds financial fields. Contact→customer link stays one-way.
- **CI gates: platform-services + billieChat gate on `black --check` (platform also flake8). Run `black` (and flake8 for platform) before pushing** or the Lint job fails. CRM has no GitHub Actions CI; use `pnpm typecheck` + `pnpm lint` + vitest locally (route/UI tasks MUST run `pnpm typecheck`, not just vitest).
- CRM code style: Prettier (single quotes, no semicolons, trailing commas, 100 width). Python: black + ruff/flake8-clean, match existing handler idioms; prefer the shared `db.py` upsert helpers.
- Commit after every task: `feat(marketing): …` / `test(marketing): …`. Branch per repo off clean `main`.

---

### Task 0: Branches + surface audit

**Files:** none (git only) + a short findings note.
- [ ] Branch each repo off clean `main`: platform `feat/marketing-phase2-sends`, billieChat `feat/marketing-phase2-routes`, CRM `feat/marketing-phase2-sends`.
- [ ] Audit and record: which `proto/marketing.proto` RPCs are already generated/stubbed; which SDK events already have Pydantic models vs enum-only; whether `notificationDispatcher` templates are Jinja2 files or inline; the dispatcher's request contract for `contact_id`-addressed sends. This audit sizes A1/A5 precisely.

---

## Part A — billie-platform-services

### Task A1: SDK models + parser for Phase-2 events; bump to `marketing-v0.2.0`
**Files:** `packages/marketing/billie_marketing_events/{models.py,parser.py}`, tests; `CHANGELOG.md`, version bump.
**Interfaces:** Pydantic models for `batch.created.v1`, `contact.batch.assigned.v1`, `feedback.received.v1`, `feedback.status.changed.v1`, `referral.attributed.v1` (enums already exist). Parser round-trips each.
- [ ] TDD: parser round-trip test per event (real envelope → model → dict). Publish + release `marketing-v0.2.0` to `BillieLoans/billie-event-sdks` via the `bump-event-sdk` flow; re-pin in platform + CRM requirements.
**Acceptance:** `pytest packages/marketing` green; SDK importable at pinned version.

### Task A2: Batches — schema, RPCs, events, projection
**Files:** Alembic `0009_marketing_phase2` (`marketing.batches`, `marketing.batch_members`); `proto/marketing.proto` (`CreateBatch`, `AssignBatch(contact_id[])`, `TriggerBatchInvitations`); command handlers; projection writer; tests.
**Interfaces:** `CreateBatch` → `batch.created.v1`; `AssignBatch` → `contact.batch.assigned.v1` per contact; `TriggerBatchInvitations` → emits a notification-dispatch command per **consented** member (reason `marketing`, addressed by `contact_id`) — see A5/A6.
- [ ] TDD each handler (event emitted, no state written in handler); projection derives batches + membership from self-consume; idempotent on re-delivery.
**Acceptance:** command→self-consume→projection round-trip test green; TriggerBatchInvitations skips non-consented members (assert).

### Task A3: Feedback — schema, RPCs, events, projection
**Files:** Alembic 0009 (`marketing.feedback`); `proto/marketing.proto` (`SubmitFeedback`, `SetFeedbackStatus`); handlers; projection; tests.
**Interfaces:** `SubmitFeedback` → `feedback.received.v1`; `SetFeedbackStatus` → `feedback.status.changed.v1` (queue triage: new→ack→resolved). Feedback links to `contact_id` (+ optional `customer_id`).
**Acceptance:** round-trip green; status transitions validated.

### Task A4: Referral attribution + waitlist positions
**Files:** marketingService UpsertContact handler (resolve `referred_by_code` → referrer), `referral.attributed.v1` emitter, position recompute, config constant (`REFERRAL_BOOST`); projection (position + referred-list); tests.
**Interfaces:** on intake with a `ref` code → resolve referrer contact → `referral.attributed.v1` (referrer ← referee, code) → recompute waitlist positions: `points = waitlist_age + REFERRAL_BOOST × attributed_referrals`. Self-referral + unknown-code guarded.
**Acceptance:** attribution + recompute test green; unknown/self code is a no-op (assert). **Dependency:** website `/r/{code}` → form `ref` is external (Flagged Decision #3, web owner) — attribution works whenever `ref` arrives.

### Task A5: notificationService/dispatcher — contact-addressing, templates, consent read-model
**Files:** dispatcher request model (accept `contact_id` recipient with optional `customer_id`, resolve raw mobile/email from the marketing contact model); marketing Jinja2 templates (`welcome`, `nurture`, `invite`, `feedback_prompt`); dispatcher read-model consumer for `contact.consent.granted.v1`/`withdrawn.v1` → sync `marketing_opt_in`; tests.
**Interfaces:** reuses existing marketing consent hard-block + `SUPPRESSION_MODE_MARKETING_ONLY` (already present). New: address by `contact_id`; render marketing templates; keep opt-in in sync from consent events (broker route in A8).
**Acceptance:** a marketing send addressed by `contact_id` to a consented contact dispatches; to a withdrawn contact is hard-blocked (assert); template render tests green.

### Task A6: marketingService campaign brain — welcome + nurture emitters
**Files:** marketingService consumers/schedulers that emit notification-dispatch commands; tests.
**Interfaces:** welcome-on-signup (on `contact.observed.v1` where `waitlist`/first-sighting) → dispatch `welcome`; nurture schedule → dispatch `nurture`; `TriggerBatchInvitations` (A2) → dispatch `invite` per consented member. All reason `marketing`, addressed by `contact_id`. Never talks to providers directly.
**Acceptance:** welcome emitted once per new consented contact (idempotency fence like `_handle_intake_command`); non-consented → no dispatch (assert).

### Task A7: Outbound timeline logging (event-native)
**Files:** marketingService consumer for `notification.sent.v1`/`notification.delivery_failed.v1` → `contact.interaction.logged.v1`; tests.
**Interfaces:** delivery events (addressed to a marketing send) become interactions on the contact timeline. Match back to `contact_id` via the dispatch correlation id.
**Acceptance:** sent + failed each produce a logged interaction (assert kind + status).

### Task A8: billieChat routes.json — deliver notification + inbound events to marketingService
**Files:** `backend/backend/src/routing/routes.json`; router test.
**Interfaces:** add `${agent_notificationDispatcherService}` → `notification.sent.v1`/`notification.delivery_failed.v1` targets to include `${agent_marketingService}` (for A7); add the CRM public-feedback fallback command route under `${agent_billie-crm}` (mirror the `contact.intake.requested.v1` rule) → `${agent_marketingService}` (for B2). Confirm the existing `marketingService → contact./referral./batch./feedback.` prefix routes to billie-crm cover the new projection events (they do).
**Acceptance:** router unit tests assert each new (agt, typ) resolves to the right inbox(es); `black --check` clean.

---

## Part B — billie-crm

### Task B1: ClickSend inbound webhook → LogInteraction
**Files:** `src/app/api/webhooks/clicksend/route.ts`; zod schema; signature verify (confirm ClickSend scheme); tests.
**Interfaces:** signature-verified inbound reply → gRPC `LogInteraction` (inbound kind). Fallback: publish an interaction command to chatLedger (broker → marketingService), same posture as intake.
**Acceptance:** valid signature → LogInteraction called; bad signature → 401 (assert); `pnpm typecheck` + vitest green.

### Task B2: Public feedback intake (gRPC-primary, chatLedger fallback)
**Files:** `src/app/api/intake/feedback/route.ts`; extend `chatledger-publisher.ts` with `publishFeedbackSubmitted()`; `events/config.ts` + `events/types.ts` (new `EVENT_TYPE_FEEDBACK_SUBMIT_REQUESTED`); tests.
**Interfaces:** HMAC+API-key auth (reuse `verifyIntakeAuth`), zod-validated → gRPC `SubmitFeedback`; on failure publish `feedback.submit.requested.v1` command to chatLedger (routed in A8). **Mirror the just-merged intake-via-broker pattern exactly.**
**Acceptance:** gRPC path 200; fallback path 200 queued (asserts publisher call, not a direct inbox xadd); both idempotent.

### Task B3: Staff routes — batches, invites, feedback status, interactions
**Files:** `src/app/api/marketing/batches/route.ts`, `batches/[id]/assign/route.ts`, `batches/[id]/invite/route.ts`, `feedback/[id]/status/route.ts`, `contacts/[id]/interactions/route.ts` (if not present); tests.
**Interfaces:** `requireAuth(canMarketing)`; command → poll projection pattern (write-off precedent). Assign takes contact_id list from a filtered segment.
**Acceptance:** authz matrix enforced (marketing role only; lending roles unchanged); command routes call the right gRPC; `pnpm typecheck` + vitest green.

### Task B4: Dashboard feed
**Files:** `src/app/api/marketing/dashboard-feed/route.ts` (service API key); export-jobs CSV addition for contacts/interactions; tests.
**Interfaces:** read-only aggregate counts (by stage, source, referral rate, funnel) for Looker Studio. Service API key auth (not session).
**Acceptance:** returns stable JSON shape; unauthorized without key (assert).

### Task B5: CRM projection handlers for Phase-2 events (+ migration)
**Files:** event-processor handlers for `batch.created.v1`, `contact.batch.assigned.v1`, `feedback.received.v1`, `feedback.status.changed.v1`, `referral.attributed.v1`; Payload collections (batches, feedback) + read-only projection columns; Payload migration; `generate:types`/`importmap`; tests.
**Interfaces:** project into read-only Payload collections (create/update/delete `() => false`), using shared `db.py` upsert helpers. `contact.interaction.logged.v1` already projected in P1 (verify).
**Acceptance:** handler upsert tests green (PYTHONPATH note for event-processor pytest); migration matches collection columns.

### Task B6: Admin UI — batch assignment, referrals + feedback panels, feedback queue
**Files:** marketing grid `Assign to batch` action + `[Batch ▾]` filter; contact-detail `Referrals` + `Feedback` panels + `Consent history`; a feedback queue view; `possible matches for review` panel if not shipped in P1. Reuse `ContactNotesTimeline`, monitoring-grid, optimistic-update/poll stores. React Query hooks in `hooks/queries|mutations` + barrel export.
**Interfaces:** **Fixed-layout rule** — every element keeps its position across states regardless of data presence (per user preference); no reflow by data presence.
**Acceptance:** hooks/logic unit-tested; `pnpm typecheck` green; **flag component visual layout for human QA** (can't verify pixels headless) — include wireframe deltas from §5.4 in the task report.

---

## Part C — Cutover

### Task C1: Apps Script send-log backfill → interactions
**Files:** one-off idempotent script (Apps Script send-log CSV → gRPC `LogInteraction` loop), runbook for Apps Script retirement.
**Interfaces:** import historical sends as interactions (original timestamps), idempotent + re-runnable. SMS/email first (ClickSend/Resend exist). Pre-cutover sends not appearing live is accepted (not a regression).
**Acceptance:** dry-run count matches; re-run creates no duplicates; sign-off checklist for switching Apps Script off.

---

## Deploy order (matters — merge ≠ deploy)
1. billieChat routes (A8) → 2. platform-services (A1–A7) → 3. billie-crm (B1–B6). Then C1 cutover. Rationale: routes + emitters must exist before the CRM relies on them, same as the intake-via-broker rollout.

## Not in this plan (explicit)
- **Stream B — customer-state projection** in customerService (`customer.customer_state`, `customer.state.changed.v1`, derived Billie stage, §3/§4). Independent; can run in parallel or slip to Phase 3. **Blocked on Flagged Decision #1** (OTP-pass event vs A3 inference — billieChat owner). **Sign-off (7 Jul 2026):** the workstream itself is in discussion (A4); when built, `ADMIN_CLOSED` maps to **C-P (win-back-eligible) + review flag**, not C-N (B2 change — design spec §3).
- **Phase 3** — WhatsApp provider + webhook (timing in discussion, B1); full DSR (XDEL sweep + subject-access export); backup restore test; `SETTLED_SHORT` SDK addition (settled-short → C-N at source; `ADMIN_CLOSED` stays win-back-eligible per B2).

## Flagged decisions / external dependencies
- **#3 (web owner):** `billie.loans/r/{code}` → form `ref` param — A4 attribution works once `ref` arrives; confirm the website route.
- **ClickSend inbound signature scheme** — confirm before B1.
- **Marketing template copy** (welcome/nurture/invite/feedback) — marketing/product supply content; A5 ships the render mechanism + placeholders.
- **#1 (billieChat owner):** OTP-pass event — Stream B only; does not block Stream A.
