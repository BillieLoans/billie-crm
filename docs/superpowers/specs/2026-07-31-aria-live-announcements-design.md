# Announcing async and optimistic state to screen readers

**Date:** 2026-07-31 · **Status:** Approved · **Author:** Rohan (with Claude)

Closes the largest open item in [`docs/ux-standards.md`](../../ux-standards.md) §9:
async and optimistic state changes are not announced, leaving the design spec's
"Truth Scale" silent to screen-reader users.

## Problem

The design spec requires that an optimistic balance change be announced — "Balance
updated to zero" — so that a non-sighted operator knows an action landed. That does
not happen today.

An earlier count claimed "only 19 of 76 components announce async state". That
number is misleading: it counted explicit `aria-live` markup and gave no credit to
the toast layer. **sonner v2.0.7 renders `aria-live="polite"` with
`aria-relevant="additions text"` on its container, so every toast is already
announced.** The real gap is narrower:

| Surface | State |
|---|---|
| 20 of 33 mutation hooks | Toast → already announced |
| 12 mutation hooks with no toast | **Silent** |
| Optimistic stage transitions | **Silent** — `MutationStage` is tracked but never announced |
| Read / loading transitions | Silent (out of scope, see below) |

The silent hooks are the sharper risk: `useFlagHardship`, `useApplyStopContact`,
`useResumeHardship` and `useAdvanceToNextStep` are **collections actions** carrying
regulatory weight, where an operator needs certainty the action registered.

A toast and a data announcement are different information. A toast reports the
**event** ("Payment posted"); the spec asks for the **data consequence** ("Balance
updated to $0.00"). Both are useful; on failure the second is essential, because a
silent rollback is otherwise invisible.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Silent hooks + Truth Scale | Closes the regulated-action gap and delivers the spec's requirement. Reads excluded. |
| Which stages announce | **Settled only** (`confirmed`, `failed`) | One clear outcome per action. Announcing all four stages triples verbosity for a single click. |
| Toast vs announcer | **Both**, data only when it changed | Toast = event, announcer = data consequence. Complementary, not duplicate. |
| Failure urgency | **Assertive** | A silent rollback is the case that actually harms an operator. |

## Architecture

Three units, each independently testable, plus a one-line change per silent hook.

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/lib/announcements.ts` | Pure: `PendingMutation` → sentence. No React, no DOM. | `@/types/mutation` |
| `src/components/ui/LiveAnnouncer/` | Two visually-hidden regions (`role="status"` polite, `role="alert"` assertive) + Zustand store exposing `announce(text, urgency)`. Mounted **once**. | zustand |
| `useOptimisticAnnouncements` | Subscribes to `useOptimisticStore`, detects transitions **into** settled stages, composes and announces. | both of the above |

`LiveAnnouncer` mounts in `src/providers/index.tsx` alongside `<Toaster>`.

### Data flow

```
mutation hook → optimisticStore.setStage('confirmed' | 'failed')
              → subscriber diffs prev vs next stage   (ignores optimistic/submitted)
              → announcements.ts composes sentence
              → announcerStore.announce(text, urgency)
              → LiveAnnouncer region → screen reader
```

### Extending `PendingMutation`

`PendingMutation` carries `{id, accountId, action, stage, amount?, createdAt, error?}`
— no balance, so "Balance updated to $0.00" is not currently derivable.

Add an optional field:

```ts
/**
 * The account balance once this mutation settled — after confirmation, or after
 * rollback on failure. Set by the caller ONLY when the mutation actually changed
 * the balance; leaving it undefined is how a caller says "nothing to report".
 */
balanceAfter?: number
```

populated by the ledger hooks that already receive it in their response. Composition
then degrades gracefully:

- present → `"Waive fee confirmed. Balance updated to $0.00."`
- absent → `"Waive fee confirmed. $25.00."`

This is what makes "data only when it changed" real, and it deliberately puts that
judgement in the hook rather than the announcer. The announcer has no access to the
prior balance and must not try to infer one — it appends the clause whenever
`balanceAfter` is present, full stop. A hook that sets it for an unchanged balance is
the bug, and that is a rule a hook-level test can enforce.

## Error handling

- `announce()` is fire-and-forget and MUST NOT throw into the React tree.
- An unrecognised `action` falls back to `"Action confirmed"` / `"Action failed"`
  rather than announcing nothing.
- Identical consecutive messages need a sequence counter. Screen readers do not
  re-read an unchanged live region, so a second identical failure would otherwise be
  silent — the exact case where silence is most dangerous.
- Failures announce the error text when present: `"Payment failed: ledger
  unavailable. Balance restored to $150.00."`

## Testing

TDD throughout, mirroring the approach used for the Modal primitive.

1. **Pure** (`announcements.ts`): action / amount / error / `balanceAfter` → exact
   sentence, including the unknown-action fallback and the balance-unchanged case.
2. **Component** (`LiveAnnouncer`): text lands in the correct region by urgency;
   repeated identical messages still announce.
3. **Subscriber**: fires on `confirmed` and `failed`; silent on `optimistic` and
   `submitted`; never announces the same mutation id twice.
4. **Hooks**: the 12 silent hooks surface success and failure toasts.
5. **axe**: the existing `tests/e2e/accessibility.e2e.spec.ts` covers the new markup.

## Out of scope

Read and loading announcements ("13 accounts loaded") — chatty live regions get
switched off, and reads were explicitly excluded. The 20 hooks that already toast.
Overriding sonner's live region. Per-component `aria-live` on data elements: that
would touch ~57 components and fire on every unrelated refetch.

## Rejected alternatives

**Per-component `aria-live` on the data.** The literal reading of the design spec,
and it announces the real value with no mapping layer. Rejected: ~57 components, and
regions attached to re-rendering data fire on every change including unrelated
refetches, making verbosity nearly impossible to control.

**Announce from each mutation hook.** Message authored next to the action. Rejected:
33 hooks, largely duplicates what toasts already say, and misses transitions that
happen outside hooks — notably rollbacks, the announcements that matter most.
