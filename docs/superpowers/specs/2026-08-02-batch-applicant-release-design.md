# Batch Applicant Release — Design

**Date:** 2 August 2026
**Status:** Approved design, pending implementation plan
**Repos:** `billie-crm` (control plane) + `billieChat` (enforcement). No changes to `billie-platform-services`.

## 1. Goal

Staff control how many people can start a new loan application, releasing applicants in batches from the CRM. Three release types:

1. **Waitlist next-N** — the next N marketing contacts by waitlist position.
2. **Phone list** — an explicit list of pasted/selected mobile numbers.
3. **Open quota** — N slots for anonymous walk-ups, first-come-first-served.

Everyone arriving at chat.billie.loans passes a front-door gate: verify your mobile via OTP, then either enter (existing customer, targeted grant, or claimed quota slot) or see a friendly "we're at capacity" page linking to the billie.loans waitlist.

## 2. Decisions (settled during brainstorming)

| Question | Decision |
|---|---|
| How does a released applicant prove identity? | **Front-door mobile + OTP** for everyone, reusing billieChat's existing `otp_service`/ClickSend. No magic-link tokens. |
| What does "release by count" mean? | **Next N from the waitlist** (specific contacts, by `waitlistPosition` then `waitlistJoinedAt`), not an anonymous counter. |
| Anonymous applications? | Also supported, as the **open quota** release type. Walk-ups still verify their mobile; a claim mints a grant tied to that mobile. |
| Existing customers? | **Bypass the gate** (verified mobile matches an existing customer → straight in; the reapplication block applies unchanged). Releases control *new* applicant volume only. |
| Grant lifetime? | **Per-release expiry window**, default 14 days, editable per release. Re-entry allowed within the window. Releases are revocable. |
| Invite SMS? | **Optional per release** (checkbox). Sending is done by billieChat, not the CRM (the CRM's NotificationDispatcher gRPC client is read/suppression-only). |
| SMS consent policy | **Marketing consent required for the SMS.** Unconsented (or unmatched pasted) numbers still get the grant — they can enter if they show up — but receive no message. |
| On/off control | **Two-level.** Operational switch: runtime gate mode (`open` \| `gated`) in billieChat Redis, flipped instantly (no deploy) by an ops CLI that publishes a `gate_mode.set` event; CRM shows the current mode. Engineering guard: `ENABLE_APPLICATION_GATE` env flag for dark-shipping and hard kill. Default mode is `open` — fully-rolled-out production simply leaves it there. |
| Architecture | **Approach A: CRM commands it, billieChat enforces it.** A new small "applicant release" domain; marketing data is only *read* for targeting; the entry decision is mastered on the lending side. Preserves the marketing spec's privacy wall (marketing never authors a lending decision) and keeps `billie-platform-services` untouched. |

Rejected approaches: extending the platform `marketingService` (out of scope repo; puts a lending-entry decision inside marketing, against the privacy-wall invariants in `docs/superpowers/specs/2026-07-02-marketing-crm-customer-lifecycle-design.md` §1); billieChat-masters-with-sync-CRM-read-API (new synchronous runtime coupling; breaks the CRM's projection convention).

## 3. Architecture

```
billie-crm (Payload admin)                     billieChat (FastAPI + Svelte)
┌─────────────────────────┐                    ┌──────────────────────────────┐
│ Marketing › Releases UI │                    │ applicantReleaseService      │
│  preflight → confirm    │                    │  (new BaseAgent, cloned from │
└──────────┬──────────────┘                    │   reapplicationBlockService) │
           │ POST /api/marketing/releases      │  grant store: Redis primary  │
           ▼                                   │  + Postgres shadow           │
┌─────────────────────────┐   chatLedger       └──────┬───────────┬───────────┘
│ Release command route   │ ────────────────►  inbox: │           │ sends invite
│  resolves targets NOW   │  cls:cmd           applicantRelease   │ SMS (ClickSend)
│  (contacts projection / │  applicant_release.released.v1        │
│   normaliseAuMobile)    │                           │           ▼
└──────────┬──────────────┘                    ┌──────┴──────────────────────┐
           │ also XADD                         │ Front-door gate             │
           ▼ inbox:billie-servicing:internal   │  /gate/status /gate/otp/*   │
┌─────────────────────────┐                    │  /chat/init + WS backstop   │
│ Python processor        │  ◄──────────────── └─────────────────────────────┘
│ release_batches +       │   facts via chatLedger → inbox:billie-servicing:
│ release_grants          │   applicant_release.grant_claimed.v1 / invites_sent.v1
│ projections (CRM UI)    │
└─────────────────────────┘
```

- **Transport is the existing chatLedger Redis stream** — the same path as `reapplication_block.clear_authorized.v1` today. No new sync coupling.
- **Dual publish** from the CRM command route: chatLedger (for billieChat) + `inbox:billie-servicing:internal` (for the CRM's own projection) — the established write-off/block-clear split.
- **Facts flow back** via a new `routes.json` rule: sender `applicantReleaseService`, `typ` prefix `applicant_release.` → billie-crm inbox.
- Targets are resolved **at command time** in the CRM (waitlist query / normalisation of pasted numbers); the event carries concrete mobiles, so billieChat needs no access to marketing data.

## 4. Event contracts (chatLedger envelope, `agt: billie-crm` / `agt: applicantReleaseService`)

### CRM → billieChat (`cls: cmd`)

**`applicant_release.released.v1`**
```json
{
  "release_id": "nanoid — minted by the UI, idempotency anchor",
  "name": "August wave 3",
  "type": "waitlist | phone_list | open_quota",
  "expires_at": "ISO 8601 — releasedAt + validity window (default 14 days)",
  "send_invite_sms": true,
  "grants": [{ "mobile_e164": "+614…", "contact_id": "nullable", "send_sms": true }],
  "quota_count": 150,
  "released_by": "staff user id"
}
```
`grants` for targeted types, `quota_count` for open quota (mutually exclusive). Per-grant `send_sms` is computed by the CRM from marketing consent at release time — billieChat sends without needing consent knowledge.

**`applicant_release.revoked.v1`** — `{ release_id, revoked_by, reason? }`. Kills all remaining grants and any remaining quota. Stops new entries; does not terminate in-flight conversations.

**`applicant_release.gate_mode.set.v1`** — `{ mode: "open" | "gated" | "closed", set_by, reason? }`. Published by the gate CLI (below), not the CRM. applicantReleaseService applies it to Redis and emits the fact. `closed` (added Aug 2026) is the kill switch: nobody passes the gate — no customer bypass, no grants, no quota — the OTP endpoints refuse (no SMS), and the frontend shows a closed page with no mobile-entry path. Closed blocks NEW passes only; sessions holding a gate-passed key from before the flip ride out that key's TTL (same posture as release revocation).

### billieChat → CRM (facts)

**`applicant_release.grant_claimed.v1`** — `{ release_id, mobile_e164, source: "targeted" | "quota", claimed_at, conversation_id }`. Emitted on first successful gate entry per grant.

**`applicant_release.invites_sent.v1`** — `{ release_id, sent: ["+614…"], failed: [{ mobile_e164, reason }] }`. One retry per failed send, then reported for manual follow-up.

**`applicant_release.gate_mode.changed.v1`** — `{ mode, set_by, changed_at }`. Projected by the CRM so the Releases UI shows the live mode.

Parsing on the CRM side uses local Pydantic models in `billie_servicing` (like the write-off events), not the external SDKs.

## 5. billie-crm

### Projections (read-only Payload collections, written by the Python processor)

**`release-batches`**: `releaseId` (unique), `name`, `type`, `status` (`active` | `revoked` | `expired` — expired derived from `expiresAt`, no sweeper event), `quotaCount`, `expiresAt`, `sendInviteSms`, `grantedCount`, `claimedCount`, `smsSentCount`, `smsFailedCount`, `skippedAlreadyCustomer`, `skippedInvalidNumber`, `skippedAlreadyReleased`, `skippedNeedsReview`, `createdByActor`, `releasedAt`, `revokedBy`, `revokedAt`.

**`release-grants`**: `releaseId`, `mobileE164`, `contactId` (nullable), `source` (`targeted` | `quota_claim`), `status` (`granted` → `claimed` → `expired` | `revoked`), `smsStatus` (`sent` | `failed` | `not_sent`), `claimedAt`. Natural key `(releaseId, mobileE164)`, upserted via the shared `db.py upsert()` helper. Quota rows appear only when claimed.

Both: `group: 'Marketing'`, `hidden: hideFromNonAdmins`, `read: canReadMarketing`, `create/update/delete: () => false`. Composite unique on the natural key added in `afterSchemaInit` (like repayment-schedule rows). Schema change ships as a committed Payload migration.

### API routes (`src/app/api/marketing/releases/`)

| Route | Method | Gate | Behaviour |
|---|---|---|---|
| `/` | GET | `canReadMarketing` | list from projection |
| `/preflight` | GET | `canReadMarketing` | partition, computed fresh from projections |
| `/` | POST | `canMarketing` | resolve targets, dual-publish `released.v1`, → 202, idempotent on `releaseId` |
| `/[releaseId]` | GET | `canReadMarketing` | detail + grant rows |
| `/[releaseId]/revoke` | POST | `canMarketing` | publish `revoked.v1`, → 202 |

**Preflight partition** (waitlist/phone-list): will-be-granted-with-SMS / granted-no-SMS (no marketing consent, or unmatched pasted number) / skipped: already a customer / skipped: already in an active release / skipped: needs-review / skipped: invalid number (failed `normaliseAuMobile`).

**Waitlist selection**: contacts where `derivedStage = 'waitlist'`, has `mobileE164`, not `needsReview`, not `erased`, no active grant; ordered by `waitlistPosition` (nulls last) then `waitlistJoinedAt`; limit N.

**Customer-match check** (for skippedAlreadyCustomer): normalised comparison against the `customers` projection. Note `customers.mobilePhoneNumber` is not normalised or indexed — the preflight normalises both sides in the query; if that proves slow, add a normalised expression index in the same migration.

Each release also logs a "released to apply" interaction on matched contacts via the **existing** `LogInteraction` gRPC — timeline visibility with zero platform changes.

### UI (extends `src/components/MarketingView/`)

- **Releases tab** in the marketing sub-nav (`/admin/marketing/releases`): summary line ("open capacity right now: X unclaimed grants + Y quota slots"), table of releases (name, type, status pill, released, granted, claimed, remaining, expires). When gate mode is `open`, a persistent banner reads "Application gate is OFF — releases are not being enforced" (mode comes from a single-row `release-gate-status` projection written from `gate_mode.changed.v1`).
- **New release modal**, two steps (ux-standards stepped-flow pattern): **Define** (name, type as three radio cards, count *or* paste-area for phone lists, validity days, SMS checkbox — disabled for open quota) → **Preflight & confirm** (partition with counts; confirm states the SMS consequence explicitly). Fixed layout: switching type swaps only the count/paste field.
- **Release detail**: header (status, audit line, Revoke button with typed-confirmation modal), five fixed stat tiles (granted / claimed / unclaimed / SMS sent / SMS failed), grant table (mobile, contact link, source, status, SMS, claimed at) — same columns for every type.
- Hooks follow the marketing pattern: `useReleases` / `useRelease` / `useReleasePreflight` (staleTime 0) queries; mutations in `useMarketingCommands.ts` style with lag-tolerant invalidation and failed-action capture.

### Python processor (`event-processor/`)

New `handlers/applicant_release.py`: `released.v1` → upsert `release_batches` + insert `release_grants` (targeted); `revoked.v1` → statuses; `grant_claimed.v1` → grant row upsert (mints quota rows) + counters; `invites_sent.v1` → sms statuses + counters; `gate_mode.changed.v1` → single-row `release_gate_status`. Registered in `main.py`; prefix `applicant_release.` added to the parser dispatch with local models.

## 6. billieChat

### Service

New `backend/backend/src/services/applicantRelease/` mirroring `reapplicationBlock/`:

- `applicant_release_service.py` — `BaseAgent` on new `inbox:applicantReleaseService` (add to `agent_inbox_mapping`, `routes.json` sender rules, and a `ProcessSpec` in `__main__.py`). Handles `released.v1` (store grants/quota; send invite SMS where `send_sms` via existing ClickSend utils; emit `invites_sent.v1`) and `revoked.v1` (sweep).
- `repository.py` / `postgres_repository.py` / `dual_write.py` behind `APPLICANT_RELEASE_PROJECTION_STORE` (`redis` | `dual` | `pg`), new Alembic migration for shadow tables.
- `gate.py` — the decision function; `messages.py` — copy from Redis hash `capacity_gate_messages` (→ config → hard-coded fallback, per `stop_messages.py`); `enums.py`.
- `gate_cli.py` — the on/off configuration script: `python -m backend.src.services.applicantRelease.gate_cli {on|off|status} --env <env>` (mirrors the `feature_flags.cli` precedent). `on`/`off` publish `gate_mode.set.v1` to chatLedger with the operator's identity; `status` reads the Redis key and prints mode + active releases. A Make target wraps it for ops convenience.

### Gate control (two levels)

Effective gating = `ENABLE_APPLICATION_GATE` (env flag, code-level guard) **AND** runtime gate mode (`application_gate:mode` in Redis, default `open` when unset). Flag off → all gate code inert regardless of mode (dark-ship + hard kill, restart required). Flag on + mode `open` → door open exactly as today, `GET /gate/status` returns `off`, frontend never shows gate states; flipping to `gated` via the CLI takes effect within seconds (mode is read per gate check with a short in-process cache, ≤5 s). Fully-rolled-out production runs mode `open` with the flag **left permanently on**: the `closed` kill switch is only flippable without a deploy while the flag is enabled, so the flag is a one-time dark-ship guard, not something to retire. CLI commands: `on` → gated, `off` → open, `close` → closed, `status` (Make targets gate-on / gate-off / gate-close / gate-status).

### Storage (Redis primary)

- `grant:{mobileE164}` hash → `{release_id, status, expires_at}` — O(1) gate lookup; one active grant per mobile; a newer release may overwrite an expired grant.
- `release:{releaseId}` hash → `{type, status, expires_at, quota_total, quota_claimed}`.
- `release_grants:{releaseId}` set → members, for revocation sweeps.
- Quota claim is atomic (INCR with cap check; Lua or WATCH/MULTI) — a race cannot oversell slots.
- Replay-safe: `released.v1` dedup on `release_id` (`SET NX` marker); claims idempotent on `(release_id, mobile)`.

### Gate endpoints and enforcement

- `GET /gate/status` → `{ mode: "off" | "quota_open" | "invite_only" }` — tells the frontend whether mobile-entry (State 1) or capacity (State 3) leads.
- `POST /gate/otp/initiate` `{mobile}` / `POST /gate/otp/verify` `{code}` — thin wrappers over the existing `otp_service` (existing TTL/attempt/rate limits, per-destination hashed keys). Verify runs the decision **in order**: (1) existing customer — mobile blind-index lookup via the identity attribute store (migration `0006_identity_blind_index`) → bypass, reapplication block unchanged; (2) active grant → enter; (3) open quota with slots → claim (mint grant, decrement, emit `grant_claimed.v1`) → enter; (4) → capacity result. Success stamps the session hash (`gate_passed`, `gate_mobile`, `release_id`).
- **Enforcement**: `POST /chat/init` — when gating is effective (flag AND mode `gated`) and the session lacks `gate_passed` → return a gate-required status (no agents start). The WS `s=true` welcome branch double-checks, mirroring `blocked_stop_message`. The Svelte pages are presentation only.
- The mid-flow OTP step is **skipped** when the gate already verified the same mobile for this session; if the applicant later gives a different mobile in-chat, normal OTP verification runs for it.

### Frontend (App.svelte + new components)

Three states, one fixed card structure (icon / title / body / action zone), Billie 2026 brand tokens:

1. **Gate** — "Let's get you started", mobile input leading. Shown to cold visitors when `mode = quota_open`.
2. **Code entry** — mirrors the existing OTP card contract (masked destination, expiry, resend, attempts remaining).
3. **At capacity** — "We're at capacity right now", coral CTA to the billie.loans waitlist, secondary "enter your mobile" path (invited people and returning customers are never stranded). Shown first when `mode = invite_only`; also the post-verify rejection state with body swapped to "your number isn't on this release yet".

Nobody is put through an OTP just to be refused unless they chose to check their number. New full-page components render before the chat shell mounts (placement per the session-expired banner precedent).

## 7. Security, privacy, and edge cases

- **No pre-OTP disclosure**: grant status is only revealed after possession of the phone is proven; the gate cannot be used to probe which numbers are invited. OTP rate limits (5 initiations/hour, 3/destination/day) cap enumeration; `/gate/*` also sits behind the existing per-IP limits.
- **Revocation** stops new entries; in-flight conversations continue.
- **Expiry** is lazy — evaluated at the gate from `expires_at`; the CRM projection derives `expired` status from `expiresAt`. No scheduled sweeper.
- **Grant store privacy**: holds E.164 mobiles and release ids only — no names, no marketing attributes. Postgres shadow rows are deleted 90 days after grant expiry/revocation (hygiene job alongside the existing projection maintenance).
- **Failure posture**: if the release event can't be published, the CRM route returns 503 `EVENT_PUBLISH_FAILED` (write-off pattern) and the failed-action queue offers replay. If billieChat's grant store is unreachable at gate time, the gate **fails closed** to the capacity page (flag off = fails open to today's behaviour).
- **Known v1 limitations**: platform-derived `derivedStage` does not learn "released" (contacts stay `waitlist` until they actually apply — teach the platform later if wanted); align the TS `normaliseAuMobile()` with the Python variant's bare-`4XXXXXXXX` acceptance as part of this work.

## 8. Testing

- **billieChat (pytest)**: gate decision matrix (bypass / grant / quota / deny × expiry / revocation), quota race under concurrency (fakeredis), release/revoke handler idempotency and replay, OTP wrapper limits, gated `/chat/init` + WS backstop, dual-write parity.
- **billie-crm (vitest)**: preflight partition logic (all six buckets), release POST publishes both streams with correct payload + idempotency, revoke, zod schemas, hooks' lag-tolerant invalidation. **Python (pytest)**: handler tests mirroring `test_marketing_handlers.py` for all four events.
- **e2e (Playwright)**: Releases UI happy path — create waitlist release → preflight → confirm → detail counts update.

## 9. Rollout

1. Ship both repos dark: `ENABLE_APPLICATION_GATE` off in prod. Today's open door is preserved exactly.
2. Rehearse in demo: flag on, then `gate_cli on` / `off`, each release type, SMS, gate entry, quota exhaustion, revocation, CRM counts and mode banner.
3. Prod: enable the flag (deploy) with mode still `open` — zero behaviour change. During a low-traffic window, run `gate_cli on` with an open-quota release active so walk-ups are never hard-blocked on day one.
4. Steady state: `gate_cli off` returns to the open door instantly (this is the "fully rolled out" end state). The flag, service, and collections stay in place permanently — they carry the `closed` kill switch, which must remain flippable without a deploy.

## 10. Post-release follow-ups (Aug 2026)

Two small additions shipped after the initial release, closing gaps noticed in review:

**`release_grants.customerId` back-fill (join key: verified mobile).** A walk-up applicant claims a grant (`release_grants`, keyed on OTP-verified `mobile_e164`) before they exist as a `customers` row — the two projections are populated by unrelated event streams (`applicant_release.*` vs `customer.*`) with no shared id at claim time. `release_grants` gains a nullable, indexed `customerId` column, plus an index on `mobile_e164` itself to serve the back-fill's own lookup predicate (migration `20260804_051712_applicant_release_customer_link`). The event processor's `handlers/customer.py` calls a new `link_customer_to_grants(pool, customer_id, raw_mobile)` after every `customer.changed/created/updated` upsert: normalises the customer's mobile via the existing `normalise_au_mobile` (lifted from `handlers/clicksend.py`, no cycle — `customer.py` imports it directly) and runs `UPDATE release_grants SET customer_id = $1 WHERE mobile_e164 = $2 AND customer_id IS NULL`. Idempotent (guarded on `customer_id IS NULL`) and replay-safe; deliberately **not** restricted to active/unexpired releases — a late link is still correct attribution. Falls back to the customer's already-persisted mobile when a partial update event doesn't re-carry it, so an address-only update doesn't skip a back-fill the customer already qualifies for. The Releases UI's grant Contact cell now falls back contactId → customerId (linking to `/admin/servicing/{customerId}`) → `—`. **Honesty note**: the back-fill is first-customer-event-wins on a shared or reassigned mobile and is a best-effort UI convenience, not authoritative attribution — unlike a marketing `contactId` link (correctable via the platform's `LinkContact`/`UnlinkContact`), a grant's `customerId` has no correction path short of a direct DB edit, which is acceptable given its purely display-only purpose in the Releases UI.

**Quota-claim contact capture (unconsented).** Previously an anonymous open-quota claim (`applicant_release.grant_claimed.v1`, wire `source: "quota"`) left no marketing-contact trace unless the claimant separately signed up. `handle_applicant_release_grant_claimed` now issues a best-effort `MarketingService.UpsertContact` for quota claims only (never for targeted claims) via a new `marketing_client.upsert_contact` convenience, mirroring the CRM's waitlist intake route (`src/app/api/intake/waitlist/route.ts`) field-for-field: `idempotency_key: "gate-claim:{release_id}:{mobile_e164}"`, `mobile`, `source: "other"`, and provenance in `utm_json` (`UpsertContactRequest` has no separate `attributes_json` — that field only exists on `UpdateContactRequest`) as `{"intake_channel": "gate_quota_claim", "release_id": ...}`. **Policy A: no consent is ever set** — proving phone possession via OTP is not marketing opt-in, so the request's `ConsentCapture` is left unset entirely. If the response carries a `contactId`, the grant row's `contact_id` is updated (only where still `NULL`). Strictly best-effort: any gRPC failure is logged and swallowed, never failing or DLQ'ing the claim projection. Guarded against re-firing on replay with a cheap `SELECT contact_id` precheck before the call (skipped once already linked), backstopped by the gRPC `idempotency_key` as the real dedupe.
