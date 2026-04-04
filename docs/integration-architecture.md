# Integration Architecture

This document describes how the two parts of Billie CRM communicate with each other and with external services.

## Parts

1. **Billie CRM Web** -- Next.js 15 + Payload CMS v3.45.0 (staff UI + API routes + gRPC client)
2. **Event Processor** -- Python async worker (consumes domain events, writes projections to MongoDB)

---

## Integration Points

| # | Integration | Type | Direction | Key Files |
|---|-------------|------|-----------|-----------|
| 1 | MongoDB | Shared database | Web reads / Event Processor writes | `src/collections/*.ts`, `event-processor/src/billie_servicing/handlers/` |
| 2 | Redis Streams | Async message queue | Web publishes / Event Processor consumes | `src/server/event-publisher.ts`, `event-processor/src/billie_servicing/processor.py` |
| 3 | gRPC (Ledger) | Synchronous RPC | Web calls external service | `src/server/grpc-client.ts`, `proto/accounting_ledger.proto` |
| 4 | AWS S3 | Object storage | Web reads and writes | `src/server/s3-client.ts` |

---

## 1. MongoDB (Shared Database)

- **Pattern**: CQRS -- the Event Processor is the sole writer for domain data. Payload CMS reads these collections as projections.
- **Exception**: `contact-notes` is CRM-writable (staff create notes directly via Payload).

### Collection ownership

| Collection | Writer | Reader | Notes |
|------------|--------|--------|-------|
| `loan-accounts` | Event Processor | Web | Upserted from account events |
| `customers` | Event Processor | Web | Upserted from customer events |
| `conversations` | Event Processor | Web | Chat/application events, utterances, assessments, summaries |
| `write-off-requests` | Event Processor | Web | Write-off workflow state machine |
| `applications` | Event Processor | Web | Application detail changes |
| `contact-notes` | **Web (Payload)** | Web | Staff-created notes -- direct CRM write |
| `users` | Web (Payload) | Web | Payload CMS user/auth data |
| `media` | Web (Payload) | Web | Payload CMS media uploads |

### Shared configuration

- Both processes connect to the same MongoDB database (`billie-servicing`).
- The Event Processor maps snake_case SDK fields to camelCase for MongoDB so that Payload collections can consume them natively.

---

## 2. Redis Streams (Event Bus)

Both processes connect to the same Redis instance. The Event Processor uses a consumer group (`billie-servicing-processor`) with manual XACK for at-least-once delivery and deduplication keys for exactly-once semantics.

### External Stream: `inbox:billie-servicing`

Events from external systems (account platform, customer platform, conversation engine) routed via the Billie Event Router.

| Event Type | Source | Handler |
|------------|--------|---------|
| `account.created.v1` | Accounts platform | `handle_account_created` |
| `account.updated.v1` | Accounts platform | `handle_account_updated` |
| `account.status_changed.v1` | Accounts platform | `handle_account_status_changed` |
| `account.schedule.created.v1` | Accounts platform | `handle_schedule_created` |
| `account.schedule.updated.v1` | Accounts platform | `handle_schedule_updated` |
| `customer.changed.v1` | Customer platform | `handle_customer_changed` |
| `customer.created.v1` | Customer platform | `handle_customer_changed` |
| `customer.updated.v1` | Customer platform | `handle_customer_changed` |
| `customer.verified.v1` | Customer platform | `handle_customer_verified` |
| `conversation_started` | Conversation engine | `handle_conversation_started` |
| `user_input` | Conversation engine | `handle_utterance` |
| `assistant_response` | Conversation engine | `handle_utterance` |
| `applicationDetail_changed` | Conversation engine | `handle_application_detail_changed` |
| `identityRisk_assessment` | Conversation engine | `handle_assessment` |
| `serviceability_assessment_results` | Conversation engine | `handle_assessment` |
| `fraudCheck_assessment` | Conversation engine | `handle_assessment` |
| `noticeboard_updated` | Conversation engine | `handle_noticeboard_updated` |
| `final_decision` | Conversation engine | `handle_final_decision` |
| `conversation_summary` | Conversation engine | `handle_conversation_summary` |

### Internal Stream: `inbox:billie-servicing:internal`

Events originated by the CRM itself (currently the write-off approval workflow). Published by `src/server/event-publisher.ts` with retry + exponential backoff (3 attempts, 100/200/400 ms).

| Event Type | Trigger |
|------------|---------|
| `writeoff.requested.v1` | Staff submits write-off request |
| `writeoff.approved.v1` | Supervisor approves write-off |
| `writeoff.rejected.v1` | Supervisor rejects write-off |
| `writeoff.cancelled.v1` | Requester cancels write-off |

### Dead Letter Queue: `dlq:billie-servicing`

- Failed messages are moved here after 3 delivery attempts.
- Contains the original message fields plus `original_message_id`, `error`, and `moved_at` metadata.
- Capped at 10,000 entries (MAXLEN on XADD).

### Processing guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| At-least-once delivery | Consumer group with manual XACK after successful MongoDB write |
| Exactly-once semantics | Dedup keys (`dedup:{stream}:{message_id}`) with 24-hour TTL |
| No message loss on restart | XPENDING recovery on startup replays un-ACKed messages |
| Oversized payload protection | Messages exceeding 256 KB are rejected to DLQ |

---

## 3. gRPC (Ledger Service)

- **Protocol**: gRPC over HTTP/2
- **Service**: `billie.ledger.v1.AccountingLedgerService`
- **Proto**: `proto/accounting_ledger.proto`
- **Client**: `src/server/grpc-client.ts`
- **Used by**: 47 of 59 API routes (80%)
- **Not used by**: Event Processor (it does not need ledger data)

### Operations

| Category | RPCs |
|----------|------|
| **Balance/Record** | `GetBalance`, `GetLedgerRecord`, `GetTransactions`, `GetStatement`, `WatchTransactions` |
| **Write (event-sourced)** | `RecordRepayment`, `ApplyLateFee`, `ApplyDishonourFee`, `WaiveFee`, `WriteOff`, `MakeAdjustment`, `DisburseLoan` |
| **Schedule** | `GetScheduleWithStatus` |
| **Aging** | `GetAccountAging`, `GetOverdueAccounts` |
| **Revenue recognition** | `GetAccruedYield`, `GetAccrualEventHistory` |
| **ECL** | `GetECLAllowance`, `GetPortfolioECL`, `TriggerPortfolioECLRecalculation`, `TriggerBulkECLRecalculation` |
| **ECL config** | `GetECLConfig`, `UpdateECLOverlay`, `UpdatePDRate`, `GetECLConfigHistory`, `SubmitECLConfigChange`, `GetPendingECLChanges`, `ApproveECLChange`, `RejectECLChange`, `GetScheduledRecalculations`, `ScheduleECLRecalculation`, `CancelScheduledRecalculation` |
| **Investigation** | `GetEventHistory`, `TraceECLToSource`, `TraceAccruedYieldToSource`, `SearchAccounts`, `BatchAccountQuery`, `GenerateRandomSample`, `GetCarryingAmountBreakdown` |
| **Period close** | `GetPortfolioSummary`, `GetGLReconciliation`, `GetEventProcessingStatus` |

### API routes that do NOT use gRPC (12 of 59)

These routes interact only with MongoDB/Payload or Redis:

- `api/health` -- health check
- `api/dashboard` -- aggregated dashboard data from MongoDB
- `api/customer/search` -- Payload customer search
- `api/loan-accounts/search` -- Payload loan account search
- `api/loan-accounts/[id]` -- Payload loan account detail
- `api/contact-notes/[id]/amend` -- amend a contact note
- `api/conversations` -- (if present) read conversations from MongoDB
- `api/commands/writeoff/request` -- publish write-off event to Redis
- `api/commands/writeoff/reject` -- publish write-off event to Redis
- `api/commands/writeoff/cancel` -- publish write-off event to Redis
- `api/pending-disbursements` -- read from MongoDB
- `api/uploads/presigned-url` -- generate S3 presigned URL
- `api/loan-agreement` -- fetch signed agreement from S3
- `api/realtime` -- SSE endpoint

---

## 4. AWS S3 (Document Storage)

- **Type**: Object storage
- **Client**: `src/server/s3-client.ts`
- **Region**: `ap-southeast-2` (default)
- **Used for**: Signed loan agreements, disbursement proof-of-payment attachments
- **Access pattern**: Presigned URLs for upload (PUT, 5-minute expiry) and download (GET)
- **Security**: Cross-bucket access is validated against `S3_BUCKET_NAME` env var

---

## Data Flow Diagrams

### Account Lifecycle

```
External Platform
      |
      v
Redis (inbox:billie-servicing)
      |
      v
Event Processor ──writes──> MongoDB (loan-accounts, customers)
                                       ^
                                       |
Payload CMS (reads) <──────────────────┘
```

### Write-Off Workflow

```
1. Staff submits write-off request
   └─> API Route (api/commands/writeoff/request)
       └─> Redis (inbox:billie-servicing:internal) [writeoff.requested.v1]
           └─> Event Processor
               └─> MongoDB (write-off-requests: status=pending)

2. Supervisor approves
   └─> API Route (api/commands/writeoff/approve)
       ├─> gRPC WriteOff ──> Ledger (records balance write-off)
       └─> Redis (inbox:billie-servicing:internal) [writeoff.approved.v1]
           └─> Event Processor
               └─> MongoDB (write-off-requests: status=approved)
```

### Customer Servicing (Live Data)

```
Staff ──> ServicingView ──> React Query hooks
                                |
                  ┌─────────────┼─────────────┐
                  v             v             v
            API Routes     API Routes     API Routes
                  |             |             |
                  v             v             v
        gRPC Ledger      MongoDB/Payload   MongoDB
     (live balances,    (customer data,   (conversations,
      transactions,      contact notes)   applications)
      schedule, aging)
```

### Contact Notes (Direct Write)

```
Staff ──> AddNoteDrawer ──> API Route ──> Payload CMS ──> MongoDB (contact-notes)
```

### Document Upload (S3)

```
Staff ──> Upload UI ──> API Route (presigned-url) ──> S3 presigned PUT URL
                              |
                              v
                   Browser uploads directly to S3
                              |
                              v
              API Route (disburse) stores S3 URI in ledger transaction metadata
```

---

## Error Handling

| Failure | Web App Behavior | Event Processor Behavior |
|---------|-----------------|-------------------------|
| **gRPC unavailable** | Returns fallback responses with `_fallback` flag; UI enters read-only mode (balance/transaction data unavailable) | N/A -- does not use gRPC |
| **Redis unavailable** | Event publisher retries with exponential backoff (100/200/400 ms), throws `EventPublishError` after 3 attempts | Retries connection with exponential backoff (1s to 30s max); replays pending messages after reconnect |
| **MongoDB unavailable** | Payload CMS returns errors on collection reads | Retries connection with exponential backoff (1s to 30s max); pending messages replayed on reconnect |
| **Redis NOGROUP** | N/A | Re-creates consumer groups automatically; replays backlog from id=0 |
| **Message processing failure** | N/A | Retries up to 3 times via XPENDING; moves to DLQ after exhausting retries |

---

## Shared Configuration

| Setting | Web App Source | Event Processor Source |
|---------|---------------|----------------------|
| MongoDB connection | `DATABASE_URI` env var | `DATABASE_URI` env var |
| MongoDB database name | Parsed from URI by Payload | `db_name` setting (default: `billie-servicing`) |
| Redis URL | `REDIS_URL` env var (default: `redis://localhost:6383`) | `redis_url` setting (default: `redis://localhost:6383`) |
| External stream name | `REDIS_EXTERNAL_STREAM` env var (ref only) | `inbox_stream` setting |
| Internal stream name | `REDIS_PUBLISH_STREAM` env var | `internal_stream` setting |
| Consumer group | N/A (publisher only) | `consumer_group` setting (`billie-servicing-processor`) |
| DLQ stream | N/A | `dlq_stream` setting (`dlq:billie-servicing`) |
| TLS enforcement | Warns if non-TLS Redis in production | Raises error if non-TLS Redis in production |
