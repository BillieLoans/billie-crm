# Live Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Announce settled mutation outcomes and their data consequences to screen readers, closing `docs/ux-standards.md` §9.

**Architecture:** A single `LiveAnnouncer` mounts once in the providers tree and renders two visually-hidden live regions (polite + assertive). A Zustand store exposes `announce(text, urgency)`. A subscriber on the existing optimistic store detects transitions into `confirmed`/`failed` and composes a sentence via pure functions. Separately, eight mutation hooks that never toast get one.

**Tech Stack:** React 19, TypeScript, Zustand, sonner, vitest + @testing-library/react.

**Spec:** [`docs/superpowers/specs/2026-07-31-aria-live-announcements-design.md`](../specs/2026-07-31-aria-live-announcements-design.md)

## Global Constraints

- Prettier: single quotes, no semicolons, trailing commas, 100 char width.
- Tests: `pnpm exec vitest run <path> --config ./vitest.config.mts`.
- Any test rendering a component that reaches `@payloadcms/ui` must `vi.mock` it — otherwise a CSS import fails collection in isolation.
- `announce()` is fire-and-forget and MUST NOT throw into the React tree.
- Announce **settled stages only** (`confirmed`, `failed`). Never `optimistic` or `submitted`.
- `failed` → assertive region. `confirmed` → polite region.
- Currency in messages uses `formatCurrency` from `@/lib/formatters` (en-AU, AUD).
- Do NOT modify the 24 hooks that already toast, including the four collections actions that toast via `useCollectionsAction`.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/mutation.ts` | *Modify* — add `balanceAfter?: number` to `PendingMutation` |
| `src/lib/announcements.ts` | *Create* — pure `PendingMutation` → sentence |
| `src/stores/announcer.ts` | *Create* — Zustand store holding polite/assertive text + seq |
| `src/components/ui/LiveAnnouncer/LiveAnnouncer.tsx` | *Create* — the two live regions |
| `src/components/ui/LiveAnnouncer/LiveAnnouncer.module.css` | *Create* — visually-hidden styling |
| `src/components/ui/LiveAnnouncer/useOptimisticAnnouncements.ts` | *Create* — store subscriber |
| `src/components/ui/LiveAnnouncer/index.ts` | *Create* — barrel |
| `src/providers/index.tsx` | *Modify* — mount `<LiveAnnouncer />` |
| 8 hook files under `src/hooks/mutations/` | *Modify* — add success/error toasts |

---

### Task 1: Pure message composition

**Files:**
- Modify: `src/types/mutation.ts`
- Create: `src/lib/announcements.ts`
- Test: `tests/unit/lib/announcements.test.ts`

**Interfaces:**
- Consumes: `PendingMutation` from `@/types/mutation`; `formatCurrency` from `@/lib/formatters`
- Produces: `describeSettledMutation(m: PendingMutation): { text: string; urgency: 'polite' | 'assertive' } | null`

- [ ] **Step 1: Add the balance field to the shared type**

In `src/types/mutation.ts`, inside `interface PendingMutation`, after `error?: string`:

```ts
  /**
   * Account balance once this mutation settled — after confirmation, or after
   * rollback on failure. Set by the caller ONLY when the mutation actually
   * changed the balance; leaving it undefined means "nothing to report".
   */
  balanceAfter?: number
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/lib/announcements.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeSettledMutation } from '@/lib/announcements'
import type { PendingMutation } from '@/types/mutation'

const base: PendingMutation = {
  id: 'm1',
  accountId: 'acc-1',
  action: 'waive-fee',
  stage: 'confirmed',
  amount: 25,
  createdAt: 0,
}

describe('describeSettledMutation', () => {
  it('returns null for unsettled stages so nothing is announced mid-flight', () => {
    expect(describeSettledMutation({ ...base, stage: 'optimistic' })).toBeNull()
    expect(describeSettledMutation({ ...base, stage: 'submitted' })).toBeNull()
  })

  it('announces a confirmed action politely, with its amount', () => {
    expect(describeSettledMutation(base)).toEqual({
      text: 'Waive fee confirmed. $25.00.',
      urgency: 'polite',
    })
  })

  it('appends the balance when the caller reported one', () => {
    expect(describeSettledMutation({ ...base, balanceAfter: 0 })).toEqual({
      text: 'Waive fee confirmed. $25.00. Balance updated to $0.00.',
      urgency: 'polite',
    })
  })

  it('announces failures assertively, including the reason', () => {
    expect(
      describeSettledMutation({
        ...base,
        stage: 'failed',
        error: 'Ledger unavailable',
      }),
    ).toEqual({
      text: 'Waive fee failed: Ledger unavailable.',
      urgency: 'assertive',
    })
  })

  it('reports the restored balance on a rollback', () => {
    expect(
      describeSettledMutation({
        ...base,
        stage: 'failed',
        error: 'Ledger unavailable',
        balanceAfter: 150,
      }),
    ).toEqual({
      text: 'Waive fee failed: Ledger unavailable. Balance restored to $150.00.',
      urgency: 'assertive',
    })
  })

  it('falls back to a generic phrase for an unmapped action', () => {
    expect(describeSettledMutation({ ...base, action: 'some-new-thing', amount: undefined }))
      .toEqual({ text: 'Action confirmed.', urgency: 'polite' })
  })

  it('omits the amount clause when there is no amount', () => {
    expect(describeSettledMutation({ ...base, amount: undefined })).toEqual({
      text: 'Waive fee confirmed.',
      urgency: 'polite',
    })
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm exec vitest run tests/unit/lib/announcements.test.ts --config ./vitest.config.mts`
Expected: FAIL — `Failed to resolve import "@/lib/announcements"`

- [ ] **Step 4: Implement**

Create `src/lib/announcements.ts`:

```ts
import { formatCurrency } from '@/lib/formatters'
import type { PendingMutation } from '@/types/mutation'

export type AnnouncementUrgency = 'polite' | 'assertive'

export interface Announcement {
  text: string
  urgency: AnnouncementUrgency
}

/**
 * Human phrase for each optimistic action. Unmapped actions fall back to
 * "Action", which keeps a new mutation silent-but-safe rather than crashing or
 * announcing a raw slug.
 */
const ACTION_PHRASES: Record<string, string> = {
  'waive-fee': 'Waive fee',
  'record-repayment': 'Record repayment',
  'apply-fee': 'Apply fee',
  'write-off': 'Write off',
  adjustment: 'Adjustment',
  disburse: 'Disbursement',
}

export function describeSettledMutation(mutation: PendingMutation): Announcement | null {
  if (mutation.stage !== 'confirmed' && mutation.stage !== 'failed') return null

  const subject = ACTION_PHRASES[mutation.action] ?? 'Action'
  const failed = mutation.stage === 'failed'
  const parts: string[] = []

  if (failed) {
    parts.push(mutation.error ? `${subject} failed: ${mutation.error}.` : `${subject} failed.`)
  } else {
    parts.push(`${subject} confirmed.`)
    if (mutation.amount !== undefined) parts.push(`${formatCurrency(mutation.amount)}.`)
  }

  if (mutation.balanceAfter !== undefined) {
    const verb = failed ? 'restored to' : 'updated to'
    parts.push(`Balance ${verb} ${formatCurrency(mutation.balanceAfter)}.`)
  }

  return { text: parts.join(' '), urgency: failed ? 'assertive' : 'polite' }
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm exec vitest run tests/unit/lib/announcements.test.ts --config ./vitest.config.mts`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add src/types/mutation.ts src/lib/announcements.ts tests/unit/lib/announcements.test.ts
git commit -m "feat(a11y): compose screen-reader sentences for settled mutations"
```

---

### Task 2: Announcer store and live regions

**Files:**
- Create: `src/stores/announcer.ts`
- Create: `src/components/ui/LiveAnnouncer/LiveAnnouncer.tsx`
- Create: `src/components/ui/LiveAnnouncer/LiveAnnouncer.module.css`
- Create: `src/components/ui/LiveAnnouncer/index.ts`
- Test: `tests/unit/ui/live-announcer.test.tsx`

**Interfaces:**
- Consumes: `AnnouncementUrgency` from `@/lib/announcements`
- Produces: `useAnnouncerStore` with `{ polite, assertive, seq, announce(text, urgency) }`; `<LiveAnnouncer />`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/live-announcer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { LiveAnnouncer } from '@/components/ui/LiveAnnouncer'
import { useAnnouncerStore } from '@/stores/announcer'

describe('LiveAnnouncer', () => {
  beforeEach(() => {
    cleanup()
    useAnnouncerStore.setState({ polite: '', assertive: '', seq: 0 })
  })

  it('exposes a polite status region and an assertive alert region', () => {
    render(<LiveAnnouncer />)
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive')
  })

  it('routes a polite announcement to the status region only', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee confirmed.', 'polite'))
    expect(screen.getByRole('status').textContent).toBe('Waive fee confirmed.')
    expect(screen.getByRole('alert').textContent).toBe('')
  })

  it('routes a failure to the assertive region only', () => {
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Waive fee failed.', 'assertive'))
    expect(screen.getByRole('alert').textContent).toBe('Waive fee failed.')
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('re-announces an identical consecutive message', () => {
    // Screen readers ignore an unchanged region, so a second identical failure
    // would otherwise be silent — the case where silence is most dangerous.
    render(<LiveAnnouncer />)
    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    const first = useAnnouncerStore.getState().seq
    act(() => useAnnouncerStore.getState().announce('Ledger unavailable.', 'assertive'))
    expect(useAnnouncerStore.getState().seq).toBeGreaterThan(first)
  })

  it('keeps the regions out of the visual layout', () => {
    render(<LiveAnnouncer />)
    expect(screen.getByRole('status').className).not.toBe('')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run tests/unit/ui/live-announcer.test.tsx --config ./vitest.config.mts`
Expected: FAIL — cannot resolve `@/components/ui/LiveAnnouncer`

- [ ] **Step 3: Create the store**

Create `src/stores/announcer.ts`:

```ts
'use client'

import { create } from 'zustand'
import type { AnnouncementUrgency } from '@/lib/announcements'

interface AnnouncerState {
  polite: string
  assertive: string
  /** Bumped on every announce so an identical consecutive message still re-reads. */
  seq: number
  announce: (text: string, urgency: AnnouncementUrgency) => void
}

export const useAnnouncerStore = create<AnnouncerState>((set) => ({
  polite: '',
  assertive: '',
  seq: 0,
  announce: (text, urgency) =>
    set((state) => ({
      seq: state.seq + 1,
      polite: urgency === 'polite' ? text : '',
      assertive: urgency === 'assertive' ? text : '',
    })),
}))
```

- [ ] **Step 4: Create the styles**

Create `src/components/ui/LiveAnnouncer/LiveAnnouncer.module.css`:

```css
/* Visually hidden but still read: display:none and visibility:hidden would
   remove the region from the accessibility tree entirely. */
.visuallyHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 5: Create a no-op subscriber first**

The component imports this, so it must exist before Step 6 or that step will not compile.

Create `src/components/ui/LiveAnnouncer/useOptimisticAnnouncements.ts`:

```ts
'use client'

/** Wired in Task 3. */
export function useOptimisticAnnouncements(): void {}
```

- [ ] **Step 6: Create the component**

Create `src/components/ui/LiveAnnouncer/LiveAnnouncer.tsx`:

```tsx
'use client'

import React from 'react'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticAnnouncements } from './useOptimisticAnnouncements'
import styles from './LiveAnnouncer.module.css'

/**
 * The app's single pair of ARIA live regions — docs/ux-standards.md §1.2 (SC 4.1.3).
 *
 * Mount exactly once, in the providers tree. Anything can announce via
 * useAnnouncerStore.getState().announce(text, urgency); optimistic mutation
 * outcomes are wired automatically by useOptimisticAnnouncements.
 */
export const LiveAnnouncer: React.FC = () => {
  const polite = useAnnouncerStore((s) => s.polite)
  const assertive = useAnnouncerStore((s) => s.assertive)
  const seq = useAnnouncerStore((s) => s.seq)

  useOptimisticAnnouncements()

  return (
    <>
      <div
        key={`polite-${seq}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={styles.visuallyHidden}
      >
        {polite}
      </div>
      <div
        key={`assertive-${seq}`}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className={styles.visuallyHidden}
      >
        {assertive}
      </div>
    </>
  )
}
```

Create `src/components/ui/LiveAnnouncer/index.ts`:

```ts
export { LiveAnnouncer } from './LiveAnnouncer'
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `pnpm exec vitest run tests/unit/ui/live-announcer.test.tsx --config ./vitest.config.mts`
Expected: PASS, 5 tests

- [ ] **Step 8: Commit**

```bash
git add src/stores/announcer.ts src/components/ui/LiveAnnouncer tests/unit/ui/live-announcer.test.tsx
git commit -m "feat(a11y): add LiveAnnouncer with polite and assertive regions"
```

---

### Task 3: Subscribe to the optimistic store

**Files:**
- Modify: `src/components/ui/LiveAnnouncer/useOptimisticAnnouncements.ts`
- Test: `tests/unit/ui/optimistic-announcements.test.tsx`

**Interfaces:**
- Consumes: `useOptimisticStore` from `@/stores/optimistic`; `describeSettledMutation`; `useAnnouncerStore`
- Produces: `useOptimisticAnnouncements(): void`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/optimistic-announcements.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { LiveAnnouncer } from '@/components/ui/LiveAnnouncer'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticStore } from '@/stores/optimistic'
import type { PendingMutation } from '@/types/mutation'

const mutation = (over: Partial<PendingMutation> = {}): PendingMutation => ({
  id: 'm1',
  accountId: 'acc-1',
  action: 'waive-fee',
  stage: 'optimistic',
  amount: 25,
  createdAt: 0,
  ...over,
})

describe('useOptimisticAnnouncements', () => {
  beforeEach(() => {
    cleanup()
    useAnnouncerStore.setState({ polite: '', assertive: '', seq: 0 })
    useOptimisticStore.setState({ pendingByAccount: new Map() })
  })

  it('stays silent while a mutation is still in flight', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    expect(useAnnouncerStore.getState().polite).toBe('')
    expect(useAnnouncerStore.getState().assertive).toBe('')
  })

  it('announces politely once the mutation is confirmed', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    expect(useAnnouncerStore.getState().polite).toBe('Waive fee confirmed. $25.00.')
  })

  it('announces assertively with the reason on failure', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    act(() =>
      useOptimisticStore.getState().setStage('acc-1', 'm1', 'failed', 'Ledger unavailable'),
    )
    expect(useAnnouncerStore.getState().assertive).toBe(
      'Waive fee failed: Ledger unavailable.',
    )
  })

  it('does not announce the same settled mutation twice', () => {
    render(<LiveAnnouncer />)
    act(() => useOptimisticStore.getState().setPending('acc-1', mutation()))
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    const seqAfterFirst = useAnnouncerStore.getState().seq
    act(() => useOptimisticStore.getState().setStage('acc-1', 'm1', 'confirmed'))
    expect(useAnnouncerStore.getState().seq).toBe(seqAfterFirst)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run tests/unit/ui/optimistic-announcements.test.tsx --config ./vitest.config.mts`
Expected: FAIL — polite region stays `''` because the subscriber is still a no-op

- [ ] **Step 3: Implement the subscriber**

Replace `src/components/ui/LiveAnnouncer/useOptimisticAnnouncements.ts`:

```ts
'use client'

import { useEffect, useRef } from 'react'
import { describeSettledMutation } from '@/lib/announcements'
import { useAnnouncerStore } from '@/stores/announcer'
import { useOptimisticStore } from '@/stores/optimistic'

/**
 * Speaks settled optimistic mutations — docs/ux-standards.md §1.2 (SC 4.1.3).
 *
 * Subscribes outside React so it observes every store write, including
 * rollbacks triggered from outside a component tree. Announced mutation ids are
 * remembered for the lifetime of the mount so a re-render or a repeated
 * setStage call cannot announce the same outcome twice.
 */
export function useOptimisticAnnouncements(): void {
  const announcedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const announced = announcedRef.current

    return useOptimisticStore.subscribe((state) => {
      for (const [accountId, mutations] of state.pendingByAccount) {
        for (const mutation of mutations.values()) {
          const key = `${accountId}:${mutation.id}:${mutation.stage}`
          if (announced.has(key)) continue

          const announcement = describeSettledMutation(mutation)
          if (!announcement) continue

          announced.add(key)
          useAnnouncerStore.getState().announce(announcement.text, announcement.urgency)
        }
      }
    })
  }, [])
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run tests/unit/ui/optimistic-announcements.test.tsx --config ./vitest.config.mts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/LiveAnnouncer/useOptimisticAnnouncements.ts tests/unit/ui/optimistic-announcements.test.tsx
git commit -m "feat(a11y): announce settled optimistic mutations"
```

---

### Task 4: Mount in the providers tree

**Files:**
- Modify: `src/providers/index.tsx`
- Modify: `src/components/ui/index.ts`

**Interfaces:**
- Consumes: `<LiveAnnouncer />` from Task 2
- Produces: nothing — this is the wiring task

- [ ] **Step 1: Export from the ui barrel**

In `src/components/ui/index.ts`, after the `Modal` exports:

```ts
export { LiveAnnouncer } from './LiveAnnouncer'
```

- [ ] **Step 2: Add the import**

In `src/providers/index.tsx`, alongside the other component imports:

```tsx
import { LiveAnnouncer } from '@/components/ui/LiveAnnouncer'
```

- [ ] **Step 3: Mount it**

In `src/providers/index.tsx`, inside `Providers`, immediately after `<Toaster position="top-right" richColors />`:

```tsx
      <LiveAnnouncer />
```

- [ ] **Step 4: Verify nothing regressed**

Run: `pnpm test:int`
Expected: all pass. Then `pnpm lint` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/providers/index.tsx src/components/ui/index.ts
git commit -m "feat(a11y): mount LiveAnnouncer in the providers tree"
```

---

### Task 5: Report the settled balance from ledger hooks

**Files:**
- Modify: `src/hooks/mutations/useWaiveFee.ts`
- Modify: `src/hooks/mutations/useRecordRepayment.ts`
- Test: `tests/unit/hooks/balance-after.test.ts`

**Interfaces:**
- Consumes: `PendingMutation.balanceAfter` from Task 1
- Produces: nothing new — populates an existing field

- [ ] **Step 1: Find where each hook settles its mutation**

Run: `rg -n "setStage\(" src/hooks/mutations/useWaiveFee.ts src/hooks/mutations/useRecordRepayment.ts`

Note the `onSuccess` and `onError` call sites — those are the only places to change.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/hooks/balance-after.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeSettledMutation } from '@/lib/announcements'
import type { PendingMutation } from '@/types/mutation'

// Guards the spec rule: balanceAfter is set by the caller ONLY when the balance
// actually changed. The announcer appends the clause whenever it is present, so
// a hook setting it for an unchanged balance is the bug.
describe('balanceAfter contract', () => {
  const settled: PendingMutation = {
    id: 'm1',
    accountId: 'acc-1',
    action: 'record-repayment',
    stage: 'confirmed',
    amount: 50,
    createdAt: 0,
  }

  it('omits the balance clause when the hook reported none', () => {
    expect(describeSettledMutation(settled)?.text).toBe('Record repayment confirmed. $50.00.')
  })

  it('includes it when the hook reported one', () => {
    expect(describeSettledMutation({ ...settled, balanceAfter: 100 })?.text).toBe(
      'Record repayment confirmed. $50.00. Balance updated to $100.00.',
    )
  })
})
```

- [ ] **Step 3: Run it and confirm it passes**

Run: `pnpm exec vitest run tests/unit/hooks/balance-after.test.ts --config ./vitest.config.mts`
Expected: PASS — this codifies the contract from Task 1 before the hooks rely on it.

- [ ] **Step 4: Populate the field on success**

In each hook's `onSuccess`, where it calls `setStage(accountId, mutationId, 'confirmed')`, first update the stored mutation to carry the balance the API returned. Use `setPending` with the existing mutation spread plus the new field, then `setStage`:

First find the real field name on the response — do not guess it:

```bash
rg -n "totalOutstanding|balanceAfter|newBalance|principalBalance" src/hooks/mutations/useWaiveFee.ts src/types
```

Then, using that field and the hook's own variable for the pending mutation
(the object it passed to `setPending` in `onMutate`):

```ts
const settledBalance = data.totalOutstanding // <- the field found above
if (settledBalance !== undefined) {
  useOptimisticStore.getState().setPending(accountId, {
    ...pending,                       // <- the hook's existing mutation object
    balanceAfter: Number(settledBalance),
  })
}
useOptimisticStore.getState().setStage(accountId, pending.id, 'confirmed')
```

Set `balanceAfter` only when the mutation actually moved the balance. If the
response has no balance field, skip this hook and leave it undefined — the
announcer degrades to "Waive fee confirmed. $25.00." which is still correct.

- [ ] **Step 5: Verify**

Run: `pnpm test:int`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/mutations/useWaiveFee.ts src/hooks/mutations/useRecordRepayment.ts tests/unit/hooks/balance-after.test.ts
git commit -m "feat(a11y): report settled balance for announcement"
```

---

### Task 6: Give the eight silent hooks a toast

**Files:**
- Modify: `src/hooks/mutations/useAcknowledgeAnomaly.ts`
- Modify: `src/hooks/mutations/useCancelConfigChange.ts`
- Modify: `src/hooks/mutations/useFinalizePeriodClose.ts`
- Modify: `src/hooks/mutations/useRetryExport.ts`
- Modify: `src/hooks/mutations/useScheduleConfigChange.ts`
- Modify: `src/hooks/mutations/useBatchQuery.ts`
- Modify: `src/hooks/mutations/useRandomSample.ts`
- Modify: `src/hooks/mutations/usePeriodClosePreview.ts`

**Interfaces:**
- Consumes: `toast` from `sonner`
- Produces: nothing — sonner's existing live region carries these

- [ ] **Step 1: Read the pattern to copy**

Run: `rg -n "toast\.(success|error)" -A3 src/hooks/mutations/useWaiveFee.ts`

Match its shape: a short title, with the actionable detail in `description`.

- [ ] **Step 2: Add toasts to each hook**

For every file above, add to its `onSuccess` and `onError`. Wording per the standards doc §5 — the action keeps the same name from button to toast, errors say what happened and what to do next:

| Hook | Success | Error title |
|---|---|---|
| `useAcknowledgeAnomaly` | `Anomaly acknowledged` | `Failed to acknowledge anomaly` |
| `useCancelConfigChange` | `Scheduled change cancelled` | `Failed to cancel scheduled change` |
| `useFinalizePeriodClose` | `Period closed` | `Failed to close period` |
| `useRetryExport` | `Export retry started` | `Failed to retry export` |
| `useScheduleConfigChange` | `Change scheduled` | `Failed to schedule change` |
| `useBatchQuery` | `Batch query complete` | `Batch query failed` |
| `useRandomSample` | `Sample generated` | `Failed to generate sample` |
| `usePeriodClosePreview` | *(none — preview is a read; error only)* | `Failed to load preview` |

Example, using `useFinalizePeriodClose`:

```ts
import { toast } from 'sonner'

// in onSuccess:
toast.success('Period closed', { description: `Period ${params.periodId} is now closed.` })

// in onError:
toast.error('Failed to close period', { description: appError.message })
```

- [ ] **Step 3: Verify**

Run: `pnpm test:int` then `pnpm lint`
Expected: all tests pass, 0 lint errors.

- [ ] **Step 4: Confirm no hook is left silent**

```bash
for f in src/hooks/mutations/*.ts; do
  b=$(basename "$f"); [ "$b" = "index.ts" ] && continue
  grep -q 'toast\.' "$f" && continue
  grep -qE 'useCollectionsAction|buildSuccessToast' "$f" && continue
  echo "STILL SILENT: $b"
done
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/mutations
git commit -m "feat(a11y): surface outcomes for the eight silent mutation hooks"
```

---

### Task 7: Update the standard and verify end to end

**Files:**
- Modify: `docs/ux-standards.md`

- [ ] **Step 1: Update §9 item 1**

Replace the open finding about `aria-live` coverage with what shipped: sonner already announced toasts; the real gap was 8 silent hooks plus unannounced optimistic transitions; both are now closed by `LiveAnnouncer`. Move it from "Open" to "Fixed".

- [ ] **Step 2: Full verification**

```bash
pnpm lint          # expect 0 errors
pnpm typecheck     # expect clean
pnpm test:int      # expect all pass
```

- [ ] **Step 3: Run the axe suite against localhost**

```bash
pnpm e2e:auth
pnpm exec playwright test tests/e2e/accessibility.e2e.spec.ts
```

Expected: no new violations. Two live regions with no text content are valid and axe does not flag them.

- [ ] **Step 4: Commit**

```bash
git add docs/ux-standards.md
git commit -m "docs(a11y): record live-announcement coverage in the standard"
```
