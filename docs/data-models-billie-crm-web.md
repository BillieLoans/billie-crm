# Data Models: Billie CRM Web

## Overview

Billie CRM is a two-process system with a strict read/write split. The data models span three layers:

1. **Payload CMS Collections** (MongoDB) -- 8 collections storing staff users, read-only event projections, and CRM-writable operational data.
2. **gRPC AccountingLedgerService** (protobuf) -- The external ledger service that owns all financial transaction data. Payload calls it for reads (balances, transactions, schedules) and writes (repayments, fees, write-offs).
3. **Zod Validation Schemas** -- Runtime validation for API route request bodies before they reach the gRPC layer.

### Write Authority

| Data Domain | Written By | Payload Access |
|---|---|---|
| Users, Media, ContactNotes | Payload CMS (direct MongoDB) | Read/Write |
| Customers, Conversations, Applications, LoanAccounts | Python Event Processor (via Redis events) | Read-Only |
| WriteOffRequests | Python Event Processor (CRM-originated events round-trip through Redis) | Read + Create (via event publish) |
| Transactions, Balances, Schedules, ECL, Accruals | AccountingLedgerService (gRPC) | Read via gRPC; Write via gRPC RPCs |

### Data Flow Diagram

```
                        +-------------------+
                        |   Staff Browser   |
                        +--------+----------+
                                 |
                     +-----------v-----------+
                     |   Payload CMS (Next.js)|
                     |   - Custom Admin Views |
                     |   - API Routes         |
                     +---+-------+-------+---+
                         |       |       |
            Direct Write |  gRPC |       | Redis XADD
            (MongoDB)    |       |       | (events)
                         |       |       |
                 +-------v--+ +--v-----+ +--v-----------------+
                 | MongoDB   | | Ledger | | Redis Streams      |
                 | (Users,   | | Service| | inbox:billie-      |
                 |  Media,   | | (gRPC) | |   servicing        |
                 |  Contact  | +--------+ | inbox:billie-      |
                 |  Notes)   |            |   servicing:       |
                 +-------^---+            |   internal         |
                         |                +--+--+--------------+
                         |                   |  |
                         |    +--------------v--v---------+
                         |    | Python Event Processor    |
                         +----|  - Billie Accounts SDK    |
                              |  - Billie Customers SDK   |
                              |  - Write-off handlers     |
                              +---------------------------+
```

---

## 1. Payload CMS Collections

### 1.1 Users (`users`)

**Purpose**: Staff authentication and role-based access control.
**Write Authority**: Payload CMS (direct).
**Admin Group**: Administration

| Field | Type | Required | Unique | Indexed | Description |
|---|---|---|---|---|---|
| `email` | email | Yes (auth) | Yes | Yes | Login username (Payload built-in auth field) |
| `role` | select | Yes | -- | -- | `admin`, `supervisor`, `operations`, `readonly`, `service` |
| `firstName` | text | Yes | -- | -- | Staff first name |
| `lastName` | text | Yes | -- | -- | Staff last name |
| `avatar` | upload (media) | -- | -- | -- | Profile image (relationship to Media) |
| `enableAPIKey` | boolean | -- | -- | -- | Payload built-in API key auth |

**Role Hierarchy**:

| Role | Description | Sidebar Access | Approval Authority | Servicing Ops |
|---|---|---|---|---|
| `admin` | Full system access | All collections visible | Yes | Yes |
| `supervisor` | Operations + approvals | Custom views only | Yes | Yes |
| `operations` | Day-to-day servicing | Custom views only | No | Yes |
| `readonly` | View-only access | Custom views only | No | No |
| `service` | API-only inter-service auth | N/A | No | No |

**Access Control**:
- Read: Admins see all; service accounts see all; users see own record
- Create: Admin only
- Update: Admin can update all; users can update own record; only admin can change `role`
- Delete: Admin only

**Authentication**: Custom JWT strategy (`custom-jwt`) extracts JWT from headers, verifies against `payload.secret`, and looks up user by decoded `id`. Also supports Payload's built-in API key auth.

---

### 1.2 Media (`media`)

**Purpose**: File uploads for avatars, supporting documents.
**Write Authority**: Payload CMS (direct).
**Admin Group**: (default)

| Field | Type | Required | Description |
|---|---|---|---|
| `alt` | text | Yes | Alt text for the uploaded file |
| (upload fields) | (Payload built-in) | -- | `filename`, `mimeType`, `filesize`, `url`, `width`, `height` |

**Access Control**:
- Read: Any authenticated user with a valid role
- Hidden from sidebar for non-admin users

---

### 1.3 Customers (`customers`)

**Purpose**: Read-only projection of customer data from domain events.
**Write Authority**: Python Event Processor only. Payload access is read-only (create/update/delete all return `false`).
**Admin Group**: Supervisor Dashboard

| Field | Type | Required | Unique | Indexed | Description |
|---|---|---|---|---|---|
| `customerId` | text | Yes | Yes | Yes | Domain customer identifier |
| `title` | text | -- | -- | -- | Mr, Mrs, Ms, Dr, etc. |
| `preferredName` | text | -- | -- | -- | Name customer prefers to be called |
| `firstName` | text | -- | -- | -- | First name |
| `middleName` | text | -- | -- | -- | Middle name |
| `lastName` | text | -- | -- | -- | Last name |
| `fullName` | text | -- | -- | -- | Computed full name (set by event processor) |
| `emailAddress` | email | -- | -- | -- | Contact email |
| `mobilePhoneNumber` | text | -- | -- | -- | Contact phone |
| `dateOfBirth` | date | -- | -- | -- | Date of birth |
| `identityVerified` | checkbox | -- | -- | -- | Set `true` on `customer.verified.v1` event |
| `residentialAddress` | group | -- | -- | -- | Structured address (see sub-fields below) |
| `mailingAddress` | group | -- | -- | -- | Mailing address for deliveries |
| `staffFlag` | checkbox | -- | -- | -- | Customer is a Billie staff member |
| `investorFlag` | checkbox | -- | -- | -- | Customer is an investor |
| `founderFlag` | checkbox | -- | -- | -- | Customer is a founder |
| `vulnerableFlag` | checkbox | -- | -- | -- | Customer requires additional care/support |
| `ekycEntityId` | text | -- | -- | -- | eKYC identifier from Frankie |
| `ekycStatus` | select | -- | -- | -- | `successful`, `failed`, `pending` |
| `individualStatus` | select | -- | -- | -- | `LIVING`, `DECEASED`, `MISSING` |
| `identityDocuments` | array | -- | -- | -- | Array of identity documents (see sub-fields) |
| `applications` | relationship[] | -- | -- | -- | Link to Applications collection |
| `conversations` | relationship[] | -- | -- | -- | Link to Conversations collection |
| `loanAccounts` | relationship[] | -- | -- | -- | Link to LoanAccounts collection |

**Residential Address Sub-fields** (`residentialAddress.*`):

| Sub-field | Type | Description |
|---|---|---|
| `streetNumber` | text | From SDK: `street_number` |
| `streetName` | text | From SDK: `street_name` |
| `streetType` | text | From SDK: `street_type` |
| `unitNumber` | text | From SDK: `unit_number` |
| `street` | text | Computed full street address |
| `suburb` | text | From SDK: `suburb` |
| `city` | text | Same as suburb (backward compatibility) |
| `state` | text | State/territory |
| `postcode` | text | Postal code |
| `country` | text | Default: `Australia` |
| `fullAddress` | text | From SDK: `full_address` |

**Identity Documents Sub-fields** (`identityDocuments[].*`):

| Sub-field | Type | Required | Description |
|---|---|---|---|
| `documentType` | select | Yes | `DRIVERS_LICENCE`, `PASSPORT`, `MEDICARE` |
| `documentSubtype` | text | -- | e.g., Medicare Card Colour |
| `documentNumber` | text | Yes | Document number |
| `expiryDate` | date | -- | Document expiry |
| `stateOfIssue` | text | -- | Issuing state |
| `countryOfIssue` | text | -- | Default: `Australia` |
| `additionalInfo` | json | -- | Additional key-value pairs |

**Events Handled** (by Python Event Processor):
- `customer.changed.v1` / `customer.created.v1` / `customer.updated.v1` -- Upsert customer with field mapping from SDK
- `customer.verified.v1` -- Sets `identityVerified: true`, `ekycStatus: 'successful'`
- `applicationDetail_changed` -- Syncs customer data from conversation events

---

### 1.4 Conversations (`conversations`)

**Purpose**: Read-only projection of AI chat conversations from the application process.
**Write Authority**: Python Event Processor only.
**Admin Group**: Supervisor Dashboard

| Field | Type | Required | Unique | Indexed | Description |
|---|---|---|---|---|---|
| `conversationId` | text | Yes | Yes | Yes | Domain conversation identifier |
| `applicationNumber` | text | Yes | -- | Yes | Linked application reference |
| `customerId` | relationship | -- | -- | -- | Link to Customers (may be null initially) |
| `customerIdString` | text | -- | -- | Yes | String customer ID for pre-relationship queries |
| `applicationId` | relationship | -- | -- | -- | Link to Applications (may be null) |
| `status` | select | -- | -- | Yes | `active`, `paused`, `soft_end`, `hard_end`, `approved`, `declined` |
| `startedAt` | date | Yes | -- | -- | Conversation start timestamp |
| `updatedAt` | date | -- | -- | -- | Last update timestamp |
| `utterances` | array | -- | -- | -- | Chat message log (see sub-fields) |
| `purpose` | text | -- | -- | -- | From conversation summary |
| `facts` | array | -- | -- | -- | Key facts from summary (`fact` text field) |
| `version` | number | -- | -- | -- | Optimistic concurrency version (default: 1) |
| `lastUtteranceTime` | date | -- | -- | -- | Timestamp of most recent utterance |
| `finalDecision` | text | -- | -- | -- | `APPROVED`, `DECLINED`, `REFERRED` |
| `assessments` | group | -- | -- | -- | Risk/serviceability assessments (JSON blobs) |
| `noticeboard` | array | -- | -- | -- | Agent internal notes (see sub-fields) |
| `applicationData` | json | -- | -- | -- | Additional application data from events |

**Utterances Sub-fields** (`utterances[].*`):

| Sub-field | Type | Required | Description |
|---|---|---|---|
| `username` | text | -- | `customer` or `assistant` |
| `utterance` | textarea | Yes | Message content |
| `rationale` | textarea | -- | Internal reasoning for assistant responses |
| `createdAt` | date | Yes | Message timestamp |
| `updatedAt` | date | -- | Edit timestamp |
| `answerInputType` | text | -- | Frontend input type hint (e.g., address, email) |
| `prevSeq` | number | -- | Previous sequence number |
| `endConversation` | checkbox | -- | Whether this message ends the conversation |
| `additionalData` | json | -- | Additional frontend enrichment data |

**Assessments Sub-fields** (`assessments.*`):

| Sub-field | Type | Description |
|---|---|---|
| `identityRisk` | json | Identity risk assessment data |
| `serviceability` | json | Serviceability assessment data |
| `fraudCheck` | json | Fraud check assessment data |

**Noticeboard Sub-fields** (`noticeboard[].*`):

| Sub-field | Type | Description |
|---|---|---|
| `agentName` | text | Agent identifier |
| `topic` | text | Topic extracted from agent name |
| `content` | textarea | Note content |
| `timestamp` | date | When posted |

**Access Control**:
- Read: Admin and Supervisor only (`hasApprovalAuthority`)
- Create/Update/Delete: Denied (event processor only)

**Events Handled**:
- `conversation_started` -- Creates conversation document
- `user_input` / `assistant_response` -- Appends utterance (capped array)
- `applicationDetail_changed` -- Updates application details, syncs customer
- `identityRisk_assessment` / `serviceability_assessment_results` / `fraudCheck_assessment` -- Updates assessment blobs
- `noticeboard_updated` -- Appends agent notes (capped array)
- `final_decision` -- Sets status and `finalDecision`
- `conversation_summary` -- Sets `purpose` and `facts`

---

### 1.5 Applications (`applications`)

**Purpose**: Read-only projection of loan application tracking data.
**Write Authority**: Python Event Processor (via conversation events).
**Admin Group**: Supervisor Dashboard

| Field | Type | Required | Unique | Indexed | Description |
|---|---|---|---|---|---|
| `applicationNumber` | text | Yes | Yes | Yes | Unique application reference |
| `customerId` | relationship | Yes | -- | -- | Link to Customers |
| `loanPurpose` | text | -- | -- | -- | Purpose of the loan |
| `loanAmount` | number | -- | -- | -- | Requested loan amount (AUD) |
| `loanFee` | number | -- | -- | -- | Calculated at 5% of loan amount |
| `loanTotalPayable` | number | -- | -- | -- | Loan amount + fee |
| `loanTerm` | number | -- | -- | -- | Term in days/months |
| `customerAttestationAcceptance` | checkbox | -- | -- | -- | Customer attestation accepted |
| `statementCaptureConsentProvided` | checkbox | -- | -- | -- | Bank statement consent given |
| `statementCaptureCompleted` | checkbox | -- | -- | -- | Bank statement capture completed |
| `productOfferAcceptance` | checkbox | -- | -- | -- | Product offer accepted |
| `applicationOutcome` | select | -- | -- | Yes | `pending`, `approved`, `declined`, `withdrawn` |
| `applicationProcess` | group | -- | -- | -- | State machine for workflow (see sub-fields) |
| `assessments` | group | -- | -- | -- | Risk/serviceability/fraud assessments (JSON) |
| `noticeboard` | array | -- | -- | -- | Agent notes with version history |
| `conversations` | relationship[] | -- | -- | -- | Link to Conversations |
| `version` | number | -- | -- | -- | Optimistic concurrency version |

**Application Process Sub-fields** (`applicationProcess.*`):

| Sub-field | Type | Description |
|---|---|---|
| `currentProcessStage` | text | Current stage name |
| `currentProcessStep` | text | Current step within stage |
| `startedAt` | date | Process start timestamp |
| `updatedAt` | date | Last process update |
| `applicationProcessState` | array | Stages with steps, prompts, business logic |
| `conversation` | array | Process conversation log (role, content, timestamp) |

**Access Control**:
- Read: Admin and Supervisor only (`hasApprovalAuthority`)
- Create/Update/Delete: Denied (event processor only)

---

### 1.6 LoanAccounts (`loan-accounts`)

**Purpose**: Read-only projection of loan account state from ledger events.
**Write Authority**: Python Event Processor only.
**Admin Group**: Servicing
**Has Custom View**: Servicing tab (`LoanAccountServicing` component)

| Field | Type | Required | Unique | Indexed | Description |
|---|---|---|---|---|---|
| `loanAccountId` | text | Yes | Yes | Yes | Unique ledger account ID |
| `accountNumber` | text | Yes | -- | Yes | Human-readable account number |
| `customerId` | relationship | -- | -- | Yes | Link to Customers |
| `customerIdString` | text | -- | -- | Yes | String customer ID for queries |
| `customerName` | text | -- | -- | -- | Denormalized for list view performance |
| `accountStatus` | select | Yes | -- | Yes | `pending_disbursement`, `active`, `paid_off`, `in_arrears`, `written_off` |
| `sdkStatus` | text | -- | -- | -- | Original SDK status (`PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`) |
| `signedLoanAgreementUrl` | text | -- | -- | -- | S3 URI for signed loan agreement |
| `loanTerms` | group | -- | -- | -- | Original loan terms snapshot |
| `balances` | group | -- | -- | -- | Current balance snapshot |
| `lastPayment` | group | -- | -- | -- | Most recent payment details |
| `repaymentSchedule` | group | -- | -- | -- | Full repayment schedule with payment statuses |

**Loan Terms Sub-fields** (`loanTerms.*`):

| Sub-field | Type | Description |
|---|---|---|
| `loanAmount` | number | Original loan amount (from SDK: `loan_amount`) |
| `loanFee` | number | Fee amount (from SDK: `loan_fee`) |
| `totalPayable` | number | Total to be repaid (from SDK: `loan_total_payable`) |
| `openedDate` | date | Account opening date (from SDK: `opened_date`) |

**Balances Sub-fields** (`balances.*`):

| Sub-field | Type | Description |
|---|---|---|
| `currentBalance` | number | Current outstanding balance (from SDK: `current_balance`) |
| `totalOutstanding` | number | Total amount currently owed |
| `totalPaid` | number | Total amount paid to date |

**Repayment Schedule Sub-fields** (`repaymentSchedule.*`):

| Sub-field | Type | Description |
|---|---|---|
| `scheduleId` | text | Unique schedule identifier |
| `numberOfPayments` | number | Total scheduled payments (from SDK: `n_payments`) |
| `paymentFrequency` | select | `weekly`, `fortnightly`, `monthly` |
| `createdDate` | date | Schedule creation date |
| `payments` | array | Individual scheduled payments (see below) |

**Payment Sub-fields** (`repaymentSchedule.payments[].*`):

| Sub-field | Type | Required | Description |
|---|---|---|---|
| `paymentNumber` | number | Yes | Sequence number (1, 2, 3...) |
| `dueDate` | date | Yes | Scheduled due date |
| `amount` | number | Yes | Scheduled payment amount |
| `status` | select | -- | `scheduled`, `paid`, `missed`, `partial` |
| `amountPaid` | number | -- | Actual amount paid |
| `amountRemaining` | number | -- | Remaining owed on this payment |
| `paidDate` | date | -- | Date payment was completed |
| `linkedTransactionIds` | json | -- | Transaction IDs linked to this payment |
| `lastUpdated` | date | -- | Last update timestamp |

**SDK Status Mapping** (Event Processor):

| SDK Status | Payload `accountStatus` |
|---|---|
| `PENDING` | `active` |
| `PENDING_DISBURSEMENT` | `pending_disbursement` |
| `ACTIVE` | `active` |
| `SUSPENDED` | `in_arrears` |
| `CLOSED` | `paid_off` |

**Events Handled**:
- `account.created.v1` -- Creates loan account, links customer, maps status
- `account.updated.v1` -- Updates balances, status, last payment; infers `pending_disbursement` to `active` transition
- `account.status_changed.v1` -- Updates status mapping
- `account.schedule.created.v1` -- Sets repayment schedule, preserves existing payment statuses for out-of-order events
- `account.schedule.updated.v1` -- Updates individual payment statuses; creates placeholder entries for out-of-order processing

---

### 1.7 WriteOffRequests (`write-off-requests`)

**Purpose**: Write-off requests requiring approval workflow. Uses event sourcing -- CRM publishes commands to Redis, the event processor creates/updates the MongoDB projection.
**Write Authority**: Python Event Processor (from CRM-originated events). Payload can also create directly via access control.
**Admin Group**: Servicing
**Has Timestamps**: Yes (`createdAt`, `updatedAt`)

| Field | Type | Required | Unique | Indexed | Description |
|---|---|---|---|---|---|
| `requestId` | text | -- | -- | Yes | Event correlation ID (`conv` field) |
| `eventId` | text | -- | -- | Yes | Event ID for polling lookup (`cause` field) |
| `requestNumber` | text | -- | -- | Yes | Human-readable ref (e.g., `WO-20241211-XXXX`) |
| `loanAccountId` | text | Yes | -- | Yes | Target loan account |
| `customerId` | text | Yes | -- | Yes | Associated customer |
| `customerName` | text | -- | -- | -- | Display name |
| `accountNumber` | text | -- | -- | -- | Display account number |
| `amount` | number | Yes | -- | -- | Write-off amount (AUD, min 0) |
| `originalBalance` | number | -- | -- | -- | Balance at time of request |
| `reason` | select | Yes | -- | -- | See reason options below |
| `notes` | textarea | -- | -- | -- | Supporting context |
| `supportingDocuments` | array | -- | -- | -- | Uploaded docs (media upload + description) |
| `status` | select | Yes | -- | Yes | `pending`, `approved`, `rejected`, `cancelled` |
| `priority` | select | -- | -- | -- | `normal`, `high`, `urgent` |
| `requiresSeniorApproval` | checkbox | -- | -- | -- | Threshold flag ($10,000) |
| `requestedBy` | relationship | -- | -- | -- | User who submitted |
| `requestedByName` | text | -- | -- | -- | Requestor name for audit |
| `requestedAt` | date | -- | -- | -- | Submission timestamp |
| `approvalDetails` | group | -- | -- | -- | Approval/rejection details (conditional) |
| `cancellationDetails` | group | -- | -- | -- | Cancellation details (conditional) |

**Reason Options**:
`hardship`, `bankruptcy`, `deceased`, `unable_to_locate`, `fraud_victim`, `disputed`, `aged_debt`, `other`

**Approval Details Sub-fields** (`approvalDetails.*`):

| Sub-field | Type | Description |
|---|---|---|
| `decidedBy` | relationship | Legacy: user who decided (direct writes) |
| `decidedByName` | text | Legacy: decider name |
| `decidedAt` | date | Legacy: decision timestamp |
| `comment` | textarea | Approval/rejection comment |
| `approvedBy` | text | User ID who approved (from event) |
| `approvedByName` | text | Approver name |
| `approvedAt` | date | Approval timestamp |
| `rejectedBy` | text | User ID who rejected (from event) |
| `rejectedByName` | text | Rejector name |
| `rejectedAt` | date | Rejection timestamp |
| `reason` | textarea | Rejection reason (from event) |

**Access Control**:

| Operation | Required Role |
|---|---|
| Read | Any authenticated role (`hasAnyRole`) |
| Create | Operations, Supervisor, Admin (`canService`) |
| Update | Admin, Supervisor (`hasApprovalAuthority`) |
| Delete | Admin only (`isAdmin`) |

**Events Handled**:
- `writeoff.requested.v1` -- Creates new write-off request document
- `writeoff.approved.v1` -- Sets status to `approved`, records approval details
- `writeoff.rejected.v1` -- Sets status to `rejected`, records rejection details
- `writeoff.cancelled.v1` -- Sets status to `cancelled`, records cancellation details

**Event Sourcing Flow**:
1. Staff submits write-off via Payload API route
2. Payload publishes `writeoff.requested.v1` to Redis stream `inbox:billie-servicing:internal`
3. Python event processor consumes event and creates MongoDB document
4. Staff polls for projection by `eventId`
5. Approval/rejection follows same publish-consume-project pattern

---

### 1.8 ContactNotes (`contact-notes`)

**Purpose**: Immutable audit trail of all staff interactions with customers. Notes can only be corrected via an amendment chain -- the original is preserved and marked `amended`.
**Write Authority**: Payload CMS (direct). This is the only domain collection Payload writes to directly.
**Admin Group**: Servicing
**Has Timestamps**: Yes (`createdAt` indexed, `updatedAt`)

| Field | Type | Required | Unique | Indexed | Description |
|---|---|---|---|---|---|
| `customer` | relationship | Yes | -- | Yes | Link to Customers |
| `loanAccount` | relationship | -- | -- | Yes | Link to LoanAccounts (optional) |
| `application` | relationship | -- | -- | -- | Link to Applications (optional) |
| `conversation` | relationship | -- | -- | -- | Link to Conversations (optional) |
| `channel` | select | Yes | -- | -- | `phone`, `email`, `sms`, `internal`, `system` |
| `topic` | select | Yes | -- | -- | `general_enquiry`, `complaint`, `escalation`, `internal_note`, `account_update`, `collections` |
| `contactDirection` | select | -- | -- | -- | `inbound`, `outbound` (for phone/email/sms) |
| `subject` | text | Yes | -- | -- | Brief subject line (max 200 chars) |
| `content` | json | Yes | -- | -- | Full note content (Tiptap JSON document) |
| `priority` | select | -- | -- | -- | `low`, `normal`, `high`, `urgent` |
| `sentiment` | select | -- | -- | -- | `positive`, `neutral`, `negative`, `escalation` |
| `createdBy` | relationship | Yes | -- | -- | Auto-populated from authenticated user |
| `amendsNote` | relationship | -- | -- | Yes | Self-referential: the note this corrects |
| `status` | select | Yes | -- | Yes | `active`, `amended` |
| `createdAt` | date | -- | -- | Yes | Indexed for timeline query performance |

**Immutability Enforcement** (via `beforeChange` hook):
- On create: auto-populates `createdBy` from session
- On update: strips all fields except `status`; `status` can only transition to `amended`
- Amendment workflow: create a new note with `amendsNote` pointing to the original, then set the original's status to `amended`

**Content Validation** (via `beforeValidate` hook):
- Validates `content` field matches Tiptap JSON schema: `{ type: "doc", content: [...] }`

**Access Control**:

| Operation | Required Role |
|---|---|
| Read | Any authenticated role |
| Create | Operations, Supervisor, Admin |
| Update | Operations, Supervisor, Admin (status field only) |
| Delete | Admin only |

---

## 2. Collection Relationships

```
+----------------+       1:N       +------------------+
|   Customers    |<----------------|   LoanAccounts   |
|  (customerId)  |                 | (loan-accounts)  |
+-------+--------+                 +------------------+
        |
        | 1:N     +------------------+
        +-------->|  Applications    |
        |         | (applications)   |
        |         +--------+---------+
        |                  |
        | 1:N     +--------v---------+       N:1
        +-------->|  Conversations   |<------+
        |         | (conversations)  |       |
        |         +------------------+       |
        |                              (applicationId)
        | 1:N     +------------------+
        +-------->|  ContactNotes    |-----> LoanAccounts (optional)
                  | (contact-notes)  |-----> Applications (optional)
                  +--------+---------+-----> Conversations (optional)
                           |
                           | self-ref (amendsNote)
                           v
                  +------------------+
                  |  ContactNotes    |  (amended original)
                  +------------------+

+----------------+       1:N       +------------------+
|     Users      |<----------------|  WriteOffRequests|
| (requestedBy)  |                 | (write-off-      |
+-------+--------+                 |  requests)       |
        |                          +------------------+
        | 1:1
        v
+----------------+
|     Media      |  (avatar upload)
+----------------+
```

---

## 3. gRPC AccountingLedgerService

The external ledger service is defined in `proto/accounting_ledger.proto`. Payload communicates with it via the gRPC client at `src/server/grpc-client.ts`.

### 3.1 Enums

| Enum | Values |
|---|---|
| `TransactionType` | `DISBURSEMENT`, `ESTABLISHMENT_FEE`, `REPAYMENT`, `LATE_FEE`, `DISHONOUR_FEE`, `FEE_WAIVER`, `ADJUSTMENT`, `WRITE_OFF` |
| `ExportType` | `JOURNAL_ENTRIES`, `AUDIT_TRAIL`, `METHODOLOGY` |
| `ExportFormat` | `CSV`, `JSON` |
| `ExportStatus` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |

### 3.2 Core Data Messages

#### Transaction

| Field | Type | Description |
|---|---|---|
| `transaction_id` | string | Unique transaction identifier |
| `loan_account_id` | string | Parent account |
| `type` | TransactionType | Transaction category |
| `transaction_date` | Timestamp | When recorded |
| `effective_date` | string | YYYY-MM-DD format |
| `principal_delta` | string | Change to principal (decimal as string) |
| `fee_delta` | string | Change to fees |
| `principal_after` | string | Principal balance after |
| `fee_after` | string | Fee balance after |
| `total_delta` | string | Total change |
| `total_after` | string | Total balance after |
| `description` | string | Human-readable description |
| `reference_type` | string | External reference type |
| `reference_id` | string | External reference ID |
| `metadata` | map | Key-value metadata |
| `created_by` | string | Operator/system that created |
| `created_at` | Timestamp | Creation timestamp |
| `portfolio_entry_id` | string | Portfolio tracking ID |
| `notes` | string (optional) | Operator notes (max 1000 chars) |

#### LedgerRecordResponse (Full Account State)

| Field | Type | Description |
|---|---|---|
| `loan_account_id` | string | Account identifier |
| `account_number` | string | Human-readable number |
| `customer_id` | string | Customer identifier |
| `application_number` | string | Application reference |
| `disbursed_principal` | string | Original principal |
| `establishment_fee` | string | Original fee |
| `total_repayable` | string | Total to be repaid |
| `principal_balance` | string | Current principal outstanding |
| `fee_balance` | string | Current fee outstanding |
| `total_outstanding` | string | Total owed |
| `total_paid` | string | Total payments received |
| `transaction_count` | int32 | Number of transactions |
| `last_transaction_id` | string (optional) | Most recent transaction |
| `schedule_id` | string (optional) | Repayment schedule reference |
| `created_at` / `updated_at` | Timestamp | Record timestamps |

#### GetBalanceResponse

| Field | Type | Description |
|---|---|---|
| `principal_balance` | string | Principal outstanding |
| `fee_balance` | string | Fees outstanding |
| `total_outstanding` | string | Total owed |
| `as_of` | Timestamp | Point-in-time reference |

### 3.3 Service RPCs (Grouped by Domain)

#### Read Operations

| RPC | Request | Response | Description |
|---|---|---|---|
| `GetTransactions` | loan_account_id, limit, date filters, type_filter | transactions[], total_count | Transaction history |
| `GetBalance` | loan_account_id | principal/fee/total balances | Current balance |
| `GetLedgerRecord` | loan_account_id | Full account details | Complete ledger state |
| `GetStatement` | loan_account_id, period_start, period_end | Statement with line items | Customer statement |
| `WatchTransactions` | loan_account_id, from_transaction_id | stream of Transaction | Real-time transaction stream |
| `GetScheduleWithStatus` | loan_account_id or schedule_id or application_number | Instalments with statuses + summary | Schedule with payment tracking |

#### Write Operations (Event-Sourced)

| RPC | Key Fields | Returns | Description |
|---|---|---|---|
| `RecordRepayment` | loan_account_id, amount, payment_id, idempotency_key | Transaction + allocation details | Fee-first allocation; optional instalment targeting |
| `ApplyLateFee` | loan_account_id, fee_amount, days_past_due | Transaction | Apply late fee |
| `ApplyDishonourFee` | loan_account_id, fee_amount, reference_id | Transaction | Failed direct debit fee |
| `WaiveFee` | loan_account_id, waiver_amount, reason, approved_by | Transaction | Waive fees |
| `WriteOff` | loan_account_id, reason, approved_by | Transaction | Write off balance |
| `MakeAdjustment` | loan_account_id, principal_delta, fee_delta, reason, approved_by | Transaction | Manual adjustment |
| `DisburseLoan` | loan_account_id, disbursement_amount, bank_reference | Disbursement + fee transaction IDs | Disburse and activate account |

All write operations support `idempotency_key` (24h TTL) and return `idempotent_replay: true` for duplicate requests.

#### Account Aging

| RPC | Description |
|---|---|
| `GetAccountAging` | Current DPD, bucket, overdue amount for one account |
| `GetOverdueAccounts` | Paginated list of overdue accounts with bucket/DPD filters |

#### Revenue Recognition (Accrued Yield)

| RPC | Description |
|---|---|
| `GetAccruedYield` | Current cumulative accrual, daily rate, completion status |
| `GetAccrualEventHistory` | Accrual event log with gap detection |

#### ECL (Expected Credit Loss)

| RPC | Description |
|---|---|
| `GetECLAllowance` | Per-account ECL with PD rate, overlay, carrying amount |
| `GetPortfolioECL` | Portfolio-wide ECL aggregated by aging bucket |
| `TriggerPortfolioECLRecalculation` | Batch recalculation of all accounts |
| `TriggerBulkECLRecalculation` | Recalculate specific accounts (max 100) |

#### ECL Configuration

| RPC | Description |
|---|---|
| `GetECLConfig` | Current overlay multiplier and PD rates |
| `UpdateOverlayMultiplier` | Change management overlay |
| `UpdatePDRate` | Change PD rate for a specific bucket |
| `GetECLConfigHistory` | Audit trail of config changes |
| `ScheduleECLConfigChange` | Future-dated config change |
| `GetPendingConfigChanges` | List pending scheduled changes |
| `CancelPendingConfigChange` | Cancel a pending change |
| `ApplyPendingConfigChanges` | Apply changes that have reached effective date |

#### Investigation and Traceability

| RPC | Description |
|---|---|
| `GetEventHistory` | Full raw event history for an account (cursor-paginated) |
| `TraceECLToSource` | Trace ECL calculations to triggering events (batch) |
| `TraceAccruedYieldToSource` | Trace accrual calculations to source events (batch) |
| `SearchAccounts` | Search by account_id, customer_id, or account_number |
| `BatchAccountQuery` | Batch lookup of up to 100 accounts |
| `GenerateRandomSample` | Random sample by criteria (for audit) |
| `GetCarryingAmountBreakdown` | Principal + accrued yield verification |
| `GetEventProcessingStatus` | Health monitoring for event stream consumers |

#### Period-End Close

| RPC | Description |
|---|---|
| `PreviewPeriodClose` | Generate preview with ECL/accrual totals, anomalies, reconciliation |
| `FinalizePeriodClose` | Lock period, generate journal entries |
| `GetPeriodClose` | Retrieve finalized period data |
| `GetClosedPeriods` | List all closed period dates |
| `AcknowledgeAnomaly` | Acknowledge a preview anomaly |

#### Exports

| RPC | Description |
|---|---|
| `CreateExportJob` | Create journal entries, audit trail, or methodology export |
| `GetExportStatus` | Poll export job status |
| `GetExportResult` | Download export data |
| `RetryExport` | Retry a failed export |
| `ListExportJobs` | List user's export jobs |

#### Portfolio and Reconciliation

| RPC | Description |
|---|---|
| `GetPortfolioSummary` | Point-in-time receivables (principal + fee) |
| `GetGLReconciliation` | Period-based income statement with integrity checks |

---

## 4. Zod Validation Schemas

Located in `src/lib/schemas/`. These validate API route request bodies before calling gRPC.

### 4.1 Ledger Mutation Schemas (`src/lib/schemas/ledger.ts`)

| Schema | Key Fields | Validation Rules |
|---|---|---|
| `RecordRepaymentSchema` | `loanAccountId`, `amount`, `paymentId` | Amount must be positive decimal string (e.g., `"100.00"`) |
| `WaiveFeeSchema` | `loanAccountId`, `waiverAmount`, `reason` | Positive decimal string; reason required (max 1000 chars) |
| `WriteOffLedgerSchema` | `loanAccountId`, `reason` | Reason required (max 1000 chars) |
| `MakeAdjustmentSchema` | `loanAccountId`, `principalDelta`, `feeDelta`, `reason` | Signed decimal strings allowed (e.g., `"-50.00"`) |
| `ApplyLateFeeSchema` | `loanAccountId`, `feeAmount`, `daysPastDue` | Positive decimal; daysPastDue is non-negative integer |
| `ApplyDishonourFeeSchema` | `loanAccountId`, `feeAmount` | Positive decimal string |
| `DisburseLoanSchema` | `loanAccountId`, `bankReference` | Bank reference required; optional disbursement amount, notes |

### 4.2 API Schemas (`src/lib/schemas/api.ts`)

| Schema | Purpose | Key Fields |
|---|---|---|
| `UpdatePDRateSchema` | ECL PD rate update | `bucket` (required), `rate` (0-1) |
| `UpdateOverlaySchema` | ECL overlay multiplier | `value` (number >= 0) or `overlayMultiplier` (string) |
| `FinalizePeriodCloseSchema` | Finalize period close | `previewId` (required) |
| `PeriodClosePreviewSchema` | Request preview | `periodDate` (YYYY-MM-DD) |
| `AcknowledgeAnomalySchema` | Acknowledge anomaly | `previewId`, `anomalyId` |
| `CreateExportJobSchema` | Create export | `exportType` (required); optional `periodDate`, `accountIds`, date range |
| `ScheduleConfigChangeSchema` | Schedule ECL config change | `parameter` or `fieldName`, `newValue`, `effectiveDate` (YYYY-MM-DD) |
| `BatchQuerySchema` | Batch account lookup | `accountIds` (1-100 strings) |
| `SampleQuerySchema` | Random sample | Optional `bucket`, ECL range, carrying amount range, `sampleSize` (1-500) |
| `BulkRecalcSchema` | Bulk ECL recalculation | `accountIds` (1-100 strings) |
| `PortfolioRecalcSchema` | Portfolio ECL recalculation | Optional `batchSize` (1-10000) |
| `PresignedUrlSchema` | Document upload | `accountNumber`, `fileName`, `contentType` (allowed: PDF, JPEG, PNG, WebP, Excel, CSV) |

### 4.3 Dashboard Schemas (`src/lib/schemas/dashboard.ts`)

| Schema | Purpose | Key Fields |
|---|---|---|
| `RecentAccountSchema` | Recently created account | `loanAccountId`, `accountNumber`, `customerName`, `loanAmount`, `createdAt` |
| `PendingDisbursementSchema` | Loan pending disbursement | Same as RecentAccount + `signedLoanAgreementUrl` |
| `UpcomingPaymentSchema` | Upcoming/overdue payment | `dueDate`, `amount`, `daysUntilDue`, `status` (`overdue`, `due_today`, `upcoming`) |
| `DashboardResponseSchema` | Full dashboard API response | `user`, `actionItems`, `recentCustomersSummary`, `recentAccounts`, `upcomingPayments`, `pendingDisbursements`, `systemStatus` |
| `DashboardQuerySchema` | Dashboard query params | `recentCustomerIds` (comma-separated, max 10) |

---

## 5. Event Processor Models

The Python event processor (`event-processor/`) consumes events from two Redis streams and writes directly to MongoDB.

### 5.1 Redis Streams

| Stream | Direction | Content |
|---|---|---|
| `inbox:billie-servicing` | External to CRM | Account, customer, conversation events from domain services |
| `inbox:billie-servicing:internal` | CRM to CRM (round-trip) | Write-off commands published by Payload, consumed by event processor |

### 5.2 Event Routing

| Event Type | SDK Parser | Handler | Target Collection |
|---|---|---|---|
| `account.created.v1` | `billie_accounts_events` | `handle_account_created` | `loan-accounts` |
| `account.updated.v1` | `billie_accounts_events` | `handle_account_updated` | `loan-accounts` |
| `account.status_changed.v1` | `billie_accounts_events` | `handle_account_status_changed` | `loan-accounts` |
| `account.schedule.created.v1` | `billie_accounts_events` | `handle_schedule_created` | `loan-accounts` |
| `account.schedule.updated.v1` | `billie_accounts_events` | `handle_schedule_updated` | `loan-accounts` |
| `customer.changed.v1` | `billie_customers_events` | `handle_customer_changed` | `customers` |
| `customer.created.v1` | `billie_customers_events` | `handle_customer_changed` | `customers` |
| `customer.updated.v1` | `billie_customers_events` | `handle_customer_changed` | `customers` |
| `customer.verified.v1` | `billie_customers_events` | `handle_customer_verified` | `customers` |
| `conversation_started` | Raw dict | `handle_conversation_started` | `conversations` |
| `user_input` | Raw dict | `handle_utterance` | `conversations` |
| `assistant_response` | Raw dict | `handle_utterance` | `conversations` |
| `applicationDetail_changed` | Raw dict | `handle_application_detail_changed` | `conversations` + `customers` |
| `identityRisk_assessment` | Raw dict | `handle_assessment` | `conversations` |
| `serviceability_assessment_results` | Raw dict | `handle_assessment` | `conversations` |
| `fraudCheck_assessment` | Raw dict | `handle_assessment` | `conversations` |
| `noticeboard_updated` | Raw dict | `handle_noticeboard_updated` | `conversations` |
| `final_decision` | Raw dict | `handle_final_decision` | `conversations` |
| `conversation_summary` | Raw dict | `handle_conversation_summary` | `conversations` |
| `writeoff.requested.v1` | Raw dict | `handle_writeoff_requested` | `write-off-requests` |
| `writeoff.approved.v1` | Raw dict | `handle_writeoff_approved` | `write-off-requests` |
| `writeoff.rejected.v1` | Raw dict | `handle_writeoff_rejected` | `write-off-requests` |
| `writeoff.cancelled.v1` | Raw dict | `handle_writeoff_cancelled` | `write-off-requests` |

### 5.3 Processing Guarantees

| Guarantee | Implementation |
|---|---|
| At-least-once delivery | Redis consumer groups with manual `XACK` after successful MongoDB write |
| Exactly-once semantics | Redis `SET NX` dedup key with configurable TTL |
| No message loss | `XPENDING` recovery on startup replays unacknowledged messages |
| Dead letter queue | Failed messages moved to DLQ after max retries |
| Out-of-order handling | Schedule handlers preserve existing payment statuses; placeholder entries created for events arriving before parent |
| Payload size limits | Oversized events rejected before processing |
| Envelope sanitization | Corrects broker field type mismatches (`c_seq`, `rec`, `dat`) |

### 5.4 CRM Event Envelope Structure

Events published by Payload to Redis (via `src/server/event-publisher.ts`) use this envelope:

| Field | Type | Description |
|---|---|---|
| `conv` | string | Request ID for workflow correlation (nanoid) |
| `agt` | string | Agent identifier (CRM agent constant) |
| `usr` | string | User ID who triggered the action |
| `seq` | number | Sequence number (always 1 for CRM events) |
| `cls` | string | Message class (always `msg`) |
| `typ` | string | Event type (e.g., `writeoff.requested.v1`) |
| `cause` | string | Event ID for polling/tracing (nanoid) |
| `payload` | string | JSON-serialized payload |

---

## 6. Database Indexes

### Unique Indexes

| Collection | Field(s) |
|---|---|
| `users` | `email` (Payload auth built-in) |
| `customers` | `customerId` |
| `conversations` | `conversationId` |
| `applications` | `applicationNumber` |
| `loan-accounts` | `loanAccountId` |

### Performance Indexes

| Collection | Field(s) | Purpose |
|---|---|---|
| `customers` | `customerId` | Primary lookup |
| `conversations` | `applicationNumber` | Application lookup |
| `conversations` | `customerIdString` | Customer lookup before relationship established |
| `conversations` | `status` | Status filtering |
| `loan-accounts` | `loanAccountId` | Primary lookup |
| `loan-accounts` | `accountNumber` | Human-readable lookup |
| `loan-accounts` | `customerId` | Customer's accounts |
| `loan-accounts` | `customerIdString` | String-based customer lookup |
| `loan-accounts` | `accountStatus` | Status filtering |
| `write-off-requests` | `requestId` | Event correlation lookup |
| `write-off-requests` | `eventId` | Polling lookup |
| `write-off-requests` | `requestNumber` | Human-readable lookup |
| `write-off-requests` | `loanAccountId` | Account's write-off requests |
| `write-off-requests` | `customerId` | Customer's write-off requests |
| `write-off-requests` | `status` | Status filtering |
| `contact-notes` | `customer` | Customer timeline query |
| `contact-notes` | `loanAccount` | Account notes query |
| `contact-notes` | `amendsNote` | Amendment chain traversal |
| `contact-notes` | `status` | Active vs amended filtering |
| `contact-notes` | `createdAt` | Timeline sort (DESC) |
| `applications` | `applicationOutcome` | Outcome filtering |
