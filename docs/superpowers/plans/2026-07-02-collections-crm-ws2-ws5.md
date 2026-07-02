# Collections CRM WS2–WS5 (BTB-200, BTB-196, BTB-197, BTB-198 + BTB-199 residual) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Collections CRM: read API + hooks over the `collection_cases` projection (WS2/BTB-200), operator gRPC client + action routes/hooks (WS5/BTB-198), re-platformed worklist (WS3/BTB-196), dedicated case view + ServicingView surfacing (WS4/BTB-197), and the `rung` residual left over from WS1 (BTB-199, otherwise DONE/merged via PR #32).

**Architecture:** CRM stays a pure consumer: the Python event-processor projects `collection.case.*` (ChatLedger → billieChat Event Router → `inbox:billie-servicing`) into Payload-owned Postgres; Next.js API routes read via the Payload local API and enrich with ledger aging; operator actions call the `collectionsService` gRPC (vendored `proto/collections_service.proto`, port 50053) — never the superseded dispatcher hardship RPCs. Economics degrade gracefully until the platform's BTB-194 deploy (companion plan `billie-platform-services/docs/superpowers/plans/2026-07-02-btb194-collections-economics-engine.md`).

**Tech Stack:** Payload CMS 3.85.1 + Next.js 16 App Router, TanStack Query, @grpc/grpc-js + proto-loader, Python event-processor (asyncpg), vitest, pytest.

## Status inputs (verified 2026-07-02)

- WS1 (BTB-199) is **merged to main** (PR #32): handlers, `collection-cases` collection, migration `20260624_094132`, tests. Residual: no `rung` column (no event carried it — fixed by SDK 0.3.0's `collection.case.step_advanced.v1`).
- billieChat routes all six `collection.case.*` → `inbox:billie-servicing`; the `step_advanced` route ships with the platform plan (its Task 8).
- `collection-v0.2.0` tag exists in billie-event-sdks; `collection-v0.3.0` ships with the platform plan (its Task 9). **Do not start Task 1 here until that tag exists.**
- Collections gRPC Phase 1 (4 commands + `GetContactLog`) is live on platform port **50053**; `GetCaseEconomics`/`ListCaseEconomics` return `NOT_APPLICABLE` until BTB-194 deploys.

## Global Constraints

- Read-only projection collections: `access.create/update/delete: () => false`; written ONLY by the event-processor.
- Roles (`src/lib/access.ts`): reads → `hasAnyRole`; operator commands → `canService` (admin|supervisor|operations); escalation (`advance`) → `hasApprovalAuthority` (admin|supervisor).
- Route auth idiom: `const auth = await requireAuth(check); if ('error' in auth) return auth.error;` — error envelope `{ error: { code, message, details? } }`.
- `operator_id` derivation: `agent:${user.email ?? user.id}` (mirror `agentIdentifier` in the suppression route).
- Schema changes need a committed Payload migration (`make -C infra/fly pg-migrate-create ENV=dev NAME=...`) + `pnpm generate:types` + `pnpm generate:importmap`.
- Payload reserves `/admin/collections/*` — the view path stays under `/collections-queue`.
- Money from gRPC is decimal strings; render as-is (no float maths in the UI).
- Test gate per task: `pnpm test` (vitest) / `pytest` in `event-processor/`; `pnpm lint`.

---

### Task 1: BTB-199 residual — `rung` via `step_advanced` (event-processor)

**Files:**
- Modify: `event-processor/requirements.txt` (pin `collection-v0.2.0` → `collection-v0.3.0`, drop the TODO comment)
- Modify: `event-processor/src/billie_servicing/processor.py` (`_COLLECTION_EVENT_MODELS`, lines ~31–38)
- Modify: `event-processor/src/billie_servicing/handlers/collections.py`
- Modify: `event-processor/src/billie_servicing/main.py` (register handler, after line ~250)
- Test: `event-processor/tests/test_collections_handlers.py`

**Interfaces:**
- Consumes: `billie_collection_events.models.CollectionCaseStepAdvancedV1` (fields: `event_id, timestamp, account_id, correlation_id, customer_id, step:int, channel, template, advanced_at`).
- Produces: handler `handle_collection_case_step_advanced(pool, event)` upserting `collection_cases` with `rung = event.step` and `last_step = event.step` (keyed `account_id`, via the existing `_upsert_case`).

- [ ] **Step 1: Failing test** (MockPool pattern from `tests/conftest.py`):

```python
class TestStepAdvanced:
    @pytest.mark.asyncio
    async def test_step_advanced_sets_rung_and_last_step(self, mock_pool):
        event = MagicMock()
        event.account_id = "acc_1"
        event.customer_id = "cus_1"
        event.step = 3
        event.correlation_id = "corr_1"
        await handle_collection_case_step_advanced(mock_pool, event)
        call = mock_pool.last_upsert("collection_cases")
        assert call.conflict_columns == ["account_id"]
        assert call.values["rung"] == 3
        assert call.values["last_step"] == 3
        assert "state" not in call.values  # never clobbers lifecycle
```

- [ ] **Step 2: Run** `cd event-processor && pytest tests/test_collections_handlers.py -v` → ImportError.
- [ ] **Step 3: Implement:**

```python
# handlers/collections.py
async def handle_collection_case_step_advanced(pool: asyncpg.Pool, event: Any) -> None:
    """collection.case.step_advanced.v1 -> current rung (reminder step just sent)."""
    step = int(event.step)
    await _upsert_case(
        pool,
        account_id=event.account_id,
        customer_id=getattr(event, "customer_id", None),
        extra={"rung": step, "last_step": step},
    )
```

Register in `processor.py` `_COLLECTION_EVENT_MODELS`: `"collection.case.step_advanced.v1": "CollectionCaseStepAdvancedV1"` (match the dict's existing value style), and in `main.py`: `processor.register_handler("collection.case.step_advanced.v1", handle_collection_case_step_advanced)`. Bump the requirements pin: `...billie-event-sdks.git@collection-v0.3.0#subdirectory=packages/collection`.

- [ ] **Step 4: Run** full `pytest` in `event-processor/` → PASS (routing test `tests/test_processor_routing.py` — add a case asserting `collection.case.step_advanced.v1` parses to the new model).
- [ ] **Step 5: Commit** `feat(collections): project step_advanced -> rung (BTB-199 residual)`

---

### Task 2: `rung` column in the Payload collection + migration

**Files:**
- Modify: `src/collections/CollectionsCases.ts` (add field after `state`)
- Modify: `src/payload.config.ts` (`collection_cases` `afterSchemaInit` block, lines ~203–220)
- Create: migration via `make -C infra/fly pg-migrate-create ENV=dev NAME=collection_cases_rung`
- Regenerate: `pnpm generate:types && pnpm generate:importmap`

**Interfaces:**
- Produces: numeric nullable `rung` field (`collection_cases.rung`), and the scope-doc worklist index `(state, rung, updatedAt DESC)`.

- [ ] **Step 1:** Add the field:

```ts
{ name: 'rung', type: 'number', index: true, admin: { readOnly: true } },
```

- [ ] **Step 2:** Update the worklist index in `payload.config.ts`:

```ts
collection_cases_worklist_idx: index('collection_cases_worklist_idx').on(
  t.state,
  t.rung,
  desc(t.updatedAt),
),
```

- [ ] **Step 3:** Create + commit the migration; regenerate types/importmap. Verify migration SQL adds `rung numeric` and recreates the index.
- [ ] **Step 4:** `pnpm lint && pnpm test` → PASS. Commit `feat(collections): rung column + worklist index (BTB-199 residual)`.

---

### Task 3: WS2 — read API routes (BTB-200)

**Files:**
- Create: `src/app/api/collections/cases/route.ts`
- Create: `src/app/api/collections/cases/[accountId]/route.ts`
- Test: `tests/unit/api/collections-cases.test.ts` (follow existing route-test setup under `tests/unit/`)

**Interfaces:**
- Consumes: Payload local API (`collection-cases`, `loan-accounts` slugs), `getLedgerClient().getOverdueAccounts` (aging enrichment, fallback pattern from `src/app/api/ledger/aging/overdue/route.ts`).
- Produces (list): `GET /api/collections/cases?state=&rung=&hardshipPaused=&stoppedContact=&page=1&limit=50` →

```ts
export interface CollectionsCaseRow {
  accountId: string
  customerId: string | null
  customerName: string | null
  accountNumber: string | null
  state: 'open' | 'awaiting_human' | 'cured'
  rung: number | null
  hardshipPaused: boolean
  stoppedContact: boolean
  overdueAmount: number | null
  daysOverdue: number | null
  lastStep: number | null
  openedAt: string | null
  updatedAt: string
  aging: { dpd: number; bucket: string; totalOverdue: string } | null
}
// response: { cases: CollectionsCaseRow[]; totalDocs: number; page: number; totalPages: number; hasNextPage: boolean; agingUnavailable: boolean }
```

- Produces (detail): `GET /api/collections/cases/{accountId}` → `{ case: CollectionsCaseRow }`, 404 `{error:{code:'NOT_FOUND'}}` when absent.

- [ ] **Step 1: Failing vitest** for: auth guard (401), state/rung/flag filtering passed to `payload.find` where-clause, pagination echo, aging join keyed by accountId, `agingUnavailable: true` + null aging on ledger UNAVAILABLE (code 14), detail 404.
- [ ] **Step 2: Implement list route:**

```ts
// src/app/api/collections/cases/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { getLedgerClient } from '@/server/grpc-client'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const { payload } = auth
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1)
  const limit = Math.min(100, Math.max(1, Number(sp.get('limit') ?? '50') || 50))

  const where: Record<string, unknown>[] = []
  const state = sp.get('state')
  if (state) where.push({ state: { equals: state } })
  const rung = sp.get('rung')
  if (rung) where.push({ rung: { equals: Number(rung) } })
  if (sp.get('hardshipPaused') === 'true') where.push({ hardshipPaused: { equals: true } })
  if (sp.get('stoppedContact') === 'true') where.push({ stoppedContact: { equals: true } })

  const result = await payload.find({
    collection: 'collection-cases',
    where: where.length ? { and: where } : undefined,
    sort: '-updatedAt',
    page,
    limit,
    depth: 0,
  })

  // loan-account enrichment (accountNumber / customerIdString / customerName)
  const accountIds = result.docs.map((d) => d.accountId)
  const loanAccounts = accountIds.length
    ? await payload.find({
        collection: 'loan-accounts',
        where: { loanAccountId: { in: accountIds } },
        limit: accountIds.length,
        depth: 0,
      })
    : { docs: [] }
  const byAccountId = new Map(loanAccounts.docs.map((a) => [a.loanAccountId, a]))

  // ledger aging enrichment — same fallback contract as /api/ledger/aging/overdue
  let agingByAccount = new Map<string, { dpd: number; bucket: string; totalOverdue: string }>()
  let agingUnavailable = false
  try {
    const overdue = await getLedgerClient().getOverdueAccounts({ pageSize: 1000 })
    agingByAccount = new Map(
      (overdue.accounts ?? []).map((a: any) => [
        a.accountId ?? a.account_id,
        {
          dpd: Number(a.dpd ?? 0),
          bucket: String(a.bucket ?? ''),
          totalOverdue: String(a.totalOverdueAmount ?? a.total_overdue_amount ?? ''),
        },
      ]),
    )
  } catch (err: any) {
    if (err?.code === 14) agingUnavailable = true
    else throw err
  }

  const cases = result.docs.map((doc) => {
    const la = byAccountId.get(doc.accountId)
    return {
      accountId: doc.accountId,
      customerId: doc.customerId ?? la?.customerIdString ?? null,
      customerName: la?.customerName ?? null,
      accountNumber: la?.accountNumber ?? null,
      state: doc.state,
      rung: doc.rung ?? null,
      hardshipPaused: Boolean(doc.hardshipPaused),
      stoppedContact: Boolean(doc.stoppedContact),
      overdueAmount: doc.overdueAmount ?? null,
      daysOverdue: doc.daysOverdue ?? null,
      lastStep: doc.lastStep ?? null,
      openedAt: doc.openedAt ?? null,
      updatedAt: doc.updatedAt,
      aging: agingByAccount.get(doc.accountId) ?? null,
    }
  })

  return NextResponse.json({
    cases,
    totalDocs: result.totalDocs,
    page: result.page,
    totalPages: result.totalPages,
    hasNextPage: result.hasNextPage,
    agingUnavailable,
  })
}
```

(Adjust `loan-accounts` field names to the actual collection schema — the overdue route at `src/app/api/ledger/aging/overdue/route.ts` shows the exact ones; copy its lookup/normalisation verbatim.)

- [ ] **Step 3: Implement detail route** — same auth; `payload.find({ collection: 'collection-cases', where: { accountId: { equals: params.accountId } }, limit: 1 })`; 404 if empty; enrich the single row the same way (aging via `getOverdueAccounts` filtered in memory, fallback null).
- [ ] **Step 4: Run** `pnpm test` → PASS. Commit `feat(collections): case list + detail read API (BTB-200 WS2)`.

---

### Task 4: WS2 — query hooks (BTB-200)

**Files:**
- Create: `src/hooks/queries/useCollectionsCases.ts`, `src/hooks/queries/useCollectionsCase.ts`, `src/hooks/queries/useCollectionsCasesByCustomer.ts`
- Modify: `src/hooks/queries/index.ts`, `src/hooks/index.ts`
- Test: `tests/unit/hooks/collections-queries.test.tsx` (mirror the existing hook tests' QueryClient wrapper)

**Interfaces:**
- `useCollectionsCases(filters: { state?: string; rung?: number; hardshipPaused?: boolean; stoppedContact?: boolean })` — `useInfiniteQuery`, key `['collections-cases', filters]`, page-number pagination (`initialPageParam: 1`, `getNextPageParam: (last) => (last.hasNextPage ? last.page + 1 : undefined)`), `refetchInterval: 30_000`, `placeholderData: (prev) => prev`; returns `{ cases, totalDocs, agingUnavailable, fetchNextPage, hasNextPage, isLoading }` with `cases = pages.flatMap(p => p.cases)`.
- `useCollectionsCase(accountId: string | null)` — plain query, key `['collections-cases', 'detail', accountId]`, `enabled: !!accountId`, 30s poll.
- `useCollectionsCasesByCustomer(customerId: string | null)` — key `['collections-cases', 'customer', customerId]`, `enabled: !!customerId`, 30s poll; fetches `/api/collections/cases?customerId=...`. **Requires** adding a `customerId` filter to the Task 3 list route: `if (sp.get('customerId')) where.push({ customerId: { equals: sp.get('customerId') } })` — include that in this task.
- Export query-key fns `collectionsCasesQueryKey`, `collectionsCaseQueryKey`, `collectionsCasesByCustomerQueryKey` (mirror `overdueAccountsQueryKey`'s style) so WS5 mutations can invalidate.

- [ ] **Step 1: Failing tests** — filter → querystring mapping, flatMap pagination, `enabled` gating for null ids.
- [ ] **Step 2: Implement** (mirror `useConversations.ts` for the infinite hook and `useCustomerConversations` for the per-customer one; `fetch` with `credentials: 'include'`, throw on `!res.ok`).
- [ ] **Step 3: Barrel exports** in `src/hooks/queries/index.ts` + `src/hooks/index.ts`.
- [ ] **Step 4: Run** `pnpm test` → PASS. Commit `feat(collections): collections-cases query hooks (BTB-200 WS2)`.

---

### Task 5: WS5 — CollectionsService gRPC client (BTB-198)

**Files:**
- Create: `src/server/collections-service-client.ts`
- Test: `tests/unit/server/collections-service-client.test.ts` (mirror the dispatcher client's tests if present; else unit-test the response mappers)

**Interfaces (produced):**

```ts
export interface CaseActionResponse { accountId: string; newState: string; emittedEventId: string }
export interface GateResult { status: 'GATE_UNSPECIFIED' | 'PASS' | 'FAIL' | 'NOT_APPLICABLE'; reason: string }
export interface CostLedgerEntry { label: string; amount: string; category: 'production' | 'hard'; recoverable: boolean }
export interface NextStepPreview { rung: number; channel: string; template: string; subject: string; body: string }
export interface CaseEconomics {
  accountId: string; amountOwed: string; costOfNextStep: string; expectedNetRecovery: string
  gateResult: GateResult; costLedger: CostLedgerEntry[]; nextStepPreview: NextStepPreview | null
}
export interface ContactCapStatus { sent7d: number; cap7d: number; sentMonth: number; capMonth: number }
export interface ContactLogEntry { sentAt: string | null; channel: string; template: string; outcome: string }
export interface ContactLog { accountId: string; entries: ContactLogEntry[]; contactCapStatus: ContactCapStatus }

export class CollectionsServiceClient {
  flagHardship(p: { accountId: string; operatorId: string; reason: string; idempotencyKey: string }): Promise<CaseActionResponse>
  resumeFromHardship(p: { accountId: string; operatorId: string; idempotencyKey: string }): Promise<CaseActionResponse>
  applyStopContact(p: { accountId: string; operatorId: string; reason?: string; idempotencyKey: string }): Promise<CaseActionResponse>
  advanceToNextStep(p: { accountId: string; operatorId: string; idempotencyKey: string }): Promise<CaseActionResponse>
  getCaseEconomics(accountId: string): Promise<CaseEconomics>
  listCaseEconomics(accountIds: string[]): Promise<CaseEconomics[]>
  getContactLog(accountId: string): Promise<ContactLog>
}
export function getCollectionsServiceClient(): CollectionsServiceClient
export function isFailedPrecondition(err: unknown): boolean // err.code === grpc.status.FAILED_PRECONDITION (9)
export function isNotFound(err: unknown): boolean
```

- [ ] **Step 1: Implement by mirroring `src/server/notification-dispatcher-client.ts`** exactly (this file is the pattern owner):
  - `PROTO_PATH = path.resolve(__dirname, '../../proto/collections_service.proto')` (already vendored).
  - `protoLoader.loadSync(PROTO_PATH, { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true })` → `grpc.loadPackageDefinition(...).billie.collections.v1.CollectionsService`.
  - URL: `process.env.COLLECTIONS_SERVICE_GRPC_URL || 'localhost:50053'`; same insecure-vs-SSL host heuristic (`.internal`/`localhost`/`127.`/`.platform` → insecure).
  - `promisify` wrapper, `timestampToIso` for `ContactLogEntry.sentAt`, module-level singleton `getCollectionsServiceClient()`.
  - Request field names in camelCase (`keepCase:false`): `{ accountId, operatorId, reason, idempotencyKey }`; response mapping with `?? ''`/`?? 0` defaults; `nextStepPreview` → `null` when the message is empty (`!p?.rung && !p?.channel && !p?.template`).
- [ ] **Step 2: Unit-test the mappers** (economics with NOT_APPLICABLE/empty preview → `nextStepPreview: null`; timestamp mapping). Run `pnpm test` → PASS.
- [ ] **Step 3: Commit** `feat(collections): CollectionsService gRPC client (BTB-198 WS5)`.

---

### Task 6: WS5 — action + read API routes (BTB-198)

**Files:**
- Create: `src/app/api/collections/actions/flag-hardship/route.ts`
- Create: `src/app/api/collections/actions/resume-hardship/route.ts`
- Create: `src/app/api/collections/actions/stop-contact/route.ts`
- Create: `src/app/api/collections/actions/advance/route.ts`
- Create: `src/app/api/collections/cases/[accountId]/economics/route.ts`
- Create: `src/app/api/collections/cases/[accountId]/contact-log/route.ts`
- Create: `src/app/api/collections/economics/route.ts` (batch, for the WS3 net-recovery sort)
- Test: `tests/unit/api/collections-actions.test.ts`

**Interfaces:**
- Action POST body (all four): `{ accountId: string; reason?: string; idempotencyKey: string }` (reason required for flag-hardship, optional stop-contact, absent resume/advance). Response 200 `{ result: CaseActionResponse }`.
- Error mapping: gRPC `NOT_FOUND` → 404 `{error:{code:'NOT_FOUND'}}`; `FAILED_PRECONDITION` → **409** `{error:{code:'FAILED_PRECONDITION', message: <grpc details — includes "economic gate failed: …">}}`; `RESOURCE_EXHAUSTED` → 429 `{error:{code:'CONTACT_CAP'}}`; anything else → 502 `{error:{code:'INTERNAL_ERROR'}}`.
- Auth: flag/resume/stop → `requireAuth(canService)`; advance → `requireAuth(hasApprovalAuthority)`.
- Reads: `GET .../economics` → `{ economics: CaseEconomics }`; `GET .../contact-log` → `{ contactLog: ContactLog }`; `POST /api/collections/economics` body `{ accountIds: string[] }` (≤200) → `{ items: CaseEconomics[] }`. All three `requireAuth(hasAnyRole)`; on gRPC UNAVAILABLE return 200 with `{ economics: null, unavailable: true }` / `{ items: [], unavailable: true }` (graceful-degrade contract for the UI).

- [ ] **Step 1: Failing vitest** — role gating per route (operations token can flag but not advance), Zod body validation (400 + fieldErrors), gRPC error mapping incl. FAILED_PRECONDITION → 409 with the gate reason surfaced, operator_id derivation `agent:${email}`.
- [ ] **Step 2: Implement** — full code for flag-hardship (the others are the same skeleton with the substitutions listed below):

```ts
// src/app/api/collections/actions/flag-hardship/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import {
  getCollectionsServiceClient,
  isFailedPrecondition,
  isNotFound,
} from '@/server/collections-service-client'

const Body = z.object({
  accountId: z.string().min(1),
  reason: z.string().min(1),
  idempotencyKey: z.string().min(8),
})

export async function POST(req: NextRequest) {
  const auth = await requireAuth(canService)
  if ('error' in auth) return auth.error
  const { user } = auth
  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'invalid JSON' } }, { status: 400 })
  }
  const parsed = Body.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'invalid body', details: parsed.error.flatten().fieldErrors } },
      { status: 400 },
    )
  }
  const operatorId = `agent:${(user as any).email ?? (user as any).id}`
  try {
    const result = await getCollectionsServiceClient().flagHardship({
      accountId: parsed.data.accountId,
      operatorId,
      reason: parsed.data.reason,
      idempotencyKey: parsed.data.idempotencyKey,
    })
    return NextResponse.json({ result })
  } catch (err: any) {
    if (isNotFound(err))
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'unknown account' } }, { status: 404 })
    if (isFailedPrecondition(err))
      return NextResponse.json(
        { error: { code: 'FAILED_PRECONDITION', message: err?.details ?? 'precondition failed' } },
        { status: 409 },
      )
    if (err?.code === 8 /* RESOURCE_EXHAUSTED */)
      return NextResponse.json({ error: { code: 'CONTACT_CAP', message: err?.details ?? 'contact cap reached' } }, { status: 429 })
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'collections service error' } }, { status: 502 })
  }
}
```

Substitutions for the other three (same file body otherwise):
| Route | access check | Body schema | client call |
|---|---|---|---|
| `resume-hardship` | `canService` | `{accountId, idempotencyKey}` | `resumeFromHardship({accountId, operatorId, idempotencyKey})` |
| `stop-contact` | `canService` | `{accountId, reason: z.string().optional(), idempotencyKey}` | `applyStopContact({...})` |
| `advance` | `hasApprovalAuthority` | `{accountId, idempotencyKey}` | `advanceToNextStep({...})` |

Reads: thin wrappers calling `getCaseEconomics`/`getContactLog`/`listCaseEconomics` with the UNAVAILABLE (code 14) degrade described in Interfaces.

- [ ] **Step 3: Run** `pnpm test` → PASS. Commit `feat(collections): operator action + economics/contact-log routes (BTB-198 WS5)`.

---

### Task 7: WS5 — mutation hooks (BTB-198)

**Files:**
- Create: `src/hooks/mutations/useFlagHardship.ts`, `useResumeHardship.ts`, `useApplyStopContact.ts`, `useAdvanceToNextStep.ts`
- Modify: `src/hooks/mutations/index.ts`, `src/hooks/index.ts`
- Test: `tests/unit/hooks/collections-mutations.test.tsx`

**Interfaces:**
- Mirror `useWaiveFee.ts` (optimistic store, failed-actions store, toasts, idempotency) minus the version-store wiring (collections commands carry no `expectedVersion`).
- Each hook: `mutationFn` POSTs the Task 6 route with `generateIdempotencyKey(accountId, '<action>')` (from `@/lib/utils/idempotency`); `onMutate` stages a `PendingMutation` (`action: 'flag-hardship' | 'resume-hardship' | 'stop-contact' | 'advance-step'`); `onSuccess` confirms + `queryClient.invalidateQueries({ queryKey: ['collections-cases'] })` (covers list, detail, per-customer via prefix) and toasts; `onError` marks failed, routes system errors to `addFailedAction`, and for 409 FAILED_PRECONDITION shows the server message verbatim (that's the economic-gate/state reason).
- Exports: `useFlagHardship(): { flagHardship, isLoading }` etc. — follow `useWaiveFee`'s return shape.

- [ ] **Step 1: Failing tests** — success invalidates `['collections-cases']`; 409 surfaces server reason in toast and does NOT enqueue failed-action; network error enqueues failed-action.
- [ ] **Step 2: Implement four hooks + barrels.**
- [ ] **Step 3: Run** `pnpm test` → PASS. Commit `feat(collections): operator mutation hooks (BTB-198 WS5)`.

---

### Task 8: WS5 — env plumbing + docs

**Files:**
- Modify: `infra/fly/fly.prod.toml`, `fly.demo.toml`, `fly.dev.toml`, `fly.staging.toml` — in `[env]` next to `NOTIFICATION_DISPATCHER_GRPC_URL` (line ~36): `COLLECTIONS_SERVICE_GRPC_URL = "billie-platform-services-<env>.internal:50053"`
- Modify: `.env.example` and `infra/fly/env/.env.*.example` — add `COLLECTIONS_SERVICE_GRPC_URL=localhost:50053` (dotenv files are hook-protected; edit manually if the tool is blocked)
- Modify: `CLAUDE.md` — "Server-side clients" section: add `notification-dispatcher-client.ts` (missing) and `collections-service-client.ts`; "Environment" section: add the new var

- [ ] **Step 1:** Apply edits. **Step 2:** Commit `chore(collections): COLLECTIONS_SERVICE_GRPC_URL plumbing (BTB-198 WS5)`.

---

### Task 9: WS3 — re-platform the queue (BTB-196)

**Files:**
- Modify: `src/payload.config.ts` line ~93-100: `views.collections.path: '/collections-queue'` → `'/collections-queue/:segments*'`
- Modify: `src/components/CollectionsView/CollectionsView.tsx`
- Modify: `src/components/CollectionsView/styles.module.css`
- Keep untouched: `NavCollectionsLink`, CSV export, fallback banner (now driven by `agingUnavailable`), pagination
- Test: `tests/unit/components/collections-view.test.tsx`

**Changes to `CollectionsView.tsx` (surgical, keep the file's structure):**
1. Data spine: `useOverdueAccounts(filters)` → `useCollectionsCases(filters)`; row type `OverdueAccount` → `CollectionsCaseRow`.
2. Filter state: replace `{bucket, minDpd, maxDpd, pageToken}` with `{state?: 'open'|'awaiting_human'|'cured', rung?: number, hardshipPaused?: boolean, stoppedContact?: boolean}`; "Awaiting human" filter chip = `state: 'awaiting_human'`.
3. Columns: Account · Customer · **Rung** (render `rung ?? '—'` as `Step {rung}/5`) · **State** (badge: open=amber, awaiting_human=red, cured=green) · **Flags** (chips: `Hardship` when `hardshipPaused`, `Stop contact` when `stoppedContact`) · DPD/Bucket/Amount (from `row.aging`, `—` when null) · Updated.
4. Sort control (select): `Updated (default)` | `Expected net recovery`. ENR sort: on selection, `POST /api/collections/economics` with the loaded page's `accountIds`, sort rows client-side by `Number(expectedNetRecovery)` desc; while every `gateResult.status === 'NOT_APPLICABLE'` or route returns `unavailable`, show the option with a "pending platform deploy (BTB-194)" tooltip and leave order unchanged. (Server-side ENR sort is deliberately out of scope — compute-on-read decision.)
5. Row click: `router.push(\`/admin/collections-queue/\${row.accountId}\`)` (replaces the servicing redirect).
6. CSV headers become `['Account','Customer','Rung','State','Flags','DPD','Bucket','Amount','Updated']`.
7. Fallback banner condition: `agingUnavailable` (aging columns degrade; cases still render — the queue no longer dies with the ledger).

- [ ] **Step 1: Failing component tests** — renders rows from a mocked `useCollectionsCases`, filter chips update the hook filters, awaiting_human chip filters state, row click pushes the case-view path, ENR option disabled/tooltip when batch economics returns all NOT_APPLICABLE.
- [ ] **Step 2: Implement** (extend `styles.module.css` with `.stateBadge`, `.flagChip`, rung cell styles following the existing `BUCKET_CONFIG` badge classes).
- [ ] **Step 3:** `pnpm test && pnpm lint` → PASS. Manually: `pnpm dev`, `/admin/collections-queue` lists cases with filters. Commit `feat(collections): event-sourced worklist (BTB-196 WS3)`.

---

### Task 10: WS4 — case view + segment routing (BTB-197)

**Files:**
- Create: `src/components/CollectionsView/CollectionsCaseView.tsx`
- Modify: `src/components/CollectionsView/CollectionsViewWithTemplate.tsx` (segment routing)
- Modify: `src/components/CollectionsView/styles.module.css`
- Test: `tests/unit/components/collections-case-view.test.tsx`

**Interfaces:**
- `CollectionsViewWithTemplate` parses `params.segments`: none → `<CollectionsView/>`; `[accountId]` → `<CollectionsCaseView accountId={accountId}/>` (still inside `DefaultTemplate`, same auth redirect).
- `CollectionsCaseView({ accountId })` — three panels, all data client-side:
  1. **Operational**: `useCollectionsCase(accountId)` → rung ladder 0–6 (visual ladder; current = `rung` for open cases, `awaiting_human` renders at rung 3 marker "escalation candidate"), state badge, lifecycle timestamps (openedAt/pausedAt/resumedAt/stopContactAt/curedAt/exhaustedAt), flags.
  2. **Accounting + economics**: fetch `/api/collections/cases/{accountId}/economics` (query `['collections-economics', accountId]`, 60s poll). When `unavailable` or `gateResult.status === 'NOT_APPLICABLE'` with the BTB-194 stub reason → "Economics pending" placeholder. Else render Amount owed (frozen A) vs live ledger balance (from the existing account aging/balance hooks used by ServicingView's `AccountPanel` — display both, labelled), cost of next step, expected net recovery, gate badge (PASS green / FAIL red with reason), cost ledger table (label/amount/category/recoverable).
  3. **Contact + actions**: fetch `/api/collections/cases/{accountId}/contact-log` (key `['collections-contact-log', accountId]`, 30s poll) → entries table + cap status "2 of 3 this week · 6 of 10 this month"; action buttons wired to Task 7 hooks: Flag hardship (reason dialog) / Resume / Stop contact (confirm dialog) / **Advance to next step** — advance button shows `nextStepPreview` (rung/channel/template/subject/body) in a confirm modal ("what the customer will experience"), disabled with reason when gate FAIL or state terminal; visible-but-disabled for non-supervisor roles (mirror how ApprovalsView gates supervisor actions).
- Reuse `ContactNotes` panel (`ContactNotesPanel customerId={case.customerId} accountId={accountId}`) beneath the contact log if `customerId` present.

- [ ] **Step 1: Failing tests** — renders three panels from mocked hooks; economics NOT_APPLICABLE → pending placeholder; gate FAIL → advance disabled with reason; advance confirm shows preview subject/body.
- [ ] **Step 2: Implement.** **Step 3:** `pnpm test` → PASS. Commit `feat(collections): dedicated case view (BTB-197 WS4)`.

---

### Task 11: WS4 — ServicingView surfacing (BTB-197)

**Files:**
- Modify: `src/lib/accountTriage.ts` (`AttentionItem` kinds + `getAttentionItems`)
- Modify: `src/components/ServicingView/AttentionStrip.tsx` (icon map, lines ~11–17)
- Modify: `src/components/ServicingView/LoanAccountCard.tsx`
- Modify: `src/components/ServicingView/ServicingView.tsx` (call `useCollectionsCasesByCustomer(customerId)`, thread per-account case into cards + attention items)
- Test: extend the existing accountTriage/ServicingView unit tests

**Interfaces:**
- New `AttentionItem` kinds: `'collections' | 'hardship' | 'stop_contact'`. Per-account: any account with an open/awaiting_human case → `collections` item (accountId set); `hardshipPaused` → `hardship`. Customer-level: `stoppedContact` on any case → one `stop_contact` item with `accountId: null` (suppression is per-customer — surface separately).
- `getAttentionItems` gains a parameter `collectionsCases: CollectionsCaseRow[]` (default `[]` so existing call sites compile).
- `LoanAccountCard` gains optional prop `collectionsCase?: CollectionsCaseRow | null`: renders a badge `Collections · Step {rung ?? '?'} · {state}` (+ flag chips) and a "View collections case →" link to `/admin/collections-queue/{loanAccountId}` when a non-cured case exists.

- [ ] **Step 1: Failing tests** — triage emits the three kinds correctly (per-account vs customer-level nuance); card renders badge + deep-link only when a case exists.
- [ ] **Step 2: Implement.** **Step 3:** `pnpm test` → PASS. Commit `feat(collections): ServicingView collections surfacing (BTB-197 WS4)`.

---

### Task 12: Deploy, backfill verification, close-out

- [ ] **Preconditions:** platform plan Tasks 1–10 deployed to demo (economics live, `step_advanced` flowing); billieChat route deployed; `collection-v0.3.0` tag published.
- [ ] Deploy CRM to demo (its normal pipeline; migration `collection_cases_rung` applies on deploy).
- [ ] **Projection completeness check** (demo): in the CRM Neon DB `SELECT account_id, state, rung FROM collection_cases ORDER BY updated_at DESC;` vs the engine's truth from a platform fly machine (`fly ssh console` — demo pg is unreachable from laptops): `SELECT account_id, series_state, next_reminder_step FROM collections.overdue_projection WHERE series_state != 'completed';`. Every active/paused/stopped engine row must have a CRM row.
- [ ] **If rows are missing** (events predate routing/consumer-group creation): run a one-off re-emit from a platform fly machine — for each missing account, in this order per account: emit `collection.case.opened.v1` (fields from `overdue_projection` + `balance_projection`, `customer_id` via the accounts read-client), then `hardship_paused`/`stop_contact_applied` if flagged. The CRM handlers are idempotent upserts keyed on `account_id`, and `opened` never clobbers `created_at`, so re-emits are safe. `rung` self-heals on the next real step advance. (Script: `scripts/backfill_collection_case_events.py` in the platform repo, written at that point against `emit_collection_case_event` — only if the check actually finds gaps.)
- [ ] E2E on demo: queue lists cases → open case view → flag hardship (verify FSM state flips via `GetContactLog`/case state and the event round-trips back into the projection within seconds) → resume → advance (as supervisor; verify preview modal, gate badge, and a new send in the contact log). Verify an `operations` user cannot advance (409/403 path).
- [ ] Prod deploy; re-run the completeness check.
- [ ] Jira: move BTB-199 → Done (note the rung residual shipped here), BTB-200/196/197/198 → Done as each lands; BTB-194 tracked in the platform plan; comment on BTB-69 linking both plans.

## Execution order & parallelism

```
Platform plan (billie-platform-services) ───► deploy demo ─┐
  Tasks 1–7 (engine+gate+SDK+emit)                          │
billieChat route (platform plan Task 8) ────► deploy ───────┤
SDK tag collection-v0.3.0 (Task 9) ─────────────────────────┤
                                                            ▼
CRM: T1–T2 (rung)  →  T3–T4 (WS2)  →  T9 (WS3)  →  T10–T11 (WS4)  →  T12
            └──────►  T5–T8 (WS5, parallel with WS2/WS3 after proto/env known)
```

CRM Tasks 3–8 need only Phase-1 gRPC (already live) and degrade gracefully, so CRM work can proceed in parallel with the platform track; only ENR sort, gate enforcement, and rung data go live with the platform deploy.

## Jira mapping

| Ticket | Tasks | Notes |
|---|---|---|
| BTB-199 (WS1) | 1–2 + T12 verification | Core merged pre-plan (PR #32); this is the rung residual |
| BTB-200 (WS2) | 3–4 | |
| BTB-198 (WS5) | 5–8 | + batch economics route used by WS3 |
| BTB-196 (WS3) | 9 | ENR sort degrades until BTB-194 deploy |
| BTB-197 (WS4) | 10–11 | |
| BTB-69 | all | parent — comment with both plan links on completion |
