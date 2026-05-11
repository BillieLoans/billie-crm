  Notification events — CRM integration spec

  Overview

  The CRM consumes platform notification events for its contact-history feed and (optionally) controls a per-customer notification kill switch. There is no HTTP or gRPC API — everything is event-driven over Redis Streams. The CRM:

  1. Reads notification events from its own dedicated Redis stream (inbox:billie-servicing), populated by the platform's chatLedger router.
  2. Writes kill-switch commands by publishing one event type onto the dispatcher's inbox (inbox:notificationDispatcher).

  ---
  1. Read events from inbox:billie-servicing (same as other events you already consume)
  There is an updated sdk for these events that has been published to git. The details are in the requirements.txt file:
  git+https://${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@notifications-v1.1.0#subdirectory=packages/notifications
 

  1b. Decoding events

  Every entry has the same envelope (chatLedger format):

  ┌─────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  Field  │                                                   Meaning                                                   │
  ├─────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ typ     │ event type — filter on this (notification.sent.v1, notification.delivery_failed.v1, statement.generated.v1) │
  ├─────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ payload │ JSON string — json.loads() it                                                                               │
  ├─────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ usr     │ customer_id (or "system" for ops sends) — also in payload                                                   │
  ├─────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ agt     │ publishing service name (notificationDispatcher or notificationService)                                     │
  ├─────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ conv    │ internal source-stream event ID (audit / debugging)                                                         │
  ├─────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ cause   │ optional correlation_id                                                                                     │
  └─────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  async def handle(event_id: bytes, fields: dict, r):
      typ = fields[b"typ"].decode()
      payload = json.loads(fields[b"payload"])

      # Idempotency — at-least-once delivery, dedup on event_id
      if await r.set(f"billieCrm:processed:{event_id.decode()}", "1", nx=True, ex=86400) is None:
          await r.xack(INBOX, GROUP, event_id)
          return

      if typ == "notification.sent.v1":
          await record_sent(payload)
      elif typ == "notification.delivery_failed.v1":
          await record_failed(payload)
      elif typ == "statement.generated.v1":
          await record_statement(payload)

      await r.xack(INBOX, GROUP, event_id)

  1c. Event payloads

  notification.sent.v1

  {
    "notification_id":      "ntn_3f4a8b2c1d5e6f7a",
    "idempotency_key":      "predue:acc_123:1:0",
    "request_id":           "req_<uuid>",
    "channel":              "email",                  // "email" | "sms"
    "template_name":        "pre_due_email_first",
    "template_content_hash":"a4f3c21…",               // sha256 of the .j2 file at send time
    "template_git_sha":     "9b1d4e7…",               // git SHA last touching the file (may be null)
    "sent_at":              "2026-05-11T03:14:09Z",
    "provider":             "resend",                 // "resend" | "clicksend" | "dryrun"
    "provider_message_id":  "abc123@resend.com",
    "recipient_hash":       "<sha256 hex>",           // SHA-256 of recipient — PII safe
    "customer_id":          "cust_abc",               // null for ops/system sends
    "correlation_id":       "corr_xyz",
    "tags": {
      "category": "servicing",                        // "servicing" | "marketing" | "auth"
      "reason":   "pre_due",                          // "pre_due" | "overdue" | "statement" | …
      "step":     0
    }
  }

  notification.delivery_failed.v1

  {
    // …same envelope as sent.v1 (incl. template_content_hash + template_git_sha)…
    "failed_at":            "2026-05-11T03:14:09Z",
    "error_type":           "permanent",              // see table below
    "error_message":        "human-readable detail",
    "attempt":              3,
    "fallback_suggested":   "sms"                     // null unless error_type="contact_missing"
  }

  error_type values:

  ┌─────────────────┬──────────────────────────────────────────────────┬────────────────────────────────────────────┐
  │   error_type    │                     Meaning                      │              CRM display hint              │
  ├─────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────┤
  │ transient       │ Retry exhausted (3 attempts)                     │ "Send failed — temporary error"            │
  ├─────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────┤
  │ permanent       │ Bad recipient / 4xx from provider                │ "Send failed — recipient invalid"          │
  ├─────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────┤
  │ auth            │ Provider credentials rotated                     │ "Send failed — system error" (alert ops)   │
  ├─────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────┤
  │ template        │ Template render bug                              │ "Send failed — template error" (alert eng) │
  ├─────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────┤
  │ contact_missing │ No email/phone for this customer                 │ "Send failed — no contact details"         │
  ├─────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────┤
  │ opt_out         │ Marketing send blocked by marketing_opt_in=false │ "Suppressed — marketing opt-out"           │
  ├─────────────────┼──────────────────────────────────────────────────┼────────────────────────────────────────────┤
  │ suppressed      │ Per-customer kill switch active                  │ "Blocked — notifications suppressed"       │
  └─────────────────┴──────────────────────────────────────────────────┴────────────────────────────────────────────┘

  statement.generated.v1

  {
    "account_id":      "acc_123",
    "customer_id":     "cust_abc",
    "period_start":    "2026-04-01",
    "period_end":      "2026-04-30",
    "notification_id": "ntn_…",      // links to the matching sent.v1
    "dispatched_at":   "2026-05-01T06:00:09Z",
    "correlation_id":  "corr_…"
  }

  1d. Notification "type" lookup

  Display label = tags.reason + tags.step. Map template_name to a friendly description:

  ┌───────────────────────────────────┬─────────┬──────────────────────────────────────────┐
  │             Template              │ Channel │              Friendly label              │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ pre_due_email_first               │ email   │ First pre-due reminder                   │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ pre_due_email_first_fallback_sms  │ sms     │ First pre-due reminder (SMS fallback)    │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ pre_due_sms_second                │ sms     │ Second pre-due reminder                  │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ pre_due_sms_second_fallback_email │ email   │ Second pre-due reminder (email fallback) │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ overdue_email_v1                  │ email   │ Overdue notice — step 1                  │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ overdue_sms_v1                    │ sms     │ Overdue notice — step 2                  │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ overdue_email_v2                  │ email   │ Overdue notice — step 3                  │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ overdue_sms_v2                    │ sms     │ Overdue notice — step 4                  │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ overdue_email_final               │ email   │ Final notice (legally important)         │
  ├───────────────────────────────────┼─────────┼──────────────────────────────────────────┤
  │ statement_monthly_email           │ email   │ Monthly statement                        │
  └───────────────────────────────────┴─────────┴──────────────────────────────────────────┘

  1e. Mapping recipient back to a contact

  The recipient_hash is sha256(lower(email_or_phone)) — full PII never leaves the dispatcher. To attribute a send to a specific contact channel:

  1. Look up the customer by customer_id in the CRM's own contact data.
  2. To verify which channel was used, hash the candidate value and compare:

  import hashlib
  def hash_recipient(value: str) -> str:
      return hashlib.sha256(value.lower().encode()).hexdigest()

  1f. Idempotency

  The CRM may receive the same event twice (at-least-once delivery). Two stable keys to dedup on:
  - notification_id — unique per send (best key for activity-feed entries)
  - idempotency_key — stable across replays of the same logical send (predue:acc_123:1:0, overdue:acc_123:2026-05-04:1, statement:acc_123:2026-05)

  ---
  2. Writing the kill switch: publish to chatLedger stream. Update routes.json in billieCRM project so that the message is forwarded to inbox:notificationDispatcher
  
  The CRM publishes one event type to toggle per-customer notification suppression. There is no permission/auth layer — the CRM is trusted on the same Redis instance.
  Use existing libraries to publish ledger event if you have it. Ensure you don't specify a "rec" value

  2a. Wire format

  Stream: chatLedger (Redis XADD)


  Fields:

  ┌─────────┬───────────────────────────────────────┐
  │  Field  │                 Value                 │
  ├─────────┼───────────────────────────────────────┤
  │ typ     │ "notification.suppression.changed.v1" │
  ├─────────┼───────────────────────────────────────┤
  │ payload │ JSON-serialised payload (see below)   │
  └─────────┴───────────────────────────────────────┘

  2b. Payload schema

  {
    "customer_id":  "cust_abc",                    // required
    "mode":         "non_essential",               // required — see modes table
    "reason":       "Hardship plan #4521",         // free-text audit string
    "set_by":       "agent:rohan@billie.loans",    // agent identifier
    "set_at":       "2026-05-11T04:12:00Z",        // ISO 8601 UTC; if empty, dispatcher stamps now()
    "expires_at":   null,                          // ISO 8601 UTC; null = indefinite
    "correlation_id": "corr_<uuid>"                // optional
  }

  Modes:

  ┌────────────────┬────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────┐
  │      mode      │                   Blocks                   │                                Use case                                 │
  ├────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
  │ all            │ every send including auth (password reset) │ Disputed account, legal hold                                            │
  ├────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
  │ non_essential  │ servicing + marketing; allows auth         │ Hardship, complaint resolution (recommended default for support agents) │
  ├────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
  │ marketing_only │ marketing only                             │ Quieter version of the existing per-customer marketing opt-out          │
  ├────────────────┼────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────┤
  │ off            │ nothing — clears any active suppression    │ Re-enable notifications                                                 │
  └────────────────┴────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────┘

  Auto-expiry: if expires_at is in the past, the suppression is treated as inactive automatically — no follow-up "off" event needed. To make a 30-day hold:

  from datetime import datetime, timedelta, timezone
  expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

  2c. Publishing code (sample only - make sure your code is aligned to what is already in place)

  import json
  import redis.asyncio as redis
  from datetime import datetime, timezone

  CHAT_LEDGER = "chatLedger"

  async def set_suppression(
      r: redis.Redis,
      *,
      customer_id: str,
      mode: str,                    # "all" | "non_essential" | "marketing_only" | "off"
      reason: str,
      set_by: str,
      expires_at: str | None = None,
  ):
      payload = {
          "customer_id":  customer_id,
          "mode":         mode,
          "reason":       reason,
          "set_by":       set_by,
          "set_at":       datetime.now(timezone.utc).isoformat(),
          "expires_at":   expires_at,
      }
      await r.xadd(
          CHAT_LEDGER,
          {"typ": "notification.suppression.changed.v1", "payload": json.dumps(payload)},
          maxlen=1_000_000,
          approximate=True,
      )

  2d. Confirming the change took effect

  The dispatcher applies the change synchronously when it consumes the event (typically <1s). There is no acknowledgment event. Two ways to confirm:

  1. Implicit: send a test dispatch with category=servicing and watch for a notification.delivery_failed.v1 with error_type="suppressed".
  2. Direct read: the projection lives at Redis hash notificationDispatcher:projections:suppression:{customer_id} — the CRM can HGETALL it to read current state. Returns empty if no suppression.

  async def get_suppression(r: redis.Redis, customer_id: str) -> dict | None:
      raw = await r.hgetall(f"notificationDispatcher:projections:suppression:{customer_id}")
      if not raw:
          return None
      return {k.decode(): v.decode() for k, v in raw.items()}

  2e. Observing blocked sends

  When a dispatch is blocked by suppression, the CRM will see a notification.delivery_failed.v1 on its inbox with:

  {
    "error_type":     "suppressed",
    "error_message":  "customer suppressed: mode=non_essential reason=Hardship plan #4521",
    "template_name":  "pre_due_email_first",
    "tags":           { "category": "servicing", "reason": "pre_due", "step": 0 },
    // …all other notification.delivery_failed.v1 fields
  }

  Render these in the CRM activity feed as "Notification blocked — " so support agents can see what would have gone out.

  ---
  3. Getting the rendered notification body (future)

  Event payloads deliberately omit the rendered HTML/SMS body for size + PII reasons. To display the actual content in the CRM, the platform will expose a small read endpoint:

  GET /v1/notifications/{notification_id}/body
  → 200 { "subject": "...", "body": "<html>...</html>", "is_html": true,
           "template_name": "...", "template_content_hash": "..." }

  The endpoint will re-render from the stored notification.dispatch.requested.v1 payload and pin to template_content_hash to detect drift.

  Status: not yet implemented. Until then, the CRM has template_name, template_content_hash, and template_git_sha on every event — that's enough to identify what was sent, just not display the rendered body. Flag if you need the endpoint sooner.

  ---
  4. Pydantic models (canonical contracts)

  If the CRM is Python, it can install the typed SDK directly:

  If the CRM is Python, it can install the typed SDK directly:

  -e git+https://github.com/BillieLoans/billie-event-sdks#subdirectory=packages/notifications

  Models used:
  - NotificationSentV1
  - NotificationDeliveryFailedV1
  - StatementGeneratedV1
  - NotificationSuppressionChangedV1 (publish-side)

  For non-Python CRMs, the JSON shapes in §1d and §2b are the contract.

  ---
  5. Quick reference — what changed since the last spec

  ┌──────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │        Change        │                                                   Detail                                                   │
  ├──────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Read source          │ Was: filter chatLedger directly. Now: own inbox stream inbox:billie-servicing populated by the chatLedger router. │
  ├──────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Template versioning  │ template_content_hash + template_git_sha now on every sent/failed event.                                   │
  ├──────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Kill switch          │ New publish-side event notification.suppression.changed.v1 to inbox:notificationDispatcher.                │
  ├──────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ New error_type value │ "suppressed" on notification.delivery_failed.v1.                                                           │
  └──────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
