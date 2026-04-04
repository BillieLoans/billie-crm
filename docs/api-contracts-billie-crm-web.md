# API Contracts: Billie CRM Web

> Comprehensive reference for the 60 custom API routes exposed by the billie-crm Next.js application.
> Auto-generated Payload CMS REST/GraphQL endpoints (e.g. `/api/customers`, `/api/loan-accounts`) are not covered here.

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total custom routes | 60 |
| HTTP methods | GET: 37, POST: 18, PUT: 3, PATCH: 1, DELETE: 1 |
| Domain areas | 14 |

### Auth Level Distribution

| Auth Level | Roles Granted | Route Count |
|------------|--------------|-------------|
| None | Public (no auth required) | 1 |
| Authenticated | Any logged-in user (cookie-based) | 7 |
| `hasAnyRole` | admin, supervisor, operations, readonly | 20 |
| `canService` | admin, supervisor, operations | 19 |
| `hasApprovalAuthority` | admin, supervisor | 13 |

### External Service Dependencies

| Service | Protocol | Route Count | Notes |
|---------|----------|-------------|-------|
| gRPC Ledger (AccountingLedgerService) | gRPC | 44 | Primary transaction engine |
| MongoDB via Payload | Local API | 25 | Read-only projections |
| AWS S3 | HTTPS | 4 | Document storage and retrieval |
| Redis Streams | TCP | 4 | Event publishing (write-off commands) |

### Cross-Cutting Patterns

| Pattern | Description |
|---------|-------------|
| Version conflict detection | Mutations accepting `expectedVersion` return `409 Conflict` when the document has been modified since read |
| Fallback responses | When gRPC is unavailable, read routes return default/empty data with `_fallback: true` and `_message` fields |
| Idempotency keys | All write operations to gRPC generate a unique idempotency key via `generateIdempotencyKey()` |
| Zod validation | Request bodies are validated with Zod schemas; failures return `400` with `{ error, details: { fieldErrors } }` |
| Error envelope | Structured errors use `{ error: { code, message, details? } }` |
| Ownership validation | Export job routes enforce user ownership, returning `403` on IDOR attempts |
| Pagination | Cursor-based via `pageToken` / `pageSize` on gRPC-backed list endpoints |
| gRPC error mapping | `UNAVAILABLE` (14) returns 503; `FAILED_PRECONDITION` (9) returns 422; `ALREADY_EXISTS` (6) returns 409 |

---

## 1. Health and Monitoring

Three endpoints for infrastructure health checks and operational monitoring.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/health` | Basic application health check (Fly.io) | None | -- |
| GET | `/api/ledger/health` | gRPC ledger connectivity and latency check | `hasAnyRole` | gRPC Ledger |
| GET | `/api/system/status` | Event processing status (Redis streams, consumer groups) | `hasAnyRole` | gRPC Ledger |

### GET /api/health

No authentication. Returns 200 if the process is running.

**Response `200`**
```json
{
  "status": "ok",
  "timestamp": "2026-04-03T00:00:00.000Z"
}
```

### GET /api/ledger/health

Probes the gRPC ledger service with multiple fallback methods (`getBalance`, then `getAccruedYield`). Classifies the service as `connected`, `degraded`, or `offline` based on response latency thresholds.

**Response `200`**
```json
{
  "status": "connected" | "degraded" | "offline",
  "latencyMs": 42,
  "message": "Ledger Connected",
  "checkedAt": "2026-04-03T00:00:00.000Z"
}
```

gRPC errors `NOT_FOUND` (5) and `UNIMPLEMENTED` (12) are treated as successful connectivity probes.

### GET /api/system/status

Retrieves event processing status from the ledger service, including per-stream lag, consumer counts, and pending message counts.

**Response `200`**
```json
{
  "success": true,
  "overallStatus": "healthy" | "degraded" | "unknown",
  "totalPending": "0",
  "estimatedCatchupSeconds": "0",
  "streams": [
    {
      "streamName": "inbox:billie-servicing",
      "consumerGroup": "...",
      "streamLength": "1234",
      "pendingCount": "0",
      "lastDeliveredId": "...",
      "lastEntryId": "...",
      "lagSeconds": "0",
      "status": "healthy",
      "consumerCount": 2,
      "lastError": null,
      "lastProcessedAt": "..."
    }
  ],
  "queriedAt": "2026-04-03T00:00:00.000Z"
}
```

**Fallback `200`** (ledger unavailable): Returns empty `streams` array with `_fallback: true`.

---

## 2. Customer and Account Management

Six endpoints for customer search, account lookup, dashboard aggregation, and disbursement queues.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/customer/search` | Search customers by name, email, phone, or ID | `hasAnyRole` | MongoDB/Payload |
| GET | `/api/customer/[customerId]` | Full customer view with accounts, conversations, live balances | Authenticated | MongoDB/Payload, gRPC Ledger |
| GET | `/api/loan-accounts/search` | Search loan accounts by number, ID, or customer name | `hasAnyRole` | MongoDB/Payload |
| GET | `/api/loan-accounts/[id]` | Fetch loan account by Payload document ID | `hasAnyRole` | MongoDB/Payload |
| GET | `/api/dashboard` | Dashboard aggregation (action items, payments, system status) | Authenticated | MongoDB/Payload, gRPC Ledger |
| GET | `/api/pending-disbursements` | List accounts pending disbursement | Authenticated | MongoDB/Payload |

### GET /api/customer/search

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `q` | Yes | Search query (minimum 3 characters) |

Returns empty results if `q` is shorter than 3 characters (no error).

**Response `200`**
```json
{
  "results": [
    {
      "id": "payload-doc-id",
      "customerId": "CUST-001",
      "fullName": "Jane Smith",
      "emailAddress": "jane@example.com",
      "identityVerified": true,
      "accountCount": 2
    }
  ],
  "total": 1
}
```

### GET /api/customer/[customerId]

Aggregates customer details, linked loan accounts with live gRPC balances, conversations, and timeline data.

**Path Parameters**

| Param | Description |
|-------|-------------|
| `customerId` | Customer ID string (e.g. `CUST-001`) |

### GET /api/loan-accounts/search

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `q` | Yes | Search by account number, loan account ID, or customer name |

### GET /api/loan-accounts/[id]

**Path Parameters**

| Param | Description |
|-------|-------------|
| `id` | Payload document ID |

### GET /api/dashboard

Aggregates multiple data sources in parallel: pending approvals count, ledger health, recent customers, recent accounts, upcoming payments (14-day window), and pending disbursements.

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `recentCustomerIds` | No | Comma-separated customer IDs for summary cards |

**Response `200`**
```json
{
  "user": { "firstName": "Jane", "role": "operations" },
  "actionItems": { "pendingApprovalsCount": 3, "failedActionsCount": 0 },
  "recentCustomersSummary": [...],
  "recentAccounts": [...],
  "upcomingPayments": [...],
  "pendingDisbursements": [...],
  "pendingDisbursementsCount": 5,
  "systemStatus": {
    "ledger": "online" | "degraded" | "offline",
    "latencyMs": 42,
    "lastChecked": "2026-04-03T00:00:00.000Z"
  }
}
```

`pendingApprovalsCount` is only populated for users with `hasApprovalAuthority`.

### GET /api/pending-disbursements

**Query Parameters**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `limit` | No | 50 | Number of results (clamped to 1-200) |

**Response `200`**
```json
{
  "totalCount": 12,
  "items": [
    {
      "loanAccountId": "...",
      "accountNumber": "LA-001",
      "customerId": "CUST-001",
      "customerName": "Jane Smith",
      "loanAmount": 5000,
      "loanAmountFormatted": "$5,000.00",
      "totalOutstanding": 0,
      "totalOutstandingFormatted": "$0.00",
      "createdAt": "2026-04-01T00:00:00.000Z",
      "signedLoanAgreementUrl": "s3://..."
    }
  ]
}
```

---

## 3. Ledger Core Transactions

Six endpoints for reading balances, recording repayments, disbursing loans, and querying transaction history. All communicate with the gRPC AccountingLedgerService.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/ledger/balance` | Current account balance | `hasAnyRole` | gRPC Ledger |
| POST | `/api/ledger/repayment` | Record a repayment | `canService` | gRPC Ledger |
| POST | `/api/ledger/disburse` | Disburse loan funds | `canService` | gRPC Ledger, S3 |
| GET | `/api/ledger/record` | Full ledger record for an account | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ledger/statement` | Period statement | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ledger/transactions` | Transaction list with filtering | `hasAnyRole` | gRPC Ledger |

### GET /api/ledger/balance

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `loanAccountId` | Yes | Loan account ID |

**Response `200`**
```json
{
  "principalBalance": "4500.00",
  "feeBalance": "150.00",
  "totalOutstanding": "4650.00",
  "asOf": { "seconds": "...", "nanos": 0 }
}
```

### POST /api/ledger/repayment

**Request Body** (validated by `RecordRepaymentSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `amount` | string | Yes | Payment amount (decimal string for precision) |
| `paymentId` | string | Yes | External payment reference |
| `paymentMethod` | string | No | e.g. `direct_debit`, `card` |
| `paymentReference` | string | No | Additional reference |
| `expectedVersion` | string | No | Expected `updatedAt` for version conflict detection |

**Response `200`**
```json
{
  "success": true,
  "transaction": {
    "id": "txn-id",
    "accountId": "...",
    "type": "REPAYMENT",
    "typeLabel": "Repayment",
    "date": "2026-04-03T00:00:00.000Z",
    "principalDelta": -200,
    "feeDelta": -50,
    "totalDelta": -250,
    "principalAfter": 4300,
    "feeAfter": 100,
    "totalAfter": 4400,
    "description": "..."
  },
  "eventId": "evt-id",
  "allocation": {
    "allocatedToFees": 50,
    "allocatedToPrincipal": 200,
    "overpayment": 0
  }
}
```

**Error `409`** (version conflict)
```json
{
  "conflict": true,
  "message": "...",
  "currentVersion": "...",
  "expectedVersion": "..."
}
```

### POST /api/ledger/disburse

Records `DISBURSEMENT` + `ESTABLISHMENT_FEE` transactions and transitions the account from `PENDING_DISBURSEMENT` to `ACTIVE`.

**Request Body** (validated by `DisburseLoanSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `disbursementAmount` | string | No | Override amount (decimal string) |
| `bankReference` | string | Yes | Bank payment reference |
| `paymentMethod` | string | No | Defaults to `bank_transfer` |
| `attachmentLocation` | string | Yes | S3 URI for proof of payment |
| `notes` | string | No | Free-text notes |

**Response `200`**
```json
{
  "success": true,
  "message": "...",
  "disbursementTransactionId": "...",
  "feeTransactionId": "...",
  "eventId": "...",
  "idempotentReplay": false
}
```

**Error `409`** (already disbursed)
```json
{
  "error": "ALREADY_DISBURSED",
  "message": "This account has already been disbursed. Please check the account status."
}
```

### GET /api/ledger/record

Full ledger record for a loan account, returned from gRPC.

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `loanAccountId` | Yes | Loan account ID |

### GET /api/ledger/statement

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Loan account ID |
| `periodStart` | Yes | Start date (ISO 8601) |
| `periodEnd` | Yes | End date (ISO 8601) |

### GET /api/ledger/transactions

**Query Parameters**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `loanAccountId` | Yes | -- | Loan account ID |
| `limit` | No | -- | Max records |
| `fromDate` | No | -- | Filter: start date |
| `toDate` | No | -- | Filter: end date |
| `type` | No | -- | Filter: transaction type |

**Response `200`**
```json
{
  "loanAccountId": "...",
  "transactions": [...],
  "totalCount": 42
}
```

---

## 4. Ledger Fee Management

Five endpoints for fee application, waivers, adjustments, and write-offs. All use gRPC with idempotency keys.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| POST | `/api/ledger/adjustment` | Manual balance adjustment | `hasApprovalAuthority` | gRPC Ledger |
| POST | `/api/ledger/late-fee` | Apply late fee | `canService` | gRPC Ledger |
| POST | `/api/ledger/dishonour-fee` | Apply dishonour fee | `canService` | gRPC Ledger |
| POST | `/api/ledger/waive-fee` | Waive fees | `hasApprovalAuthority` | gRPC Ledger |
| POST | `/api/ledger/write-off` | Write off balance | `hasApprovalAuthority` | gRPC Ledger |

### POST /api/ledger/adjustment

**Request Body** (validated by `MakeAdjustmentSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `principalDelta` | string | Yes | Change to principal (can be negative) |
| `feeDelta` | string | Yes | Change to fees (can be negative) |
| `reason` | string | Yes | Reason for adjustment |
| `approvedBy` | string | No | Ignored; derived from authenticated session |

**Response `200`**: Same transaction envelope as repayment (with `success`, `transaction`, `eventId`).

**Error `422`**: gRPC `FAILED_PRECONDITION` (business rule violation).

### POST /api/ledger/late-fee

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `feeAmount` | string | Yes | Fee amount |
| `daysPastDue` | number | Yes | Days past due triggering the fee |
| `reason` | string | No | Optional reason |

### POST /api/ledger/dishonour-fee

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `feeAmount` | string | Yes | Fee amount |
| `reason` | string | No | Optional reason |
| `referenceId` | string | No | Related payment reference |

### POST /api/ledger/waive-fee

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `waiverAmount` | string | Yes | Amount to waive |
| `reason` | string | Yes | Reason for waiver |
| `approvedBy` | string | No | Ignored; derived from session |
| `expectedVersion` | string | No | For version conflict detection |

**Error `409`**: Version conflict (see repayment error format).

### POST /api/ledger/write-off

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `reason` | string | Yes | Reason for write-off |
| `approvedBy` | string | No | Ignored; derived from session |

---

## 5. Ledger Account State Queries

Five endpoints for accrual, aging, and schedule data. All backed by gRPC.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/ledger/accrual/[accountId]` | Current accrued yield | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ledger/accrual/[accountId]/history` | Accrual event history | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ledger/aging/[accountId]` | Aging state (DPD, bucket) | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ledger/aging/overdue` | Paginated overdue accounts | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ledger/schedule/[accountId]` | Repayment schedule with instalment status | `hasAnyRole` | gRPC Ledger |

### GET /api/ledger/accrual/[accountId]

**Path Parameters**

| Param | Description |
|-------|-------------|
| `accountId` | Loan account ID |

Returns the current accrued yield calculation for the account.

### GET /api/ledger/accrual/[accountId]/history

Returns the full history of accrual events for audit and investigation.

### GET /api/ledger/aging/[accountId]

Returns current aging state including days past due (DPD) and delinquency bucket classification.

### GET /api/ledger/aging/overdue

**Query Parameters**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `bucket` | No | -- | Filter by delinquency bucket |
| `minDpd` | No | -- | Minimum days past due |
| `maxDpd` | No | -- | Maximum days past due |
| `pageSize` | Yes | -- | Results per page |
| `pageToken` | No | -- | Cursor for next page |

**Response `200`**
```json
{
  "accounts": [...],
  "totalCount": 42,
  "nextPageToken": "..."
}
```

### GET /api/ledger/schedule/[accountId]

Returns the repayment schedule with per-instalment status (`scheduled`, `paid`, `overdue`, `partial`).

---

## 6. ECL Queries

Two endpoints for Expected Credit Loss data retrieval.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/ledger/ecl/[accountId]` | ECL allowance details for an account | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ledger/ecl/portfolio` | Portfolio-wide ECL summary by bucket | `hasAnyRole` | gRPC Ledger |

### GET /api/ledger/ecl/[accountId]

Returns the ECL allowance breakdown for a specific account including stage classification, PD rate applied, LGD, and calculated allowance.

### GET /api/ledger/ecl/portfolio

Returns aggregated ECL summary grouped by delinquency bucket, including total exposure, weighted PD, and total allowance per bucket.

---

## 7. ECL Recalculation

Two endpoints for triggering ECL recalculations.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| POST | `/api/ledger/ecl/recalc/bulk` | Recalculate ECL for specific accounts (max 100) | `canService` | gRPC Ledger |
| POST | `/api/ledger/ecl/recalc/portfolio` | Trigger portfolio-wide ECL recalculation | `canService` | gRPC Ledger |

### POST /api/ledger/ecl/recalc/bulk

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountIds` | string[] | Yes | Account IDs to recalculate (max 100) |

### POST /api/ledger/ecl/recalc/portfolio

No request body. Triggers a full portfolio recalculation.

---

## 8. ECL Configuration

Seven endpoints for managing ECL model parameters (overlay multiplier, PD rates, LGD).

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/ecl-config` | Current ECL configuration | `hasAnyRole` | gRPC Ledger, MongoDB/Payload |
| GET | `/api/ecl-config/history` | Configuration change history | `hasAnyRole` | gRPC Ledger |
| GET | `/api/ecl-config/pending` | Pending scheduled config changes | `hasAnyRole` | gRPC Ledger |
| PUT | `/api/ecl-config/overlay` | Update overlay multiplier | `hasApprovalAuthority` | gRPC Ledger |
| PUT | `/api/ecl-config/pd-rate` | Update PD rate by bucket | `hasApprovalAuthority` | gRPC Ledger |
| POST | `/api/ecl-config/schedule` | Schedule a future config change | `hasApprovalAuthority` | gRPC Ledger |
| DELETE | `/api/ecl-config/pending/[changeId]` | Cancel a pending scheduled change | `hasApprovalAuthority` | gRPC Ledger |

### GET /api/ecl-config

Returns current configuration enriched with user display names from Payload.

**Response `200`**
```json
{
  "overlayMultiplier": 1.0,
  "overlayUpdatedAt": "2026-04-03T00:00:00.000Z",
  "overlayUpdatedBy": "user-id",
  "overlayUpdatedByName": "Jane Smith",
  "pdRates": [
    {
      "bucket": "current",
      "rate": 0.03,
      "updatedAt": "...",
      "updatedBy": "...",
      "updatedByName": "System Default"
    },
    { "bucket": "early_arrears", "rate": 0.25, "..." : "..." },
    { "bucket": "late_arrears", "rate": 0.55, "..." : "..." },
    { "bucket": "default", "rate": 1.0, "..." : "..." }
  ],
  "lgd": 0.50,
  "lgdUpdatedAt": "...",
  "lgdUpdatedBy": "...",
  "lgdUpdatedByName": "..."
}
```

**Fallback `200`** (ledger unavailable): Returns system defaults with `_fallback: true`.

Bucket mapping from legacy names: `CURRENT` -> `current`, `DAYS_1_30` -> `early_arrears`, `DAYS_31_60` / `DAYS_61_90` -> `late_arrears`, `DAYS_90_PLUS` -> `default`.

### PUT /api/ecl-config/overlay

**Request Body** (validated by `UpdateOverlaySchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `overlayMultiplier` | string | Yes* | New overlay value (decimal string) |
| `value` | number | Yes* | Alternative numeric format (* one of the two is required) |

**Response `200`**
```json
{
  "success": true,
  "newValue": 1.15,
  "previousValue": 1.0,
  "updatedAt": "2026-04-03T00:00:00.000Z"
}
```

### PUT /api/ecl-config/pd-rate

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `bucket` | string | Yes | Bucket name (`current`, `early_arrears`, `late_arrears`, `default`) |
| `rate` | number | Yes | New PD rate (0.0 - 1.0) |

### POST /api/ecl-config/schedule

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `effectiveDate` | string | Yes | ISO 8601 date for the change to take effect |
| `changes` | object | Yes | Configuration changes to apply |

### DELETE /api/ecl-config/pending/[changeId]

**Path Parameters**

| Param | Description |
|-------|-------------|
| `changeId` | ID of the pending config change to cancel |

---

## 9. Write-Off Commands (Event-Sourced)

Four endpoints implementing write-off request lifecycle via Redis event streams. All return `202 Accepted` on success with correlation IDs for polling.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| POST | `/api/commands/writeoff/request` | Submit a new write-off request | `canService` | Redis Events |
| POST | `/api/commands/writeoff/approve` | Approve a pending request | `hasApprovalAuthority` | Redis Events, gRPC Ledger, MongoDB/Payload |
| POST | `/api/commands/writeoff/reject` | Reject a pending request | `hasApprovalAuthority` | Redis Events, MongoDB/Payload |
| POST | `/api/commands/writeoff/cancel` | Cancel a pending request | `canService`* | Redis Events, MongoDB/Payload |

*Cancel authorization: the original requester (with `canService`) OR any user with `hasApprovalAuthority` can cancel a request. Non-requester users without approval authority receive `403`.

### POST /api/commands/writeoff/request

Publishes `writeoff.requested.v1` event to Redis stream `inbox:billie-servicing:internal`.

**Request Body** (validated by `WriteOffRequestCommandSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `loanAccountId` | string | Yes | Loan account ID |
| `customerId` | string | Yes | Customer ID |
| `customerName` | string | Yes | Customer display name |
| `accountNumber` | string | Yes | Loan account number |
| `amount` | number | Yes | Write-off amount |
| `originalBalance` | number | Yes | Balance at time of request |
| `reason` | string | Yes | Reason for write-off |
| `notes` | string | No | Additional notes |
| `priority` | string | No | Request priority |

**Response `202`**
```json
{
  "eventId": "evt-uuid",
  "requestId": "req-uuid"
}
```

**Error `503`** (Redis publish failure)
```json
{
  "error": {
    "code": "EVENT_PUBLISH_FAILED",
    "message": "Failed to submit write-off request. Please try again."
  }
}
```

### POST /api/commands/writeoff/approve

Publishes `writeoff.approved.v1` event. Additionally calls gRPC `writeOff` to post the write-off transaction to the ledger before publishing the approval event.

**Request Body** (validated by `WriteOffApproveCommandSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requestId` | string | Yes | Write-off request ID |
| `requestNumber` | string | Yes | Human-readable request number |
| `comment` | string | Yes | Approver's comment |

Validates that the request exists and has `status: 'pending'` before proceeding. Returns `404` if not found, `400` if already processed.

**Response `202`**: Same envelope as request, including `ledgerEventId` and `transactionId` in the event payload.

### POST /api/commands/writeoff/reject

Publishes `writeoff.rejected.v1` event.

**Request Body** (validated by `WriteOffRejectCommandSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requestId` | string | Yes | Write-off request ID |
| `requestNumber` | string | Yes | Human-readable request number |
| `reason` | string | Yes | Rejection reason |

**Response `202`**: Same envelope.

### POST /api/commands/writeoff/cancel

Publishes `writeoff.cancelled.v1` event.

**Request Body** (validated by `WriteOffCancelCommandSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requestId` | string | Yes | Write-off request ID |
| `requestNumber` | string | Yes | Human-readable request number |

**Response `202`**: Same envelope.

---

## 10. Export Operations

Five endpoints for creating, listing, polling, downloading, and retrying export jobs. Exports are backed by the gRPC ledger service with ownership enforcement.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| POST | `/api/export/jobs` | Create an export job | `canService` | gRPC Ledger |
| GET | `/api/export/jobs` | List authenticated user's export jobs | `hasAnyRole` | gRPC Ledger |
| GET | `/api/export/jobs/[jobId]` | Get export job status | `hasAnyRole` | gRPC Ledger |
| GET | `/api/export/jobs/[jobId]/result` | Download export file (CSV/JSON) | `hasAnyRole` | gRPC Ledger |
| POST | `/api/export/jobs/[jobId]/retry` | Retry a failed export | `canService` | gRPC Ledger |

### POST /api/export/jobs

**Request Body** (validated by `CreateExportJobSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `exportType` | string | Yes | `journal_entries`, `audit_trail`, or `methodology` |
| `exportFormat` | string | No | `csv` or `json` |
| `periodDate` | string | No | Target period date |
| `accountIds` | string[] | No | Specific account IDs to include |
| `dateRangeStart` | string | No | Date range filter start |
| `dateRangeEnd` | string | No | Date range filter end |
| `includeCalculationBreakdown` | boolean | No | Include detailed calculation data |

The `createdBy` field is derived from the authenticated user session (IDOR prevention).

### GET /api/export/jobs

**Query Parameters**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `limit` | No | -- | Max results |
| `includeCompleted` | No | `true` | Include completed jobs |

Only returns jobs belonging to the authenticated user.

**Response `200`**
```json
{
  "jobs": [
    {
      "id": "job-id",
      "type": "journal_entries",
      "format": "csv",
      "status": "pending" | "processing" | "ready" | "failed",
      "createdAt": "...",
      "createdBy": "user-id",
      "completedAt": "...",
      "sizeBytes": 1048576,
      "downloadUrl": "/api/export/jobs/{jobId}/result",
      "errorMessage": null
    }
  ],
  "totalCount": 3
}
```

**Fallback `200`** (ledger unavailable): Returns `{ jobs: [], totalCount: 0, _fallback: true }`.

### GET /api/export/jobs/[jobId]

Returns the current status of a specific export job.

### GET /api/export/jobs/[jobId]/result

Downloads the completed export file. Returns appropriate `Content-Type` header for CSV or JSON format.

### POST /api/export/jobs/[jobId]/retry

Retries a failed export job. Only applicable to jobs with `failed` status.

---

## 11. Investigation and Audit

Seven endpoints for deep-dive account investigation, batch queries, sampling, and trace analysis. Designed for audit, compliance, and debugging workflows.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/investigation/search` | Search accounts in the ledger | `hasAnyRole` | gRPC Ledger |
| POST | `/api/investigation/batch-query` | Query multiple accounts at once (max 100) | `canService` | gRPC Ledger |
| POST | `/api/investigation/sample` | Random sample with filtering criteria | `canService` | gRPC Ledger |
| GET | `/api/investigation/events/[accountId]` | Full event history with user enrichment | `hasAnyRole` | gRPC Ledger, MongoDB/Payload |
| GET | `/api/investigation/carrying-amount/[accountId]` | Carrying amount breakdown | `hasAnyRole` | gRPC Ledger |
| GET | `/api/investigation/trace/accrual/[accountId]` | Accrual calculation trace | `hasAnyRole` | gRPC Ledger |
| GET | `/api/investigation/trace/ecl/[accountId]` | ECL calculation trace | `hasAnyRole` | gRPC Ledger |

### GET /api/investigation/search

**Query Parameters**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | Yes | -- | Search query |
| `limit` | No | 20 | Max results (capped at 100) |

**Fallback `200`** (ledger unavailable): Returns `{ results: [], totalCount: 0, _fallback: true }`.

### POST /api/investigation/batch-query

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountIds` | string[] | Yes | Account IDs to query (max 100) |

### POST /api/investigation/sample

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sampleSize` | number | Yes | Number of accounts to sample |
| `filters` | object | No | Filtering criteria (bucket, status, etc.) |

### GET /api/investigation/events/[accountId]

Returns the complete event history for an account, enriched with user display names from Payload for audit trail readability.

### GET /api/investigation/carrying-amount/[accountId]

Returns the carrying amount decomposition (gross amount, ECL allowance, net carrying amount).

### GET /api/investigation/trace/accrual/[accountId]

Returns a step-by-step trace of the accrual calculation for debugging and audit verification.

### GET /api/investigation/trace/ecl/[accountId]

Returns a step-by-step trace of the ECL calculation including PD, LGD, EAD inputs and intermediate results.

---

## 12. Period Close

Five endpoints for managing accounting period close workflow (preview, finalize, acknowledge anomalies, history).

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| POST | `/api/period-close/preview` | Generate period close preview | `canService` | gRPC Ledger |
| POST | `/api/period-close/finalize` | Finalize the period close | `hasApprovalAuthority` | gRPC Ledger |
| GET | `/api/period-close/[periodDate]` | Get a finalized period close | `hasAnyRole` | gRPC Ledger |
| POST | `/api/period-close/acknowledge-anomaly` | Acknowledge an anomaly in the close | `hasApprovalAuthority` | gRPC Ledger |
| GET | `/api/period-close/history` | List previously closed periods | `hasAnyRole` | gRPC Ledger |

### POST /api/period-close/preview

Generates a preview of what the period close will look like, without committing. Returns journal entries, anomalies, and summary totals.

### POST /api/period-close/finalize

**Request Body** (validated by `FinalizePeriodCloseSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `previewId` | string | Yes | Preview ID from the preview step |
| `finalizedBy` | string | No | Ignored; derived from authenticated session |

### GET /api/period-close/[periodDate]

**Path Parameters**

| Param | Description |
|-------|-------------|
| `periodDate` | Period date (e.g. `2026-03-31`) |

### POST /api/period-close/acknowledge-anomaly

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `anomalyId` | string | Yes | ID of the anomaly to acknowledge |
| `comment` | string | Yes | Acknowledgement comment |

### GET /api/period-close/history

Returns a list of all finalized period closes with summary data.

---

## 13. Loan Agreement and Contact Notes

Two endpoints for document retrieval and contact note lifecycle management.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| GET | `/api/loan-agreement` | Stream signed loan agreement from S3 | Authenticated | S3, MongoDB/Payload |
| PATCH | `/api/contact-notes/[id]/amend` | Mark a contact note as amended | `canService` | MongoDB/Payload |

### GET /api/loan-agreement

Streams the signed loan agreement document (PDF or HTML) from S3 directly to the browser. The `Content-Disposition` header is set to `inline` for in-browser viewing.

**Query Parameters**

| Param | Required | Description |
|-------|----------|-------------|
| `accountId` | Yes | Loan account ID (used to look up S3 URI) |

**Response `200`**: Binary stream with appropriate `Content-Type` (e.g. `application/pdf`).

**Error `404`**: Account exists but has no signed agreement.

**Error `502`**: S3 retrieval failure.

### PATCH /api/contact-notes/[id]/amend

Marks a contact note as `amended`. Uses a direct database write (`payload.db.updateOne()`) to bypass Payload's required-field validation on sparse updates (documented workaround for Payload v3.45.0).

**Path Parameters**

| Param | Description |
|-------|-------------|
| `id` | Payload document ID of the contact note |

No request body required.

**Response `200`**
```json
{
  "doc": { "id": "note-id", "status": "amended" }
}
```

**Error `400`**: Note is already amended (`INVALID_STATE`).

**Error `404`**: Contact note not found.

---

## 14. File Uploads

One endpoint for generating presigned S3 upload URLs.

| Method | Path | Purpose | Auth Level | External Services |
|--------|------|---------|------------|-------------------|
| POST | `/api/uploads/presigned-url` | Generate S3 presigned PUT URL for disbursement attachments | `canService` | S3, MongoDB/Payload |

### POST /api/uploads/presigned-url

Validates the loan account exists, sanitizes the file name and account number (preventing S3 path traversal), and generates a presigned PUT URL with a 5-minute expiry.

**Request Body** (validated by `PresignedUrlSchema`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountNumber` | string | Yes | Loan account number (used as S3 path prefix) |
| `fileName` | string | Yes | Original file name |
| `contentType` | string | Yes | MIME type of the file |

S3 key format: `{accountNumber}/docs/{timestamp}-{fileName}`

**Response `200`**
```json
{
  "uploadUrl": "https://s3.ap-southeast-2.amazonaws.com/...",
  "s3Key": "LA-001/docs/1712102400000-proof.pdf",
  "s3Uri": "s3://bucket-name/LA-001/docs/1712102400000-proof.pdf"
}
```

**Error `404`**: Loan account not found.

---

## Authentication Details

All routes (except `/api/health`) require Payload CMS cookie-based authentication (`payload-token` cookie). Two authentication patterns are used:

### Pattern 1: `requireAuth(accessFn)`

Used by most routes. A helper that authenticates the user and checks the access function in one step. Returns `{ user, payload }` on success or `{ error: NextResponse }` on failure.

```
const auth = await requireAuth(canService)
if ('error' in auth) return auth.error
```

### Pattern 2: Direct `payload.auth()`

Used by some routes (dashboard, write-off approve/reject, loan-agreement, pending-disbursements) that need the Payload instance before auth or have custom auth logic.

```
const { user } = await payload.auth({ headers: new Headers({ cookie: cookieHeader }) })
```

### Access Functions

| Function | Roles | Description |
|----------|-------|-------------|
| `hasAnyRole(user)` | admin, supervisor, operations, readonly | Any staff member |
| `canService(user)` | admin, supervisor, operations | Can perform servicing operations |
| `hasApprovalAuthority(user)` | admin, supervisor | Can approve/reject write-offs, adjustments, waivers |
| `isAdmin(user)` | admin | Full system access |

---

## Common Error Responses

All error responses follow one of two envelopes:

### Structured error envelope
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message.",
    "details": {}
  }
}
```

Error codes: `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (400), `INVALID_STATE` (400), `EVENT_PUBLISH_FAILED` (503), `LEDGER_ERROR` (503), `INTERNAL_ERROR` (500).

### Simple error envelope
```json
{
  "error": "Short message",
  "details": "Longer explanation or field errors",
  "message": "User-friendly message"
}
```

### HTTP Status Code Reference

| Status | Meaning | When Used |
|--------|---------|-----------|
| 200 | OK | Successful read or mutation |
| 202 | Accepted | Write-off command published to Redis (async processing) |
| 400 | Bad Request | Validation failure, invalid state transition |
| 401 | Unauthorized | Missing or expired `payload-token` cookie |
| 403 | Forbidden | Insufficient role for the operation |
| 404 | Not Found | Resource does not exist |
| 409 | Conflict | Version conflict or duplicate operation (e.g. already disbursed) |
| 422 | Unprocessable Entity | gRPC `FAILED_PRECONDITION` (business rule violation) |
| 500 | Internal Server Error | Unhandled exception |
| 502 | Bad Gateway | Upstream S3 retrieval failure |
| 503 | Service Unavailable | gRPC ledger or Redis unavailable |
