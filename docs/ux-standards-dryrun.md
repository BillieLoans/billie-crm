# Accessibility lint dry run — 2026-07-31

Baseline measurement taken before any `eslint.config.mjs` change. Nothing in CI was
modified. See [`ux-standards.md`](./ux-standards.md) §8 for the resulting plan.

## Reproduce

```bash
pnpm exec eslint src -f json -o /tmp/a11y-dryrun.json --rule '{
  "jsx-a11y/mouse-events-have-key-events":"error",
  "jsx-a11y/click-events-have-key-events":"error",
  "jsx-a11y/no-static-element-interactions":"error",
  "jsx-a11y/no-noninteractive-element-interactions":"error",
  "jsx-a11y/interactive-supports-focus":"error",
  "jsx-a11y/label-has-associated-control":"error",
  "jsx-a11y/no-autofocus":"error",
  "jsx-a11y/tabindex-no-positive":"error",
  "jsx-a11y/no-noninteractive-tabindex":"error",
  "jsx-a11y/anchor-is-valid":"error",
  "jsx-a11y/heading-has-content":"error",
  "jsx-a11y/no-redundant-roles":"error",
  "jsx-a11y/aria-activedescendant-has-tabindex":"error",
  "jsx-a11y/autocomplete-valid":"error",
  "jsx-a11y/img-redundant-alt":"error",
  "jsx-a11y/scope":"error",
  "jsx-a11y/aria-role":"error",
  "jsx-a11y/no-noninteractive-element-to-interactive-role":"error"
}'
```

`--rule` injects into the flat config; the plugin resolves transitively through
`eslint-config-next`, so no dependency install is needed to reproduce this.

## Result

**134 violations · 33 of 524 files.** 12 of the 18 rules found nothing.

## Top files

| Count | File |
|---|---|
| 16 | `src/components/AccountsBrowserView/FilterBar.tsx` |
| 9 | `src/components/CollectionsView/CollectionsCaseView.tsx` |
| 9 | `src/components/LoanAccountServicing/AdjustmentModal.tsx` |
| 9 | `src/components/LoanAccountServicing/DisburseLoanModal.tsx` |
| 7 | `src/components/ECLConfigView/ECLConfigView.tsx` |
| 7 | `src/components/LoanAccountServicing/ApplyLateFeeModal.tsx` |
| 7 | `src/components/LoanAccountServicing/RecordPaymentModal.tsx` |
| 7 | `src/components/LoanAccountServicing/WaiveFeeModal.tsx` |
| 7 | `src/components/LoanAccountServicing/WriteOffModal.tsx` |
| 5 | `src/components/InvestigationView/InvestigationView.tsx` |

## Triage notes

The count is a poor severity signal. Reading the flagged code:

- The `click-events-have-key-events` / `no-static-element-interactions` pairs are almost
  all this idiom, which appears in ~19 modals:
  ```tsx
  <div className={styles.modalOverlay} onClick={onClose}>
    <div className={styles.modal} onClick={e => e.stopPropagation()}>
  ```
  Backdrop-click-to-close is a mouse convenience. Provided `Esc` closes the modal (the
  design spec requires it), these are not keyboard dead-ends. Fix by marking the backdrop
  `role="presentation"` inside a shared `<Modal>`, not by adding key handlers to divs.

- `label-has-associated-control` is the opposite: fewer files, genuinely broken. Clicking
  the label does not focus the control and the field name is not announced. `FilterBar`
  alone has 12.

- The most serious finding is not in this table at all — see `ux-standards.md` §8.3.
  Six money-movement modals lack `role="dialog"` entirely, which ESLint cannot detect
  because there is no element for it to flag.
