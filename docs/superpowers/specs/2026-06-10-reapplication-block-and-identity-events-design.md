# Re-application block + identity verification events — CRM design

**Date:** 2026-06-10
**Contract:** `crm-event-contract-2026-06-10.md` (billie-platform-services)
**Jira:** BTB-135 (block events), BTB-132/133/134 (eKYC fixes)

## Scope

Consume four events from the `inbox:billie-servicing` stream and surface them in the CRM:

| event | status upstream | CRM action |
|---|---|---|
| `application.reapplication_blocked.v1` | shipped (PR #66) | new handler → conversations + customers mirror |
| `final_credit_decision` (+`reason` variant) | shipped (PR #66) | extend existing handler |
| `identityRisk_assessment` (+`lab_verification`) | designed (PR #67) | payload already stored whole; add customer mirror |
| `identity_verification.report.archived.v1` | designed (PR #67) | new handler → conversations + customers mirror |

`identity_verification.report.archive_failed.v1` is ledger-only (not routed to CRM) — **deliberately out of scope**.

## Storage approach (chosen: A)

Extend existing read-only projections; mirror compact customer-level state onto `customers` so the
servicing view reads a single row. No new collections. (Rejected: dedicated collections —
nothing needs cross-customer block reporting yet; JSONB-only — poor queryability, customer view
would scan conversations.)

## Data model

### Conversations (all read-only projections)

- `decisionDetail` (group): `reason` (text, raw e.g. `REAPPLICATION_BLOCK:ID_VERIFICATION`),
  `retryEligible` (checkbox), `sourceApplicationNumber` (text), `blockedUntil` (date).
  All nullable — legacy payloads carry none of these.
- `reapplicationBlock` (group): `reason` (select: ACTIVE_LOAN · PRIOR_DEFAULT · PEP ·
  ID_VERIFICATION · SERVICEABILITY · ACCOUNT_CONDUCT · IDENTITY_CONFLICT), `messageVariant`,
  `stopMessage` (textarea), `sourceApplicationNumber`, `sourceAccountId`, `sourceDecidedAt` (date),
  `blockedUntil` (date, null = permanent or ongoing), `blockedAt` (date), `canonicalCustomerId`.
- `identityVerificationReport` (group): `labRequestId`, `providerReference`,
  `reportFileLocation`, `reportFileName`, `rawResponseFileLocation`, `rawResponseFileName`,
  `archivedAt` (date).
- `lab_verification` (event 3) needs no schema change — it arrives inside `assessments.identityRisk` JSON.

### Customers (read-only)

- `reapplicationBlock` (group): `reason`, `blockedUntil`, `blockedAt`, `applicationNumber`.
  Written against the **canonical** customer id (fallback journey id, one `merged_into` hop).
- `identityVerification` (group): `overallResult`, `provider`, `providerReference`,
  `labRequestId`, `checkedAt`, `reportArchived` (checkbox), `archivedAt`.
  Merged from events 3 + 4 in either arrival order.

Groups flatten to snake_case columns via the pg adapter; Python writes plain columns through
existing db.py helpers. Run `pnpm generate:types` after schema change.

## Event processor

- **`handle_final_decision`** — extend: pull optional `reason`, `retry_eligible`,
  `source_application_number`, `blocked_until` into `decision_detail_*` columns via
  `upsert_conversation`. Absent fields → null (backward compatible with legacy/mock payloads).
- **`handle_reapplication_blocked`** (new) — writes `reapplication_block_*` on `conversations`
  keyed by conversation id, then mirrors `{reason, blocked_until, blocked_at, application_number}`
  onto `customers` targeting `canonical_customer_id` (fallback `journey_customer_id`), resolving
  one `merged_into` hop.
- **`handle_identity_report_archived`** (new) — writes `identity_verification_report_*` on the
  conversation matching `application_number`; merges `{reportArchived: true, archivedAt, labRequestId,
  providerReference}` onto the customer row.
- **`identityRisk_assessment`** — after the existing JSONB store, when `lab_verification` is
  present mirror the summary (`overallResult`, `provider`, `providerReference`,
  `requestId`→`labRequestId`, `requestDateTime`→`checkedAt`) onto the customer row.
- All handlers registered in `main.py` `setup_handlers`. Writes are idempotent upserts/merges on
  natural keys (at-least-once safe). Payloads parsed defensively (may arrive as JSON string).

## Application details view — "why was this declined?"

A 3-state decision strip pinned at the top of the right AssessmentPanel, above the collapsible
sections — always rendered in the same fixed slot (no reflow by data presence):

```
 In progress:   ○ NO DECISION YET                          (neutral)
 Approved:      ✓ APPROVED                                 (green)
 Declined:      ✗ DECLINED · <headline>                    (red + detail rows)
```

Declined detail rows: block-declines (reason prefixed `REAPPLICATION_BLOCK:`) render the rich
rows from `reapplicationBlock` — humanized reason, blocked-until (`null` → "Permanent" for
PEP/PRIOR_DEFAULT/IDENTITY_CONFLICT, "While loan open" for ACTIVE_LOAN), source decline (link to
that application) or source account (link to servicing), and the stop message the customer saw.
Assessment-based declines show `reason` when present; legacy declines show the banner only.

## Customer view

Two additions to `CustomerProfile` (fixed positions), plus an `AttentionStrip` entry:

- **Block strip** (red), shown while the block is active (`blockedUntil` null or in the future):
  `⛔ Re-application blocked — ID verification · until 10 Dec 2026 · from A3CD3461-11F →`.
  Also added as an AttentionStrip item so it survives scrolling.
- **Identity verification section** — always-rendered rows (`—` when absent):
  Status (`overallResult` + provider), Checked (date/time), Reference (`providerReference`),
  Report (`View report ⤢` inline · `Raw JSON ⤓` download — each enabled only when archived).

## Report viewing API

```
GET /api/customer/[customerId]/identity-report?artifact=report|raw&disposition=inline|attachment
```

Follows the statements-file route pattern: Payload cookie auth + role check, rate limit, S3 URI
validation, streaming. Resolves the S3 location server-side from the latest conversation's
`identityVerificationReport` (S3 URIs never reach the browser). "View report" opens the inline
URL in a new tab (native browser PDF rendering); 404 when the artifact wasn't archived.

## Edge cases

- Legacy `final_credit_decision` payloads (no `reason`) and mock decisions — all new fields optional.
- Redelivery in any order — independent idempotent upserts.
- Merged identities — customer mirrors resolve `merged_into` one hop.
- Partial archive — `report` / `raw_response` each nullable; only existing artifacts get links.

## Testing

- Python: `mock_pool` handler tests — block variants (incl. permanent), decision with/without
  reason, partial archive, merged-customer mirror.
- Vitest: DecisionBanner 3 states; CustomerProfile identity section + block strip.
- API route: auth + 404-on-missing-artifact for the identity-report route.
