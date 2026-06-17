# Disbursement Cut-off Triage — Design

**Ticket:** BTB-158 — *Pending disbursements queue, time based*
**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan

## Problem

Ops staff must disburse each loan **on its scheduled start date**, before the daily **3:00pm AEST cut-off**. The disbursement date *is* the loan start date, which drives the repayment schedule and keeps the loan within the 62-day maximum term. Disburse on the wrong day and the schedule is thrown out.

Today the CRM gives staff no way to see this. The dashboard shows a single **"Disbursements Awaiting"** tile (a flat count + total + "oldest X ago"), and `/admin/pending-disbursements` is a flat table sorted by `createdAt`. Neither expresses *which loans must go out today before 3pm*, *which have already missed their window*, or *which belong to a future day*.

From the reporter (Marcus Korff):
> I need to clearly distinguish between loans which must be disbursed before the daily 3pm cut-off and those due to roll over to tomorrow. "Disburse today" loans are (a) signed yesterday after 3pm and (b) signed today before 3pm.

## Key insight — consume, don't re-derive

billieChat already computes the authoritative loan start date and emits it. We must **not** re-implement the cut-off logic in the CRM — two systems would inevitably drift on something that breaks loan schedules.

In `billieChat/backend/backend/src/agents/contractAgent/repaymentScheduleCalculator.py`:

- `calculate_commencement_date()` — loan start date = **today if before 15:00 `Australia/Sydney` on a business day, else the next business day**.
- Public holidays: national (Nager.Date API → Redis cache → hardcoded fallback). Weekends + holidays roll forward.
- Emitted on the **`loan_execution_plan_created`** event (Redis stream `chatLedger`), with:
  - **`commencement_date`** — the loan start date (= the date it must be disbursed). *This is our bucket key.*
  - **`offer_valid_until`** — full UTC datetime = **15:00 AEST on the commencement date**. *The precise "must disburse by" deadline.*

The CRM's job is to read `commencement_date` and bucket by it. This maps exactly onto the ticket's (a)/(b) cases — a loan signed yesterday-after-3pm already has `commencement_date = today`; one signed today-before-3pm also has `commencement_date = today`; one signed today-after-3pm has `commencement_date = tomorrow`.

## Domain model — three time-based buckets

For each loan in `accountStatus = pending_disbursement`, compare its `commencementDate` (as an `Australia/Sydney` calendar date) to *today* in the same zone:

| Bucket | Condition | Meaning | Colour |
|---|---|---|---|
| **Overdue / at-risk** | `commencementDate < today` | Window missed — schedule already broken. Disburse immediately. | Red |
| **Disburse today** | `commencementDate == today` | The live working queue. Must complete before 15:00 AEST. | Amber |
| **Scheduled** | `commencementDate > today` | Future start date — not yet actionable. | Blue |

The **cut-off deadline** for the "today" bucket is 15:00 `Australia/Sydney` on the current date (equivalently `offer_valid_until` when ingested). After 15:00, any loan still in "today" has missed its window and is surfaced as critical (it becomes overdue on the next day's recompute).

## Data dependency (build prerequisite)

`commencement_date` is **not in the CRM today.** Confirmed: the event processor reads only `inbox:billie-servicing` + `…:internal` (not `chatLedger`), and no CRM code references `commencement`, `execution_plan`, or `offer_valid_until`.

Resolve in this order (this decides build effort — do it **first**):

1. **Verify `account.created.v1.opened_date`.** `loanTerms.openedDate` is stored as `timestamp(3) with time zone` (the SDK sends a full `datetime`; the admin only *displays* it day-only). If the accounts service sets `opened_date` to the **commencement date**, we already have the bucket key — derive the deadline as 15:00 AEST on that date. *Verification:* read a recent batch of pending/active accounts and check whether `opened_date` lands on business days, never after 3pm for same-day loans, and tracks the schedule. (Read-only query.)
2. **If `opened_date` is not the commencement date:** add a `commencementDate` field to `loan-accounts` (+ migration) and populate it by **ingesting `loan_execution_plan_created`** — requires the event routed onto the CRM inbox and a new handler in the event processor (use the shared `upsert`/`update_by_key` helpers). Optionally also store `disburseBy` from `offer_valid_until`.

**The UI/API are built against a typed `commencementDate` field regardless of source**, so frontend work is not blocked by this decision.

## UX design

### 1. Dashboard panel — "Cut-off band" (Direction A)

A full-width band promoted to the **top of the dashboard** (above the existing hero tiles), since it is launch-critical and time-sensitive. Replaces the current single `DisbursementsHeroTile`.

- **Countdown strip** (top): "Disbursements" label + a live chip — *"Today's 3:00pm cut-off in **2h 14m**"* (tabular-nums, updates each minute).
- **Three buckets in a row** below, fixed positions, reading left→right:
  - **Overdue** (narrow, red): count + `$` total + "schedule at risk".
  - **Disburse today** (wide, amber, the working column): **remaining** count (not total) + `$` total + a quiet "*3 of 11 done*" with a progress bar.
  - **Scheduled** (blue): count + "tomorrow N · later M".
- Clicking any bucket deep-links to that section of the queue page.

**States (fixed layout — always render all three slots, never reflow by data presence):**
- Overdue = 0 → "0 ✓" calm state (still occupies its slot).
- Today all done → "All disbursed ✓".
- **After 15:00** with loans still in "today" → countdown chip flips **red**: *"Cut-off passed — N still pending!"*.
- Loading → skeleton; error → inline error card (match existing dashboard patterns).

### 2. Queue page — `/admin/pending-disbursements` (work surface)

Rebuilt from a flat table into the three buckets as sections. Header keeps the same countdown chip + a total summary ("24 loans awaiting · $9,630") + Refresh.

Shared columns (fixed): **Account · Customer · Loan amount · [date/deadline] · Actions**. (No "Outstanding" column — pre-disbursement it always equals the loan amount.)

- **Overdue section** (red, expanded): date column shows *"Should have disbursed — Mon 15 Jun · 2 days late"*; primary red **"Disburse now"** + View.
- **Disburse today section** (amber, expanded): date column shows *"Must disburse by 3:00pm"*; amber **"Disburse"** + View. Already-disbursed rows **remain, greyed with ✓** ("disbursed 11:02am") so progress is visible through the day.
- **Scheduled section** (blue, **collapsed by default**): grouped by `commencementDate` (Tomorrow, then dates). Date column shows *"Disburses on Mon 22 Jun"*. Action is a de-emphasized outlined **"⚠ Disburse early"** (see guard) + View.

Disburse actions reuse the existing `DisburseLoanDrawer`.

### 3. Early-disbursement guard

Scheduled loans **can** be disbursed early, but never silently. "⚠ Disburse early" opens a confirmation **before** the normal disburse drawer:

- Title: *"Disburse before the scheduled start date?"*
- Body: identifies the loan; states *"scheduled to start **Mon 22 Jun**; disbursing today sets the start date to **today, Wed 17 Jun** and recalculates the repayment schedule."*
- A before→after pair (Scheduled start → New start) and a red callout: *"May push the loan beyond the 62-day maximum term."*
- Actions: **Cancel** (default) and destructive **"Disburse today anyway"**. On confirm, proceed to the normal disburse drawer.

(The "today" and "overdue" buckets go straight to the disburse drawer — no extra confirmation.)

## Component & API changes (CRM)

**Shared util**
- `src/lib/disbursement-cutoff.ts` (new) — `Australia/Sydney` helpers: today's date, the 15:00 cut-off instant, and `classifyBucket(commencementDate, now)` → `'overdue' | 'today' | 'scheduled'`. Reuse the timezone approach already in `src/app/api/dashboard/route.ts` (`australianDayBoundaries` / `sydneyOffsetMinutes`) — extract and share rather than duplicate.

**Schemas** — `src/lib/schemas/dashboard.ts`
- Extend `PendingDisbursementSchema` with `commencementDate: string` (ISO date) and `bucket` enum.
- Add a `disbursementBuckets` summary to `DashboardResponseSchema`: per-bucket `{ count, totalAmount, totalAmountFormatted }` + `todayDoneCount`/`todayTotalCount` for the progress indicator.

**Dashboard API** — `src/app/api/dashboard/route.ts`
- Classify pending loans into buckets; return per-bucket counts + `$` subtotals + today's done/total. (Disbursed-today count = `loan_terms_disbursed_date` within today's AEST boundaries — the `fetchMoneyFlowsToday` query already does this.)

**Queue API** — `src/app/api/pending-disbursements/route.ts`
- Return `commencementDate` + `bucket` per item; accept an optional `?bucket=` filter for dashboard deep-links.

**Dashboard UI** — `src/components/DashboardView/`
- New `DisbursementTriagePanel.tsx` (Direction A band) + `CutoffCountdown.tsx` (shared live countdown). Render the panel at the top of `index.tsx`; retire `DisbursementsHeroTile.tsx`.

**Queue UI** — `src/components/PendingDisbursementsView/`
- Rebuild `PendingDisbursementsView.tsx` into three `DisbursementSection`s (collapsible) + `EarlyDisburseWarningModal.tsx`. Reuse `DisburseLoanDrawer`.

**Data layer** (only if prerequisite step 2 is needed)
- Add `commencementDate` (+ optional `disburseBy`) to `src/collections/LoanAccounts.ts` + migration; new event-processor handler for `loan_execution_plan_created` using shared `db.py` helpers.

## Testing

- **Unit (`classifyBucket`)**: boundary cases — commencement = yesterday/today/tomorrow; "now" just before vs just after 15:00 AEST; across an AEST/AEDT transition; weekend/holiday-derived dates (values come from billieChat, but the CRM must classify them correctly).
- **API**: dashboard returns correct per-bucket counts/totals and today done/total; queue `?bucket=` filter.
- **Component**: panel zero-states and after-cutoff red state (fixed layout); queue section grouping; Scheduled collapsed by default; early-disburse modal gates the drawer.
- Follow existing vitest + Testcontainers setup.

## Out of scope (YAGNI)

- Re-implementing the holiday calendar or 3pm logic in the CRM (consume billieChat's output).
- Bulk "disburse all today" actions.
- Notifications/alerts when the cut-off nears (possible follow-up).
- Changing the disburse drawer / ledger gRPC flow itself.

## Open questions / risks

- **Primary risk:** the data prerequisite. Until step 1 is verified, the exact ingestion path (and whether a migration + new handler is needed) is unconfirmed. UI/API are insulated from this via the typed `commencementDate` field.
- `offer_valid_until = min(session_expiry, 3pm_cutoff)` in billieChat — it can be *earlier* than 3pm. For a **signed** loan in `pending_disbursement` the relevant deadline is 15:00 AEST on `commencementDate`; the CRM should derive the deadline from `commencementDate` (15:00 AEST) rather than depend on `offer_valid_until`, which is offer-stage state.
