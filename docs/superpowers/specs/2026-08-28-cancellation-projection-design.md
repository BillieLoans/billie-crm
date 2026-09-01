# Cancellation & offer-expiry projection into the CRM

**Date:** 2026-08-28
**Status:** Design — approved decisions recorded, implementation not started
**Repos:** `billieChat` (routing + expiry timer), `billie-crm` (schema, projection, UI)

## Problem

A customer who declines a credit offer leaves no trace in the CRM. The
conversation keeps reading `Approved` in the monitoring grid forever.

Investigation on 28 Aug 2026 (conversation `2cf3919d-a94e-4995-bd02-1865b9d755a4`,
application `C6F7C8E6-77F`) traced this to billieChat's routing table, not to the
CRM event processor.

`dispatch_cancel_application` (`backend/backend/src/services/chat/dispatcher.py:194`)
publishes a `customer_cancelled` event with sender `agt=chatbot`. `routes.json`
resolves targets by `(sender, typ)` with no default rule, and carries a
`customer_cancelled` rule only for sender `contract`. `router.resolve()` therefore
returned `[]`, and the event was dropped after being written to `chatLedger`.

Two further gaps sit behind that one:

1. **No cancellation event of any kind routes to `billie-crm`.** Even the rules that
   do match (`customer_cancelled` and `offer_cancelled` from `contract`) target
   `applicationState` only. Fixing the missing `chatbot` rule alone would repair
   billieChat's own application state but still leave the CRM blind.
2. **The CRM event processor has no handler** for `customer_cancelled` or
   `offer_cancelled`. `Processor._process_message` ACKs and discards events with no
   registered handler, so opening the routes before the handler ships would silently
   burn the events.

### Blast radius

Every customer-confirmed decline path runs through the same dispatcher, so all four
of its reasons are affected, as are the three `offer_cancelled` reasons. The retained
`chatLedger` (28 Jun 2026 → now) holds 11 cancellation events, none of which reached
the CRM:

| Date | Application | Event | Reason |
|---|---|---|---|
| 2026-06-29 | 3EB1C8D9-EF9 | `offer_cancelled` | `session_timeout` |
| 2026-06-29 | 24206B4A-61F | `offer_cancelled` | `session_timeout` |
| 2026-07-12 | 2101C867-822 | `offer_cancelled` | `session_timeout` |
| 2026-07-28 | 85895FE4-FEB | `offer_cancelled` | `session_timeout` |
| 2026-08-04 | 4B9067DC-FF3 | `offer_cancelled` | `session_timeout` |
| 2026-08-05 | 8DDC8F2E-2B4 | `offer_cancelled` | `session_timeout` |
| 2026-08-12 | 9F60D9BC-A84 | `offer_cancelled` | `session_timeout` |
| 2026-08-17 | 5064E6C1-738 | `offer_cancelled` | `session_timeout` |
| 2026-08-17 | 73E21E42-EF7 | `offer_cancelled` | `session_timeout` |
| 2026-08-28 | C6F7C8E6-77F | `customer_cancelled` | `final_offer_declined` |
| 2026-08-28 | C6F7C8E6-77F | `offer_cancelled` | `session_timeout` |

Conversation `6003b8d0` (73E21E42-EF7) expired on 17 Aug and still reads `approved`
in prod today, confirming the expiry path is equally blind.

### The stale-timeout hazard

The last two rows are the same application. The customer declined at 01:37; an offer
expiry fired for the same application at 02:36. `dispatch_cancel_application` never
removes the application from `OFFER_EXPIRY_SORTED_SET` — only
`_handle_cancel_offer_command` calls `_remove_offer_expiry`. A naive last-write-wins
projection would overwrite the customer's explicit decline with a system timeout an
hour later.

This is the same class of hazard as `aging-scheduler-downgrades-closed` (BTB-286) and
the two-consumer ordering problem: a later, less-informative event clobbering an
earlier, more-informative one.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Add `cancelled` and `expired` to `conversations.status`; leave `decisionStatus` untouched | The credit decision is a lending record — a customer walking away must not restate Billie's approval as a decline. The grid gets a truthful lifecycle state; approval-rate reporting stays correct. |
| D2 | Two statuses, split by who ended it | Ops treat "the customer said no" and "they drifted away" differently. Splitting at the status level makes that filterable in the grid rather than buried in a JSON field. |
| D3 | Backfill all 11 retained cancellation events | ~10 conversations currently misreport. The events are still in `chatLedger`, so the repair is a replay rather than hand-written SQL. |
| D4 | Guard in the CRM projection *and* fix the billieChat timer | The guard protects against every out-of-order redelivery, not just this one; the timer fix stops the phantom event being emitted at all. |
| D5 | Model terminal states as a precedence ladder rather than a pairwise guard | Conversation-kill (live in prod since 25 Aug) writes a third terminal status. A ladder handles every arrival order between kill, decline and expiry without a new special case per pair. |
| D6 | Split the kill reason `compliance` into `compliance` + `customer_request`, and project `customer_request` as `cancelled` | The existing label is literally "Compliance / customer request" — one option doing two jobs. Without the split, a customer who phones to cancel is recorded as `hard_end` while one who clicks DECLINE is `cancelled`, and decline reporting undercounts the phone path. |

### Reason → status mapping

| Event | Reason | Category | `status` |
|---|---|---|---|
| `customer_cancelled` | `attestation_declined` | `customer_declined` | `cancelled` |
| `customer_cancelled` | `preliminary_approval_cancelled` | `customer_declined` | `cancelled` |
| `customer_cancelled` | `statement_consent_declined` | `customer_declined` | `cancelled` |
| `customer_cancelled` | `final_offer_declined` | `customer_declined` | `cancelled` |
| `offer_cancelled` | `browser_close` | `abandoned` | `expired` |
| `offer_cancelled` | `session_timeout` | `system_expired` | `expired` |
| `offer_cancelled` | `cutover_exhausted` | `system_expired` | `expired` |
| `conversation.killed.v1` | `customer_request` | `customer_declined` | `cancelled` |
| `conversation.killed.v1` | `fraud_abuse`, `operational`, `compliance` | — (kill record only) | `hard_end` |

Unknown reasons fall back on the event type: `customer_cancelled` →
`customer_declined`/`cancelled`, `offer_cancelled` → `system_expired`/`expired`,
`conversation.killed.v1` → `hard_end`. The raw reason is always preserved verbatim in
the record, so a new upstream reason degrades to a sensible status rather than being
dropped.

`statement_consent_declined` (customer refused to connect their bank) is distinct
from the existing `statement_consent_cancelled` event (the Basiq flow aborted) and
must not be merged with it.

## Interaction with conversation kill

Conversation-kill shipped on 25 Aug 2026 and the fraud auto-stop is **enforcing in
prod, not shadow**. Two conversations have already been killed by it (`0283068c` /
6A2ACCDF-A9E and `8bd3d09f` / 9B5EF537-356, both `hard_end` with
`kill_record.actor = system:fraudRiskAgent`). Both were killed before any credit
decision, so neither had a live offer — which is the only reason the defect below has
not yet fired.

### The regression this design would otherwise introduce

The kill pipeline never cancels the offer. `_handle_conversation_kill`
(`application_state_service.py:978`) closes the client session, writes
`data::conversation` → closed on the noticeboard, posts the stop message and emits
`conversation.killed.v1`. It never touches `OFFER_EXPIRY_SORTED_SET` and never marks
the `LoanExecutionPlan` cancelled. It cannot easily do either:
`conversation.kill.requested.v1` routes only to `applicationState` and
`reapplicationBlock`, so `contractAgent` — which owns that sorted set — never learns a
kill happened.

For a conversation killed *after* an offer exists, the expiry poller therefore still
fires and publishes `offer_cancelled(session_timeout)`. Today that event is dropped
before the CRM and is harmless. Once these routes open it is delivered, and a handler
keyed only on `cancellation_record` would find that column empty (a kill writes
`kill_record`) and **overwrite `hard_end` with `expired`** — silently masking a fraud
stop in the monitoring grid roughly one offer-window later. That is strictly worse
than today's "nothing shows up".

The fraud agent scores every `user_input` and `assistant_response`, including the
post-approval turns where the customer chooses ACCEPT or DECLINE, so this is
reachable — that is exactly when a live offer sits in the expiry set.

### Terminal-state precedence

Terminal statuses are ranked. A write lands only if it is at least as strong as what
is already recorded:

| Rank | Status | Meaning |
|---|---|---|
| 3 | `hard_end` | Killed — operator or fraud agent ended it |
| 2 | `cancelled` | The customer said no (in chat, or by request to an operator) |
| 1 | `expired` | System expiry or abandonment — the weakest, "nothing happened" |
| 0 | everything else | `active`, `paused`, `soft_end`, `approved`, `declined` |

Rules:

- Incoming rank **greater than** the stored rank → write.
- Incoming rank **equal** to the stored rank → write only if no record of that kind
  exists yet, so the *first* reason at a given strength is the one kept.
- Otherwise → skip, logging the rejection.

This subsumes the earlier pairwise "customer decline beats system expiry" rule and
handles every ordering without further special cases: a late `session_timeout` cannot
mask a kill or a decline; a kill arriving after either still wins; redelivery of
anything is idempotent.

### Stopping the phantom at source

Alongside the guard, `conversation.kill.requested.v1` gains `${agent_contract}` as a
target (from both the `fraudRisk` and `billie-crm` senders) and `ContractAgent` clears
the expiry timer on it, exactly as it will for `customer_cancelled`. The guard and the
timer fix are complementary: the timer fix stops the event being emitted, the guard
protects against orderings the timer fix cannot reach.

### Customer-requested cancellation

`reason_category: compliance` is labelled "Compliance / customer request" — one option
doing two jobs. It splits:

- `compliance` — relabelled to just "Compliance". Projects `hard_end` as today.
- `customer_request` — new, labelled "Customer request". Projects **`cancelled`** with
  a cancellation record (`category: customer_declined`, `reason: customer_request`,
  `source_event: conversation.killed.v1`) *in addition to* the kill record, so the
  phone path counts in decline reporting and shows the cancellation banner.

billieChat needs no change for this: `_handle_conversation_kill` passes
`reason_category` through opaquely into `conversation.killed.v1`.

**Blocking must stay off this path.** `reapplicationBlock._handle_conversation_kill`
raises a `MANUAL_ADMIN` block purely on the `block_requested` boolean (behind
`ENABLE_MANUAL_KILL_BLOCK`) — it never inspects `reason_category`. A customer asking
to cancel must never be blocked from reapplying, so the CRM forces
`blockRequested: false` for `customer_request` in the UI and rejects the combination
server-side.

### Deliberately not added: a server-side status gate on the kill route

`ENDABLE_STATUSES` is enforced only in the React component; the command route has no
status check, so a kill is API-reachable on an already-approved or already-terminal
conversation. This was considered and rejected: the precedence ladder already makes
such a kill safe, and a status gate would block the legitimate post-approval fraud
kill that motivated this section.

## Design

### billieChat — routing

Three changes to `backend/backend/src/routing/routes.json`:

1. New rule under `${agent_chatbot}` for `${msg_type_customer_cancelled}` targeting
   `${service_applicationState}`, `${agent_billie-crm}`, `${agent_contract}`.
2. `${agent_contract}`'s existing `${msg_type_customer_cancelled}` rule gains
   `${agent_billie-crm}`.
3. `${agent_contract}`'s existing `${msg_type_offer_cancelled}` rule gains
   `${agent_billie-crm}`.
4. `${agent_fraudRisk}`'s and `${agent_billie-crm}`'s existing
   `${msg_type_conversation_kill_requested}` rules each gain `${agent_contract}`.

`${agent_contract}` is a target of rules 1 and 4 so the contract agent can clear its
own expiry timer (below) — the sorted set belongs to that agent, so neither the chat
dispatcher nor applicationState should reach into it directly.

Pinned by a routing test in the style of `tests/unit/routing/test_session_start_block_routes.py`.

### billieChat — stale expiry timer

`ContractAgent` gains two branches in its message dispatch, alongside the existing
`msg_type_offer_cancelled` and `cmd_type_cancel_offer` ones — for
`msg_type_customer_cancelled` and `msg_type_conversation_kill_requested` — both
calling a shared helper that resolves the application number and calls
`_remove_offer_expiry`. A declined or killed application then leaves the sorted set
immediately and no phantom `session_timeout` is emitted an hour later.

This keeps ownership of `OFFER_EXPIRY_SORTED_SET` inside `ContractAgent` and needs no
new cross-module imports in the chat dispatcher or applicationState.

### billie-crm — schema

A single migration:

```sql
ALTER TYPE "public"."enum_conversations_status" ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE "public"."enum_conversations_status" ADD VALUE IF NOT EXISTS 'expired';
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "cancellation_record" jsonb;
```

`ALTER TYPE ... ADD VALUE` inside a Payload migration transaction is already proven in
this repo (`20260804_060425_gate_mode_closed.ts`,
`20260714_053341_word_of_mouth_source.ts`). The constraint it carries is that the new
value cannot be *used* in the same transaction — this migration only defines it, so
that is satisfied. Migrations must use `idType: 'uuid'`.

`Conversations.ts` gains the two status options and a `cancellationRecord` JSON field,
following the `killRecord` precedent exactly (`readOnly`, descriptive `admin.description`).

Record shape:

```json
{
  "reason": "final_offer_declined",
  "category": "customer_declined",
  "cancelled_at": "2026-08-28T01:37:30.993832+00:00",
  "source_event": "customer_cancelled",
  "application_number": "C6F7C8E6-77F"
}
```

### billie-crm — projection

`customer_cancelled` and `offer_cancelled` fall through `Processor._parse_event`'s
final `else` branch to `sanitize_envelope`, so handlers receive a plain dict with the
payload already parsed — the same path as `final_credit_decision`. No SDK work.

One shared implementation in `handlers/conversation.py` behind two registered
handlers, parametrised by source event. It:

1. Maps reason → (category, status).
2. Writes `status` and `cancellation_record` under the terminal-state guard.
3. Sets `applications.application_outcome = 'withdrawn'` when an application number is
   present. This applies to both statuses — an expired offer is as much "the customer
   did not take the loan" as an explicit decline, and `withdrawn` is the only
   non-decision outcome the existing enum offers. That value already exists in the
   schema and is currently never written by any handler.

**Terminal-state guard.** A shared `terminal_rank()` helper implements the precedence
ladder above, and every terminal write goes through it: the two cancellation handlers
and `handle_conversation_killed` alike. An explicit customer decline therefore always
beats a system expiry regardless of arrival order, a kill beats both, and nothing can
be silently downgraded. Combined with the timer fixes this is belt-and-braces: the
phantom events should stop being emitted, and if one still arrives it cannot do
damage.

**`handle_final_decision` guard.** That handler currently overwrites `status`
unconditionally. A redelivered `final_credit_decision` would reset a cancelled
conversation to `approved` and reintroduce the exact bug. It must skip the `status`
write when a `cancellation_record` exists, while still applying `final_decision` and
`decision_status` (those are decision facts and safe to re-apply).

### billie-crm — UI

The status map is wider than it looks; a new value must be added in every one of
these or it silently degrades:

| Location | Change |
|---|---|
| `src/collections/Conversations.ts:70` | two new `options` entries |
| `src/lib/schemas/conversations.ts` | `CONVERSATION_STATUSES` + new `CancellationRecordSchema` attached to the detail schema |
| `src/payload-types.ts` | regenerate (`pnpm generate:types`) |
| `src/components/ApplicationsView/StatusBadge/index.tsx:10` | `STATUS_CONFIG` entries + CSS classes in `styles.module.css` |
| `src/components/ApplicationsView/FilterBar/index.tsx:66` | two new `<option>`s in the status select |
| `src/app/(frontend)/customer/[customerId]/page.tsx:105` | second, independent colour map |
| `src/app/api/conversations/[conversationId]/route.ts:164` | return `cancellationRecord` |
| `src/lib/events/schemas.ts:149` | `ConversationKillCommandSchema.reasonCategory` enum gains `customer_request` |
| `src/app/api/commands/conversation-kill/route.ts` | reject `blockRequested: true` with `customer_request` |
| `src/components/ConversationDetailView/EndConversation/index.tsx:19` | `REASON_OPTIONS` gains "Customer request", `compliance` relabelled to "Compliance"; block checkbox forced off for the new category |

A `CancellationBanner` in `ConversationDetailView`, mounted next to `KillBanner` and
built on the same pattern: a fixed one-line summary opening a `ContextDrawer` with
label/value rows. Per the `fixed-layout-over-adaptive` preference, the banner slot
keeps its position whether or not a record exists.

`ENDABLE_STATUSES` is `['active', 'paused']`, so the new terminal statuses are
already correctly excluded from the manual end-conversation action — no change, but
worth a regression test.

`docs/ux-standards.md` is the conformance floor for the UI work.

### Backfill

A script that reads the retained `chatLedger`, filters the 11 cancellation events,
and re-`XADD`s them to `inbox:billie-servicing` in ledger order. Replayed events get
fresh stream IDs, so the processor's `dedup:{stream}:{message_id}` key does not
suppress them; idempotency comes from the handler's guard and upserts.

The script must be re-runnable without compounding: running it twice must leave the
same rows, which the guard already ensures.

## Sequencing

Order is load-bearing. The processor ACKs and discards events it has no handler for,
so opening the routes first would permanently burn any cancellation that occurred in
the window.

1. **billie-crm** — migration, collection, handlers, UI. Deploy. Handlers sit idle.
2. **billieChat** — routes + timer fix. Deploy. New cancellations flow through.
3. **Backfill** — replay the 11 retained events. Verify.

## Testing

- **billieChat:** routing test asserting all three rules resolve to the expected
  inboxes (mirroring `test_session_start_block_routes.py`); a contract-agent test that
  `customer_cancelled` removes the application from the expiry sorted set.
- **billie-crm (Python):** reason→status mapping for all seven reasons plus the
  unknown-reason fallback for each event type; the guard in both arrival orders
  (decline-then-timeout and timeout-then-decline); `handle_final_decision` not
  clobbering a cancelled status; `applications.application_outcome` set.
- **billie-crm (vitest):** `StatusBadge` renders both new statuses rather than falling
  through to the raw-string branch; `FilterBar` offers them; `CancellationBanner`
  renders and stays absent without a record; `ENDABLE_STATUSES` regression. UI tests
  must mock `@payloadcms/ui`.

## Risks

| Risk | Mitigation |
|---|---|
| Routes opened before the handler ships → events ACKed and lost | Strict deploy order; step 1 before step 2 |
| `ALTER TYPE` in a transaction | Proven precedent in this repo; the migration defines the value without using it |
| Stale `session_timeout` overwriting a decline | Precedence ladder plus the upstream timer fix |
| Stale `session_timeout` masking a fraud kill as `expired` | Precedence ladder (`expired` < `hard_end`) plus routing the kill request to `contractAgent` to clear the timer |
| `customer_request` cancellation accidentally raising a reapplication block | `blockRequested` forced false in the UI and rejected server-side for that category |
| Redelivered `final_credit_decision` resetting status | Explicit guard in `handle_final_decision` |
| New status falls through a missed UI map | The table above enumerates all seven touch points; `ended` is an existing example of a half-registered value |
| billieChat work disturbing in-progress branch | `feat/btb-304-income-frame` is checked out with uncommitted changes — do the billieChat work in a worktree off `main` |

## Out of scope

- The pre-existing `ended` phantom status (present in the UI filter and schema, absent
  from the DB enum). Noted, not fixed here.
- Surfacing `applications.applicationOutcome` in a custom view — it remains
  visible only in the raw Payload admin list.
- Any change to how `decisionStatus` or `finalDecision` are computed.
