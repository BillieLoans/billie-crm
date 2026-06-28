# Manual Block Clear — billie-crm Command Routes (Plan B2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The operator-facing command routes for manual block clear: raise a clear (single-operator for windowed declines, maker-checker for default-class), approve/reject (with **server-side maker≠checker**), and cancel — plus the companion server-side maker≠checker fix on the existing write-off approve route.

**Architecture:** Mirrors the existing write-off command routes (`src/app/api/commands/writeoff/*`). Routes publish events (B1's contract): the maker-checker path publishes `block_clear_approval.*` internal lifecycle events (B1 Python handlers project them); the approve route (and the single-operator request path) emit the authoritative `reapplication_block.clear_authorized.v1` onto the shared chatLedger via B1's `publishClearAuthorized`.

**Tech Stack:** Next.js route handlers, Payload auth, Zod, vitest. Builds on Plan B1 (PR #34, same branch `feat/manual-block-clear-crm`).

## Global Constraints

- Mirror `src/app/api/commands/writeoff/{request,approve,reject,cancel}/route.ts` for the try/catch + error-response boilerplate (`VALIDATION_ERROR` 400, `EventPublishError`→503, `INTERNAL_ERROR` 500, 202 on success). Read those files; copy their structure; only the auth/role checks, the parsed schema, and the published event(s) differ.
- Auth: `request`/`cancel` use `requireAuth(canService)` (`src/lib/auth.ts`); `approve`/`reject` use `getPayload({config})` + `payload.auth({headers})` + `hasApprovalAuthority(user)` (`src/lib/access.ts`).
- **Reason tiering (B1 `config.ts`):** `REASONS_REQUIRING_APPROVAL = ['PRIOR_DEFAULT','PRIOR_SERIOUS_ARREARS']`. A request whose `reasons` includes ANY of these goes through maker-checker; otherwise it is a single-operator immediate clear (bundling rule, billieChat spec §6).
- **Server-side maker≠checker** is mandatory on the approve route: `String(requestDoc.requestedBy) !== String(user.id)`, else 403 `SELF_APPROVAL`.
- The authoritative clear uses B1's `publishClearAuthorized(payload)` (`src/server/chatledger-publisher.ts`) with `operator_id` = the MAKER (requester) and, for default-class, an `approval` attestation whose `approved_by` = the checker (≠ operator_id). `request_id` correlates the approval-request row to billieChat's `cleared`/`clear_rejected` (which the B1 Python handler projects back).
- Internal lifecycle events via B1's `createAndPublishEvent({typ, userId, payload, requestId})` (`src/server/event-publisher.ts`), types `EVENT_TYPE_BLOCK_CLEAR_APPROVAL_{REQUESTED,APPROVED,REJECTED,CANCELLED}` (B1 `config.ts`).
- Tests: vitest. Model on an existing route/handler test if one exists; otherwise mock `@/server/chatledger-publisher` (`publishClearAuthorized`), `@/server/event-publisher` (`createAndPublishEvent`), and Payload auth/find (`getPayload`/`payload.auth`/`payload.find` or `requireAuth`) and call the route's exported `POST(req)` directly, asserting status + the published event payload. Prettier (single quotes, no semicolons, 100 cols).
- This is Plan B2. The UI is Plan B3.

---

### Task 1: `request` + `cancel` routes

**Files:**
- Create: `src/app/api/commands/reapp-block-clear/request/route.ts`, `src/app/api/commands/reapp-block-clear/cancel/route.ts`
- Modify: `src/lib/events/schemas.ts` (add `customerName: z.string().optional()` to `BlockClearRequestCommandSchema`)
- Test: `tests/unit/routes/reappBlockClearRequest.test.ts`, `tests/unit/routes/reappBlockClearCancel.test.ts`

**Interfaces produced:** `POST /api/commands/reapp-block-clear/request`, `POST /api/commands/reapp-block-clear/cancel`.

- [ ] **Step 1: Write failing tests** for the request route covering: (a) a single-operator request (`reasons:['SERVICEABILITY']`) calls `publishClearAuthorized` with `operator_id=user.id`, `reasons`, `justification`, a generated `request_id`, and NO `approval`; returns 202; (b) a default-class request (`reasons:['PRIOR_DEFAULT']`) calls `createAndPublishEvent` with `typ=block_clear_approval.requested.v1` and does NOT call `publishClearAuthorized`; returns 202; (c) invalid body → 400. Mock `@/server/chatledger-publisher`, `@/server/event-publisher`, and `requireAuth` (return `{ user: { id: 'ops-1', firstName: 'Op', role: 'operations' } }`). Run: `cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/routes/reappBlockClearRequest.test.ts --config ./vitest.config.mts` → RED.

- [ ] **Step 2: Implement `request/route.ts`** (mirror `writeoff/request/route.ts` boilerplate):

```typescript
import { type NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { BlockClearRequestCommandSchema } from '@/lib/events/schemas'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import {
  EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED,
  REASONS_REQUIRING_APPROVAL,
} from '@/lib/events/config'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth

    const parsed = BlockClearRequestCommandSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      )
    }
    const cmd = parsed.data
    const operatorName = user.firstName
      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
      : user.email || 'Unknown User'
    const needsApproval = cmd.reasons.some((r) => (REASONS_REQUIRING_APPROVAL as readonly string[]).includes(r))

    if (needsApproval) {
      // Maker-checker: raise an approval request; the Python processor creates the pending row.
      const result = await createAndPublishEvent({
        typ: EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REQUESTED,
        userId: String(user.id),
        payload: {
          canonicalCustomerId: cmd.canonicalCustomerId,
          conversationId: cmd.conversationId,
          customerName: cmd.customerName ?? '',
          reasons: cmd.reasons,
          justification: cmd.justification,
          requestedBy: String(user.id),
          requestedByName: operatorName,
        },
      })
      return NextResponse.json(result, { status: 202 })
    }

    // Single-operator (windowed declines only): emit the authoritative clear directly.
    const requestId = nanoid()
    const { eventId } = await publishClearAuthorized({
      canonical_customer_id: cmd.canonicalCustomerId,
      reasons: cmd.reasons,
      operator_id: String(user.id),
      justification: cmd.justification,
      request_id: requestId,
      requested_at: new Date().toISOString(),
    })
    return NextResponse.json(
      { eventId, requestId, status: 'accepted', message: 'Block clear submitted' },
      { status: 202 },
    )
  } catch (error) {
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        { error: { code: 'EVENT_PUBLISH_FAILED', message: 'Failed to submit block clear. Please try again.' } },
        { status: 503 },
      )
    }
    console.error('[BlockClear Request] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}
```

Add `customerName: z.string().optional()` to `BlockClearRequestCommandSchema` in `src/lib/events/schemas.ts`.

- [ ] **Step 3: Implement `cancel/route.ts`** — mirror `writeoff/cancel/route.ts` exactly (requireAuth(canService); look up the request in `reapplication-block-clear-requests` by `requestId`; allow original `requestedBy` or `hasApprovalAuthority`; publish `EVENT_TYPE_BLOCK_CLEAR_APPROVAL_CANCELLED` with `BlockClearApprovalCancelledPayload`). Use `BlockClearCancelCommandSchema`.

- [ ] **Step 4: Tests green** for both routes; Prettier; commit:

```bash
cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/routes/reappBlockClearRequest.test.ts tests/unit/routes/reappBlockClearCancel.test.ts --config ./vitest.config.mts
pnpm exec prettier --write src/app/api/commands/reapp-block-clear src/lib/events/schemas.ts tests/unit/routes/reappBlockClear*.test.ts
git add src/app/api/commands/reapp-block-clear/request src/app/api/commands/reapp-block-clear/cancel src/lib/events/schemas.ts tests/unit/routes/reappBlockClear*.test.ts
git commit -m "feat(block-clear): request + cancel command routes"
```

---

### Task 2: `approve` + `reject` routes (server-side maker≠checker)

**Files:**
- Create: `src/app/api/commands/reapp-block-clear/approve/route.ts`, `src/app/api/commands/reapp-block-clear/reject/route.ts`
- Test: `tests/unit/routes/reappBlockClearApprove.test.ts`, `tests/unit/routes/reappBlockClearReject.test.ts`

**Interfaces:** `POST .../approve`, `POST .../reject`.

- [ ] **Step 1: Write failing tests** for approve covering: (a) happy path — checker ≠ requester, status pending → calls `publishClearAuthorized` with `operator_id = requestDoc.requestedBy`, `approval.approved_by = user.id`, `approval.approved_by ≠ operator_id`, `request_id = command.requestId`; then `createAndPublishEvent` `block_clear_approval.approved.v1`; returns 202; (b) **self-approval** — `requestDoc.requestedBy === user.id` → 403 `SELF_APPROVAL`, NO publish; (c) non-pending → 400; (d) not found → 404; (e) not `hasApprovalAuthority` → 403. Mock `getPayload` (so `payload.auth` returns the checker and `payload.find` returns the request doc), `@/server/chatledger-publisher`, `@/server/event-publisher`. RED.

- [ ] **Step 2: Implement `approve/route.ts`** (mirror `writeoff/approve/route.ts`; the ledger-gRPC call is replaced by `publishClearAuthorized`):

```typescript
import { type NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { hasApprovalAuthority } from '@/lib/access'
import { BlockClearApproveCommandSchema } from '@/lib/events/schemas'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import { EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED } from '@/lib/events/config'

export async function POST(request: NextRequest) {
  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()
    const { user } = await payload.auth({ headers: new Headers(Array.from(headersList.entries())) })
    if (!user) {
      return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } }, { status: 401 })
    }
    if (!hasApprovalAuthority(user)) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to approve block clears.' } }, { status: 403 })
    }
    const parsed = BlockClearApproveCommandSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.flatten().fieldErrors } },
        { status: 400 },
      )
    }
    const cmd = parsed.data
    const found = await payload.find({
      collection: 'reapplication-block-clear-requests',
      where: { or: [{ requestId: { equals: cmd.requestId } }, { id: { equals: cmd.requestId } }] },
      limit: 1,
    })
    if (found.docs.length === 0) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Block-clear request not found.' } }, { status: 404 })
    }
    const doc = found.docs[0]
    if (doc.status !== 'pending') {
      return NextResponse.json({ error: { code: 'INVALID_STATE', message: `Request is already ${doc.status}.` } }, { status: 400 })
    }
    // Server-side maker != checker (closes the gap the write-off flow only guards in the UI).
    if (String(doc.requestedBy) === String(user.id)) {
      return NextResponse.json(
        { error: { code: 'SELF_APPROVAL', message: 'You cannot approve your own request.' } },
        { status: 403 },
      )
    }
    const approverName = user.firstName
      ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
      : user.email || 'Unknown User'

    // Emit the authoritative clear onto chatLedger with the approval attestation.
    await publishClearAuthorized({
      canonical_customer_id: doc.canonicalCustomerId,
      reasons: doc.reasons,
      operator_id: String(doc.requestedBy),
      justification: doc.justification,
      request_id: cmd.requestId,
      requested_at: (doc.requestedAt ?? doc.createdAt) as string,
      approval: {
        approval_request_id: doc.requestNumber,
        approved_by: String(user.id),
        approved_by_name: approverName,
        approved_at: new Date().toISOString(),
        comment: cmd.comment,
      },
    })

    const result = await createAndPublishEvent({
      typ: EVENT_TYPE_BLOCK_CLEAR_APPROVAL_APPROVED,
      userId: String(user.id),
      payload: {
        requestId: cmd.requestId,
        requestNumber: cmd.requestNumber,
        comment: cmd.comment,
        approvedBy: String(user.id),
        approvedByName: approverName,
      },
      requestId: cmd.requestId,
    })
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    if (error instanceof EventPublishError) {
      return NextResponse.json({ error: { code: 'EVENT_PUBLISH_FAILED', message: 'Failed to approve block clear. Please try again.' } }, { status: 503 })
    }
    console.error('[BlockClear Approve] Error:', error)
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }, { status: 500 })
  }
}
```

- [ ] **Step 3: Implement `reject/route.ts`** — mirror `writeoff/reject/route.ts` (payload.auth + hasApprovalAuthority; `BlockClearRejectCommandSchema`; publish `EVENT_TYPE_BLOCK_CLEAR_APPROVAL_REJECTED` with `BlockClearApprovalRejectedPayload`). No self-check needed on reject.

- [ ] **Step 4: Tests green; Prettier; commit**

```bash
cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/routes/reappBlockClearApprove.test.ts tests/unit/routes/reappBlockClearReject.test.ts --config ./vitest.config.mts
pnpm exec prettier --write src/app/api/commands/reapp-block-clear/approve src/app/api/commands/reapp-block-clear/reject tests/unit/routes/reappBlockClear{Approve,Reject}.test.ts
git add src/app/api/commands/reapp-block-clear/approve src/app/api/commands/reapp-block-clear/reject tests/unit/routes/reappBlockClear{Approve,Reject}.test.ts
git commit -m "feat(block-clear): approve + reject routes with server-side maker-checker"
```

---

### Task 3: Companion fix — server-side maker≠checker on the write-off approve route

**Files:**
- Modify: `src/app/api/commands/writeoff/approve/route.ts`
- Test: `tests/unit/routes/writeoffApproveSelfApproval.test.ts` (new — or extend an existing write-off approve test if present)

**Context:** The existing write-off approve route enforces maker≠checker only in the UI (`ApprovalDetailDrawer` `isOwnRequest`); the API permits self-approval. Add the same server-side guard the block-clear approve route uses.

- [ ] **Step 1: Write the failing test** — a write-off approve request where `writeOffDoc.requestedBy === user.id` must return 403 (no ledger call, no event publish). Mock `getPayload`/`payload.auth`/`payload.find` and the ledger client. RED (today it proceeds to the ledger call).

- [ ] **Step 2: Add the guard** — in `writeoff/approve/route.ts`, immediately AFTER the existing `if (writeOffDoc.status !== 'pending')` check and BEFORE the `getLedgerClient()` call, insert:

```typescript
    // Segregation of duties: the approver must differ from the requester.
    if (String(writeOffDoc.requestedBy) === String(user.id)) {
      return NextResponse.json(
        { error: { code: 'SELF_APPROVAL', message: 'You cannot approve your own request.' } },
        { status: 403 },
      )
    }
```

- [ ] **Step 3: Test green** (the existing write-off approve suite still passes — the guard only fires for self-approval); Prettier; commit:

```bash
cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/routes/writeoffApproveSelfApproval.test.ts --config ./vitest.config.mts
pnpm exec prettier --write src/app/api/commands/writeoff/approve/route.ts tests/unit/routes/writeoffApproveSelfApproval.test.ts
git add src/app/api/commands/writeoff/approve/route.ts tests/unit/routes/writeoffApproveSelfApproval.test.ts
git commit -m "fix(writeoff): server-side maker-checker guard on approve route"
```

---

## Out of scope (Plan B3)

The "Clear block" action on the blocked customer/conversation view, the ApprovalsView extension (a block-clear queue + detail drawer with the self-approval-disabled Approve button), and the React Query hooks (`usePendingBlockClears`, mutations) that call these routes.

## Self-Review

- **Spec coverage:** §12 maker-checker enforcement → Tasks 1 (tiering/raise) + 2 (server-side approve guard); §6 bundling (any default-class ⇒ approval) → Task 1 `needsApproval`; single-operator path → Task 1; companion write-off fix (spec §12.1) → Task 3.
- **Contract:** routes consume B1's `publishClearAuthorized` / `createAndPublishEvent` / event-type constants / Zod schemas; `request_id` correlates approval rows to billieChat's outcome (projected by B1 Task 6). `operator_id`=maker, `approval.approved_by`=checker, guard guarantees they differ — satisfying billieChat's attestation guard (PR #110).
- **Placeholder scan:** request + approve routes carry full code; cancel/reject reference their verbatim write-off templates with the named event/schema swaps.
