# Manual Block Clear — billie-crm Backend Contract (Plan B1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the billie-crm backend half of the manual block-clear feature: the event contract, a producer that emits the authorised clear onto the shared `chatLedger`, the maker-checker request projection (Postgres + Payload collection + Python lifecycle handlers), and the consumer that projects billieChat's `cleared`/`clear_rejected` outcome back into the CRM.

**Architecture:** Event-sourced, mirroring the existing write-off approval pattern. TS command routes (Plan B2) publish CRM-internal `block_clear_approval.*` lifecycle events to `inbox:billie-servicing:internal`; the Python event-processor projects them into a `reapplication_block_clear_requests` table. On approval (or a single-operator clear), the CRM emits `reapplication_block.clear_authorized.v1` onto the shared `chatLedger`; billieChat applies it and emits `reapplication_block.cleared.v1` / `.clear_rejected.v1`, which the Python processor consumes to NULL the block on `conversations`/`customers` and close out the request row.

**Tech Stack:** Payload CMS 3.85 (Next.js 16), TypeScript, Zod v4, ioredis; Python event-processor (asyncpg, pytest); Postgres (Payload migrations). pnpm + vitest (TS), pytest (Python).

## Global Constraints

- **Binding contract = the billieChat spec** `../../billieChat/docs/superpowers/specs/2026-06-27-reapplication-block-manual-clear-design.md` (§7 event payloads, §12 maker-checker, §13 producer, §14 projection). The billieChat side is merged as PR #110 and is the consumer of `clear_authorized` / producer of `cleared`/`clear_rejected`.
- **Read/write split:** only the Python event-processor writes projection tables (`conversations`, `customers`, `reapplication_block_clear_requests`). TS publishes events; never write these tables from Payload hooks/routes.
- **Event types:**
  - CRM-internal lifecycle (→ `inbox:billie-servicing:internal`): `block_clear_approval.requested.v1`, `.approved.v1`, `.rejected.v1`, `.cancelled.v1`.
  - billieChat-facing, produced onto `chatLedger`: `reapplication_block.clear_authorized.v1`.
  - billieChat-facing, consumed from `inbox:billie-servicing`: `reapplication_block.cleared.v1`, `reapplication_block.clear_rejected.v1`.
- **clear_authorized payload (must match billieChat spec §7.1):** `canonical_customer_id`, `reasons` (array or `"ALL_CLEARABLE"`), `operator_id`, `justification` (non-empty), `request_id`, `requested_at`, and — for default-class reasons — `approval: { approval_request_id, approved_by, approved_by_name, approved_at, comment }`.
- **Clearable reasons:** `PRIOR_DEFAULT`, `PRIOR_SERIOUS_ARREARS`, `ID_VERIFICATION`, `SERVICEABILITY`, `ACCOUNT_CONDUCT`. **Default-class (need approval):** `PRIOR_DEFAULT`, `PRIOR_SERIOUS_ARREARS`. (PEP / active-loan / identity-conflict are never offered — billieChat rejects them defensively.)
- **chatLedger envelope:** reuse `eventToStreamFields` shape (`conv/agt/usr/seq/cls/typ/cause/payload`), `agt = "billie-crm"`, `conv = "ops:block-clear:{request_id}"`, `usr = canonical_customer_id`, `cls = "cmd"`. Target stream `chatLedger` (config `CHATLEDGER_STREAM`, default `chatLedger`) on the producer Redis (default = existing `getRedisClient()`; override `CHATLEDGER_REDIS_URL` for the dev two-instance split where chatLedger sits on the persistent Redis).
- **rejection_code vocabulary (from billieChat, for the consumer):** `MISSING_FIELDS | NOTHING_CLEARABLE | UNKNOWN_CANONICAL | APPROVAL_REQUIRED | SELF_APPROVAL`.
- Commands: TS tests `pnpm exec vitest run <file> --config ./vitest.config.mts`; Python `cd event-processor && pytest <file>`; Prettier (single quotes, no semicolons, 100 cols); `ruff check .` for Python.
- This plan is **backend only** — the 4 command routes + single-operator path + companion write-off fix are Plan B2; the UI is Plan B3.

---

### Task 1: Event contract — types, schemas, config (TS)

**Files:**
- Modify: `src/lib/events/types.ts`, `src/lib/events/schemas.ts`, `src/lib/events/config.ts`
- Test: `tests/unit/events/blockClear.test.ts`

**Interfaces produced (later tasks/plan B2 consume these):**
- Payloads: `BlockClearApprovalRequestedPayload`, `BlockClearApprovalApprovedPayload`, `BlockClearApprovalRejectedPayload`, `BlockClearApprovalCancelledPayload`, `ReapplicationBlockClearAuthorizedPayload`.
- Zod: `BlockClearRequestCommandSchema`, `BlockClearApproveCommandSchema`, `BlockClearRejectCommandSchema`, `BlockClearCancelCommandSchema`.
- Constants: `EVENT_TYPE_BLOCK_CLEAR_APPROVAL_{REQUESTED,APPROVED,REJECTED,CANCELLED}`, `EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED`, `CLEARABLE_REASONS`, `REASONS_REQUIRING_APPROVAL`, `CHATLEDGER_STREAM`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/events/blockClear.test.ts
import { describe, it, expect } from 'vitest'
import {
  BlockClearRequestCommandSchema,
  BlockClearApproveCommandSchema,
} from '@/lib/events/schemas'
import {
  CLEARABLE_REASONS,
  REASONS_REQUIRING_APPROVAL,
  EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED,
} from '@/lib/events/config'

describe('block-clear event contract', () => {
  it('accepts a valid request command', () => {
    const ok = BlockClearRequestCommandSchema.safeParse({
      canonicalCustomerId: 'c123',
      conversationId: 'conv-1',
      reasons: ['SERVICEABILITY'],
      justification: 'manual assessment, ticket OPS-1',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects an empty justification', () => {
    const bad = BlockClearRequestCommandSchema.safeParse({
      canonicalCustomerId: 'c123',
      reasons: ['SERVICEABILITY'],
      justification: '',
    })
    expect(bad.success).toBe(false)
  })

  it('requires a >=10 char comment to approve', () => {
    expect(
      BlockClearApproveCommandSchema.safeParse({
        requestId: 'r1',
        requestNumber: 'RBC-1',
        comment: 'too short',
      }).success,
    ).toBe(false)
  })

  it('exposes the clearable + approval-required vocabularies and the authorize type', () => {
    expect(CLEARABLE_REASONS).toEqual([
      'PRIOR_DEFAULT',
      'PRIOR_SERIOUS_ARREARS',
      'ID_VERIFICATION',
      'SERVICEABILITY',
      'ACCOUNT_CONDUCT',
    ])
    expect(REASONS_REQUIRING_APPROVAL).toEqual(['PRIOR_DEFAULT', 'PRIOR_SERIOUS_ARREARS'])
    expect(EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED).toBe(
      'reapplication_block.clear_authorized.v1',
    )
  })
})
```

- [ ] **Step 2: Run test → fails** — `pnpm exec vitest run tests/unit/events/blockClear.test.ts --config ./vitest.config.mts` (module/exports not found).

- [ ] **Step 3: Add config constants** to `src/lib/events/config.ts`:

```typescript
export const CHATLEDGER_STREAM = process.env.CHATLEDGER_STREAM ?? 'chatLedger'

export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED ?? 'block_clear_approval.requested.v1'
export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED ?? 'block_clear_approval.approved.v1'
export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REJECTED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REJECTED ?? 'block_clear_approval.rejected.v1'
export const EVENT_TYPE_BLOCK_CLEAR_APPROVAL_CANCELLED =
  process.env.EVENT_TYPE_BLOCK_CLEAR_APPROVAL_CANCELLED ?? 'block_clear_approval.cancelled.v1'
export const EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED =
  process.env.EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED ??
  'reapplication_block.clear_authorized.v1'

// Single source of truth for the clear vocabulary (mirrors billieChat enums).
export const CLEARABLE_REASONS = [
  'PRIOR_DEFAULT',
  'PRIOR_SERIOUS_ARREARS',
  'ID_VERIFICATION',
  'SERVICEABILITY',
  'ACCOUNT_CONDUCT',
] as const
export const REASONS_REQUIRING_APPROVAL = ['PRIOR_DEFAULT', 'PRIOR_SERIOUS_ARREARS'] as const
export type ClearableReason = (typeof CLEARABLE_REASONS)[number]
```

- [ ] **Step 4: Add payload interfaces** to `src/lib/events/types.ts`:

```typescript
import type { ClearableReason } from './config'

export interface BlockClearApprovalRequestedPayload {
  canonicalCustomerId: string
  conversationId?: string
  reasons: ClearableReason[]
  justification: string
  requestedBy: string
  requestedByName: string
}

export interface BlockClearApprovalApprovedPayload {
  requestId: string
  requestNumber: string
  comment: string
  approvedBy: string
  approvedByName: string
}

export interface BlockClearApprovalRejectedPayload {
  requestId: string
  requestNumber: string
  reason: string
  rejectedBy: string
  rejectedByName: string
}

export interface BlockClearApprovalCancelledPayload {
  requestId: string
  requestNumber: string
  cancelledBy: string
  cancelledByName: string
}

// The authoritative command billieChat consumes off chatLedger (spec §7.1).
export interface ReapplicationBlockClearAuthorizedPayload {
  canonical_customer_id: string
  reasons: ClearableReason[] | 'ALL_CLEARABLE'
  operator_id: string
  justification: string
  request_id: string
  requested_at: string
  approval?: {
    approval_request_id: string
    approved_by: string
    approved_by_name: string
    approved_at: string
    comment: string
  }
}
```

- [ ] **Step 5: Add Zod command schemas** to `src/lib/events/schemas.ts`:

```typescript
import { CLEARABLE_REASONS } from '../events/config'

const ClearableReasonSchema = z.enum(CLEARABLE_REASONS)

export const BlockClearRequestCommandSchema = z.object({
  canonicalCustomerId: z.string().min(1, 'Canonical customer ID is required'),
  conversationId: z.string().optional(),
  reasons: z.array(ClearableReasonSchema).min(1, 'At least one reason is required'),
  justification: z.string().min(1, 'Justification is required'),
})

export const BlockClearApproveCommandSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  requestNumber: z.string().min(1, 'Request number is required'),
  comment: z.string().min(10, 'Approval comment must be at least 10 characters'),
})

export const BlockClearRejectCommandSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  requestNumber: z.string().min(1, 'Request number is required'),
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters'),
})

export const BlockClearCancelCommandSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  requestNumber: z.string().min(1, 'Request number is required'),
})
```

- [ ] **Step 6: Run test → passes; Prettier; commit**

```bash
pnpm exec vitest run tests/unit/events/blockClear.test.ts --config ./vitest.config.mts
pnpm exec prettier --write src/lib/events/*.ts tests/unit/events/blockClear.test.ts
git add src/lib/events/ tests/unit/events/blockClear.test.ts
git commit -m "feat(block-clear): event contract — types, schemas, config"
```

---

### Task 2: chatLedger producer (TS)

**Files:**
- Create: `src/server/chatledger-publisher.ts`
- Test: `tests/unit/server/chatledgerPublisher.test.ts`

**Interfaces:**
- Consumes: `ReapplicationBlockClearAuthorizedPayload` (Task 1), `CHATLEDGER_STREAM`, `EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED`, `CRM_AGENT_ID`.
- Produces: `publishClearAuthorized(payload: ReapplicationBlockClearAuthorizedPayload): Promise<{ eventId: string }>` — xadds a LedgerMessage to `chatLedger`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/server/chatledgerPublisher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const xadd = vi.fn().mockResolvedValue('1-0')
vi.mock('@/server/redis-client', () => ({
  getChatLedgerRedisClient: () => ({ xadd }),
}))

import { publishClearAuthorized } from '@/server/chatledger-publisher'

beforeEach(() => xadd.mockClear())

describe('publishClearAuthorized', () => {
  it('xadds a chatLedger LedgerMessage with agt=billie-crm and the ops conv', async () => {
    const res = await publishClearAuthorized({
      canonical_customer_id: 'c123',
      reasons: ['SERVICEABILITY'],
      operator_id: 'ops-1',
      justification: 'manual assessment',
      request_id: 'req-1',
      requested_at: '2026-06-28T00:00:00.000Z',
    })
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(1)
    const [stream, star, ...flat] = xadd.mock.calls[0]
    expect(stream).toBe('chatLedger')
    expect(star).toBe('*')
    const fields = Object.fromEntries(
      flat.reduce((acc: string[][], v: string, i: number) => {
        if (i % 2 === 0) acc.push([v, flat[i + 1]])
        return acc
      }, []),
    )
    expect(fields.agt).toBe('billie-crm')
    expect(fields.typ).toBe('reapplication_block.clear_authorized.v1')
    expect(fields.conv).toBe('ops:block-clear:req-1')
    expect(fields.usr).toBe('c123')
    expect(fields.cls).toBe('cmd')
    expect(JSON.parse(fields.payload).request_id).toBe('req-1')
  })
})
```

- [ ] **Step 2: Run test → fails** (module not found).

- [ ] **Step 3: Add a chatLedger Redis accessor** to `src/server/redis-client.ts` (a second lazily-created client, defaulting to the same `REDIS_URL` so docker/prod reuse it, with a `CHATLEDGER_REDIS_URL` override for the dev split):

```typescript
let chatLedgerClient: Redis | null = null

export function getChatLedgerRedisClient(): Redis {
  if (!chatLedgerClient) {
    const url = process.env.CHATLEDGER_REDIS_URL ?? REDIS_URL
    chatLedgerClient = new Redis(url, {
      retryStrategy: (times) => Math.min(times * 100, 30000),
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      keepAlive: 10000,
      enableOfflineQueue: false,
      lazyConnect: true,
    })
    chatLedgerClient.on('error', (e) => console.error('[ChatLedger Redis] error:', e.message))
  }
  return chatLedgerClient
}
```

- [ ] **Step 4: Implement the producer** `src/server/chatledger-publisher.ts`:

```typescript
import { nanoid } from 'nanoid'
import { getChatLedgerRedisClient } from './redis-client'
import { CHATLEDGER_STREAM, CRM_AGENT_ID, EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED } from '@/lib/events/config'
import type { ReapplicationBlockClearAuthorizedPayload } from '@/lib/events/types'

// Mirrors billieChat's LedgerMessage envelope on the shared chatLedger stream so
// its Broker routes the command (agt=billie-crm) to the reapplicationBlock service.
export async function publishClearAuthorized(
  payload: ReapplicationBlockClearAuthorizedPayload,
): Promise<{ eventId: string }> {
  const eventId = nanoid()
  const fields: Record<string, string> = {
    conv: `ops:block-clear:${payload.request_id}`,
    agt: CRM_AGENT_ID,
    usr: payload.canonical_customer_id,
    seq: '1',
    cls: 'cmd',
    typ: EVENT_TYPE_REAPPLICATION_BLOCK_CLEAR_AUTHORIZED,
    cause: eventId,
    payload: JSON.stringify(payload),
  }
  const redis = getChatLedgerRedisClient()
  await redis.xadd(CHATLEDGER_STREAM, '*', ...Object.entries(fields).flat())
  return { eventId }
}
```

- [ ] **Step 5: Run test → passes; Prettier; commit**

```bash
pnpm exec vitest run tests/unit/server/chatledgerPublisher.test.ts --config ./vitest.config.mts
pnpm exec prettier --write src/server/chatledger-publisher.ts src/server/redis-client.ts tests/unit/server/chatledgerPublisher.test.ts
git add src/server/chatledger-publisher.ts src/server/redis-client.ts tests/unit/server/chatledgerPublisher.test.ts
git commit -m "feat(block-clear): chatLedger producer for clear_authorized"
```

---

### Task 3: Postgres migration — requests table + clear columns

**Files:**
- Create: `src/migrations/<timestamp>_reapplication_block_clear_requests.ts` (generate via `make -C infra/fly pg-migrate-create ENV=dev NAME=reapplication_block_clear_requests`, then edit)
- Modify: `src/migrations/index.ts` (register)

**Interfaces:** table `reapplication_block_clear_requests` (natural key `request_id`); new columns on `conversations` (`reapplication_block_clear_status`, `_cleared_at`, `_cleared_by`, `_clear_justification`, `_clear_request_id`) and `customers` (`reapplication_block_clear_status`, `_cleared_at`).

- [ ] **Step 1: Generate the migration file** with the make target above; it scaffolds `up`/`down` with `MigrateUpArgs`/`MigrateDownArgs`.

- [ ] **Step 2: Write `up`** (mirror `20260515_061818.ts` structure):

```typescript
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TYPE "public"."enum_reapplication_block_clear_requests_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
    CREATE TABLE "reapplication_block_clear_requests" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "request_id" varchar NOT NULL,
      "event_id" varchar,
      "request_number" varchar,
      "canonical_customer_id" varchar NOT NULL,
      "conversation_id" varchar,
      "customer_name" varchar,
      "reasons" jsonb,
      "justification" varchar,
      "status" "enum_reapplication_block_clear_requests_status" DEFAULT 'pending' NOT NULL,
      "requested_by_id" uuid,
      "requested_by_name" varchar,
      "requested_at" timestamp(3) with time zone,
      "approval_details_approved_by" varchar,
      "approval_details_approved_by_name" varchar,
      "approval_details_approved_at" timestamp(3) with time zone,
      "approval_details_comment" varchar,
      "approval_details_rejected_by" varchar,
      "approval_details_rejected_by_name" varchar,
      "approval_details_reason" varchar,
      "approval_details_rejected_at" timestamp(3) with time zone,
      "cancellation_details_cancelled_by" varchar,
      "cancellation_details_cancelled_by_name" varchar,
      "cancellation_details_cancelled_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX "rbcr_request_id_idx" ON "reapplication_block_clear_requests" ("request_id");
    CREATE INDEX "rbcr_status_created_idx" ON "reapplication_block_clear_requests" ("status","created_at");
    ALTER TABLE "reapplication_block_clear_requests" ADD CONSTRAINT "rbcr_requested_by_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_clear_status" varchar;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_cleared_at" timestamp(3) with time zone;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_cleared_by" varchar;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_clear_justification" varchar;
    ALTER TABLE "conversations" ADD COLUMN "reapplication_block_clear_request_id" varchar;
    ALTER TABLE "customers" ADD COLUMN "reapplication_block_clear_status" varchar;
    ALTER TABLE "customers" ADD COLUMN "reapplication_block_cleared_at" timestamp(3) with time zone;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE "reapplication_block_clear_requests" CASCADE;
    DROP TYPE "public"."enum_reapplication_block_clear_requests_status";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_clear_status";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_cleared_at";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_cleared_by";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_clear_justification";
    ALTER TABLE "conversations" DROP COLUMN "reapplication_block_clear_request_id";
    ALTER TABLE "customers" DROP COLUMN "reapplication_block_clear_status";
    ALTER TABLE "customers" DROP COLUMN "reapplication_block_cleared_at";
  `)
}
```

- [ ] **Step 3: Register in `src/migrations/index.ts`** — add the import + an entry in the `migrations` array (matching the existing pattern, in timestamp order).

- [ ] **Step 4: Verify** — `pnpm typecheck` passes and the migration imports resolve. (Schema is applied to dev/test via Payload `push:true`; the migration is for demo/prod deploy. The collection in Task 4 is what `push:true` syncs for tests.)

- [ ] **Step 5: Commit**

```bash
git add src/migrations/
git commit -m "feat(block-clear): migration — clear requests table + conversation/customer clear columns"
```

---

### Task 4: Payload collection + projection columns

**Files:**
- Create: `src/collections/ReapplicationBlockClearRequests.ts`
- Modify: `src/payload.config.ts` (register collection), `src/collections/Conversations.ts` + `src/collections/Customers.ts` (add the clear fields to the `reapplicationBlock` group so `push:true` and types match the migration)
- Then: `pnpm generate:types`
- Test: `tests/int/collections/reapplicationBlockClearRequests.int.spec.ts`

**Interfaces:** collection slug `reapplication-block-clear-requests` (read via `canRead`, create via `canCreate`, update via `canUpdate`, delete via `canDelete` — same helpers as `WriteOffRequests`). The Python processor is the real writer.

- [ ] **Step 1: Write the failing integration test** (uses the testcontainer Postgres from `globalSetup`):

```typescript
// tests/int/collections/reapplicationBlockClearRequests.int.spec.ts
import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'

let payload: Payload
beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('reapplication-block-clear-requests collection', () => {
  it('round-trips a request row with status + reasons', async () => {
    const created = await payload.create({
      collection: 'reapplication-block-clear-requests',
      data: {
        requestId: 'req-int-1',
        canonicalCustomerId: 'c-int-1',
        reasons: ['SERVICEABILITY'],
        justification: 'int test',
        status: 'pending',
      },
      overrideAccess: true,
    })
    expect(created.requestNumber).toMatch(/^RBC-/)
    const found = await payload.find({
      collection: 'reapplication-block-clear-requests',
      where: { requestId: { equals: 'req-int-1' } },
      overrideAccess: true,
    })
    expect(found.docs[0].status).toBe('pending')
  })
})
```

- [ ] **Step 2: Run test → fails** — `pnpm exec vitest run tests/int/collections/reapplicationBlockClearRequests.int.spec.ts --config ./vitest.config.mts` (unknown collection).

- [ ] **Step 3: Create the collection** `src/collections/ReapplicationBlockClearRequests.ts` (mirror `WriteOffRequests.ts`; `useAsTitle: 'requestNumber'`, group `'Servicing'`, `hidden: hideFromNonAdmins`, access `{ read: canRead, create: canCreate, update: canUpdate, delete: canDelete }`, a `beforeChange` that stamps `RBC-{ts}-{rand}` on create). Fields: `requestId` (unique, index), `eventId`, `requestNumber` (readOnly, index), `canonicalCustomerId` (index), `conversationId`, `customerName`, `reasons` (`type: 'json'`), `justification` (textarea), `status` (select pending/approved/rejected/cancelled, index), `requestedBy` (relationship→users), `requestedByName`, `approvalDetails` (group: approvedBy/approvedByName/approvedAt/comment/rejectedBy/rejectedByName/reason/rejectedAt — conditional on status approved|rejected), `cancellationDetails` (group: cancelledBy/cancelledByName/cancelledAt — conditional on status cancelled); `timestamps: true`. Use the verbatim `WriteOffRequests` shape with the loan-specific fields swapped for `canonicalCustomerId`/`reasons`/`justification`.

- [ ] **Step 4: Register** in `src/payload.config.ts` — import `ReapplicationBlockClearRequests` and add it to the `collections: [...]` array (next to `WriteOffRequests`).

- [ ] **Step 5: Add the clear columns to the projection collections** — in `Conversations.ts` and `Customers.ts`, extend the `reapplicationBlock` group with the fields matching Task 3's migration (`clearStatus`, `clearedAt`, `clearedBy`, `clearJustification`, `clearRequestId` on conversations; `clearStatus`, `clearedAt` on customers). Field names flatten to the migration's snake_case columns.

- [ ] **Step 6: Regenerate types + run test → passes**

```bash
pnpm generate:types
pnpm exec vitest run tests/int/collections/reapplicationBlockClearRequests.int.spec.ts --config ./vitest.config.mts
```

- [ ] **Step 7: Commit**

```bash
git add src/collections/ src/payload.config.ts src/payload-types.ts tests/int/collections/reapplicationBlockClearRequests.int.spec.ts
git commit -m "feat(block-clear): clear-requests collection + projection columns"
```

---

### Task 5: Python lifecycle handlers (approval projection)

**Files:**
- Create: `event-processor/src/billie_servicing/handlers/block_clear_approval.py`
- Modify: `event-processor/src/billie_servicing/main.py` (register 4 handlers)
- Test: `event-processor/tests/test_block_clear_approval_handlers.py`

**Interfaces:** `handle_block_clear_approval_{requested,approved,rejected,cancelled}(pool, parsed_event)` writing `reapplication_block_clear_requests` via `upsert`/`update_by_key`.

- [ ] **Step 1: Write the failing tests** (mirror `test_writeoff_handlers.py`, using the `mock_pool` fixture):

```python
# event-processor/tests/test_block_clear_approval_handlers.py
import pytest
from billie_servicing.handlers.block_clear_approval import (
    handle_block_clear_approval_requested,
    handle_block_clear_approval_approved,
)


@pytest.mark.asyncio
async def test_requested_creates_pending_row(mock_pool):
    event = {
        "conv": "req-1",
        "cause": "evt-1",
        "typ": "block_clear_approval.requested.v1",
        "payload": {
            "canonicalCustomerId": "c1",
            "conversationId": "conv-1",
            "reasons": ["PRIOR_DEFAULT"],
            "justification": "manual assessment",
            "requestedByName": "Jane Ops",
        },
    }
    await handle_block_clear_approval_requested(mock_pool, event)
    doc = mock_pool.last_insert("reapplication_block_clear_requests")
    assert doc["request_id"] == "req-1"
    assert doc["canonical_customer_id"] == "c1"
    assert doc["status"] == "pending"
    assert doc["request_number"].startswith("RBC-")
    assert mock_pool.calls_against("reapplication_block_clear_requests")[0].conflict_columns == [
        "request_id"
    ]


@pytest.mark.asyncio
async def test_approved_flips_status(mock_pool):
    event = {
        "conv": "req-1",
        "cause": "evt-2",
        "typ": "block_clear_approval.approved.v1",
        "payload": {"approvedBy": "boss-1", "approvedByName": "Sam Sup", "comment": "ok"},
    }
    await handle_block_clear_approval_approved(mock_pool, event)
    doc = mock_pool.last_update("reapplication_block_clear_requests")
    assert doc["status"] == "approved"
    assert doc["approval_details_approved_by"] == "boss-1"
```

- [ ] **Step 2: Run → fails** — `cd event-processor && pytest tests/test_block_clear_approval_handlers.py` (module missing).

- [ ] **Step 3: Implement the handlers** (copy `writeoff.py`'s structure: `_parse_payload`, `safe_str`, `_generate_request_number` → `RBC-` prefix, `upsert(..., do_nothing_on_conflict=True)` for requested, `update_by_key(...)` for approved/rejected/cancelled). `requested` writes `request_id`, `event_id`, `request_number`, `canonical_customer_id`, `conversation_id`, `reasons` (JSON-encode the list), `justification`, `status='pending'`, `requested_by_name`, timestamps. approved/rejected/cancelled mirror `handle_writeoff_{approved,rejected,cancelled}` with the same `approval_details_*` / `cancellation_details_*` columns.

- [ ] **Step 4: Register** in `main.py` (next to the writeoff registrations):

```python
processor.register_handler("block_clear_approval.requested.v1", handle_block_clear_approval_requested)
processor.register_handler("block_clear_approval.approved.v1", handle_block_clear_approval_approved)
processor.register_handler("block_clear_approval.rejected.v1", handle_block_clear_approval_rejected)
processor.register_handler("block_clear_approval.cancelled.v1", handle_block_clear_approval_cancelled)
```

- [ ] **Step 5: Run → passes; `ruff check .`; commit**

```bash
cd event-processor && pytest tests/test_block_clear_approval_handlers.py -q && ruff check src/billie_servicing/handlers/block_clear_approval.py
cd .. && git add event-processor/src/billie_servicing/handlers/block_clear_approval.py event-processor/src/billie_servicing/main.py event-processor/tests/test_block_clear_approval_handlers.py
git commit -m "feat(block-clear): python approval-lifecycle handlers"
```

---

### Task 6: Python projection — consume billieChat's cleared / clear_rejected

**Files:**
- Modify: `event-processor/src/billie_servicing/handlers/reapplication.py` (add 2 handlers), `event-processor/src/billie_servicing/main.py` (register)
- Test: `event-processor/tests/test_block_clear_projection.py`

**Interfaces:** `handle_reapplication_block_cleared(pool, event)` and `handle_reapplication_block_clear_rejected(pool, event)`. On cleared: NULL the conversation/customer block reason, stamp clear audit, and flip the request row to `approved`/applied. On rejected: stamp `clear_status` + the rejection_code.

- [ ] **Step 1: Write the failing tests** (mirror `test_reapplication_and_identity_verification.py`):

```python
# event-processor/tests/test_block_clear_projection.py
import pytest
from billie_servicing.handlers.reapplication import (
    handle_reapplication_block_cleared,
    handle_reapplication_block_clear_rejected,
)


@pytest.mark.asyncio
async def test_cleared_nulls_block_and_stamps_audit(mock_pool):
    event = {
        "typ": "reapplication_block.cleared.v1",
        "usr": "c1",
        "payload": {
            "canonical_customer_id": "c1",
            "request_id": "req-1",
            "cleared_reasons": ["SERVICEABILITY"],
            "cleared_at": "2026-06-28T01:00:00+00:00",
            "operator_id": "ops-1",
            "justification": "manual assessment",
            "prior_block_reason": "SERVICEABILITY",
        },
    }
    await handle_reapplication_block_cleared(mock_pool, event)
    cust = mock_pool.last_upsert("customers")
    assert cust["reapplication_block_reason"] is None
    assert cust["reapplication_block_clear_status"] == "cleared"
    req = mock_pool.last_update("reapplication_block_clear_requests")
    assert req["status"] == "approved"


@pytest.mark.asyncio
async def test_rejected_stamps_clear_status(mock_pool):
    event = {
        "typ": "reapplication_block.clear_rejected.v1",
        "usr": "c1",
        "payload": {
            "canonical_customer_id": "c1",
            "request_id": "req-1",
            "rejection_code": "APPROVAL_REQUIRED",
            "detail": "needs approval",
        },
    }
    await handle_reapplication_block_clear_rejected(mock_pool, event)
    req = mock_pool.last_update("reapplication_block_clear_requests")
    assert req["reapplication_block_clear_status"] == "rejected" or req["status"] == "rejected"
```

- [ ] **Step 2: Run → fails** — `cd event-processor && pytest tests/test_block_clear_projection.py`.

- [ ] **Step 3: Implement the two handlers** in `reapplication.py` (reuse `parse_payload`, `safe_str`, `resolve_canonical_customer_id`, `upsert`, `upsert_conversation`, `update_by_key`, `coerce_date`):
  - `handle_reapplication_block_cleared`: resolve canonical; `upsert("customers", conflict=["customer_id"], { reapplication_block_reason: None, reapplication_block_clear_status: "cleared", reapplication_block_cleared_at: coerce_date(payload["cleared_at"]), updated_at })`; mirror onto the blocked `conversations` row(s) for the canonical (`upsert_conversation` keyed by `conversation_id` if present, else update by `reapplication_block_canonical_customer_id`); `update_by_key("reapplication_block_clear_requests", key_column="request_id", key_value=request_id, values={ status: "approved", updated_at })` so the queue shows it applied. NULLing the block reason is the load-bearing effect (CRM stops showing the customer as blocked) — but only when at least one reason cleared; if `prior_block_reason` is still a non-cleared higher-precedence reason, leave the block reason but stamp the clear audit (per spec §14).
  - `handle_reapplication_block_clear_rejected`: `update_by_key("reapplication_block_clear_requests", request_id, { status: "rejected", approval_details_reason: payload["detail"], updated_at })` and stamp `reapplication_block_clear_status="rejected"` on the conversation/customer so the operator sees why.

- [ ] **Step 4: Register** in `main.py`:

```python
processor.register_handler("reapplication_block.cleared.v1", handle_reapplication_block_cleared)
processor.register_handler("reapplication_block.clear_rejected.v1", handle_reapplication_block_clear_rejected)
```

(`reapplication_block.*` falls through `_parse_event`'s prefix checks to the `else` → `sanitize_envelope` dict path — handlers receive a dict payload. Confirm no earlier prefix branch captures it.)

- [ ] **Step 5: Run → passes; `ruff check .`; commit**

```bash
cd event-processor && pytest tests/test_block_clear_projection.py -q && ruff check src/billie_servicing/handlers/reapplication.py
cd .. && git add event-processor/src/billie_servicing/handlers/reapplication.py event-processor/src/billie_servicing/main.py event-processor/tests/test_block_clear_projection.py
git commit -m "feat(block-clear): project cleared/clear_rejected back into CRM"
```

---

## Out of scope (Plan B2 / B3)

- **B2:** the 4 TS command routes `/api/commands/reapp-block-clear/{request,approve,reject,cancel}` (request publishes `block_clear_approval.requested` for default-class reasons, OR calls `publishClearAuthorized` directly for single-operator windowed-decline clears; approve calls `publishClearAuthorized` with the approval attestation **and** enforces server-side maker≠checker `requestedBy !== approverId`), plus the **companion fix** adding the same server-side guard to `src/app/api/commands/writeoff/approve/route.ts`.
- **B3:** the "Clear block" action on the blocked customer/conversation view, the ApprovalsView extension (block-clear queue + detail drawer with the self-approval-disabled Approve button), and the React Query hooks.

## Self-Review

- **Spec coverage:** §7 contract → Tasks 1, 6; §13 producer → Task 2; §12 maker-checker projection storage → Tasks 3–5; §14 confirmation projection → Task 6. The maker-checker *enforcement* and producer *invocation* are B2 (noted out-of-scope).
- **Type consistency:** `publishClearAuthorized` (Task 2) consumes `ReapplicationBlockClearAuthorizedPayload` (Task 1). Python handlers (Tasks 5–6) key on `request_id = conv` / `event_id = cause` per the verbatim write-off pattern. Migration columns (Task 3) match the collection fields (Task 4) and the handler writes (Tasks 5–6).
- **Placeholder scan:** event/schema/producer/migration/handler code is concrete; the collection (Task 4 Step 3) references the verbatim `WriteOffRequests` shape with named field swaps rather than re-transcribing all 300 lines — acceptable as it names every field and the source file.
