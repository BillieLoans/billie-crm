# UX Standards — Billie CRM

**Status:** Adopted · **Owner:** Rohan · **Last reviewed:** 2026-08-01

This is a **conformance document**. It states what any screen in Billie CRM must
satisfy before it ships. It is deliberately separate from
[`ux-design-specification.md`](./ux-design-specification.md), which is a *design brief* —
it describes what this product looks and feels like. Where the two disagree, this
document wins on conformance and the design spec wins on aesthetics.

Keywords: **MUST** = blocking, do not merge. **SHOULD** = default; deviations get a
one-line justification in the PR. **MAY** = discretionary.

---

## 0. Why this exists

Billie CRM is a mandated-use internal tool for staff who service consumer credit
accounts. That combination changes which UX standards apply:

- Staff cannot choose a competitor, so **engagement metrics are meaningless**. Do not
  optimise for them, and do not cite them as evidence of success.
- Operators are reading this UI aloud to customers on a call, so **copy is a compliance
  surface**, not decoration.
- Most actions move money or alter a regulated record, so **error prevention and
  reversibility outrank delight** in every trade-off.
- Accessibility here is an **employment** obligation (Disability Discrimination Act
  1992), not only a customer-facing one.

---

## 1. Accessibility — WCAG 2.2 Level AA

**This supersedes the WCAG 2.1 AA target in the design spec (§Accessibility Strategy).**

WCAG 2.2 adds nine success criteria, six at Level A/AA, and obsoletes 4.1.1 Parsing.
Four of the six land directly on patterns this app already commits to.

### 1.1 The 2.2 delta — required for every view

| SC | Level | Requirement | Where it bites in this codebase |
|---|---|---|---|
| **2.5.8** Target Size (Min) | AA | Interactive targets ≥ 24×24 CSS px, or spaced so a 24px circle centred on each target doesn't overlap another's | Dense-mode 32px table rows with inline actions; icon-only row buttons |
| **2.4.11** Focus Not Obscured | AA | The focused element must not be fully hidden by author content | Sticky table headers, the account context panel, slide-over edges |
| **3.3.7** Redundant Entry | A | Don't ask for the same information twice in one process | Write-off approval, period-close, disbursement wizards |
| **3.2.6** Consistent Help | A | Help mechanisms appear in the same relative order across pages | The `?` shortcut and any help affordance across custom views |
| **2.5.7** Dragging Movements | AA | Any drag operation needs a single-pointer alternative | Applies if/when drag reordering or drag-to-assign appears |
| **3.3.8** Accessible Auth (Min) | AA | No cognitive function test without an alternative | Payload login flow; re-auth on privileged actions |

### 1.2 Standing rules

- **1.4.1 Use of Colour** — status, severity, arrears, and movement direction MUST carry
  a non-colour cue (icon, text, or shape). Colour is never the sole channel.
- **1.4.3 Contrast** — 4.5:1 for body text, 3:1 for large text and for UI component and
  graphical boundaries. Conform to WCAG 2.2 for compliance, but small dense text
  SHOULD also be sanity-checked with **APCA**: WCAG 2.x's contrast maths is known to
  mis-rate exactly the small-text-on-mid-tone case a dense financial table produces.
- **1.4.13 Content on Hover or Focus** — anything revealed on hover MUST be dismissible,
  hoverable, and persistent.
- **2.1.1 / 2.1.2 Keyboard** — every action reachable, no focus traps. This is already a
  product requirement ("Sarah"), not only an accessibility one.
- **2.4.3 Focus Order** — closing a slide-over or modal MUST return focus to the element
  that opened it.
- **4.1.3 Status Messages** — optimistic UI transitions MUST be announced via
  `aria-live="polite"`. Errors that revert state use `role="alert"`.
- **prefers-reduced-motion** MUST be respected (this is best practice reinforcing
  2.3.3 at AAA; we treat it as mandatory regardless of level).

### 1.3 Component behaviour — ARIA APG is normative

For every custom interactive component, the
[W3C ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/) pattern
is the contract. Do not invent keyboard models.

| Our component | APG pattern |
|---|---|
| Cmd+K command palette (`cmdk`) | Combobox / Listbox |
| Transaction table with inline actions | Grid |
| Modals (writing data) | Dialog (Modal) |
| Slide-overs (reading data) | Dialog, non-modal — or Disclosure |
| Status badges with tooltips | Tooltip |
| Multi-step approval flows | Follow "one thing per page" (§3), not Tabs |

---

## 2. Resolved conflicts with the design spec

Two statements in `ux-design-specification.md` cannot both hold. These are the rulings.

### 2.1 Target size: 24px is the floor, 44px is touch-mode only

The spec promises "44px+ click targets" (§Platform Strategy) while specifying 32px dense
rows (§Spacing) — contradictory as written.

**Ruling:** **24×24 CSS px is the absolute minimum everywhere** (SC 2.5.8). Desktop dense
mode at 32px rows is permitted provided each inline control is ≥24×24 *or* satisfies the
24px spacing exception. The **44×44** figure applies **only** at the touch/tablet
breakpoint, where the spec already raises rows to 48px. Amend the spec's §Platform
Strategy wording accordingly.

### 2.2 Hover-revealed row actions must also appear on focus

The spec's `TransactionTable` (§Custom Components) reveals actions on hover. As written
this is a keyboard and touch dead-end.

**Ruling:** any action revealed on `:hover` MUST also be revealed on `:focus-within`, and
MUST remain operable without hover. The recommended implementation is
`:hover, :focus-within { opacity: 1 }` — never `onMouseOver` alone. Actions MUST NOT be
hidden from the accessibility tree while visually hidden; use opacity/visibility that
still permits focus, or render them always and adjust emphasis.

---

## 3. Interaction and pattern references

We do not adopt these component libraries. We adopt their **decisions**, so row height
and destructive-action confirmation are not re-litigated in every PR.

- **[IBM Carbon](https://carbondesignsystem.com/)** — primary reference for dense
  operational data: data tables, inline notifications, progressive disclosure. Chosen
  because it is built for exactly this density; Payload's table is built for CMS content.
- **[GOV.UK Design System](https://design-system.service.gov.uk/)** — the reference for
  error handling and high-stakes flows. Two patterns are mandatory here:
  - **Error summary + inline error.** Validation failures MUST surface a summary at the
    top of the form with in-page links to each field, in addition to the inline message.
  - **One thing per page.** Irreversible money-movement decisions (write-off, adjustment,
    disbursement) MUST NOT be crammed into a single modal. Use a stepped flow. This also
    satisfies the spec's own "never nest modals" rule.
- **GOV.UK content design** — adopted wholesale for microcopy. See §5.

**Nielsen's 10 heuristics** are adopted as a *review vocabulary only* — use them to
structure critique, never as a design method.

---

## 4. Domain conformance — the layer that is specific to us

Generic standards produce a competent enterprise app. These make the right action the
easy one. Each is a UI requirement, not a training issue.

- **Deadline-aware surfaces.** Hardship notices (National Credit Code) and complaints
  (ASIC RG 271) carry hard response clocks. Where an obligation has a deadline, the UI
  MUST render remaining time on the account and in the relevant queue. Deadlines MUST NOT
  live only in someone's calendar.
- **Contact-frequency guardrails.** The ACCC/ASIC debt collection guideline (RG 96) caps
  contact attempts. Collections views MUST show attempts-against-cap *before* the operator
  initiates contact.
- **Complaints are first-class.** A complaint MUST be capturable as a structured record
  with its own state and clock. It MUST NOT be recordable only as a free-text contact
  note — that makes IDR reporting guesswork.
- **PII progressive disclosure.** Full identifiers MUST NOT render by default. Reveal on
  explicit action, and write an audit entry on reveal. One pattern, three wins: cleaner
  visual hierarchy, Privacy Act APP 11 hygiene, reduced insider risk.
- **Vulnerability changes the flow.** A vulnerability or financial-abuse flag MUST alter
  the operator's available actions and prompts, not merely add a badge.

> ⚠️ **Verify before these become acceptance criteria.** The specific timeframes and
> contact caps above are cited from general knowledge, not from a current primary source.
> Compliance MUST confirm current values, and this section SHOULD carry the date of that
> confirmation once obtained.

---

## 5. Content standards

Words exist to make the interface easier to use. They are design material.

- **Name things as the operator recognises them**, never as the system is built. "Waive
  fee", not "post adjustment transaction".
- **Actions keep their name through the whole flow.** A button labelled "Post repayment"
  produces a toast that says "Repayment posted" — not "Success".
- **Errors state what happened and what to do next**, in the interface's voice. They do
  not apologise and they are never vague. "Ledger unavailable — the payment was not
  posted. Retry, or queue it from Failed Actions."
- **Empty states are an invitation to act**, not a mood.
- Sentence case, active voice, no filler. Australian English, AUD, en-AU dates — use the
  shared formatters in `src/lib/formatters.ts`, never ad-hoc formatting.

---

## 6. Measurement

Track these instead of engagement:

| Metric | Target | Source |
|---|---|---|
| Core loop: search → verify → payment | < 30s | Design spec §Defining Experience |
| Task success rate on core journeys | ≥ 95% | Moderated session, quarterly |
| Rework rate | Reversals + failed-action queue depth, trending down | Telemetry |
| Operator satisfaction | **UMUX-Lite** (2 items) quarterly | Survey |

UMUX-Lite is preferred over SUS: two items, comparable to SUS via published regression,
and short enough that busy staff actually complete it.

---

## 7. Review checklist

Paste into the PR description for any change touching UI.

```
### UX conformance
- [ ] Keyboard: every action reachable; focus returns to the invoking element on close
- [ ] Focus visible and not obscured by sticky headers/panels (2.4.11)
- [ ] Interactive targets >= 24x24 px, or meet the spacing exception (2.5.8)
- [ ] Hover-revealed controls also revealed on :focus-within (2.2 of this doc)
- [ ] Status/severity conveys meaning without relying on colour (1.4.1)
- [ ] Contrast: 4.5:1 text, 3:1 UI boundaries (1.4.3)
- [ ] Optimistic/async state announced via aria-live; errors via role="alert" (4.1.3)
- [ ] prefers-reduced-motion respected
- [ ] Custom widget follows its ARIA APG pattern
- [ ] Validation shows an error summary with in-page links, plus inline messages
- [ ] Irreversible money movement uses a stepped flow, not a single modal
- [ ] Copy: action name consistent across button -> confirmation -> toast
- [ ] PII not rendered by default; reveal is audited
- [ ] No new ad-hoc date/currency formatting (use src/lib/formatters.ts)
```

---

## 8. Enforcement

A standard that lives only in a markdown file decays in a quarter.

### 8.1 Current state (as at 2026-07-31)

- `eslint-plugin-jsx-a11y` is available transitively via `eslint-config-next`, but only
  **six ARIA-correctness rules** are enabled (`alt-text`, `aria-props`, `aria-proptypes`,
  `aria-unsupported-elements`, `role-has-required-aria-props`, `role-supports-aria-props`)
  and **all are `warn`**.
- CI (`.github/workflows/crm-ci.yml`) runs `pnpm lint` **without `--max-warnings 0`**.
- **Net effect: accessibility linting currently fails nothing.**
- No `@axe-core/playwright`. No PR template.

### 8.2 Measured baseline (dry run, 2026-07-31)

Reproduce with the 18-rule sweep in `docs/ux-standards-dryrun.md`. Result: **134
violations across 33 of 524 linted files.**

| Rule | Count | Triage |
|---|---|---|
| `click-events-have-key-events` | 41 | Mostly modal backdrop `onClick={onClose}` — low severity |
| `label-has-associated-control` | 40 | **Real.** Labels not bound to inputs; mechanical fix |
| `no-static-element-interactions` | 29 | Same backdrop pattern as above |
| `no-noninteractive-element-interactions` | 17 | Same backdrop pattern |
| `no-autofocus` | 7 | Intentional per design spec; convert to programmatic focus |
| `mouse-events-have-key-events` | **0** | — |

**Correction to an earlier assumption:** `mouse-events-have-key-events` catches nothing,
because the hover-reveal pattern in §2.2 is implemented in CSS, not JSX handlers. ESLint
cannot see it. §2.2 must be enforced by review and axe, not lint.

### 8.2a Remediation status (2026-07-31)

| Item | State |
|---|---|
| Tier 1 rules enforced as errors | ✅ done, backlog cleared (40 → 0) |
| Tier 2 rules at warn | ✅ done |
| Total jsx-a11y findings | 134 → **29** |
| Shared `<Modal>` primitive | ✅ `src/components/ui/Modal`, 17 unit tests |
| Dialogs migrated | ✅ 21 of 23 |
| `@axe-core/playwright` + spec | ⚠️ added, **not yet executed** — needs a running app + seeded DB |
| PR template | ✅ `.github/PULL_REQUEST_TEMPLATE.md` |
| `--max-warnings 0` in CI | ⬜ blocked on the 29 remaining warnings |

Two dialogs are deliberately **not** migrated:

- `MarketingView/Modal.tsx` — an independently-built primitive that already meets the
  §1.3 contract (dialog role on the panel, focus trap, focus restore, Escape via
  `useModalA11y`). Converging the two is worthwhile but is a refactor with visual risk
  across ~8 marketing dialogs, not an accessibility fix.
- `ServicingView/Communications/NotificationBodyModal.tsx` — already correct
  (`role="presentation"` on the backdrop, `role="dialog"` on the panel).

### 8.3 What lint cannot cover

The dry run confirmed three classes of defect are invisible to ESLint and need axe or
manual review:

1. **Missing or misplaced dialog semantics.** A full sweep found this was worse than the
   first count suggested — 23 dialogs across the app, of which **15 were defective**:
   - **6 had no `role="dialog"` at all**, all in `src/components/LoanAccountServicing/`:
     RecordPayment, ApplyLateFee, WriteOff, Adjustment, DisburseLoan, WaiveFee. The six
     highest-stakes money-movement surfaces in the app were the six announced to a screen
     reader as anonymous divs.
   - **9 put the role on the backdrop** rather than the panel, so the accessible name
     covered the whole viewport and the backdrop's dismiss handler sat on a dialog:
     CollectionsCaseView (×3), ClearBlockModal, CarryingAmountModal, AccrualHistoryModal,
     ShortcutsCheatsheet, FilterBar, ApprovalActionModal.
   - A further 4 (InvestigationView ×2, ExportCenterView, ECLConfigView recalc) had
     `role="dialog"` with **no accessible name at all**.

   All are now migrated to the shared primitive. Note the codebase already contained a
   correct implementation in `MarketingView/Modal.tsx` and a `useModalA11y` hook — the
   pattern existed, it just never reached the servicing modals. That is the argument for
   a single primitive rather than a documented convention.
2. **Hover-only tooltips** with no `:focus-within` pairing (SC 1.4.13). `LedgerStatus`
   pairs them correctly and is the reference implementation; `NavSystemStatus` and
   `ServicingView` do not.
3. **Focus trap and focus restoration** — no static rule exists for these.

There is no shared `<Modal>` primitive (only shared `ui/modal.module.css`), which is why
the markup has drifted. Remediation SHOULD introduce one rather than patching 19 files.

### 8.4 Required to close the gap

1. **Tier 1 — enable as errors now** (backlog is small and mechanical):
   `label-has-associated-control`, `interactive-supports-focus`, `tabindex-no-positive`,
   `no-noninteractive-tabindex`, `anchor-is-valid`, `aria-role`.
2. **Tier 2 — enable as warnings**, promote to error once the shared `<Modal>` lands:
   `click-events-have-key-events`, `no-static-element-interactions`,
   `no-noninteractive-element-interactions`, `no-autofocus`.
3. **Add `@axe-core/playwright`** and assert zero serious/critical violations per custom
   view in `tests/e2e/`. Playwright 1.61 and a `webServer` config are already in place.
4. **Add `.github/PULL_REQUEST_TEMPLATE.md`** containing §7.
5. Once Tier 2 is clean, tighten CI lint to `--max-warnings 0`.

These are follow-up work, not claimed as done.

---

## 9. Audit findings (2026-07-31)

Full sweep of `src/components` against §1–§5. The first three Fixed items landed in the
same change as the sweep; the `aria-live` item was the top open finding and was closed in
a follow-up branch — see the 2026-08-01 change-log row.

### Fixed

| Finding | Detail |
|---|---|
| **1.4.13** hover-only reveals | `NavSystemStatus` tooltip and `ServicingView.txBackButton` revealed content on `:hover` with no focus equivalent — unreachable by keyboard and touch. Both now pair `:focus-within` / `:focus-visible`. `LedgerStatus` was already correct and is the reference. |
| **§5** ad-hoc money formatting | **12** components had grown their own `formatCurrency`, bypassing `lib/formatters`. They disagreed: most rendered 2 dp, `ECLSummaryWidget` whole dollars, and nullish handling ranged from an em-dash to **`$NaN` reaching the UI**. `formatCurrency` now accepts `string \| number \| null \| undefined` with an explicit em-dash fallback and a `fractionDigits` option; all 12 duplicates deleted. |
| **1.3.1 / 4.1.2** form labels | 40 labels not associated with their control, incl. 12 in `FilterBar`. Date-range pairs announced as two anonymous "edit text" fields; they now carry per-input names inside a named `role="group"`, and toggle groups expose `aria-pressed`. |
| **4.1.3** `aria-live` / status messages | The original **"19 of 76 components"** figure counted explicit `aria-live` markup only and gave no credit to the toast layer — **sonner v2.0.7 renders `aria-live="polite"` on its container, so every toast was already announced.** That correction is part of this finding: the framing overstated the gap. The real gap was narrower: **8 mutation hooks** (`useAcknowledgeAnomaly`, `useCancelConfigChange`, `useFinalizePeriodClose`, `useRetryExport`, `useScheduleConfigChange`, `useBatchQuery`, `useRandomSample`, `usePeriodClosePreview`) that never toasted at all, plus optimistic stage transitions (`MutationStage`) that were tracked in the optimistic store but never spoken. Both are now closed. A single `LiveAnnouncer` (`src/components/ui/LiveAnnouncer`) mounts once, in `src/providers/index.tsx`, rendering two visually-hidden regions — `role="status"`/`aria-live="polite"` and `role="alert"`/`aria-live="assertive"` — each with its own sequence counter, so one lane's announcement never blanks or remounts the other. A Zustand store (`src/stores/announcer.ts`) exposes `announce()`; message text is pure-function composition in `src/lib/announcements.ts`; a subscriber on the optimistic store (`useOptimisticAnnouncements`) announces **settled stages only** — `confirmed`/`failed`, never `optimistic`/`submitted` — with a dedupe record that survives component unmount/remount. `PendingMutation` gained an optional `balanceAfter`, populated by `useWaiveFee` and `useRecordRepayment` and gated on `totalDelta !== 0`, so an unchanged balance is never announced as "updated". Seven of the eight now toast on both success and failure; `usePeriodClosePreview` is error-only by design — generating a preview is a read, not a commitment, and the wizard already advances visibly to a "Preview Summary" step on success, so a success toast there would be intermediate-step noise. **Not verified:** actual screen-reader output (NVDA/VoiceOver/JAWS) — the test suite proves DOM remount and store transitions, not what a screen reader speaks aloud; that check remains a manual step. |

### Open, in priority order

1. **Error summary pattern (§3) is implemented nowhere.** Validation errors are inline
   only. Required for every form under the GOV.UK pattern this standard adopts.
2. **Row-click keyboard access.** `TransactionList`, `RepaymentScheduleList` and
   `EnhancedScheduleList` put click handlers on non-interactive rows. These are the
   `click-events-have-key-events` warnings that are *not* backdrop noise — real keyboard
   dead-ends in the densest, most-used surfaces. Fix with the APG Grid pattern.
3. **Drawer backdrops.** `ApplyFeeDrawer`, `BulkWaiveFeeDrawer`, `WriteOffRequestDrawer`,
   `AddNoteDrawer`, `ContextDrawer` repeat the backdrop idiom the `<Modal>` primitive
   solved. A sibling `<Drawer>` primitive would close these out.
4. **`autoFocus` (7 sites, all `MarketingView`).** The design spec's "modal focuses first
   input" is right, but should be programmatic — `<Modal>` already does this, so these can
   simply be dropped once those dialogs adopt it.
5. **Stepped flows for irreversible money movement (§3)** are still single modals.
   `WriteOffModal` mitigates with a type-to-confirm field; the others do not.

## 10. Change log

| Date | Change |
|---|---|
| 2026-07-31 | Initial adoption. WCAG target raised 2.1 AA → 2.2 AA. Resolved target-size and hover-action conflicts in the design spec. |
| 2026-07-31 | Remediation: Tier 1 lint enforced (40 label fixes), shared `<Modal>` primitive added, 21 of 23 dialogs migrated, `formatCurrency` consolidated (12 duplicates, `$NaN` bug), 2 hover-only tooltips fixed, axe spec + PR template added. jsx-a11y findings 134 → 29. See §8.2a and §9. |
| 2026-08-01 | Closed §9's largest open finding (4.1.3): added `LiveAnnouncer` (two visually-hidden live regions), an announcer store, pure message composition, and a subscriber that announces settled optimistic mutations with `balanceAfter` support; gave toasts to the 8 previously-silent mutation hooks. Corrected the "19 of 76 components" framing — sonner already announced every toast; the real gap was the 8 hooks plus unannounced optimistic transitions. Screen-reader output not yet verified with a real AT. Moved from Open to Fixed in §9. |
