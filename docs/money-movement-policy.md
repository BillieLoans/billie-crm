# Money movement policy

How the CRM posts money to the ledger, and what actually protects against double-posting.

## Two flows

**1. Maker–checker command flow (evented) — write-offs only.**
A write-off is requested in the UI, stored as a `write-off-requests` row (`pending`), and later
approved by a *different* user via `POST /api/commands/writeoff/approve`. The approve route posts
to the ledger, writes a Redis "ledger posted" marker, then publishes `writeoff.approved.v1` to
`inbox:billie-servicing:internal`; the Python event processor flips the projection out of
`pending`. The route returns `202 Accepted` — the projection updates asynchronously.
Segregation of duties (requester ≠ approver) and approval authority (`admin`/`supervisor`) are
enforced server-side. There is no direct `/api/ledger/write-off` route.

**2. Direct ledger routes (synchronous).**
`POST /api/ledger/{repayment, waive-fee, adjustment, disburse, late-fee, dishonour-fee}` call the
AccountingLedgerService over gRPC and return the posted transaction inline. No maker–checker step;
authorisation is role-based at the route (`canService`, or `hasApprovalAuthority` for waive-fee and
adjustment). The ledger is the system of record; Postgres holds a read-only projection maintained
by the Python event processor.

## What prevents double-posting

The real integrity controls are:

1. **Client idempotency keys.** Every money route forwards a caller-supplied `idempotencyKey`
   (8–128 chars) to the ledger, which dedupes it for 24h. The key is minted once per *user intent*
   in the mutation hook, so every retry path — React Query retry, toast "Retry", failed-actions
   replay — re-POSTs the same key. Absent a key the route generates a per-request fallback.
   The write-off approve route uses a deterministic key (`writeoff-approve-${requestId}`) plus a
   Redis posted-marker so a failed event publish cannot cause a second post on retry.
2. **Ledger-side business rules.** The ledger enforces the actual money rules (NCC fee caps,
   already-disbursed, insufficient balance) and rejects with gRPC `FAILED_PRECONDITION` (9), which
   `handleApiError` surfaces as a non-retryable `422` carrying the ledger's own message.

## `checkVersion` is advisory only

`checkVersion` (`src/lib/utils/version-check.ts`) compares the client's `expectedVersion` against
`loan_accounts.updatedAt` in the projection. It is a **staleness hint for the operator, not a
concurrency control**:

- the projection is updated asynchronously by the event processor, so `updatedAt` can lag a
  just-posted ledger transaction — a "valid" version does not prove the account is current;
- it fails open (missing `expectedVersion`, missing account, or any error allows the request), and
  it can be disabled outright by `VERSION_CONFLICT_CHECK_ENABLED`;
- there is no transaction spanning the check and the gRPC post, so it cannot serialise two
  concurrent operators.

Its value is UX: it catches the "you're looking at a stale screen" case and prompts a refresh
before the operator commits money. Never treat a passing version check as a safety guarantee — the
guarantees come from the idempotency key and the ledger's own rules (audit P2-6).

## gRPC → HTTP status mapping

`handleApiError` (`src/lib/utils/api-error.ts`) maps ledger gRPC status codes centrally:

| gRPC code | HTTP | Error code | Retryable |
| --- | --- | --- | --- |
| 9 FAILED_PRECONDITION | 422 | `LEDGER_REJECTED` | no |
| 6 ALREADY_EXISTS | 409 | `DUPLICATE_OPERATION` | no |
| 5 NOT_FOUND | 404 | `ACCOUNT_NOT_FOUND` | no |
| 14 UNAVAILABLE | 503 | `LEDGER_UNAVAILABLE` | yes |
| anything else | 500 | `UNKNOWN_ERROR` | — |

`/api/ledger/disburse` keeps a bespoke `ALREADY_DISBURSED` 409 ahead of the generic mapping, and
`/api/commands/writeoff/approve` keeps its own `{ error: { code, message } }` envelope; both apply
the same 9 → 422 semantics.
