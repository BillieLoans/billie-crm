# Collections CRM (Stream D) — build scope

| Field | Value |
| --- | --- |
| Status | DRAFT — file-level build scope for review / ticket-cutting |
| Repo | billie-crm (the CRM = consumer; UI + read model) |
| Date | 2026-06-24 |
| Parent | BTB-69 (Collections process embedment) |
| Depends on (done) | BTB-166 — headless `collectionsService` emits all six `collection.case.*` to ChatLedger |
| Depends on (backlog) | BTB-194 — cost-of-recovery economics engine (gate + `CaseEconomics`); CRM degrades gracefully until it lands |
| Contract | `proto/collections_service.proto` (vendored copy of the provider's canonical) |
| Consumer reqs | `docs/collections/collections-service-grpc-consumer-requirements.md` |

## Decisions locked

1. **CRM is the consumer.** The engine (`collectionsService`) owns the FSM, cadence, economics, and emits `collection.case.*`. The CRM consumes those events into its own Postgres read model and renders the operator UI. No collections business logic in the CRM.
2. **Per-case view = Option A** — a **dedicated** collections case view, *plus* collections/hardship context surfaced in the (customer-scoped) **ServicingView** with a deep-link to the case view.
3. **Operator actions = `collectionsService` gRPC** (vendored `collections_service.proto` + a new client), **not** the superseded `NotificationDispatcherService` hardship RPCs (those route to the wrong inbox post-BTB-166). Suppression stays on the dispatcher client (unchanged).
4. **Economics is graceful-degrade.** Build the per-case view + worklist against the full `CaseEconomics` contract, but the economics panel + net-recovery sort + the `AdvanceToNextStep` cost-of-recovery gate render "pending"/disabled until BTB-194 ships real data. CRM v1 is not blocked on it.
5. **Projection store = Postgres**, schema owned by Payload (TS collection config → Drizzle), written only by the Python event-processor (read-only projection — `create/update/delete: () => false`).

## Data flow

```
collectionsService (engine) ──collection.case.*──▶ ChatLedger ──▶ inbox:billie-servicing
                                                                        │
                                  Python event-processor (WS1) ──upsert─┤
                                                                        ▼
                                                            Postgres: collection_cases
                                                                        ▲ reads (WS2)
   Payload/Next CRM ── worklist (WS3) · case view (WS4) · ServicingView surfacing (WS4)
        │                         │ economics + contact log + actions
        │ accounting reads        ▼
        └──▶ AccountingLedgerService gRPC (exists)    CollectionsService gRPC (WS5, new client)
```

---

## WS1 — Consume `collection.case.*` → `CollectionsCase` projection

Unblocked; depends on nothing in WS2–WS5. Mirrors the existing 29-handler pattern.

| File | Change |
| --- | --- |
| `event-processor/requirements.txt` | Add the `billie-collection-events` SDK (≥0.2.0, the version BTB-166 shipped — confirm tag/subdirectory, e.g. `…@collection-v0.2.0#subdirectory=packages/collection`) |
| `event-processor/src/billie_servicing/processor.py` | Add a parse branch for the `collection.` prefix → `parse_collection_message` (typed); the operator events carry a real `customer_id` (BTB-154), so prefer the SDK over envelope-dict |
| `event-processor/src/billie_servicing/handlers/collections.py` *(new)* | Six handlers — `opened`, `cured`, `exhausted`, `hardship_paused`, `resumed`, `stop_contact_applied` — using `db.py` `upsert`/`update_by_key` keyed on `account_id`. Map operational state/rung/flags/lifecycle/money-snapshot per the read-model spec (§2) |
| `event-processor/src/billie_servicing/main.py` | Register the six handlers in `setup_handlers` |
| `event-processor/tests/test_collections_handlers.py` *(new)* | `MockPool` assertions (table, conflict keys, idempotency) |
| `src/collections/CollectionsCases.ts` *(new)* | Read-only Payload collection, slug `collection-cases`; fields: `accountId` (unique/index), `customerId` (relationship) + `customerIdString` (index), `state`, `rung`, `hardshipPaused`/`stoppedContact`, lifecycle timestamps, `overdueAmount`/`daysOverdue`/`lastStep`, terminal state; `access: { create/update/delete: () => false }`, all fields `readOnly` |
| `src/payload.config.ts` | Register the collection; add `afterSchemaInit` indexes `(state, rung, updatedAt DESC)` and `(customerIdString, updatedAt DESC)` (same mechanism as the conversations monitor-grid) |
| `src/payload-types.ts`, importMap, `src/migrations/*` | Regenerate (`pnpm generate:types` + `generate:importmap`); commit a Payload migration via the local-Docker-Postgres recipe |

**Dependency to verify (platform-side, not this repo):** ChatLedger fan-out routes `collection.case.*` into `inbox:billie-servicing` (`consume_from_agents=["collectionsService"]`). Without it the projection never fills.

## WS2 — Read-model API + query hooks

| File | Change |
| --- | --- |
| `src/app/api/collections/cases/route.ts` *(new)* | List — filter/paginate over `collection_cases` (Payload local API); optionally enrich each row with ledger aging (reuse the `/api/ledger/aging/overdue` enrichment pattern) |
| `src/app/api/collections/cases/[accountId]/route.ts` *(new)* | Single-case detail |
| `src/hooks/queries/useCollectionsCases.ts` *(new)* | Infinite query (mirror `useConversations`) |
| `src/hooks/queries/useCollectionsCase.ts` *(new)* | Single case |
| `src/hooks/queries/useCollectionsCasesByCustomer.ts` *(new)* | All cases for a customer's accounts — feeds the ServicingView surfacing (WS4) |
| `src/hooks/queries/index.ts`, `src/hooks/index.ts` | Barrel exports |

## WS3 — Worklist (evolve the existing `/admin/collections-queue`)

The current view is the ledger-driven "Shell" (Story E1-S1) = the spec's §5.4 pre-CRM bridge. **Re-platform it**, don't greenfield.

| File | Change |
| --- | --- |
| `src/components/CollectionsView/CollectionsView.tsx` | Swap the data spine `useOverdueAccounts` → `useCollectionsCases` (+ ledger aging enrichment for DPD/bucket/amount); add filters: rung, `hardship_paused`, `stopped_contact`, `awaiting-human` (exhausted); add columns: Rung, State, Flags; add a **sort** control (expected-net-recovery option present but disabled until BTB-194); change row-click target → the dedicated case view |
| `src/components/CollectionsView/styles.module.css` | Extend for new columns/badges |
| `src/payload.config.ts` | Change `views.collections.path` → `/collections-queue/:segments*` so the route hosts both queue and case view |
| *Keep unchanged* | `NavCollectionsLink` (overdue badge), `CollectionsViewWithTemplate`, CSV export, fallback banner, cursor pagination |

## WS4 — Dedicated per-case view + ServicingView surfacing

| File | Change |
| --- | --- |
| `src/components/CollectionsView/CollectionsCaseView.tsx` *(new)* | The dedicated case screen — three fixed panels: **operational** (rung ladder + state + lifecycle from the projection) · **accounting + economics** (accounting from `AccountingLedgerService`; economics/gate/cost-ledger/next-step-preview from `GetCaseEconomics`, graceful-degrade) · **contact + actions** (`GetContactLog` + cadence-cap; action buttons from WS5). Reuse ServicingView building blocks (`AccountPanel`, `ContactNotes`) where they fit |
| `src/components/CollectionsView/CollectionsViewWithTemplate.tsx` | Route by segment: no segment → queue; `/{accountId}` → `CollectionsCaseView` |
| `src/components/ServicingView/AttentionStrip.tsx` | Customer-level aggregate: if any of the customer's accounts is in a case / hardship / stop-contact, raise a strip entry with a link |
| `src/components/ServicingView/LoanAccountCard.tsx` (and/or `AccountPanel`) | Per-account collections badge (rung + state + flags) + "View collections case →" deep-link |
| data | `useCollectionsCasesByCustomer(customerId)` (WS2). **Customer-vs-account nuance:** case + hardship are per-account (show per account); suppression is per-customer (surface separately at customer level) |

## WS5 — Operator actions + `CollectionsService` gRPC client

| File | Change |
| --- | --- |
| `proto/collections_service.proto` | **Vendored ✓** (this change) |
| `src/server/collections-service-client.ts` *(new)* | gRPC client mirroring `notification-dispatcher-client.ts`; env `COLLECTIONS_SERVICE_GRPC_URL`; dynamic proto-loader; hand-maintained TS interfaces. Methods: `flagHardship`, `resumeFromHardship`, `applyStopContact`, `advanceToNextStep`, `getCaseEconomics`, `listCaseEconomics`, `getContactLog`. Every command sends `operator_id` + `idempotency_key` |
| `src/app/api/collections/actions/{flag-hardship,resume-hardship,stop-contact,advance}/route.ts` *(new)* | `requireAuth` (operator=`operations`; `advance`/escalation gated to `supervisor` via `hasApprovalAuthority`), generate idempotency key, call gRPC, return `CaseActionResponse` |
| `src/app/api/collections/cases/[accountId]/{economics,contact-log}/route.ts` *(new)* | `GetCaseEconomics` / `GetContactLog` reads |
| `src/hooks/mutations/{useFlagHardship,useResumeHardship,useApplyStopContact,useAdvanceToNextStep}.ts` *(new)* | Mirror `useWaiveFee` (optimistic stage, failed-actions queue, toasts, idempotency); barrel-export |
| Record payment / write-off-park | Reuse existing ledger repayment + `/api/commands/writeoff/*` paths — no new engine RPC |
| `.env.example`, fly config, `CLAUDE.md` | Add `COLLECTIONS_SERVICE_GRPC_URL` + a server-clients note |

> The economics RPCs (`getCaseEconomics`/`listCaseEconomics`) and `advanceToNextStep`'s gate are wired now but return `NOT_APPLICABLE`/empty until BTB-194. Build the client + UI to handle that state explicitly (panel shows "pending"; Advance enforces state preconditions only).

## WS6 — Cross-cutting

- **Roles** (`src/lib/access.ts`): operator = `operations` (`canService`); escalation (`advance` / authorise-send) = `supervisor` (`hasApprovalAuthority`). Confirm.
- **Tests**: Python `MockPool` (WS1); vitest for hooks/routes (WS2/WS5); reuse the testcontainers Postgres global setup; optional Playwright e2e for the queue→case→action flow.
- **Deploy / backfill**: dev/demo use `push:true`; prod needs the committed migration. The projection is **replay-rebuildable** — backfill `collection_cases` by replaying `collection.case.*`; run inside the fly machine (demo pg is laptop-unreachable).

---

## Suggested ticket breakdown (cut from the workstreams)

1. **WS1** — `CollectionsCase` projection + `collection.case.*` handlers (Python + Payload collection + indexes + migration). *Unblocked; start here.*
2. **WS2** — read-model API + query hooks.
3. **WS3** — re-platform the collections queue onto the projection (filters/columns/sort-shell).
4. **WS4** — dedicated case view + ServicingView surfacing.
5. **WS5** — `CollectionsService` gRPC client + operator-action routes/hooks (Phase-1 actions; economics graceful-degrade).
6. *(BTB-194, separate/engine)* — when it ships, light up the economics panel, net-recovery sort, and the `AdvanceToNextStep` gate. No CRM rework beyond removing the "pending" state.

## Out of scope

- Legal ladder (remedy notice / letter of demand / court / Form 21A / enforcement) — later Stream D.
- Cost-of-recovery engine internals / formulas — BTB-194 (engine).
- Inbound SMS/chat ingestion; credit-bureau integration.
