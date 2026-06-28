# Manual Block Clear — billie-crm UI (Plan B3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The operator UI for manual block clear: React Query hooks against the B2 command routes, a "Clear block" action on the blocked-customer view, and a block-clear approvals queue in the existing ApprovalsView (self-approval-disabled, mirroring write-offs).

**Architecture:** Mirrors the existing write-off UI (`src/hooks/{mutations,queries}`, `src/components/ApprovalsView/*`, `src/lib/events/poll.ts`). Hooks POST to `/api/commands/reapp-block-clear/*` (B2), then poll the `reapplication-block-clear-requests` projection. Builds on B1 (PR #34) + B2 (same branch).

**Tech Stack:** React 19, TanStack React Query, Payload admin (`@payloadcms/ui`), vitest + @testing-library/react (jsdom).

## Global Constraints

- Mirror the verbatim write-off templates: hooks `src/hooks/mutations/use{Approve,Reject,Cancel}WriteOff.ts` + `src/hooks/queries/usePendingApprovals.ts`; poll `src/lib/events/poll.ts` (`pollForWriteOffUpdate`); components `src/components/ApprovalsView/{ApprovalsView,ApprovalsList,ApprovalDetailDrawer,ApprovalActionModal}.tsx`. Read them first.
- Routes (B2): `POST /api/commands/reapp-block-clear/{request,approve,reject,cancel}`. Request body shapes = the B1 Zod command schemas (`BlockClear{Request,Approve,Reject,Cancel}CommandSchema`). All return 202 `{ requestId, status: 'accepted' }`.
- Projection read: `GET /api/reapplication-block-clear-requests?where[status][equals]=pending&...` (Payload REST for the collection slug `reapplication-block-clear-requests`).
- Self-approval: the Approve button is disabled when `currentUserId === requestedBy` (the `isOwnRequest` pattern from `ApprovalDetailDrawer`). The server also enforces it (B2), so the UI guard is UX-only.
- Role gating: current user via `useAuth()` from `@payloadcms/ui`; show "Clear block" to `admin/supervisor/operations` (`canService` roles); the approvals queue is `admin/supervisor` only (existing ApprovalsView access).
- Field bindings (camelCase, `payload-types.ts`): `reapplicationBlock.{reason, blockedUntil, canonicalCustomerId, clearStatus, clearedAt, clearJustification, clearRequestId}`. Treat the customer/conversation as blocked when `reapplicationBlock?.reason && !reapplicationBlock?.clearedAt`.
- Reason vocabulary for the request form: only offer `CLEARABLE_REASONS` (B1 `config.ts`); a selection containing any `REASONS_REQUIRING_APPROVAL` member shows "needs approval" copy.
- Tests: hooks via the `tests/unit/hooks/use*.test.ts` pattern (createWrapper + fetch mock + fake timers). **Components: this plan's UI components are built to the write-off template; their visual layout/interaction must get a human QA pass in the running admin app — the automated tests cover logic/wiring, not pixels.** Prettier (single quotes, no semicolons, 100 cols).
- New generated types: after any collection touch run `pnpm generate:types` (not expected here — no schema change).

---

### Task 1: React Query hooks + poll (fully tested)

**Files:**
- Modify: `src/lib/events/poll.ts` (add `pollForBlockClearUpdate`)
- Create: `src/hooks/mutations/useRequestBlockClear.ts`, `useApproveBlockClear.ts`, `useRejectBlockClear.ts`, `useCancelBlockClear.ts`; `src/hooks/queries/usePendingBlockClears.ts`
- Modify: `src/hooks/index.ts` (barrel exports)
- Test: `tests/unit/hooks/useApproveBlockClear.test.ts`, `useRequestBlockClear.test.ts`

**Interfaces produced:** `useRequestBlockClear()`, `useApproveBlockClear()`, `useRejectBlockClear()`, `useCancelBlockClear()`, `usePendingBlockClears(options)`.

- [ ] **Step 1: Write failing tests** mirroring `tests/unit/hooks/useRejectWriteOff.test.ts`: 
  - `useApproveBlockClear` — `approveAsync({ requestId, requestNumber, comment })` POSTs to `/api/commands/reapp-block-clear/approve` with that body; after a 202 it polls `/api/reapplication-block-clear-requests?...status=approved` and resolves; assert the POST URL + body.
  - `useRequestBlockClear` — `requestAsync({ canonicalCustomerId, reasons, justification, conversationId?, customerName? })` POSTs to `/api/commands/reapp-block-clear/request`; assert URL + body. (Single-op returns immediately; the hook just returns the 202 — no projection poll needed for request, since single-op has no row; for the maker-checker path the row appears but the request hook need not poll. Keep request simple: POST + return.)
  Run RED.

- [ ] **Step 2: Add `pollForBlockClearUpdate`** to `poll.ts` (copy `pollForWriteOffUpdate`, swap the endpoint to `/api/reapplication-block-clear-requests` and the `expectedStatus` union to `'approved' | 'rejected' | 'cancelled'`).

- [ ] **Step 3: Implement the mutation hooks** (each mirrors its write-off twin):
  - `useApproveBlockClear` → POST `/api/commands/reapp-block-clear/approve`, then `pollForBlockClearUpdate(requestId, 'approved')`, then `queryClient.invalidateQueries({ queryKey: ['block-clear-requests'] })` and `['pending-block-clears']`; sonner toast on success/error.
  - `useRejectBlockClear` → `/reject`, poll `'rejected'`.
  - `useCancelBlockClear` → `/cancel`, poll `'cancelled'`.
  - `useRequestBlockClear` → POST `/request`; no poll (single-op has no row, maker-checker row is eventual); invalidate `['pending-block-clears']`; toast.

- [ ] **Step 4: Implement `usePendingBlockClears`** (mirror `usePendingApprovals`): `useQuery` fetching `/api/reapplication-block-clear-requests` with `where[status][equals]=pending`, `sort`, paging; `queryKey: ['pending-block-clears', options]`; `refetchInterval: 60_000`.

- [ ] **Step 5: Barrel exports** in `src/hooks/index.ts` (add the 5 new hooks alongside the write-off ones).

- [ ] **Step 6: Tests green; Prettier; commit**

```bash
cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/hooks/useApproveBlockClear.test.ts tests/unit/hooks/useRequestBlockClear.test.ts --config ./vitest.config.mts
pnpm exec prettier --write src/hooks src/lib/events/poll.ts tests/unit/hooks/use{Approve,Request}BlockClear.test.ts
git add src/hooks src/lib/events/poll.ts tests/unit/hooks/use{Approve,Request}BlockClear.test.ts
git commit -m "feat(block-clear): react-query hooks + poll for block-clear requests"
```

---

### Task 2: "Clear block" action on the blocked-customer view

**Files:**
- Create: `src/components/BlockClear/ClearBlockButton.tsx`, `src/components/BlockClear/ClearBlockModal.tsx`
- Modify: the blocked-customer host — `src/components/ConversationDetailView/DecisionBanner/index.tsx` (render `ClearBlockButton` when a confirmed block is present) — and/or `src/components/ServicingView/ServicingView.tsx` near the AttentionStrip. (Choose the host the brief identifies; prefer DecisionBanner where the block + `canonicalCustomerId` are already in scope.)
- Test: `tests/unit/components/ClearBlockModal.test.tsx`

**Interfaces:** `<ClearBlockButton block={reapplicationBlock} conversationId? customerName? />` opens `<ClearBlockModal>` → on submit calls `useRequestBlockClear`.

- [ ] **Step 1: Write a failing component test** (testing-library): rendering `ClearBlockModal` with the clearable reasons, selecting a reason + entering a justification (≥ N chars), submitting calls the (mocked) `requestAsync` with `{ canonicalCustomerId, reasons, justification }`; a default-class reason shows the "requires approval" notice; submit is disabled until a reason + valid justification are present. RED.

- [ ] **Step 2: Implement `ClearBlockModal`** (model on `ApprovalActionModal`): a form with a reasons multiselect limited to `CLEARABLE_REASONS` (label each; show an "Approval required" badge when any selected reason ∈ `REASONS_REQUIRING_APPROVAL`), a justification textarea (min length, mirror `MIN_APPROVAL_COMMENT_LENGTH`), submit → `useRequestBlockClear().requestAsync({...})`, success toast + close. Pre-select the block's current `reason` if it's clearable.

- [ ] **Step 3: Implement `ClearBlockButton`** — visible only to `canService` roles (`useAuth()`), only when `block?.reason && !block?.clearedAt`. Shows current `clearStatus` if a clear is already pending/rejected. Opens the modal. (`PEP`/`ACTIVE_LOAN`/`IDENTITY_CONFLICT` are not clearable — if the current `reason` is one of those, render a disabled state with a tooltip rather than the action.)

- [ ] **Step 4: Wire into the host** (DecisionBanner): render `<ClearBlockButton block={reapplicationBlock} conversationId={conversation.id} customerName={...} />` where the block details are shown. Additive — do not alter the existing banner content.

- [ ] **Step 5: Test green; Prettier; commit**

```bash
cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/components/ClearBlockModal.test.tsx --config ./vitest.config.mts
pnpm exec prettier --write src/components/BlockClear src/components/ConversationDetailView/DecisionBanner/index.tsx tests/unit/components/ClearBlockModal.test.tsx
git add src/components/BlockClear src/components/ConversationDetailView/DecisionBanner/index.tsx tests/unit/components/ClearBlockModal.test.tsx
git commit -m "feat(block-clear): Clear-block action + modal on blocked-customer view"
```

**⚠️ Visual QA:** the modal/button layout, the reason multiselect, and the host placement need a human pass in the running admin app.

---

### Task 3: Block-clear approvals queue in ApprovalsView

**Files:**
- Create: `src/components/ApprovalsView/BlockClearList.tsx`, `src/components/ApprovalsView/BlockClearDetailDrawer.tsx`
- Modify: `src/components/ApprovalsView/ApprovalsView.tsx` (add a "Block clears" tab/section alongside write-offs)
- Test: `tests/unit/components/BlockClearDetailDrawer.test.tsx`

**Interfaces:** a second queue in ApprovalsView listing pending `reapplication-block-clear-requests`, each row opening `BlockClearDetailDrawer` with Approve/Reject (self-approval-disabled) wired to the B3.1 mutations.

- [ ] **Step 1: Write a failing component test** for `BlockClearDetailDrawer`: given a request whose `requestedBy === currentUserId`, the Approve button is disabled with the "Cannot approve own request" reason (mirror the `ApprovalDetailDrawer` `isOwnRequest` test); Approve calls `useApproveBlockClear`, Reject calls `useRejectBlockClear`. RED.

- [ ] **Step 2: Implement `BlockClearList`** (parallel to `ApprovalsList`, isolated so the write-off list is untouched): use `usePendingBlockClears`, render rows showing `requestNumber`, `customerName`, `reasons`, requester, age; row click opens `BlockClearDetailDrawer`; pass `currentUserId`/`currentUserName`.

- [ ] **Step 3: Implement `BlockClearDetailDrawer`** (parallel to `ApprovalDetailDrawer`): show the request detail (canonical id, reasons, justification, requester); the `isOwnRequest` self-approval-disabled Approve button; Approve/Reject open an `ApprovalActionModal` (reuse it) → `useApproveBlockClear`/`useRejectBlockClear`.

- [ ] **Step 4: Add the queue to `ApprovalsView`** — a tab/section "Block clears" beside "Write-Off Approvals" (additive; do not change the write-off section), rendering `<BlockClearList currentUserId={userId} currentUserName={userName} />`, gated by the same `admin/supervisor` access already in ApprovalsView.

- [ ] **Step 5: Test green; Prettier; commit**

```bash
cd /Users/rohansharp/workspace/billie-crm && pnpm exec vitest run tests/unit/components/BlockClearDetailDrawer.test.tsx --config ./vitest.config.mts
pnpm exec prettier --write src/components/ApprovalsView tests/unit/components/BlockClearDetailDrawer.test.tsx
git add src/components/ApprovalsView tests/unit/components/BlockClearDetailDrawer.test.tsx
git commit -m "feat(block-clear): block-clear approvals queue in ApprovalsView"
```

**⚠️ Visual QA:** the tab, list columns, and drawer layout need a human pass; consider an e2e (Playwright) follow-up mirroring any write-off approvals e2e.

---

## Self-Review

- **Spec coverage:** §12/§13 UI surface → the request action (Task 2) + the approvals queue (Task 3); the hooks (Task 1) bind to the B2 routes. Self-approval-disabled mirrors write-off; server-side guard is the real enforcement (B2).
- **Isolation:** new components are parallel (`BlockClear*`) — the working write-off ApprovalsView path is untouched (additive tab + a parallel list/drawer), accepting some duplication for safety over generalizing shared components we can't visually verify.
- **Verification boundary:** hooks + form logic + the isOwnRequest/role gating are unit-tested; component *visual* layout is explicitly deferred to human QA.
- **Placeholder scan:** hooks carry concrete wiring; components reference their verbatim write-off templates + the new data bindings.
