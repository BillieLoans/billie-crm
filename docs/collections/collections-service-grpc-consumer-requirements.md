# `collectionsService` gRPC — CRM consumer requirements

| Field | Value |
| --- | --- |
| Status | ADOPTED — provider authored `billie-platform-services/proto/collections_service.proto` from this note; the CRM vendors a copy at `proto/collections_service.proto`. Economics methods (`GetCaseEconomics`/`ListCaseEconomics` + the `AdvanceToNextStep` gate) are **Phase 2**, blocked on BTB-194. See `collections-crm-build-scope.md`. |
| Consumer | billie-crm (Stream D, Collections CRM module) |
| Provider | `collectionsService` (headless collections engine, BTB-166) |
| Related | BTB-69; BTB-166; "Collections CRM — Front-End Requirements & Event-Routing Spec"; "Solution Design — Collections Policy Alignment" |
| Date | 2026-06-24 |

## Purpose

The CRM's per-case view and operator actions need two classes of method from the
collections engine that **are not available from any existing source**:

1. **Operator-action commands** that move a case's state. Post-BTB-166 these live on
   `collectionsService` (the operator gRPC was repointed to `inbox:collectionsService`),
   so the CRM must call the engine — not `notificationDispatcherService`.
2. **Engine-owned reads** — the cost-of-recovery gate, expected net recovery, cost
   ledger, next-step preview, and the authoritative contact log. These are computed
   inside the engine and are not on the `collection.case.*` events or in the ledger.

This note is the **consumer's requirements**. The provider owns the canonical
`collections_service.proto`; the CRM vendors a copy (same convention as
`proto/accounting_ledger.proto` and `proto/notification_dispatcher.proto`) and builds a
TS client against it. The proto sketches below are an illustrative strawman, not the
final contract.

## Boundary — what the CRM does NOT need from this endpoint

To keep the contract minimal, these stay on their current owners and must **not** be
duplicated here:

- **Aging / DPD / bucket / gross / ECL allowance / net carrying / live balance** →
  `AccountingLedgerService` (`GetAccountAging`, `GetCarryingAmountBreakdown`,
  `GetECLAllowance`, `GetBalance`) — already wired in the CRM.
- **Operational case state / rung / flags / lifecycle timestamps** → the CRM's own
  `CollectionsCase` projection, built from the `collection.case.*` event stream. The
  CRM owns this read model; no query RPC is required for it.
- **Generic per-customer suppression CRUD** → `NotificationDispatcherService`
  (`Get/Set/Clear/ListSuppression`) — already wired. (See note on stop-contact below.)
- **Legal track** (remedy notice / letter of demand / court / Form 21A / enforcement)
  → out of scope (Stream D non-goal).

---

## 1. Commands (operator actions)

All commands:

- Take an `operator_id` (the CRM staff user id) for the audit/contact log.
- Accept an `idempotency_key` (the CRM generates one per action, as it does for ledger
  writes) so retries are de-duplicated.
- Return a `CaseActionResponse { account_id, new_state, emitted_event_id }` so the CRM
  can drive its existing optimistic-mutation + idempotency UI pattern and trace the
  emitted `collection.case.*` event.
- Are expected to **emit the corresponding `collection.case.*` event to ChatLedger** as
  the engine does today, so the CRM's own projection converges without a second code path.

| RPC | Inputs | State transition / effect | Emits |
| --- | --- | --- | --- |
| `FlagHardship` | `account_id`, `operator_id`, `reason`, `idempotency_key` (engine resolves `customer_id`) | `active → paused_hardship` (retain step pointer) | `collection.case.hardship_paused.v1` |
| `ResumeFromHardship` | `account_id`, `operator_id`, `idempotency_key` | `paused_hardship → active` (explicit hand-back; no auto-resume by policy) | `collection.case.resumed.v1` |
| `ApplyStopContact` | `account_id`, `operator_id`, `reason?`, `idempotency_key` | `* → stopped_contact` (suppress all automated sends) | `collection.case.stop_contact_applied.v1` |
| `AdvanceToNextStep` | `account_id`, `operator_id`, `idempotency_key` | Gated escalation + human consent-to-send: advance the rung and command notification to send the next step. **Only valid when the next-step gate passes.** | next-step send (and any rung/state event the engine already emits) |

### Command semantics the CRM relies on

- **`AdvanceToNextStep` is the human gate.** Per policy, routine reminders (rungs 0–2)
  auto-send within the cadence cap; every escalation/escalated artefact is human-decided.
  The CRM flow is: read `GetCaseEconomics` → show `next_step_preview` + `gate_result`
  → operator confirms → `AdvanceToNextStep`. If the gate does **not** pass, the engine
  should reject with `FAILED_PRECONDITION` and a human-readable reason (the CRM disables
  the button from `gate_result`, but the server must enforce it too).
- **Stop-contact is a collections command, not raw suppression.** `ApplyStopContact`
  should both apply the suppression *and* emit the domain event. The CRM will call this
  engine RPC for collections stop-contact, and reserve `NotificationDispatcherService.SetSuppression`
  for generic, non-collections suppression.
- **Preconditions / errors** the CRM will surface to the operator:
  - `FlagHardship` on an already-paused case → idempotent success (no-op) or `FAILED_PRECONDITION`.
  - `ResumeFromHardship` on a case that is not `paused_hardship` → `FAILED_PRECONDITION`.
  - `AdvanceToNextStep` on a terminal/`exhausted`/`cured`/`stopped_contact` case → `FAILED_PRECONDITION`.
  - Unknown `account_id` → `NOT_FOUND`.
  Please return a stable error reason string the CRM can show verbatim.

---

## 2. Reads (engine-owned economics + contact log)

These power the per-case "amount owed vs cost of recovery" panel (§3.2 of the front-end
spec) and the contact-history / cadence-cap display.

| RPC | Returns |
| --- | --- |
| `GetCaseEconomics(account_id)` | `amount_owed` (frozen **A**), `cost_of_next_step`, `expected_net_recovery`, `gate_result` (status + reason), `cost_ledger[]` (production + hard cost entries, each with a `recoverable` flag), `next_step_preview` (rung, channel, template, rendered subject/body the customer will see) |
| `GetContactLog(account_id)` | immutable contact history (the Playbook §E2 log, sourced from `collections.send_log`) + `contact_cap_status` (`sent_7d`/`cap_7d` e.g. 2/3, `sent_month`/`cap_month` e.g. 6/10) |

Notes:

- **`amount_owed` is the frozen A** the engine asserts at case open (principal +
  original fee − payments, no default-interest/fee/collection-fee fields). The CRM shows
  this alongside the *live* ledger balance — they are intentionally different numbers.
- **`gate_result`** drives both the economics panel and whether `AdvanceToNextStep` is
  offered. Suggest `{ status: PASS | FAIL | NOT_APPLICABLE, reason: string }`.
- For a `cured` / `closed` case, `gate_result = NOT_APPLICABLE` and `next_step_preview`
  may be empty — please define rather than erroring.
- **Money fields are decimal strings** (matching the ledger gRPC convention used
  throughout the CRM). **Timestamps are `google.protobuf.Timestamp`** (matching the
  dispatcher proto).

---

## 3. Open questions for the provider

1. **Worklist sort by expected net recovery (front-end spec §3.1).** `GetCaseEconomics`
   is per-account, but the queue must sort by `expected_net_recovery` across many cases.
   We need one of:
   - a batch `ListCaseEconomics(account_ids[])` the CRM calls for the loaded page, or
   - a queue-level economics query, or
   - acceptance that the sort runs only over the page the CRM has hydrated.
   Provider's call — it changes the contract. The CRM's preference is a **batch
   `ListCaseEconomics`** so the sort can cover a full filtered page.
2. **Arrangement / park ownership.** "Record arrangement" (promise-to-pay / payment
   plan) and "park" both affect cadence, so they may warrant engine commands
   (`RecordArrangement`, `Park`) — or they may be expressible as hardship/stop-contact +
   a CRM note. Plain payments already go to the ledger (`RecordRepayment`) and write-off
   rides the existing CRM event path, so those two are **not** engine RPCs. Please
   confirm whether arrangement/park are engine-owned.
3. **`customer_id` on commands.** BTB-166 already has the engine resolving `customer_id`
   from the accounts read-client for the operator events. We assume the CRM does **not**
   need to pass it on commands — confirm.

---

## 4. Strawman proto (illustrative — provider owns the canonical version)

```protobuf
syntax = "proto3";
package billie.collections.v1;

import "google/protobuf/timestamp.proto";

service CollectionsService {
  // — commands —
  rpc FlagHardship(FlagHardshipRequest)      returns (CaseActionResponse);
  rpc ResumeFromHardship(ResumeRequest)      returns (CaseActionResponse);
  rpc ApplyStopContact(StopContactRequest)   returns (CaseActionResponse);
  rpc AdvanceToNextStep(AdvanceRequest)      returns (CaseActionResponse);

  // — reads —
  rpc GetCaseEconomics(CaseRef)              returns (CaseEconomics);
  rpc GetContactLog(CaseRef)                 returns (ContactLog);

  // — open (see §3.1) —
  // rpc ListCaseEconomics(CaseRefs)         returns (CaseEconomicsList);
}

message CaseRef { string account_id = 1; }

message FlagHardshipRequest {
  string account_id = 1;
  string operator_id = 2;
  string reason = 3;
  string idempotency_key = 4;
}
message ResumeRequest      { string account_id = 1; string operator_id = 2; string idempotency_key = 3; }
message StopContactRequest { string account_id = 1; string operator_id = 2; string reason = 3; string idempotency_key = 4; }
message AdvanceRequest     { string account_id = 1; string operator_id = 2; string idempotency_key = 3; }

message CaseActionResponse {
  string account_id = 1;
  string new_state = 2;          // e.g. "paused_hardship"
  string emitted_event_id = 3;   // the collection.case.* event_id, for trace/dedup
}

enum GateStatus { GATE_UNSPECIFIED = 0; PASS = 1; FAIL = 2; NOT_APPLICABLE = 3; }
message GateResult { GateStatus status = 1; string reason = 2; }

message CostLedgerEntry {
  string label = 1;
  string amount = 2;             // decimal string
  string category = 3;           // "production" | "hard"
  bool recoverable = 4;
}

message NextStepPreview {
  int32 rung = 1;
  string channel = 2;            // "sms" | "email"
  string template = 3;
  string subject = 4;
  string body = 5;               // rendered, what the customer will see
}

message CaseEconomics {
  string account_id = 1;
  string amount_owed = 2;            // frozen A (decimal string)
  string cost_of_next_step = 3;
  string expected_net_recovery = 4;
  GateResult gate_result = 5;
  repeated CostLedgerEntry cost_ledger = 6;
  NextStepPreview next_step_preview = 7;
}

message ContactCapStatus {
  int32 sent_7d = 1;  int32 cap_7d = 2;     // e.g. 2 / 3
  int32 sent_month = 3; int32 cap_month = 4; // e.g. 6 / 10
}
message ContactLogEntry {
  google.protobuf.Timestamp sent_at = 1;
  string channel = 2;
  string template = 3;
  string outcome = 4;            // sent | failed | skipped (+ reason)
}
message ContactLog {
  string account_id = 1;
  repeated ContactLogEntry entries = 2;
  ContactCapStatus contact_cap_status = 3;
}
```

---

## Summary

**4 commands** — `FlagHardship`, `ResumeFromHardship`, `ApplyStopContact`,
`AdvanceToNextStep` — and **2 reads** — `GetCaseEconomics`, `GetContactLog` — plus a
provider decision on a **batch economics** RPC for the worklist sort and on
**arrangement/park** ownership. Everything else the per-case view needs comes from the
ledger gRPC or the CRM's own event-sourced projection and must not be duplicated here.
