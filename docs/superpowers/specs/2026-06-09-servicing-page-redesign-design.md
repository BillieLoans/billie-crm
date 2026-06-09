# Customer Servicing Page — Layout Redesign

**Date:** 2026-06-09
**Status:** Approved design — ready for implementation planning
**Area:** `src/components/ServicingView/**` (Payload admin custom view `servicing`)
**Type:** Front-end layout / IA redesign. No data-model, ledger, API, or Python-processor changes.

---

## 1. Context & problem

The servicing page (`ServicingView`) is the staff work surface for a single customer who may hold multiple loan accounts. Today everything renders in a **single ~1200px centred column** (`styles.module.css` → `.container { max-width:1200px }`, `.content { flex-direction:column }`, `.accountsList { flex-direction:column }`), stacked in this order: customer header → loan-account list → selected-account detail → communications → applications.

Diagnosed problems (multi-account case especially):

1. **Inverted hierarchy** — the account *list* (navigation) takes the prime real estate; the selected-account work surface is demoted beneath it.
2. **Work surface below the fold** — with 3+ accounts you scroll past the whole list every time to reach balances/transactions/actions.
3. **Redundancy** — the in-panel "Other Accounts" switcher (`AccountSwitcher`) repeats the account list already at the top.
4. **Flat, equal-weight stacking** — communications/applications dumped at the bottom; nothing reflects what *needs attention* (arrears, pending disbursement, write-off pending, vulnerability).
5. **Low-density, oversized cards** — each account is a full-width band showing ~4 numbers.
6. **Wasted horizontal space + no triage** — single column on wide monitors; a paid-off account looks identical to a live, overdue one.

## 2. Goals & non-goals

**Goals**
- A persistent **master–detail cockpit** that keeps the customer, the selected account's work surface, and contact history all in view — no scrolling past navigation.
- Surface *what needs attention* immediately.
- Use the wide-desktop canvas (target ≥1440px); degrade cleanly when narrower.
- Serve a **mixed** workload (inbound contact, collections/arrears, investigation) equally well.

**Non-goals / explicitly preserved (do not change)**
- Data layer & read/write split: collections remain read-only projections; ledger writes still go through `src/app/api/ledger/*`; the Python event processor is untouched.
- **Action semantics & gating** (see §7) — relocated, not re-implemented.
- Optimistic updates (`useOptimisticStore`), version-conflict detection (`useVersionStore` / `updatedAt`), read-only mode (`useUIStore.readOnlyMode`), Live/Cached balance provenance + refresh, repayment↔transaction linking, recent-customer tracking (`useTrackCustomerView`), breadcrumb, copy buttons, loan-agreement API link (`/api/loan-agreement`), aging buckets + tooltips.
- No new backend endpoints or React Query hooks — all required data is already fetched.
- No Payload schema / `generate:types` / `generate:importmap` changes (no collections or registered views/components added; new components render *inside* the already-registered `ServicingView`).

## 3. Chosen approach — three-pane cockpit (Option B)

Selected over (A) plain two-pane and (C) overview-first, because the workload is mixed and screens are wide. The right context pane collapses to two-pane (Option A) when narrow, and the Overview tab carries Option C's at-a-glance value.

```
┌────────────────────────────────────────────────────────────────┐
│ Customer header  (name · IDs · contact · notifications · More)   │
│ Attention strip  (vulnerable · overdue · pending · write-off)    │
├──────────┬───────────────────────────────────┬──────────────────┤
│ Account  │ Summary bar (balance · next pmt ·  │ Context pane     │
│ rail     │  status · IDs · ACTIONS)           │ ┌Comms│Apps┐     │
│ (triaged)│ Tabs: Overview Transactions Fees   │ + Add note       │
│  ● over  │       Accruals ECL Actions         │ scope: acct/all  │
│  ⏳ pend  │ ───────────────────────────────    │ timeline …       │
│  ✓ track │ <tab content>                      │                  │
│ ─Closed─ │                                    │                  │
└──────────┴───────────────────────────────────┴──────────────────┘
   ~232px              flex (min 380px)               ~308px
```

- **Customer-level** regions: header, attention strip, context pane (communications, applications).
- **Account-level** regions: rail selection, summary bar, tabs + content.

## 4. Information architecture & layout

| Region | Width | Persistence |
|---|---|---|
| Customer header + attention strip | full | always (top) |
| Account rail | ~232px | always |
| Detail pane (summary + tabs) | flex, min 380px | always |
| Context pane (Comms/Apps) | ~308px | ≥1440; collapses below |

Container changes (`styles.module.css`): `.content` becomes a 3-column grid/flex (rail / detail / context) instead of a single column; the 1200px cap on `.container` is **removed for the servicing view** so the cockpit uses the viewport width — panes carry their own min-widths (rail 232 / detail 380 / context 308), with an optional outer max of ~1920px to keep ultra-wide monitors readable. `ServicingView.tsx`'s body is restructured from the current vertical stack (`LoanAccountsList` → `AccountPanel|prompt` → `CommunicationsPanel` → `ApplicationsPanel`) into the three-pane grid.

## 5. Component plan

**Create**
- `AttentionStrip.tsx` — customer-level chips derived from already-loaded data; each chip selects the relevant account (and tab/action). Replaces `VulnerableCustomerBanner`.
- `AccountRail.tsx` — extracted from the inline `LoanAccountsList` in `ServicingView.tsx`; renders triaged, grouped, compact rows.
- `lib/accountTriage.ts` — pure sort/group + overdue derivation (schedule-based). Unit-tested.
- `lib/getAccountActions.ts` — single source of truth for action availability (see §7). Consumed by the summary bar **and** `ActionsTab`. Unit-tested.
- `AccountPanel/AccountSummaryBar.tsx` — evolves `AccountHeader` into the sticky summary: account number + copy, muted copyable `loanAccountId`, status + aging badges, Live/Cached + refresh, **total outstanding / next payment**, and the **action buttons** (primary + "More" menu).
- `ContextPane.tsx` — right-hand pane wrapping `CommunicationsPanel` and `ApplicationsPanel` behind two tabs (Communications default / Applications), with the `This account / All` scope filter.

**Modify**
- `ServicingView.tsx` — restructure into the three-pane grid; keep all state/handlers; change multi-account default selection (§8); remove the `AccountSwitcher` wiring and the bottom-of-page stacking.
- `LoanAccountCard.tsx` — slim to a compact rail row (status dot, account number, one-line status/aging, balance, selected state). Reuse `getStatusConfig` from `account-status.ts`.
- `AccountPanel/OverviewTab.tsx` — reflow from vertical sections into a card grid (Balance + Repayment-progress row; full-width Repayment schedule; Loan-terms + Documents row). **Remove** the bottom "Loan Account ID" row (moved to summary bar). All fields and the Total-Paid fallback chain retained.
- `AccountPanel/ActionsTab.tsx` — render from `getAccountActions()` instead of hard-coded per-card conditions. Remains the full "action centre" (cards + descriptions + amounts).
- `Communications/CommunicationsPanel.tsx`, `ApplicationsPanel/index.tsx` — restyle to fit the narrower context pane; behaviour unchanged.
- The keyboard hint text (currently in `AccountSelectionPrompt`, "1–4") → corrected to "1–6".

**Remove**
- `AccountPanel/AccountSwitcher.tsx` — redundant with the rail.
- `VulnerableCustomerBanner.tsx` — superseded by the attention strip.

**Unchanged**
- `ServicingViewWithTemplate.tsx`, `AccountPanel/AccountTabs.tsx` (tab strip + shortcuts), `RepaymentScheduleList.tsx`, `TransactionsTab/FeesTab/AccrualsTab/ECLTab` and their hooks, all `*Drawer.tsx`, `account-status.ts`, all `src/hooks/queries/*`, all `src/stores/*`.

## 6. Data

No new fetches. Region → source:

- Header / rail / summary / overview ← `useCustomer(customerId)` (`loanAccounts[]`, `liveBalance`, `balances`, `repaymentSchedule`, `lastPayment`, `loanTerms`, `signedLoanAgreementUrl`, `accountNumber`, `loanAccountId`).
- Aging badge / authoritative DPD ← `useAccountAging` (header only; **not** fetched per rail row).
- Fees badge ← `useFeesCount`; write-off pending ← `usePendingWriteOff`.
- Tabs ← existing `useTransactions`, `useAccruedYield`, `useECLAllowance`, `useCarryingAmountBreakdown`.
- Context pane ← `useContactNotes`, `useNotifications`, `useCustomerConversations`.

## 7. Action model (single source of truth)

`getAccountActions(account, ctx)` returns, per action, `{ id, label, visible, enabled, primary, disabledReason }`. `ctx = { readOnly, hasPendingWriteOff, pending: { waive, repayment }, fees, status }`. Both `AccountSummaryBar` and `ActionsTab` consume it, so the relocated buttons cannot drift from the tab.

Gating — verbatim port of today's `ActionsTab.tsx` / `RecordRepaymentDrawer.tsx`, plus one deliberate tightening (★):

| Action | Visible when | Enabled when (preserved) | Change |
|---|---|---|---|
| Disburse loan | `status = pending_disbursement` | `!readOnly` | ★ becomes **primary** in that state |
| Record payment | always | `!readOnly && !pendingRepayment` | ★ also disabled while `pending_disbursement` |
| Waive fee | always | `!readOnly && !pendingWaive && fees > 0` | ★ + disabled while `pending_disbursement` |
| Apply late fee | always | `!readOnly` | ★ + disabled while `pending_disbursement` |
| Apply dishonour fee | always | `!readOnly` | ★ + disabled while `pending_disbursement` |
| Request write-off | handler provided | `!readOnly && !hasPendingWriteOff` (shows "Pending approval") | ★ + disabled while `pending_disbursement` |

★ **Behaviour change:** today Record Payment is *not* actually disabled for pending-disbursement accounts (only read-only / in-flight). The redesign disables all money actions until disbursement. Summary-bar layout per state: **pending →** `Disburse loan` primary, rest disabled with tooltip "Available after the loan is disbursed"; **live →** `Record payment` primary, `Waive fee`, `More ▾` (late fee · dishonour fee · write-off); **read-only →** 🔒 banner + all disabled.

## 8. Triage & selection rules

**Rail sort** (within an Active group): `overdue` (most days first) → `pending_disbursement` → `on-track active`; then a muted **Closed** group (`paid_off`, `written_off`, most-recent first). Overdue is **schedule-derived** from `repaymentSchedule` (same logic as `RepaymentScheduleList.isOverdue`) → no extra ledger calls on load. Authoritative DPD/bucket still shown in the summary bar via `useAccountAging`.

**Attention strip** chips (from already-loaded data; each click-throughs to the account/action): `⚠ Vulnerable customer` (`vulnerableFlag`, most prominent) · `● N overdue` · `⏳ N pending disbursement` · `📝 N write-off pending`. Empty ⇒ strip collapsed.

**Selection:** preserve single-account auto-select, `?accountId=` URL override, reset-to-Overview on select, rail "Selected" highlight. ★ For multiple accounts with no URL param, auto-select the **top-triaged** account (most overdue → pending → most-recent active) instead of the empty "Select an account" prompt.

## 9. Behaviours & states (preserved)

- **Keyboard:** `1–6` tabs, `↑/↓` switch accounts, `Esc` deselect/focus rail, `⌘K` palette.
- **Responsive:** ≥1440 three-pane; 1100–1440 context pane → on-demand toggle/overlay (two-pane); <1100 rail → top account-switcher, context → drawer (stacked).
- **Read-only:** `useUIStore.readOnlyMode` disables all actions via `getAccountActions()`; 🔒 banner retained; add-note respects read-only.
- **Live/Cached:** tag + "as of" timestamp + per-tab `handleRefresh` retained.
- **Loading/empty/error:** skeletons adapted to three-pane; `CustomerNotFound`; empty comms/applications states; "No loan accounts" rail state.
- **Optimistic / version conflict:** unaffected.

## 10. Overview tab (detail)

Card grid replacing the vertical stack: **Balance** (Principal, Fees, Total Outstanding highlighted, Total Paid; Live/Cached + "as of") and **Repayment progress** (paid x/y, frequency, progress bar, next/overdue payment, last payment) side-by-side; **Repayment schedule** full-width (`RepaymentScheduleList`, unchanged — rows still expand to "Linked Transactions (N)" chips that highlight + switch to the Transactions tab via `setHighlightedTransactionId` / `setTransactionNavigationSource` / `expandedPaymentNumber`); **Loan terms** and **Documents** (agreement link) in a demoted bottom row.

## 11. Identifiers

Three exist: Payload row `id` (not shown), `accountNumber` (human code, e.g. `I9NWJ8XVXKJ3`), `loanAccountId` (ledger UUID, e.g. `e09a63be-…`). Summary bar shows `accountNumber` bold + copy (as today) with `loanAccountId` muted/truncated/click-to-copy directly beneath. The Overview's bottom ID row is removed.

## 12. Styling

CSS Modules throughout (existing convention); reuse `account-status.ts` status labels/colour classes (the triage rank lives in `accountTriage.ts`, not in `account-status.ts`); Payload theme variables (`--theme-elevation-*`, `--theme-text`). No Tailwind/inline styles in shipped code (the brainstorm mocks were inline-only and are not the source of truth).

## 13. Testing

- **Unit (vitest):** `getAccountActions` (every row of the §7 table incl. pending-disbursement + read-only), `accountTriage` sort/group + overdue derivation.
- **Integration (`tests/int`):** ServicingView renders three panes; multi-account auto-selects top-triaged; attention-chip click selects the right account; action gating reflects status.
- **E2E (Playwright):** keyboard nav (`1–6`, `↑/↓`, `Esc`), responsive collapse at the two breakpoints, repayment-row → transaction navigation round-trip.

## 14. Behaviour changes (★) — review/QA checklist

1. Multi-account default now auto-selects the top-triaged account (was: empty prompt).
2. All money actions disabled until disbursement (was: Record Payment clickable pre-disbursement).
3. `VulnerableCustomerBanner` replaced by an attention-strip chip.
4. In-panel "Other Accounts" (`AccountSwitcher`) removed.
5. `loanAccountId` moved from Overview bottom to the summary bar.
6. Keyboard hint corrected "1–4" → "1–6".

Everything else is a faithful relocation of existing behaviour.

## 15. Risks & open questions

- **1440px tightness:** three panes at exactly 1440 are snug; min-widths + the 1100–1440 collapse mitigate. Validate on the narrowest target monitor.
- **Optional (deferred):** shorten long transaction-ID chips (full value on hover + copy). Default keeps today's exact rendering.
- **Selection persistence:** `selectedAccountId` stays local state in `ServicingView`; revisit only if cross-component needs emerge.

## 16. Out of scope (YAGNI)

New ledger actions (reschedule, send statement — left as the existing "coming soon" note), cross-customer views, mobile/touch layouts, and any change to event publishing or the Python processor.
