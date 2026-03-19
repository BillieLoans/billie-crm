# Gap Analysis Review: System Ownership Assessment

**Date:** 19 March 2026
**Reviewed Document:** CRM Gap Analysis & Test Plan v4.0 (17 March 2026)
**Scope:** Correct attribution of remediations across billie-crm and billie-platform-services

---

## Context

The gap analysis document identifies 35 requirements across the CRM. The reviewer conducted thorough work understanding the CRM codebase, but treated the system as if it were a monolith responsible for everything from UI to GL journal entries. In reality, the architecture is:

- **billie-platform-services** ("headless core"): Python microservices owning the accounting ledger, customer lifecycle, account lifecycle, event sourcing, GL journal entries, transaction processing, and all domain rules for financial operations. Exposes a gRPC API on port 50051.
- **billie-crm** ("front end"): Next.js/Payload CMS application providing operator UI, CRM-originated workflows (write-offs, fee waivers), RBAC, compliance monitoring (safety net), and read projections of data from the platform services.

**Key principle:** Core accounting, ledger, and customer record management belongs in the platform services. Front-end validation, operator workflows, compliance monitoring UI, and RBAC belong in the CRM.

---

## Requirements That Are Already Satisfied (No Work Needed)

| REQ | Title | Assessment |
|-----|-------|------------|
| REQ-09 | Separate Carrying Amount & ECL | Already tested and working |
| REQ-12 | Interest Disabled for Exempt Loans | Structurally zero — no interest mechanism exists anywhere |
| REQ-18 | Partial Payment Handling | Working correctly via instalment allocation |
| REQ-23 | ECL Tracking | Already tested and working |
| REQ-24 | ECL Booking GL Entries | Already tested and working |
| REQ-28 | On-Demand Statements | Working correctly |

The reviewer correctly identified these as having no gap. No further action.

---

## Requirements Where The Reviewer Misattributed Ownership

These are the most important corrections. The gap analysis suggests changes in the CRM that should actually be made in the platform services, or suggests proto/gRPC changes without acknowledging they require platform-side implementation.

### REQ-03 / REQ-13: Cumulative Fee Tracking (5% Threshold)

**What the reviewer said:** Add `cumulative_fees_charged` field to `LedgerRecordResponse` proto and add a `GetCumulativeFees` helper to the ledger service.

**Correction:** This is entirely a **platform-services** change. The reviewer acknowledges the ledger is a "black box" but then prescribes proto field additions and new RPC methods as if they were CRM changes.

- **Platform services:** Add `cumulative_fees_charged` to the `LedgerRecordResponse` message (currently fields 1–16; this would be field 17). The platform's `AccountingLedgerService` already stores every transaction with its type — summing all `ESTABLISHMENT_FEE`, `LATE_FEE`, and `DISHONOUR_FEE` transactions is straightforward. The platform already has portfolio-level fee tracking in `GLReconciliationResponse` (`establishment_fee_income`, `late_fee_income`, `dishonour_fee_income`) — this just needs a per-account equivalent.
- **CRM:** Consume the new field. Display it. Use it in the perimeter check (REQ-02). The CRM does **not** need to compute this itself.

### REQ-08 / REQ-10 / REQ-15 / REQ-16: GL Journal Entries

**What the reviewer said:** "UNKNOWN — requires ledger verification" and "verify the ledger service creates double-entry journals."

**Correction:** The reviewer is correct that this can't be determined from the CRM. But the platform services **already implements dual-entry accounting** — every customer transaction creates a 1:1 linked `PortfolioEntry`/`PortfolioPosting` with proper debit/credit GL account mappings (PL-1001 through PL-5001). The `IntegrityCheck` in `GLReconciliationResponse` proves this with `principal_match` and `fee_match` fields that cross-validate customer totals against portfolio totals.

- **Platform services:** Already done. The dual-entry system exists. The reviewer's concern about "verify the ledger creates proper GL journals" is already satisfied. One improvement: expose journal entry details in `TransactionResponse` so the CRM can display them for audit purposes.
- **CRM:** No changes needed for GL correctness. Optional: display journal entries if the platform services exposes them.

### REQ-14: Fee Categorisation / GetFeeBreakdown RPC

**What the reviewer said:** Add a `GetFeeBreakdown` RPC with a `FeeBreakdown` message, and add a dishonour fee API route.

**Correction:**

- **Platform services:** The new `GetFeeBreakdown` RPC and `FeeBreakdown` proto message must be implemented here. The platform already tracks transactions by type — this is just a new aggregation query. Also, if `ApplyDishonourFee` is to become a dedicated RPC (rather than using the existing `DISHONOUR_FEE` transaction type via a more general mechanism), that's a platform-side addition.
- **CRM:** Add `POST /api/ledger/dishonour-fee` route (thin wrapper calling the platform gRPC). Add fee breakdown display in ServicingView. The proto definition in the CRM's `proto/` folder needs to be kept in sync.

### REQ-19 / REQ-20: Overpayment & Refund Processing

**What the reviewer said:** Add `OVERPAYMENT` and `REFUND` transaction types to the proto, add refund GL logic to the ledger service.

**Correction:** This is fundamentally a **platform-services** change:

- **Platform services:** New transaction types (`OVERPAYMENT`, `REFUND`), overpayment balance tracking, refund GL logic (debit overpayment account, credit cash/bank). The platform already tracks overpayments in the `RecordRepayment` response — but as the reviewer correctly notes, the amount is returned and then lost. Platform needs persistent tracking.
- **CRM:** Add `RefundRequests` collection (approval workflow, mirroring `WriteOffRequests`). Add `POST /api/commands/refund/*` routes. Display overpayment balance. The workflow/approval is CRM-owned; the accounting is platform-owned.

### REQ-25: Write-Off Proto Fields

**What the reviewer said:** Add `write_off_category`, `recovery_attempts_documented`, `recovery_notes`, `supervisor_override` to `WriteOffRequest` proto.

**Correction:** The `WriteOffRequest` proto message (currently just `loan_account_id`, `reason`, `approved_by`, `idempotency_key`) is implemented in the platform services.

- **Platform services:** Only add fields that the ledger actually needs for its domain logic. The ledger needs `reason` (already there) and arguably `write_off_category` for proper GL classification (e.g., different bad debt expense sub-accounts). `recovery_attempts_documented`, `recovery_notes`, and `supervisor_override` are **CRM workflow concerns** — the ledger doesn't care whether recovery was attempted; it just processes the write-off.
- **CRM:** Keep `recoveryAttemptsDocumented`, `recoveryNotes`, and approval workflow logic in the `WriteOffRequests` collection and approval route. These are front-end workflow validations. The CRM already has the `WriteOffRequests` collection with `reason`, `supportingDocuments[]`, `notes`, `requiresSeniorApproval` — this is the right place for workflow metadata.

### REQ-17: Configurable Allocation Sequence

**What the reviewer said:** Add `allocation_order` to `RecordRepaymentRequest`.

**Correction:** Payment allocation order is core accounting logic and is **already implemented** in the platform services as fee-first then principal. This is the correct allocation order for Billie's product.

- **Platform services:** Fee-first allocation already exists. If configurability is ever needed, it must be implemented here — allocation order is a core accounting domain rule. The proto change and implementation are platform-side.
- **CRM:** Would pass through the selected allocation order. No CRM changes needed for the current behaviour. P3 priority at most — fee-first is correct for the current product.

### REQ-29: History Integrity (Hash Chaining / Redis Retention)

**What the reviewer said:** Verify Redis stream retention, consider adding hash chaining.

**Correction:** The platform services **already implements hash chaining** on transactions (`prev_hash`/`previous_hash` references exist throughout the `AccountingLedgerService` codebase). The reviewer missed this because they only examined the CRM.

- **Platform services:** Hash chaining already exists. Redis stream retention (`MAXLEN`) configuration is in the platform's config files — needs verification that production config has appropriate retention.
- **CRM:** No changes needed.

---

## Requirements Correctly Attributed to the CRM

These the reviewer got right — these are CRM-side concerns.

### REQ-01: Product Configuration / Compliance Monitoring

The reviewer is correct that the CRM should:

- Store computed/derived fields on `LoanAccounts` for display: `feePercentage`, `maturityDate`, `complianceStatus`, `productType`
- Compute `complianceStatus` from data already available in ledger responses
- The event processor should compute these on `account.created.v1` events

**One correction:** `productType` could arguably be a platform concept (the platform knows what product a loan is). But since Billie currently has only one product type (s6(1) exempt), and the CRM is the safety-net monitor, storing it in the CRM projection is fine for now.

### REQ-02: Perimeter Breach Detection

Correctly CRM. The CRM is the safety net — it monitors for breaches. The perimeter checks in `POST /api/ledger/late-fee` and `POST /api/ledger/adjustment` are CRM-originated actions where the CRM is the control point.

**Nuance:** For upstream events (loans arriving from billieChat), the CRM event processor should check compliance on ingestion. For CRM-originated fees, the API routes should check before confirming. Both are CRM-side logic.

### REQ-04: Product Label UI

Purely CRM UI. Correct.

### REQ-07: Compliance Summary View

Purely CRM UI. Correct. The data comes from the ledger; the aggregation and display is CRM.

### REQ-21: Controlled Adjustments

RBAC, version conflict checks, separation of duties, threshold escalation — all CRM-side concerns for CRM-originated actions. Correct.

### REQ-22: Fee Waiver RBAC

Adding `hasApprovalAuthority` check to `POST /api/ledger/waive-fee`. Correct — this is CRM access control.

### REQ-30: RBAC for High-Risk Operations

Adding RBAC middleware to all ledger write routes. Correct and the most impactful security fix. The reviewer's route-by-role mapping is accurate:

| Route | Required Role |
|-------|--------------|
| `POST /api/ledger/repayment` | `canService` (operations+) |
| `POST /api/ledger/late-fee` | `canService` (operations+) |
| `POST /api/ledger/waive-fee` | `hasApprovalAuthority` (supervisor+) |
| `POST /api/ledger/adjustment` | `hasApprovalAuthority` (supervisor+) |
| `POST /api/commands/writeoff/request` | `canService` (operations+) |

### REQ-31: Approval Thresholds

Threshold enforcement for write-offs, waivers, and adjustments. Correct — these are CRM workflow rules.

### REQ-32: Audit Logging

Failed action logging, read audit logging, audit log UI. Correct — these are CRM-side operational concerns.

### REQ-35: Admin Perimeter Controls

`PerimeterConfig` collection, `ComplianceExceptions` collection, admin UI. Correct — the CRM is the safety net and admin interface.

---

## Requirements Needing Work in Both Systems

### REQ-05: Core Loan Master Data

- **Platform services:** Consider adding `term_days` directly to `LedgerRecordResponse` (currently only available via `AccruedYieldResponse` and `CarryingAmountBreakdownResponse`). This avoids the CRM needing to make multiple gRPC calls to get basic loan data.
- **CRM:** Store derived fields on `LoanAccounts` projection: `termDays`, `maturityDate`, `feePercentage`, `disbursementDate`. Update event processor to populate these from ledger data on account events.

### REQ-06: Repayment Schedule Versioning

- **Platform services:** No changes — the event log already retains all schedule versions.
- **CRM:** Add `scheduleHistory` array to `LoanAccounts`. Update event processor to archive current schedule before overwriting on `account.schedule.created.v1`. Add "Schedule History" tab to ServicingView. This is a CRM projection concern.

### REQ-10: Disbursement Date Tracking

- **Platform services:** Already provides `actual_disbursement_at` in `RecordDisbursementRequest` and `disbursement_date` in `AccruedYieldResponse`. No changes.
- **CRM:** Add `loanTerms.disbursementDate` to `LoanAccounts`, distinct from `openedDate`. Populate from the disbursement event.

### REQ-11: Disbursement Channel Recording

- **Proto (coordinated):** Consider adding an enum for `payment_method` (currently free-text string).
- **CRM:** Surface `disbursementMethod` and `bankReference` on `LoanAccounts`.

### REQ-26: Arrears Detection

- **Platform services:** Verify bucket transition thresholds are configurable and that ECL recalculation is triggered on bucket transitions. The `ScheduleAgingService` and event-driven ECL recalculation appear to handle this already.
- **CRM:** No changes needed if the platform handles automation correctly.

### REQ-27: Collections Workflow

- **Platform services:** No changes — arrears data is already exposed via gRPC.
- **CRM:** Add `CollectionsActions` collection for contact attempt tracking. Add `hardshipFlag` to `LoanAccounts`. Consider integrating with billieChat conversation data for contact history.

### REQ-33: Data Retention (7 Years)

- **Platform services:** Verify Redis stream configuration (no `MAXLEN` trimming, or sufficiently high limits). Configure data archival for streams. This is infrastructure-level.
- **CRM:** Add `retentionExpiresAt` computed field to `LoanAccounts`. Add `beforeDelete` hooks blocking deletion of approved `WriteOffRequests`. Document the retention policy.

### REQ-34: Reconciliation Tools

- **Platform services:** Already provides comprehensive reconciliation via `GLReconciliationResponse`, `IntegrityCheck`, `CarryingAmountBreakdownResponse`, and `GenerateRandomSample`.
- **CRM:** Add automated CRM-vs-ledger consistency check (compare `LoanAccounts.balances` against `GetBalance` for all active accounts). Add anomaly alerting.

---

## Revised Remediation Phases

The reviewer's phase ordering was reasonable but needs adjustment for system boundaries.

### Phase 1 — RBAC & Security (CRM only, highest impact-to-effort ratio)

This is the most impactful change and can be done entirely in the CRM with no platform dependency:

- **REQ-30:** Add RBAC middleware to all ledger write routes
- **REQ-22:** Add `hasApprovalAuthority` check to fee waiver route
- **REQ-21:** Add version conflict check, RBAC, and separation of duties to adjustment route
- **REQ-31:** Enforce write-off senior approval threshold; add waiver/adjustment thresholds

### Phase 2 — Compliance Monitoring Infrastructure (CRM + minor platform work)

- **REQ-01:** Add computed fields to `LoanAccounts` (`feePercentage`, `maturityDate`, `complianceStatus`, `productType`). Update event processor.
- **REQ-02:** Add perimeter checks to late-fee and adjustment routes (warn, don't block).
- **REQ-35:** Add `PerimeterConfig` and `ComplianceExceptions` collections.
- **Platform dependency:** Request `cumulative_fees_charged` field on `LedgerRecordResponse` (REQ-03) and optionally `term_days` on `LedgerRecordResponse`.

### Phase 3 — Compliance Monitoring UI (CRM only)

- **REQ-07:** Compliance Summary Dashboard view
- **REQ-04:** Compliance badge on ServicingView
- **REQ-03/13:** Fee cap warning UI in late-fee and adjustment workflows

### Phase 4 — Ledger Enhancements (Platform services)

These require platform-side development and proto coordination:

- **REQ-03:** Add `cumulative_fees_charged` to `LedgerRecordResponse`
- **REQ-14:** Add `GetFeeBreakdown` RPC or per-account fee categorisation
- **REQ-19/20:** Overpayment tracking and refund transaction types
- **REQ-25:** Add `write_off_category` to `WriteOffRequest` (only the GL-relevant field)
- **REQ-08/15:** Optionally expose journal entry details in `TransactionResponse` for audit visibility

### Phase 5 — CRM Projection Enhancements (CRM only)

- **REQ-05:** Store `termDays`, `maturityDate`, `disbursementDate` on `LoanAccounts`
- **REQ-06:** Schedule version history
- **REQ-10:** Separate disbursement date from opened date
- **REQ-27:** Collections workflow improvements
- **REQ-32:** Enhanced audit logging (failed actions, read auditing)

### Phase 6 — Infrastructure & Operational (Both systems)

- **REQ-33:** Data retention policy and configuration
- **REQ-34:** Automated reconciliation checks
- **REQ-29:** Verify Redis retention config in platform services

### Phase 7 — Low Priority / Future (Both systems)

- **REQ-11:** Disbursement channel enum
- **REQ-17:** Configurable allocation sequence (platform)
- **REQ-19/20:** Refund approval workflow (CRM) + refund GL logic (platform)

---

## Summary of Misattributions

| Area | Reviewer Said | Should Be |
|------|---------------|-----------|
| Cumulative fee tracking | CRM / proto change | **Platform services** computes and exposes |
| GL journal verification | "Unknown — verify ledger" | **Already implemented** in platform (dual-entry with integrity checks) |
| Hash chaining for integrity | "Consider adding" | **Already exists** in platform |
| New transaction types (OVERPAYMENT, REFUND) | Proto change (implied CRM) | **Platform services** implementation |
| Fee breakdown RPC | Proto change (implied CRM) | **Platform services** implementation |
| Write-off workflow metadata (recovery docs, supervisor override) | Proto fields on WriteOffRequest | **CRM collection fields** — ledger doesn't need workflow metadata |
| Allocation order configuration | Proto field | **Platform services** core logic |
| Redis stream retention | CRM concern | **Platform services** infrastructure |

---

## Conclusion

The gap analysis is thorough and the requirements are well-identified. The primary issue is that the reviewer treated the CRM as a monolith and attributed platform-services responsibilities to it. The core takeaway: **the CRM is a consumer of the platform's accounting capabilities, not the implementor.** RBAC, compliance monitoring, operator workflows, and UI are CRM concerns. Accounting logic, transaction types, GL entries, and financial calculations are platform concerns.

Phase 1 (RBAC) should be prioritised immediately as it addresses the most significant security gap with zero platform-side dependency.
