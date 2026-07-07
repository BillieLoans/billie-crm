# Marketing CRM + Customer Lifecycle — Design Spec

**Date:** 2026-07-02
**Status:** Approved direction (design dialogue with Rohan, 2026-07-02); ready for per-phase implementation planning
**Inputs:**
- *Billie CRM in Payload — Build Brief* (2026-07-02) — functional requirements for the marketing CRM module
- *Billie Customer State Model v1.0* (PO-approved 2026-06-11) — governed person-state vocabulary (Axes A/B/C + L)
**Repos affected:** `billie-platform-services` (primary new build), `billie-crm` (intake gateway, command surface, projection UI), `billieChat` (broker routing config only), `billie-event-sdks` (new `marketing` package), billiewebsite (referral link resolution — flagged, owned elsewhere)

---

## 1. Goal and governing idea

Build the marketing CRM (contacts, interactions, feedback, referrals, consent) and wire the customer lifecycle end-to-end so that every person Billie touches has **one identity spine** with **federated data facets**, and the person's lifecycle state is a **governed, event-derived projection** owned by the platform.

The state model document dissolves the "contact vs customer" dichotomy: a contact and a customer are the **same person at different states**, and states never move backward (D5). A repaid customer who signs up to a campaign two years later is not a new contact — they are the same person at `A4 · B– · C-P · ¬L` with a refreshed marketing-consent attribute.

### Ownership map

| Concern | System of record | Consumers |
|---|---|---|
| Person identity spine (`customer_id` + `merged_into`) | platform `customerService` (exists) | everyone |
| Person state A × B\* × C × L | platform `customerService` — **new state-projection module** | billieChat treatments, marketingService, CRM |
| Lending facet (KYC, accounts, ledger) | platform (exists) | CRM servicing views |
| **Marketing facet** (Contact, Interactions, Consent, Referrals, Batches, Feedback) | platform — **new `marketingService`** | CRM marketing views, notificationService |
| Lending recognition / re-application | billieChat (exists; incl. `feat/reapplication-block-recognition`) | unchanged |
| Outbound sends (all channels, incl. marketing) | platform `notificationService` + dispatcher | marketingService triggers; CRM projects outcomes |

**Invariants:**
- The contact→customer link is **one-way** (contact carries `customer_id`; nothing marketing-side ever writes into `customer.*`). A wrong marketing match can misattribute a referral; it can never affect a lending decision.
- The `marketing.contact` schema **never holds financial fields** — the privacy wall is structural, not ACL-based.
- Lending recognition (billieChat resolver, recognition evidence) remains a separate, higher-evidence process; the marketing link is not an input to it.
- Retention regimes stay separable: the marketing facet is erasable (APP 11 / DSR); the lending facet keeps AML/CTF 7-year retention.

### Lifecycle arc

```
                    ┌──────────────  PERSON (identity spine)  ──────────────┐
                    │   platform customer_id + merged_into (canonical)      │
                    └────────────────────────────────────────────────────────┘
   MARKETING FACET (marketingService)              LENDING FACET (platform)
   Contact record                                  Customer record + accounts

1. Waitlist signup ──► Contact created (A2 "Known contact")     [no lending record yet]
      intake upserts on mobile/email; consent + source recorded

2. Starts application ──► billieChat journey ──► customer.changed.v1
      marketingService matcher ──► contact.linked.v1 (one-way, reversible)

3. OTP / IDV / decision / acceptance / funding
      state projection: A3→A4, B0→B1→B3→B4, L=true   (D6: customer at B3)
      customer.state.changed.v1 ──► contact stage mirror "Customer" (no $ detail)

4. Final repayment ──► account.closed.v1 (PAID_OFF) ──► C-P, L=false
      contact mirror: "Former customer" ──► advocacy / win-back segment

5a. Returns via marketing ──► intake dedupe finds existing Contact ──► same record,
      new Interaction + consent refresh. No new identity created anywhere.
5b. Returns straight to chat ──► existing recognition layer collapses M1 ──►
      same canonical customer ──► re-application rules read C-N/aging as today
```

---

## 2. `marketingService` (new, billie-platform-services)

A new bounded-context service, sibling to `customerService`, registered in `src/main.py` multiprocessing alongside the existing six. It follows the platform's **strict event-first** pattern (per `customerService/event_handlers.py`): command handlers create and publish domain events and write **no state**; a self-consume consumer group derives all state from the service's own event stream.

### 2.1 Write path

```
gRPC command (UpsertContact / SetConsent / LogInteraction / …)
  1. check idempotency response cache (accountingLedgerService pattern) → replay if hit
  2. validate command (reads the marketing.* projection, e.g. current consent state)
  3. construct domain event (contact.observed.v1, …)
  4. XADD → marketingService:events:contacts        (internal self-consume stream)
     + publish → chatLedger                          (broker fan-out: CRM, notifications)
  5. cache response, return {contact_id, event_id}   ← NO state written here

self-consume group "marketingService-projection-writers"
  6. consume own event → idempotency key check → upsert marketing.* projection (Postgres)
```

**Dedupe under eventual consistency:** two near-simultaneous signups for one mobile can both pass validation before either projection write lands. This is benign by construction: the projection writer upserts on the normalised natural key (E.164 mobile, then lowercased email), so the second `contact.observed.v1` folds into the same contact as an update. Convergence at the projection layer, not lock-based prevention.

### 2.2 Entities (Postgres schema `marketing.*`, Alembic-migrated)

| Table | Contents |
|---|---|
| `marketing.contact` | contact_id (UUID); asserted identity: first_name, email (lowercased), mobile_e164, city, postcode; source (meta/google/campus/referral/social_dm/ai_search/organic/other) + UTM fields; platforms (multi: uber/uber_eats/doordash/didi/airtasker/milkrun/amazon_flex); channel_preference (whatsapp/sms); referral_code (unique, minted at creation); referred_by_contact_id; waitlist_joined_at + waitlist_position (computed); batch_id; panel_member; incentive fields (offered/value/redeemed_date); `customer_id` (canonical link, nullable) + link_basis; lifecycle mirror: derived_stage, loan_status_minimal, state tuple snapshot; consent snapshot (current, per channel); `attributes` jsonb (low-stakes campaign fields — the schema-churn escape valve); erased flag; last_event_id |
| `marketing.interaction` | interaction_id, contact_id, occurred_at, kind (signup/message_out/message_in/feedback_prompt/referral/stage_change/note/import), channel, direction, body/subject, source_system, metadata jsonb |
| `marketing.feedback` | feedback_id, contact_id, type, severity, text, product_area, status |
| `marketing.batch` | batch_id, name, created_at, invited_at, criteria snapshot |

**No financial fields, ever.** The loan-status mirror is the enum `approved | disbursed | repaid` only.

### 2.3 Domain events (new SDK package `packages/marketing` → `billie_marketing_events`)

```
contact.observed.v1            intake/import first sighting (carries consent capture, source, UTM)
contact.updated.v1             staff/intake change to asserted fields (actor in envelope)
contact.linked.v1              contact ↔ canonical customer_id (match_basis: mobile|email, confidence)
contact.unlinked.v1            reversal (data fix)
contact.consent.granted.v1     purpose, channels, method, evidence
contact.consent.withdrawn.v1
contact.interaction.logged.v1
contact.stage.changed.v1       derived Billie-stage transitions (§4)
contact.erased.v1              DSR tombstone (ids only, no PI)
referral.attributed.v1         referrer ← referee, code
batch.created.v1
contact.batch.assigned.v1
feedback.received.v1
feedback.status.changed.v1
```

Envelope, naming (`{domain}.{entity}.{action}.v{n}`), Pydantic models, and stream parser follow the existing SDK package conventions; version bumps via the established `bump-event-sdk` flow.

### 2.4 gRPC API (`proto/marketing.proto`, next port per platform convention)

| RPC | Notes |
|---|---|
| `UpsertContact` | idempotent: dedupe on normalised mobile → email; client idempotency key; returns contact_id + event_id + created/updated flag |
| `UpdateContact` | staff edits to asserted fields |
| `SetConsent` | grant/withdraw per channel, method + evidence required |
| `LogInteraction` | manual notes, inbound replies (from webhooks) |
| `SubmitFeedback` | |
| `CreateBatch` / `AssignBatch` | AssignBatch takes contact_id list (from a filtered CRM segment) |
| `TriggerBatchInvitations` | emits dispatch commands to notificationService for each consented member |
| `EraseContact` | DSR erasure (§7) |

Auth: internal network (Fly private networking), same posture as the accounting-ledger gRPC.

### 2.5 Consumed events (via `inbox:marketing`, new broker routes)

| Event | Action |
|---|---|
| `customer.changed.v1` | run marketing matcher: exact E.164 mobile → auto-link; exact email with no mobile conflict → auto-link; ambiguous → no link, flag for CRM review → `contact.linked.v1` |
| `customer.identity.linked.v1` / `merged.v1` | re-point links to canonical (follow `merged_into`) |
| `customer.state.changed.v1` | update lifecycle mirror + derived stage → `contact.stage.changed.v1` |
| `notification.sent.v1` / `notification.delivery_failed.v1` (reason=marketing) | log `contact.interaction.logged.v1` — outbound timeline is event-native, no logging endpoint |

---

## 3. Customer state projection (new module in `customerService`)

> **Open at sign-off (A4, discuss):** this added workstream — the governed Customer State Model driving stage and loan status — is under discussion; scope and sequencing may change. Per §10, it can slip to phase 3 without blocking the rest of phase 2.

Implements the governed A × B\* × C × L tuple as a derived projection — platform-owned, exactly per the state model's D14 (C and L are projections over agreement records) and R4 (events move states; treatments read states).

Persists `customer.customer_state` (canonical_id, `a_level`, `b_star`, `c_history`, `live`, current_application_ref, cause_event_id, updated_at); emits **`customer.state.changed.v1`** (added to the `customers` SDK package) carrying the full tuple + cause.

| Axis | Driven by | Notes |
|---|---|---|
| A (sticky, rises only) | `customer.changed.v1` → A2; OTP signal → A3; `customer.verified.v1` / IDV result → A4 | **Gap (flagged decision):** no explicit OTP-pass event exists today. Either billieChat emits one (preferred; small addition) or A3 is inferred from fields on `customer.changed.v1`. Resolve during phase-2 planning with the billieChat owner. |
| B\* (per-application, mortal) | `applicationDetail_changed` → B0; `final_credit_decision` → B1/B2; `loan_agreement_accepted` → B3; `account.disbursed.v1` → B4 then concludes to B– (L carries on) | **Bx (exit)**: no abandonment event exists; a platform-side timeout sweep marks applications inactive for N days as Bx (N configurable, default 30). Terminal stages (B2, Bx) never persist as B\* (per D9a). |
| C (sticky) + L | `account.created.v1`/`account.disbursed.v1` → L=true; `account.closed.v1` closure_reason: `PAID_OFF` → C-P; `WRITTEN_OFF` → C-N (dominant, sticky); `ADMIN_CLOSED` → **C-P by default (win-back-eligible), surfaced for review** | **Changed at sign-off (B2, 7 Jul 2026):** admin closures must not default to negative — C-N would silently drop genuine former customers out of the win-back segment. Settled-short accounts are the exception, not the rule; they get C-N properly at source once the accounts SDK gains a `SETTLED_SHORT` closure reason (phase 3). Until then, every `ADMIN_CLOSED` mapping raises a review metric/flag so credit can reclassify individual accounts. |

**Testing gift from the state model:** the projection ships with a property test asserting it can only ever emit tuples inside the 28 feasible cells (invariants I1–I5 from §5A of the model), and a metric/alert when a ◉ control-failure cell (concurrent applicant, returning non-performed applicant, etc.) is observed — those cells are representable by design and their observation is a control signal.

---

## 4. Lifecycle mirror: the brief's "Billie stage", derived

The stage on a contact is **derived, never hand-edited** — computed by marketingService from marketing attributes + the consumed state tuple. Rules are an **ordered precedence list; first match wins** (so a returning customer mid-application shows Applicant, not Former customer — marketing must not message into an open application):

| Precedence | Derived stage | Rule |
|---|---|---|
| 1 | Customer | L = true, or B\* = B3 — per D6, customer begins at acceptance, not funding |
| 2 | Applicant | B\* ∈ {B0, B1} |
| 3 | Former customer | C ≠ C0 (∧ ¬L, implied by precedence) |
| 4 | Invited | assigned to a batch whose invitations were triggered |
| 5 | Waitlist | `waitlist_joined_at` set |
| 6 | Lead | contact observed |

**Advocate is a flag overlay, not a stage** (per D16: type tests are attributes): `advocate = true` when ≥1 attributed referral reached Customer. The CRM grid can still filter/present it as a pseudo-stage.

> **Open at sign-off (A2, discuss):** whether staff get a manual stage override or an "Other / needs review" stage, so we're never locked out of reclassifying as new situations emerge. Derivation-only stands until that discussion lands; if an override is approved it will be an explicit, audited command (an attribute overlay the derivation respects), never a hand-edit of the derived field. Note the general `attributes` field already absorbs unexpected campaign data — the gap is specifically stage correction.

Loan-status mirror (minimal, per brief §3): `approved` (B1) / `disbursed` (B4 or L) / `repaid` (C-P ∧ ¬L). No amounts — structurally impossible (§2.2).

Return arc has no special cases: a former customer re-signing hits intake → dedupe finds the existing contact → interaction + consent refresh on the same record; stage stays Former customer, making win-back a segment, not a re-onboarding.

---

## 5. billie-crm changes

The CRM masters nothing new: **intake gateway, command surface, projection UI.**

### 5.1 Projections (read-only Payload collections, written by the Python event processor)

New collections following the `Customers` projection pattern (`create/update/delete: () => false`, fields readOnly, `hideFromNonAdmins`): `contacts`, `interactions`, `feedback`, `batches`, `contact-audit-log` (append-only projection of updated/consent/linked/erased events: who, what, when — satisfies the brief's audit requirement). Referrals are contact self-relationships + interactions; no separate collection (allowed by brief §2).

Event processor: new `handlers/marketing.py` using the `db.py` upsert helpers; parse routing adds `contact.` / `referral.` / `batch.` / `feedback.` prefixes → `billie_marketing_events` parser. Payload migration for the new tables (via the established throwaway-Docker-Postgres recipe), `pnpm generate:types` + `generate:importmap`.

### 5.2 Roles and the privacy wall

- Add `marketing` to `VALID_ROLES` (`src/lib/access.ts`).
- **`hasAnyRole` does not change** — every existing lending projection stays walled with zero modifications.
- New helper `canMarketing` (admin | marketing) gates marketing collections, command routes, and the nav link. Supervisor/operations get read access to marketing projections (`canReadMarketing` = canMarketing | supervisor | operations | readonly — final matrix at implementation).
- Every marketing command carries the staff user in the event envelope (`usr`) → audit projection.

### 5.3 API routes

```
Public/partner (API-key + HMAC, rate-limited, zod-validated):
  POST /api/intake/waitlist        → gRPC UpsertContact; on gRPC failure, XADD the
                                     command to inbox:marketing (same Redis) — the
                                     "never lose a signup" fallback; both paths idempotent
                                     (idempotency key = client-supplied or hash(mobile, form_ts))
  POST /api/intake/feedback        → gRPC SubmitFeedback (same fallback pattern)
  POST /api/webhooks/clicksend     → signature-verified inbound replies → LogInteraction
  POST /api/webhooks/whatsapp      → (phase 3, with the WhatsApp provider)

Staff (requireAuth(canMarketing); write-off command pattern: command → poll projection):
  POST  /api/marketing/contacts                    create (gRPC UpsertContact)
  PATCH /api/marketing/contacts/[id]               update asserted fields
  POST  /api/marketing/contacts/[id]/consent       SetConsent
  POST  /api/marketing/contacts/[id]/interactions  LogInteraction (manual note)
  POST  /api/marketing/batches                     CreateBatch
  POST  /api/marketing/batches/[id]/assign         AssignBatch (from filtered segment)
  POST  /api/marketing/batches/[id]/invite         TriggerBatchInvitations
  POST  /api/marketing/contacts/[id]/erase         EraseContact (admin-only)
  GET   /api/marketing/contacts/[id]/export        DSR subject-access export (JSON)

Dashboard/exports:
  GET /api/marketing/dashboard-feed                read-only counts for Looker Studio
                                                   (by stage, source, referral rate, funnel;
                                                   service API key)
  contacts/interactions CSV added to the existing export-jobs pattern
```

### 5.4 Admin UI (custom views, servicing-view pattern; nav link gated by role)

```
/marketing — Contact grid                      /marketing/contacts/:id — Contact detail
┌───────────────────────────────────────┐     ┌─────────────────────────────────────────┐
│ 🔍 search   [Stage ▾][Source ▾][City ▾]│     │ Jess M · 04xx xxx xxx · jess@…          │
│            [Platform ▾][Panel ▾][Batch▾]│     │ [WAITLIST #142] [✓ consent SMS] [⛓ cust]│
│ ┌───────────────────────────────────┐ │     ├──────────────────────┬──────────────────┤
│ │ Name    Stage     Source   Batch  │ │     │ TIMELINE             │ Referrals        │
│ │ Jess M  Waitlist  Referral  —     │ │     │ ● 02/07 signed up    │  ↳ referred by Sam│
│ │ Sam K   Customer  Campus    B2    │ │     │ ● 02/07 welcome SMS  │  ↳ referred: 2   │
│ │ …                                 │ │     │ ● 03/07 reply "…"    │ Consent history  │
│ └───────────────────────────────────┘ │     │ ● 04/07 stage→Invited│  ✓ granted (form)│
│ [Assign to batch] [Export CSV]        │     │ (reverse-chron, all  │ Feedback (1)     │
└───────────────────────────────────────┘     │  interaction kinds)  │ Loan: disbursed  │
                                              └──────────────────────┴──────────────────┘
```

Timeline reuses the `ContactNotesTimeline` pattern; grid reuses the monitoring-grid + React Query patterns; commands use the existing optimistic-update/poll stores. A small "possible matches for review" panel surfaces ambiguous link candidates (§2.5). Fixed-layout rule applies: every element keeps its position across states regardless of data presence.

---

## 6. Messaging — platform notificationService from day one (no interim)

There is **no Apps Script integration, ever.** Apps Script keeps running standalone (off its Sheet, exactly as today) until cutover, then retires. Rationale: an interim send-permission/message-log integration would create throwaway endpoints and a dual-consent-enforcement window — the worst failure mode available.

- **marketingService is the campaign brain**: batch invites, welcome-on-signup, nurture schedules → emits notification dispatch commands (reason `marketing`, addressed by `contact_id`). It never talks to providers.
- **notificationService/dispatcher is the only send path**, enforcing marketing consent, suppression, rate limits, quiet hours, compliance gates — all of which already exist.
- **Pipeline work required** (all permanent): `NotificationReason.MARKETING` + a policy keyed to Spam Act consent (a different legal basis than servicing sends); contact-addressable dispatch (recipient keyed by `contact_id` with optional `customer_id` — the model already carries raw email/mobile); marketing Jinja2 templates (welcome, nurture, invite, feedback prompt); dispatcher read model consumes `contact.consent.*` events (the `marketing_opt_in` field already exists).
- **Outbound timeline logging is event-native**: marketingService consumes `notification.sent.v1`/`delivery_failed.v1` → `contact.interaction.logged.v1`.
- **Cutover**: SMS/email first (ClickSend/Resend exist). At cutover, a **one-off backfill imports the Apps Script send log into interactions**, so timelines are complete without live coupling. Pre-cutover sends not appearing live on timelines is accepted (status quo, not a regression).
- **WhatsApp** is the only genuinely new provider work (Meta Cloud API client + delivery webhooks) — scheduled phase 3. **Flagged product-priority call:** if marketing insists WhatsApp-first for nurture, the client moves ahead of cutover.

---

## 7. DSR and erasure (event-sourced erasure, designed in from day one)

`EraseContact` (admin-only) →
1. `XDEL` the contact's PI-bearing entries from `marketingService:events:contacts` (Redis streams support targeted entry deletion) — rebuild-from-stream stays honest: erased contacts deliberately rebuild as tombstones;
2. null PI in `marketing.*` rows (keep ids + erased flag), redact interaction bodies;
3. emit `contact.erased.v1` (ids only) → CRM processor redacts projections.

If linked to a customer, only the marketing facet is erased; lending retention (AML/CTF 7-year) is untouched — the two-facet payoff.

**Operational requirement (explicit):** chatLedger and inbox stream copies of marketing events are covered by stream `MAXLEN` trimming with retention ≤ the privacy policy's period; Postgres projections + the (redactable) internal stream are the only durable stores. Subject-access view: the DSR export route (§5.3).

---

## 8. Referral engine

- `referral_code` (short unique base32) minted at contact creation **in phase 1** (so imports get codes even though attribution ships in phase 2).
- Link `billie.loans/r/{code}` → website resolves → waitlist form carries `ref` → intake → marketingService resolves referrer → `referral.attributed.v1` → waitlist position recomputed.
- Position algorithm: rank by points = waitlist age + (configurable boost × attributed referrals). Constant lives in marketingService config.
- Attribution surfaces on both contacts' timelines and the referrer's referred-list.
- **Flagged (owned outside these repos):** the website route that resolves `/r/{code}` and passes `ref` into the form — confirm with the web owner.

---

## 9. Import and backfill

- **Phase 1:** one-off script — current waitlist Sheet CSV → gRPC `UpsertContact` loop (idempotent, re-runnable), source preserved, consent method recorded as `waitlist_form_imported`, signup interaction logged with original timestamp.
- **Phase 2 cutover:** Apps Script send-log backfill → `LogInteraction` loop (§6).

---

## 10. Build phases

Each phase is independently shippable and gets its own implementation plan.

**Phase 1 — Contacts land (fast-follow):**
`marketing` SDK package; `marketingService` core (Contact/Interaction/Consent aggregates, event-first write path, gRPC: UpsertContact/UpdateContact/SetConsent/LogInteraction, plus EraseContact in basic form — projection redaction + tombstone event; the stream XDEL sweep and subject-access export complete it in phase 3); broker routes (billieChat `routes.json`); Alembic migration for `marketing.*`; CRM: intake routes (waitlist + fallback publish), projections + processor handlers + Payload migration, `marketing` role, marketing view (grid + contact timeline); contact↔customer **linking** (needs only existing `customer.changed.v1` + identity events); referral codes minted; Sheet import. No outbound sends — Apps Script continues untouched.

**Phase 2 — Lifecycle + sends through the platform:**
Customer-state projection in customerService + `customer.state.changed.v1` + lifecycle mirror/derived stage (resolve the OTP-event decision with billieChat owner); notificationService marketing capability (reason, contact addressing, templates, consent-event consumption); batches + invite flow through the pipeline (SMS/email); welcome/nurture; referral attribution + waitlist positions; feedback intake + queue; ClickSend inbound webhook; dashboard feed; **cutover + Apps Script send-log backfill; Apps Script retires.**
*Note: the state projection and the notification work are independent streams — run in parallel if team capacity allows; otherwise state projection may slip to phase 3 without blocking anything else in phase 2.*

**Phase 3 — Harden and complete:**
WhatsApp provider client + webhook; DSR tooling complete (erase incl. XDEL sweep + subject-access export); one-click CSV exports; audit hardening review; backup restore test for `marketing.*`; `SETTLED_SHORT` SDK addition so settled-short closures map to C-N at source (`ADMIN_CLOSED` itself stays win-back-eligible per the B2 sign-off change, §3).

---

## 11. Testing strategy

| Layer | What |
|---|---|
| marketingService unit (pytest) | matching rules (mobile/email normalisation, ambiguity), stage derivation table (§4), idempotency (command cache + projection-writer keys), erasure redaction |
| State projection property tests | only the 28 feasible cells are emittable (invariants I1–I5); stickiness (A never falls, C-N dominates); ◉ cell observation raises the control metric |
| Service integration | Postgres testcontainer per platform conventions; event-first round-trip (command → self-consume → projection) |
| Contract | proto-driven gRPC; SDK parser round-trips per package conventions |
| CRM (vitest) | intake route validation/auth/idempotency + fallback publish; access matrix (marketing role sees no lending collection; lending roles unchanged); processor handler upserts |
| E2E (Playwright) | marketing grid filter → contact detail timeline happy path |

## 12. Observability & non-functional mapping (brief §7)

- **Intake must never silently fail** → SLI: intake success rate (gRPC-or-fallback), alert on fallback-path activation; idempotency keys logged; DLQ + replay per existing processor patterns.
- Correlation: `conv`/`event_id`/`cause` envelope discipline throughout; link rate and state-event lag as service metrics.
- Security: role wall (§5.2), API-key+HMAC on public intake, internal-network gRPC, PI encrypted at rest per existing Neon/Fly posture.
- Backups: `marketing.*` joins the existing platform Postgres backup regime; restore test in phase 3.
- Deliverability: consent, suppression, rate limits, quiet hours enforced in the single send pipeline (§6).

## 13. Flagged decisions (owners, defaults)

| # | Decision | Default in this spec | Owner to confirm | Status (sign-off, 7 Jul 2026) |
|---|---|---|---|---|
| 1 | OTP-pass event from billieChat vs A3 inference | billieChat emits explicit event | billieChat owner, phase-2 planning | open — awareness item (Part C), billieChat owner to confirm |
| 2 | WhatsApp before or after cutover | after (phase 3), SMS-first cutover | marketing/product | in discussion (B1) — default stands until resolved |
| 3 | Referral URL resolution on website | `/r/{code}` redirect → form `ref` param | web owner | open — awareness item (Part C), web owner to confirm |
| 4 | `ADMIN_CLOSED` mapping | ~~conservative C-N~~ → **C-P (win-back-eligible) + review flag** | product/credit, phase 3 | **changed (B2)** — incorporated in §3; `SETTLED_SHORT` at source remains phase 3 |
| 5 | Bx timeout window | 30 days inactivity | product | **approved as default (B3)** |
| 6 | Manual stage override / "Other — needs review" stage | none — stage strictly derived (§4) | product + design | in discussion (A2) |
| 7 | Customer State Model + state-projection workstream | new module in customerService (§3) | product/platform | in discussion (A4) |

## 14. Sign-off record (7 July 2026)

Design sign-off sheet reviewed against the build brief; decisions returned by Nichola Patterson:

| Item | Outcome |
|---|---|
| A1 — marketingService masters the data; Payload is read-only view + command screens | **Approved** |
| A2 — stage derived, never hand-edited (override / "needs review" stage proposed) | **Discuss** — recorded in §4 and decision #6; derivation-only stands meanwhile |
| A3 — no Apps Script integration; all sends via platform notificationService; cutover + backfill | **Approved** |
| A4 — Customer State Model + state-projection workstream | **Discuss** — recorded in §3 and decision #7 |
| B1 — WhatsApp after cutover (phase 3) | **Discuss** — decision #2; default stands until resolved |
| B2 — admin-closed loans treated as written-off/negative | **Changed** — now C-P (win-back-eligible) + review flag; §3, decision #4 |
| B3 — abandoned application dead after 30 days | **Approved as default** — decision #5 |
