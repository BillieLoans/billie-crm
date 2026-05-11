Notification events + API — CRM integration spec (v2)
  
  Overview

  The CRM integrates with the platform via two channels:
  
  1. Events — read-only feed of notification lifecycle events on the CRM's own Redis stream (inbox:billieCrm).
  2. gRPC API — synchronous reads + writes against NotificationDispatcherService on port 50052:
    - Fetch the rendered subject/body of any past notification.
    - Set / get / clear / list per-customer notification suppression (kill switch).
  
  Both Redis and gRPC are reached on the existing platform network.

  ---
  1. Reading events: inbox:billieCrm

  1a. Platform-side setup (one-time)
  
  Platform team adds to src/config.{env}.json:
  
  "chatLedger_services": {
    "billieCrm": {
      "events": {},
      "subscriptions": {
        "consume_from_agents": ["notificationDispatcher", "notificationService"]
      }
    }
  },
  "stream_caps": {
    "inbox:billieCrm": 1000000
  }
  
  1b. Consume
  
  import json, redis.asyncio as redis
  
  INBOX, GROUP, CONSUMER = "inbox:billieCrm", "billieCrm-contact-history", "billieCrm-1"

  async def consume():
      r = redis.from_url(REDIS_URL)
      try: await r.xgroup_create(INBOX, GROUP, id="0", mkstream=True)
      except redis.ResponseError as e:
          if "BUSYGROUP" not in str(e): raise
      while True:
          # drain pending first (crash recovery), then long-poll for new
          for source in ("0", ">"):
              msgs = await r.xreadgroup(GROUP, CONSUMER, {INBOX: source}, count=100, block=5000 if source==">" else 0)
              for _stream, events in (msgs or []):
                  for event_id, fields in events:
                      typ = fields[b"typ"].decode()
                      payload = json.loads(fields[b"payload"])
                      if await r.set(f"billieCrm:processed:{event_id.decode()}", "1", nx=True, ex=86400):
                          await dispatch(typ, payload)
                      await r.xack(INBOX, GROUP, event_id)

  1c. Event types the CRM cares about
  
  ┌─────────────────────────────────┬─────────────────────────────────────────────────────────────┐
  │               typ               │                           Purpose                           │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ notification.sent.v1            │ Add "delivered" entry to activity feed                      │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ notification.delivery_failed.v1 │ Add "failed" entry; error_type indicates reason (see table) │
  ├─────────────────────────────────┼─────────────────────────────────────────────────────────────┤
  │ statement.generated.v1          │ Add "statement issued" entry (compliance marker)            │
  └─────────────────────────────────┴─────────────────────────────────────────────────────────────┘

  1d. Payloads

  notification.sent.v1

  {
    "notification_id":      "ntn_3f4a8b2c1d5e6f7a",
    "idempotency_key":      "predue:acc_123:1:0",
    "request_id":           "req_<uuid>",
    "channel":              "email",                  // "email" | "sms"
    "template_name":        "pre_due_email_first",
    "template_content_hash":"a4f3c21…",               // sha256 — pin for audit
    "template_git_sha":     "9b1d4e7…",               // may be null
    "sent_at":              "2026-05-11T03:14:09Z",
    "provider":             "resend",
    "provider_message_id":  "abc@resend.com",
    "recipient_hash":       "<sha256 hex>",
    "customer_id":          "cust_abc",
    "correlation_id":       "corr_xyz",
    "tags": { "category": "servicing", "reason": "pre_due", "step": 0 }
  }

  notification.delivery_failed.v1
  
  Same envelope + failed_at, error_type, error_message, attempt, fallback_suggested.
  
  error_type values:
  
  ┌─────────────────┬─────────────────────────────────────────────┐
  │   error_type    │                 CRM display                 │
  ├─────────────────┼─────────────────────────────────────────────┤
  │ transient       │ "Failed — temporary error"                  │
  ├─────────────────┼─────────────────────────────────────────────┤
  │ permanent       │ "Failed — recipient invalid"                │
  ├─────────────────┼─────────────────────────────────────────────┤
  │ auth            │ "Failed — system error"                     │
  ├─────────────────┼─────────────────────────────────────────────┤
  │ template        │ "Failed — template error"                   │
  ├─────────────────┼─────────────────────────────────────────────┤
  │ contact_missing │ "Failed — no contact details"               │
  ├─────────────────┼─────────────────────────────────────────────┤
  │ opt_out         │ "Suppressed — marketing opt-out"            │
  ├─────────────────┼─────────────────────────────────────────────┤
  │ suppressed      │ "Blocked — notification suppression active" │
  └─────────────────┴─────────────────────────────────────────────┘

  statement.generated.v1

  {
    "account_id": "acc_123",
    "customer_id": "cust_abc",
    "period_start": "2026-04-01",
    "period_end": "2026-04-30",
    "notification_id": "ntn_…",
    "dispatched_at": "2026-05-01T06:00:09Z",
    "correlation_id": "corr_…"
  }

  1e. Template → friendly label

  tags.reason + tags.step is the easiest display. Full mapping:
  
  ┌────────────────────────────────────────┬───────────┬──────────────────────────────────────────────────────┐
  │                Template                │  Channel  │                        Label                         │
  ├────────────────────────────────────────┼───────────┼──────────────────────────────────────────────────────┤
  │ pre_due_email_first                    │ email     │ First pre-due reminder                               │
  ├────────────────────────────────────────┼───────────┼──────────────────────────────────────────────────────┤
  │ pre_due_email_first_fallback_sms       │ sms       │ First pre-due (SMS fallback)                         │
  ├────────────────────────────────────────┼───────────┼──────────────────────────────────────────────────────┤
  │ pre_due_sms_second                     │ sms       │ Second pre-due reminder                              │
  ├────────────────────────────────────────┼───────────┼──────────────────────────────────────────────────────┤
  │ pre_due_sms_second_fallback_email      │ email     │ Second pre-due (email fallback)                      │
  ├────────────────────────────────────────┼───────────┼──────────────────────────────────────────────────────┤
  │ overdue_email_v1 … overdue_email_final │ email/sms │ Overdue notice — step N (final is legally important) │
  ├────────────────────────────────────────┼───────────┼──────────────────────────────────────────────────────┤
  │ statement_monthly_email                │ email     │ Monthly statement                                    │
  └────────────────────────────────────────┴───────────┴──────────────────────────────────────────────────────┘
  
  ---
  2. gRPC API: NotificationDispatcherService (port 50052)
  
  Insecure plaintext on the platform network — no TLS/auth today; same trust model as the existing accounting-ledger gRPC.
  
  2a. Install + generate stubs
  
  pip install grpcio grpcio-tools
  # Pull notification_dispatcher.proto from billie-platform-services/proto/
  python -m grpc_tools.protoc -I./proto \
    --python_out=./generated --grpc_python_out=./generated \
    ./proto/notification_dispatcher.proto

  Channel setup:
  
  import grpc
  from generated import notification_dispatcher_pb2 as pb
  from generated import notification_dispatcher_pb2_grpc as pb_grpc
  
  channel = grpc.aio.insecure_channel("notification-dispatcher.platform:50052")
  stub = pb_grpc.NotificationDispatcherServiceStub(channel)
  
  2b. Fetch the rendered notification body

  rpc GetNotification(GetNotificationRequest) returns (GetNotificationResponse)
  
  resp = await stub.GetNotification(pb.GetNotificationRequest(notification_id="ntn_3f4a8b…"))
  # resp.subject, resp.body, resp.is_html (True for email, False for SMS)
  # Plus: channel, template_name, template_content_hash, template_git_sha,
  #       provider, provider_message_id, recipient_hash, customer_id, correlation_id,
  #       sent_at, failed_at, success, error_type, error_message, tags

  - Available for 90 days after send. Older returns NOT_FOUND.
  - Notifications written before this feature shipped also return NOT_FOUND (they age out).
  - subject is empty for SMS; body is the full HTML or plain SMS text.
  - Recipient stays hashed (recipient_hash); use customer_id to look up the contact in your own data.
  
  2c. Get current suppression for a customer
  
  rpc GetSuppression(GetSuppressionRequest) returns (Suppression)
  
  try:
      s = await stub.GetSuppression(pb.GetSuppressionRequest(customer_id="cust_abc"))
      # s.mode, s.reason, s.set_by, s.set_at, s.expires_at, s.active_now
  except grpc.RpcError as e:
      if e.code() == grpc.StatusCode.NOT_FOUND:
  - Available for 90 days after send. Older returns NOT_FOUND.
  - Available for 90 days after send. Older returns NOT_FOUND.
  - Notifications written before this feature shipped also return NOT_FOUND (they age out).
  - subject is empty for SMS; body is the full HTML or plain SMS text.
  - Recipient stays hashed (recipient_hash); use customer_id to look up the contact in your own data.

  2c. Get current suppression for a customer

  rpc GetSuppression(GetSuppressionRequest) returns (Suppression)

  try:
      s = await stub.GetSuppression(pb.GetSuppressionRequest(customer_id="cust_abc"))
      # s.mode, s.reason, s.set_by, s.set_at, s.expires_at, s.active_now
  except grpc.RpcError as e:
      if e.code() == grpc.StatusCode.NOT_FOUND:
          # no active suppression
          ...

  s.active_now is False if expires_at has passed — surface this in the UI ("Expired" badge).

  2d. Set / replace suppression

  rpc SetSuppression(SetSuppressionRequest) returns (Suppression)

  from datetime import datetime, timedelta, timezone
  from google.protobuf.timestamp_pb2 import Timestamp

  expires = Timestamp()
  expires.FromDatetime((datetime.utcnow() + timedelta(days=30)))

  s = await stub.SetSuppression(pb.SetSuppressionRequest(
      customer_id="cust_abc",
      mode=pb.SuppressionMode.SUPPRESSION_MODE_NON_ESSENTIAL,
      reason="Hardship plan #4521",
      set_by="agent:rohan@billie.loans",
      expires_at=expires,         # omit for indefinite
  ))
  # Response is the new state with source_event_id pointing at the audit event.

  Modes:

  ┌─────────────────────────────────┬────────────────────────────────────┬──────────────────────────────────────┐
  │           Proto enum            │               Blocks               │               Use case               │
  ├─────────────────────────────────┼────────────────────────────────────┼──────────────────────────────────────┤
  │ SUPPRESSION_MODE_ALL            │ every send incl. auth              │ Disputed account / legal hold        │
  ├─────────────────────────────────┼────────────────────────────────────┼──────────────────────────────────────┤
  │ SUPPRESSION_MODE_NON_ESSENTIAL  │ servicing + marketing; allows auth │ Hardship — recommended default       │
  ├─────────────────────────────────┼────────────────────────────────────┼──────────────────────────────────────┤
  │ SUPPRESSION_MODE_MARKETING_ONLY │ marketing only                     │ Tighter version of marketing opt-out │
  └─────────────────────────────────┴────────────────────────────────────┴──────────────────────────────────────┘
  
  Behind the scenes the RPC publishes notification.suppression.changed.v1, waits up to ~2s for the projection to converge, then
  returns. If the projection writer is unhealthy you'll get DEADLINE_EXCEEDED.

  2e. Clear suppression
  
  rpc ClearSuppression(ClearSuppressionRequest) returns (ClearSuppressionResponse)
  
  resp = await stub.ClearSuppression(pb.ClearSuppressionRequest(
      customer_id="cust_abc",
      set_by="agent:rohan@billie.loans",
  ))
  # resp.cleared is True if there was an active row removed, False if no-op

  2f. List all active suppressions
  
  rpc ListSuppressions(ListSuppressionsRequest) returns (ListSuppressionsResponse)

  resp = await stub.ListSuppressions(pb.ListSuppressionsRequest())
  for s in resp.suppressions:
      print(s.customer_id, s.mode, s.set_by, s.active_now)
  
  No pagination — the active set is expected to stay small.

  2g. Observing blocked sends
  
  When a customer is suppressed and the system tries to send to them, the CRM's inbox receives a notification.delivery_failed.v1 with
  error_type="suppressed". Display as "Blocked — notification suppression active" in the activity feed.
  
  ---
  3. Event SDK (Python only)

  For typed parsing of the inbox events:

  pip install
  git+https://${GITHUB_TOKEN}@github.com/BillieLoans/billie-event-sdks.git@notifications-v1.1.0#subdirectory=packages/notifications
  
  Models: NotificationSentV1, NotificationDeliveryFailedV1, StatementGeneratedV1.

  Note: the kill-switch event (NotificationSuppressionChangedV1) is still in the SDK but the CRM should not publish it directly — use
  the gRPC SetSuppression instead. The event is reserved for internal system-to-system automations.
  
  ---
  4. Idempotency keys (for dedup in your activity feed)

  Format-stable across event replays:

  ┌───────────┬──────────────────────────────────────────────────────┬──────────────────────────────┐
  │  Reason   │                        Format                        │           Example            │
  ├───────────┼──────────────────────────────────────────────────────┼──────────────────────────────┤
  │ Pre-due   │ predue:{account_id}:{instalment_number}:{rule_index} │ predue:acc_123:1:0           │
  ├───────────┼──────────────────────────────────────────────────────┼──────────────────────────────┤
  │ Overdue   │ overdue:{account_id}:{series_start}:{step}           │ overdue:acc_123:2026-05-04:1 │
  ├───────────┼──────────────────────────────────────────────────────┼──────────────────────────────┤
  │ Statement │ statement:{account_id}:{YYYY-MM}                     │ statement:acc_123:2026-05    │
  └───────────┴──────────────────────────────────────────────────────┴──────────────────────────────┘
  
  Plus notification_id is unique per send if you want a per-attempt key.

  ---
  5. Summary of what changed since v1 of this spec
  
  ┌─────────────────────┬───────────────────────────────────┬─────────────────────────────────────────────────────────────────────┐
  │       Change        │                Was                │                                 Now                                 │
  ├─────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ Read source         │ chatLedger direct                 │ Own inbox inbox:billieCrm (chatLedger router fans in)               │
  ├─────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ Template versioning │ Not available                     │ template_content_hash + template_git_sha on every sent/failed event │
  ├─────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ Kill switch         │ Publish event to dispatcher inbox │ gRPC Set/Get/Clear/ListSuppression on port 50052                    │
  ├─────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────┤
  │ Body fetch          │ Not available ("future")          │ gRPC GetNotification on port 50052                                  │
  └─────────────────────┴───────────────────────────────────┴─────────────────────────────────────────────────────────────────────┘
