# Marketing Phase 2 (Stream A) — Owner Handoffs

Companion to `docs/superpowers/plans/2026-07-02-marketing-crm-phase2-sends.md`.
Part B (billie-crm) of the sends stream is **built**: B1–B6 across PRs
#42/#43/#44/#45 (merged) and #46 (B6 UI, open — awaiting human visual QA). Two
items remain that are **not** billie-crm code work; this doc hands them off.

---

## Status snapshot

| Task | PR | State |
|---|---|---|
| B5 projection layer | #42 | merged |
| B2/B3/B4 backend + timing-side-channel fix | #43 | merged |
| B6 data layer + contact-detail panels | #44 | merged |
| B1 ClickSend inbound (webhook + processor) | #45 | merged |
| B6 UI (grid Assign-to-batch + feedback queue) | #46 | open — needs visual QA |

Remaining after the above: the platform feedback-command handler (§1), the B1
deploy config (§2), and the Stream-A cutover tail (Apps Script send-log backfill,
spec §9) whenever Apps Script is retired.

---

## 1. Platform task — `feedback.submit.requested.v1` inbox handler (billie-platform-services)

**Why:** billie-crm's public feedback intake (`POST /api/intake/feedback`, PR #43)
is gRPC-primary (`SubmitFeedback`) with a durable chatLedger fallback. On gRPC
failure it publishes a `feedback.submit.requested.v1` **command** to chatLedger.
billieChat's broker already routes it to `inbox:marketing`
(`backend/backend/src/routing/routes.json:216`, under `${agent_billie-crm}`), **but
marketingService's inbox consumer does not handle that typ** — the fallback command
is silently dropped (falls to the "ignoring inbox event type" debug log). The gRPC
primary path works; only the durable fallback is dead until this lands. This is the
one open gap in the sends stream.

**Do (in `src/services/marketingService/marketingService.py`):** add an inbox-dispatch
branch for `feedback.submit.requested.v1` → a new `_handle_feedback_command`, mirroring
the existing `_handle_intake_command` in the same file:

- Idempotency fence in Redis (e.g. `marketingService:feedback-intake:{idempotency_key}`),
  checked before and set only **after** a successful emit (so a failed emit re-delivers).
- Mint `feedback_id` (uuid) behind the fence, then reuse the **same** feedback-creation
  logic as the gRPC `SubmitFeedback` servicer (`grpc_servicer.py`, `SubmitFeedback`,
  ~line 536) — factor it into a shared helper if cleanest — to emit `feedback.received.v1`.
- Add config key `msg_type_feedback_submit_requested` (default
  `"feedback.submit.requested.v1"`) to `config.*.json`, matching how
  `msg_type_contact_intake_requested` is wired.

**Command payload contract** (from the CRM's `FeedbackSubmitCommandPayload` — do not
rename): `idempotency_key`, `contact_id`, `customer_id` (nullable), `type`,
`severity` (nullable), `text`, `product_area` (nullable), `actor`. It does **not**
include `feedback_id` (marketingService mints it, like the gRPC path).

**Test/CI:** unit-test like the intake-command tests (fence dedup + emit + payload
mapping). CI gates on `black --check` + `flake8` — run both before pushing. The
broker route already exists, so **no billieChat change** is needed.

---

## 2. B1 (ClickSend inbound SMS) deploy checklist

**Deploy order:** marketingService reachable → event-processor → CRM webhook →
configure ClickSend rule.

**① Event-processor image (billie-crm event-processor)**
- [ ] Rebuild/redeploy — `requirements.txt` now adds `grpcio==1.76.0` + `protobuf==6.33.0`
      (its first gRPC deps; vendored stubs are committed, no build-time codegen).
- [ ] Set **`MARKETING_GRPC_ADDRESS`** (`billie-platform-services.internal:50054` on
      Fly 6PN; `localhost:50054` local).
- [ ] Confirm the processor can make outbound gRPC to marketingService :50054.

**② CRM app (billie-crm)**
- [ ] Set **`CLICKSEND_WEBHOOK_SECRET`** to a strong random value. *(Fail-closed: until
      set, the webhook 401s everything — safe, but inbound won't flow.)*
- [ ] Deploy so `/api/webhooks/clicksend` is live.

**③ ClickSend dashboard — inbound SMS rule**
- [ ] Point the rule's webhook URL at
      `https://<crm-host>/api/webhooks/clicksend?secret=<CLICKSEND_WEBHOOK_SECRET>`
      (secret in query — ClickSend rules only configure a URL). Method: POST (default
      form-urlencoded works; JSON is also handled). If ClickSend supports a custom
      header on the rule, prefer `x-webhook-secret` to keep the secret out of access logs.

**④ End-to-end verify**
- [ ] Reply (or use ClickSend's *Create Test Inbound SMS*) from a mobile that matches an
      existing contact's `mobileE164` → webhook 200 → event on
      `inbox:billie-servicing:internal` → processor resolves the contact + calls
      `LogInteraction` → the reply shows on the contact timeline (`message_in`).
- [ ] Send from an **unknown** mobile → confirm logged-and-skipped (no phantom contact,
      no error).

**Safety:** webhook is fail-closed (no secret → 401); the processor's new gRPC path
only fires on `clicksend.inbound.received.v1`, and errors go to the existing DLQ/retry
without affecting other handlers. Rotate the URL secret periodically since it rides in
the query string.
