# BTB-221 — Serviceability panel: show the HEM-floored living expenses the engine actually decided on

**Ticket:** [BTB-221](https://billie-team.atlassian.net/browse/BTB-221) · Task · display-only · PR not direct-to-main
**Date:** 2026-07-09
**Type:** Bug fix (CRM display) — no engine change

## Problem

The CRM Serviceability Assessment panel renders tiles that do not reconcile to the
displayed net surplus. On the reference application `CA91F55B-716` the tiles showed
INCOME $666.50, LIVING EXPENSES $46.90, LOAN REPAYMENT $31.50, CASH SAVINGS $0.00,
NET SURPLUS −$98.05 — but `666.50 − 46.90 − 31.50 = +588.10`, not −98.05.

The decision was arithmetically correct. The serviceability engine (v2
`net_income_surplus` rule) floors living expenses at the household HEM value and
decides on the **floored** figure, but the CRM renders the applicant's **observed**
living expenses. An assessor (and the CRO) cannot reconstruct the decision from the
panel.

### Root cause (deeper than "observed vs floored")

The v2 evaluator
(`billieChat/backend/backend/src/utils/rules/serviceability/evaluator.py`,
`evaluate_net_income_surplus`) emits a **monthly** detail payload and computes:

```
monthly_living   = max(avg_observed_living, hem_monthly)     # the value the formula uses
hem_floor_binding = hem_monthly > avg_observed_living
surplus = (avg_monthly_income − monthly_living − avg_monthly_debt − monthly_billie)
          × loan_term_months + cash_savings
data_value = surplus                                          # what NET SURPLUS shows
```

The CRM's `ServiceabilityContent`
(`src/components/ConversationDetailView/AssessmentDetailView/index.tsx`, ~lines
651–800) renders the component tiles from the **legacy daily** fields
(`avg_daily_income × termDays`, `avg_daily_expenses × termDays`,
`avg_daily_loan_repayment × termDays`) while the NET SURPLUS tile shows the
**monthly-based** `data_value`. There are three distinct reconciliation breaks:

1. **Living uses observed, not floored** — `avg_daily_expenses` instead of `monthly_living`. (Headline bug.)
2. **`avg_daily_expenses` bundles existing debt** into "Living Expenses"; the engine keeps debt in a separate bucket (`avg_monthly_debt`).
3. **Daily-basis component tiles cannot reconcile** with a monthly-basis surplus by construction.

## What the event already carries

The fix is display-only. `rule_results[0].details` already contains everything needed
(evaluator lines 722–752):

| Need | Field | Basis |
|---|---|---|
| Income | `avg_monthly_income` | monthly |
| Living (floored, the value used) | `monthly_living` | monthly |
| Observed living | `avg_observed_living` | monthly |
| Monthly HEM floor | `hem_monthly` | monthly ($/mo) |
| Floor binding flag | `hem_floor_binding` | bool |
| Existing debt | `avg_monthly_debt` | monthly |
| Billie repayment | `monthly_billie` | monthly |
| Term scaling | `loan_term_months` | ratio |
| Cash savings | `cash_savings` | absolute |
| Net surplus (decision) | `data_value` (rule top-level) | over-term |

**The only thing NOT in the event is the HEM band label.** The engine hardcodes
`single_1_dep` for every applicant (band selection is deliberately unwired per
BTB-220) and writes it only to a log line, never to `details`. The CRM will render a
**constant** that mirrors the engine's fixed band (decision below).

## Required behaviour (from the ticket)

1. LIVING EXPENSES tile shows the figure the formula actually used (floored when the floor binds).
2. When the floor binds, show both numbers and say so: primary floored value + "HEM floor applied", secondary "observed: $X".
3. The HEM band and monthly HEM value must be visible on the panel.
4. **Reconciliation invariant:** displayed `income − living − repayment + savings = displayed net surplus`, to the cent, on every assessment.

## Design

Display-only change to the serviceability renderer. All work is in `src/`.

### 1. Re-base the cash-flow grid onto the v2 monthly fields

Detect the v2 payload and, when present, compute every component tile from the
monthly fields over the loan term using `ltm = loan_term_months` (fallback
`days_loan_term / 30`):

```
isV2            = details.monthly_living != null && details.hem_monthly != null
ltm             = details.loan_term_months ?? (details.days_loan_term / 30)
incomeOverTerm  = avg_monthly_income × ltm
livingOverTerm  = monthly_living   × ltm        # floored value the formula used
observedOverTerm= avg_observed_living × ltm
repaymentOverTerm = (avg_monthly_debt + monthly_billie) × ltm   # existing debt + Billie
cashSavings     = cash_savings
netSurplus      = data_value                     # engine decision figure, verbatim
```

Existing debt moves out of "Living Expenses" (where the legacy `avg_daily_expenses`
put it) and into "Loan Repayment", matching the engine's buckets.

**Reconciliation:** NET SURPLUS shows `data_value` verbatim. Because all components
now share the engine's monthly basis, `income − living − repayment + savings`
equals `data_value` up to independent 2-dp rounding of the three products
(worst case ~1¢). A unit test asserts the residual ≤ 1¢ on the reference fixture and
the general case.

### 2. Self-contained HEM-aware Living Expenses tile

The Living tile carries all HEM context internally. Fixed height across both states
(honours the fixed-layout convention — same rows, different content, never reflows by
data presence):

```
 FLOOR BINDING                             NOT BINDING (observed > floor)
┌─────────────────────────────┐          ┌─────────────────────────────┐
│ LIVING EXPENSES             │          │ LIVING EXPENSES             │
│ $733.05                     │  value   │ $912.40                     │
│ ⚑ HEM floor applied         │  chip    │ above HEM floor  (muted)    │
│ observed:      $46.90       │  line B  │ $30.41/day                  │
│ band: Single, 1 dependent   │  line C  │ band: Single, 1 dependent   │
│ HEM floor:  $2,199.00/mo    │  line D  │ HEM floor:  $733.40/mo      │
└─────────────────────────────┘          └─────────────────────────────┘
```

- **Value:** `livingOverTerm` (floored when binding, else observed — they are equal when not binding since `monthly_living = max(observed, hem)`).
- **Chip (line A):** binding → prominent "⚑ HEM floor applied"; not binding → muted "above HEM floor" (no alarm indicator, per acceptance).
- **Line B:** binding → `observed: $<observedOverTerm>`; not binding → `$<observed daily>/day` (neutral, matches other tiles).
- **Line C:** `band: Single, 1 dependent` (constant, both states).
- **Line D:** `HEM floor: $<hem_monthly>/mo` (both states; satisfies req #3 in both).

Net Surplus, Income, Loan Repayment, Cash Savings tiles keep their current visual
treatment; only their underlying values move to the monthly basis (Income/Repayment
values are unchanged in practice; Repayment gains any existing-debt component).

### 3. HEM band constant

The band is not in the event. Define one constant that mirrors the engine's fixed band:

```ts
// Mirrors the engine's hardcoded single_1_dep band (billieChat evaluator.py).
// TODO(BTB-2xx): read details.hem_band once the engine emits it in the payload,
// so this compliance label stops being hardcoded in the CRM.
const SERVICEABILITY_HEM_BAND = 'Single, 1 dependent'
```

### 4. Backward compatibility

When the v2 fields are absent (`isV2 === false`), fall through to the **existing daily
rendering unchanged**. Old assessments and the current test fixtures keep working; no
HEM tile lines appear for them.

## Files changed

- `src/components/ConversationDetailView/AssessmentDetailView/index.tsx`
  - Extend `SvcDetails` with v2 monthly fields: `avg_monthly_income?`, `avg_observed_living?`, `hem_monthly?`, `hem_floor_binding?`, `monthly_living?`, `avg_monthly_debt?`, `monthly_billie?`, `loan_term_months?` (all `number`, `hem_floor_binding` `boolean`).
  - v2 detection + monthly-basis derivation in `ServiceabilityContent`.
  - Self-contained HEM Living tile; `SERVICEABILITY_HEM_BAND` constant.
  - Legacy daily path preserved as fallback.
- `src/components/ConversationDetailView/AssessmentDetailView/styles.module.css`
  - Classes for the floor chip (binding vs muted), observed/band/floor lines; fixed Living-tile height.
- `tests/unit/ui/assessment-views.test.tsx`
  - New v2 fixture (`makeSvcAssessmentV2`) with HEM fields modelled on `CA91F55B-716`.

## Testing

Unit tests in `tests/unit/ui/assessment-views.test.tsx`:

1. **Floor binding (reference case):** floored primary value rendered; "HEM floor applied" chip present; `observed: $46.90` present; `band: Single, 1 dependent` present; `HEM floor: $…/mo` present.
2. **Reconciliation invariant:** parse the four component tile values + net surplus from the DOM; assert `|income − living − repayment + savings − netSurplus| ≤ 0.01`; assert net surplus equals `data_value`.
3. **Not binding (observed > floor):** observed figure shown as primary; **no** "HEM floor applied" chip; band + HEM-floor context still present.
4. **Legacy fallback:** existing daily-only fixture still renders Income/Living/Net Surplus with no HEM lines (existing tests stay green).

Run: `pnpm exec vitest run tests/unit/ui/assessment-views.test.tsx --config ./vitest.config.mts`

## Acceptance mapping

- `CA91F55B-716` re-render: tiles reconcile to −$98.05; floor indicator shown; observed $46.90 as secondary → tests 1 + 2.
- Observed exceeds HEM floor → observed figure, no floor indicator → test 3.
- Display-only; no engine calculation touched → no changes outside `src/` frontend + tests.

## Out of scope / follow-ups

- **Engine emits `hem_band`.** Recommend a follow-up (or fold into BTB-220) so the CRM reads the band from `details` instead of hardcoding a compliance label.
- BTB-220 (HEM table value fix) is independent; after it lands, a fresh assessment of `CA91F55B-716` shows the new floor and a positive surplus — this renderer reconciles either way.
