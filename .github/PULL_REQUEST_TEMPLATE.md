## What & why

<!-- One or two sentences. Link the ticket. -->

## How to verify

<!-- Commands run, or steps to reproduce. -->

---

### UX conformance

Delete this section if the change touches no UI. Otherwise tick or strike through
with a reason. Full standard: [`docs/ux-standards.md`](../docs/ux-standards.md).

- [ ] Keyboard: every action reachable; focus returns to the invoking element on close
- [ ] Focus visible and not obscured by sticky headers/panels (2.4.11)
- [ ] Interactive targets >= 24x24 px, or meet the spacing exception (2.5.8)
- [ ] Hover-revealed controls also revealed on `:focus-within` (ux-standards §2.2)
- [ ] Status/severity conveys meaning without relying on colour (1.4.1)
- [ ] Contrast: 4.5:1 text, 3:1 UI boundaries (1.4.3)
- [ ] Async/optimistic state announced via `aria-live`; errors via `role="alert"` (4.1.3)
- [ ] `prefers-reduced-motion` respected
- [ ] Custom widget follows its ARIA APG pattern
- [ ] New dialogs use `<Modal>` from `@/components/ui/Modal` — not hand-rolled markup
- [ ] Validation shows an error summary with in-page links, plus inline messages
- [ ] Irreversible money movement uses a stepped flow, not a single modal
- [ ] Copy: action name consistent across button -> confirmation -> toast
- [ ] PII not rendered by default; reveal is audited
- [ ] Currency/dates use `src/lib/formatters.ts` — no ad-hoc `Intl` calls
