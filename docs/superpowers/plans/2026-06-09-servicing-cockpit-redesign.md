# Servicing Cockpit Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column servicing page with a persistent three-pane cockpit (triaged account rail · account work-surface · customer-context pane) without changing any data, ledger, or action semantics.

**Architecture:** Two new pure-logic modules (`accountTriage`, `getAccountActions`) become the single source of truth for rail ordering and action gating. New presentational components (`AttentionStrip`, `AccountRail`, `AccountSummaryBar`, `ContextPane`) are built and unit-tested in isolation, then `ServicingView` is restructured from a vertical stack into a CSS grid that composes them. Existing tabs, drawers, hooks, stores, and the read/write split are untouched.

**Tech Stack:** Next.js 15 / Payload 3.45 admin view · React · TypeScript · CSS Modules · TanStack Query · Zustand · Vitest + Testing Library (jsdom) · Playwright.

**Spec:** `docs/superpowers/specs/2026-06-09-servicing-page-redesign-design.md`

---

## File Structure

**Create**
- `src/lib/accountTriage.ts` — pure rail sort/group + per-account signal + attention items. (Tests: `tests/unit/lib/account-triage.test.ts`)
- `src/lib/getAccountActions.ts` — pure action availability model. (Tests: `tests/unit/lib/get-account-actions.test.ts`)
- `src/components/ServicingView/AttentionStrip.tsx` + `AttentionStrip.module.css` — customer-level alert chips. (Tests: `tests/unit/ui/attention-strip.test.tsx`)
- `src/components/ServicingView/AccountRail.tsx` + `AccountRail.module.css` — triaged, grouped account list. (Tests: `tests/unit/ui/account-rail.test.tsx`)
- `src/components/ServicingView/AccountPanel/AccountSummaryBar.tsx` — sticky summary + IDs + actions (evolves `AccountHeader`). (Tests: `tests/unit/ui/account-summary-bar.test.tsx`)
- `src/components/ServicingView/ContextPane.tsx` + `ContextPane.module.css` — tabbed Communications/Applications wrapper. (Tests: `tests/unit/ui/context-pane.test.tsx`)

**Modify**
- `src/components/ServicingView/LoanAccountCard.tsx` (+ its test) — slim to a compact rail row.
- `src/components/ServicingView/AccountPanel/OverviewTab.tsx` (+ new test) — reflow to card grid; drop bottom ID row.
- `src/components/ServicingView/AccountPanel/ActionsTab.tsx` (+ new test) — render from `getAccountActions`.
- `src/components/ServicingView/AccountPanel/AccountPanel.tsx` — drop `AccountSwitcher`, use `AccountSummaryBar`.
- `src/components/ServicingView/ServicingView.tsx` — three-pane grid; auto-select top-triaged; swap banner→strip, list→rail, add context pane.
- `src/components/ServicingView/styles.module.css` — grid + responsive; lift the 1200px cap for this view.
- `src/components/ServicingView/AccountPanel/AccountTabs.tsx` — keyboard hint "1–4" → "1–6".

**Delete**
- `src/components/ServicingView/AccountPanel/AccountSwitcher.tsx`
- `src/components/ServicingView/VulnerableCustomerBanner.tsx`

**Shared interfaces (defined in Task 2 / Task 4, referenced later — keep names exact):**
- `AccountSignal { tier: 'overdue'|'pending'|'active'|'closed'; isOverdue: boolean; daysOverdue: number; nextDueDate: string|null }`
- `getAccountSignal(account, today?) → AccountSignal`
- `sortAccountsForRail(accounts, today?) → { active: LoanAccountData[]; closed: LoanAccountData[] }`
- `AttentionItem { kind: 'vulnerable'|'overdue'|'pending_disbursement'|'writeoff_pending'; label: string; accountId: string|null; severity: 'high'|'medium' }`
- `getAttentionItems({ vulnerable, accounts, pendingWriteOffAccountIds?, today? }) → AttentionItem[]`
- `AccountActionId = 'disburse'|'record-payment'|'waive-fee'|'apply-late-fee'|'apply-dishonour-fee'|'request-write-off'`
- `AccountActionContext { readOnly: boolean; hasPendingWriteOff: boolean; pendingRepayment: boolean; pendingWaive: boolean }`
- `AccountAction { id: AccountActionId; label: string; visible: boolean; enabled: boolean; primary: boolean; danger: boolean; disabledReason: string|null }`
- `getAccountActions(account, ctx) → AccountAction[]`

---

## Task 1: Feature branch

- [ ] **Step 1: Create and switch to the branch**

Run:
```bash
cd /Users/rohansharp/workspace/billie-crm
git checkout -b feature/servicing-cockpit-redesign
```
Expected: `Switched to a new branch 'feature/servicing-cockpit-redesign'`

---

## Task 2: `getAccountActions` — action model (pure, TDD)

**Files:**
- Create: `src/lib/getAccountActions.ts`
- Test: `tests/unit/lib/get-account-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/get-account-actions.test.ts
import { describe, it, expect } from 'vitest'
import { getAccountActions, type AccountActionContext } from '@/lib/getAccountActions'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const baseCtx: AccountActionContext = {
  readOnly: false,
  hasPendingWriteOff: false,
  pendingRepayment: false,
  pendingWaive: false,
}

const account = (overrides: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'a1',
    loanAccountId: 'LOAN-1',
    accountNumber: 'ACC-1',
    accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: '2026-05-23', amount: 80 },
    repaymentSchedule: { scheduleId: 's1', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z',
    updatedAt: '2026-06-09T00:00:00Z',
    ...overrides,
  }) as LoanAccountData

const byId = (a: LoanAccountData, ctx: AccountActionContext) =>
  Object.fromEntries(getAccountActions(a, ctx).map((x) => [x.id, x]))

describe('getAccountActions', () => {
  it('live account: record-payment is the enabled primary; waive enabled when fees>0', () => {
    const m = byId(account(), baseCtx)
    expect(m['record-payment'].primary).toBe(true)
    expect(m['record-payment'].enabled).toBe(true)
    expect(m['disburse'].visible).toBe(false)
    expect(m['waive-fee'].enabled).toBe(true)
  })

  it('waive disabled when fees are zero', () => {
    const m = byId(account({ liveBalance: { principalBalance: 160, feeBalance: 0, totalOutstanding: 160, asOf: '2026-06-09T00:00:00Z' } }), baseCtx)
    expect(m['waive-fee'].enabled).toBe(false)
    expect(m['waive-fee'].disabledReason).toBe('No fees to waive')
  })

  it('pending_disbursement: disburse is the enabled primary, all money actions disabled', () => {
    const m = byId(account({ accountStatus: 'pending_disbursement' }), baseCtx)
    expect(m['disburse'].visible).toBe(true)
    expect(m['disburse'].primary).toBe(true)
    expect(m['disburse'].enabled).toBe(true)
    for (const id of ['record-payment', 'waive-fee', 'apply-late-fee', 'apply-dishonour-fee', 'request-write-off'] as const) {
      expect(m[id].enabled).toBe(false)
      expect(m[id].disabledReason).toBe('Available after the loan is disbursed')
    }
  })

  it('read-only disables everything with a read-only reason', () => {
    const m = byId(account(), { ...baseCtx, readOnly: true })
    for (const a of Object.values(m)) {
      if (a.visible) {
        expect(a.enabled).toBe(false)
        expect(a.disabledReason).toBe('Read-only mode')
      }
    }
  })

  it('in-flight repayment/waive disable their buttons', () => {
    const m = byId(account(), { ...baseCtx, pendingRepayment: true, pendingWaive: true })
    expect(m['record-payment'].enabled).toBe(false)
    expect(m['record-payment'].disabledReason).toBe('Payment in progress')
    expect(m['waive-fee'].enabled).toBe(false)
    expect(m['waive-fee'].disabledReason).toBe('Waive in progress')
  })

  it('pending write-off disables the write-off action', () => {
    const m = byId(account(), { ...baseCtx, hasPendingWriteOff: true })
    expect(m['request-write-off'].enabled).toBe(false)
    expect(m['request-write-off'].disabledReason).toBe('Write-off already pending approval')
    expect(m['request-write-off'].danger).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/lib/get-account-actions.test.ts --config ./vitest.config.mts`
Expected: FAIL — `Cannot find module '@/lib/getAccountActions'`.

- [ ] **Step 3: Implement `getAccountActions`**

```ts
// src/lib/getAccountActions.ts
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

export type AccountActionId =
  | 'disburse'
  | 'record-payment'
  | 'waive-fee'
  | 'apply-late-fee'
  | 'apply-dishonour-fee'
  | 'request-write-off'

export interface AccountActionContext {
  readOnly: boolean
  hasPendingWriteOff: boolean
  pendingRepayment: boolean
  pendingWaive: boolean
}

export interface AccountAction {
  id: AccountActionId
  label: string
  visible: boolean
  enabled: boolean
  primary: boolean
  danger: boolean
  disabledReason: string | null
}

const PENDING_REASON = 'Available after the loan is disbursed'
const READONLY_REASON = 'Read-only mode'

/**
 * Single source of truth for account action availability.
 * Ported verbatim from ActionsTab/RecordRepaymentDrawer, plus the
 * pending_disbursement gating (all money actions disabled until disbursed).
 */
export function getAccountActions(
  account: LoanAccountData,
  ctx: AccountActionContext,
): AccountAction[] {
  const isPending = account.accountStatus === 'pending_disbursement'
  const fees = account.liveBalance ? account.liveBalance.feeBalance : 0

  // Resolve a disabledReason in precedence order; null means enabled.
  const reason = (extra: () => string | null): string | null => {
    if (ctx.readOnly) return READONLY_REASON
    if (isPending) return PENDING_REASON
    return extra()
  }

  const disburse: AccountAction = {
    id: 'disburse',
    label: 'Disburse loan',
    visible: isPending,
    primary: isPending,
    danger: false,
    disabledReason: ctx.readOnly ? READONLY_REASON : null,
    enabled: isPending && !ctx.readOnly,
  }

  const recordPayment: AccountAction = mk('record-payment', 'Record payment', {
    primary: !isPending,
    disabledReason: reason(() => (ctx.pendingRepayment ? 'Payment in progress' : null)),
  })

  const waiveFee: AccountAction = mk('waive-fee', 'Waive fee', {
    disabledReason: reason(() =>
      ctx.pendingWaive ? 'Waive in progress' : fees <= 0 ? 'No fees to waive' : null,
    ),
  })

  const lateFee = mk('apply-late-fee', 'Apply late fee', { disabledReason: reason(() => null) })
  const dishonourFee = mk('apply-dishonour-fee', 'Apply dishonour fee', { disabledReason: reason(() => null) })

  const writeOff = mk('request-write-off', 'Request write-off', {
    danger: true,
    disabledReason: reason(() =>
      ctx.hasPendingWriteOff ? 'Write-off already pending approval' : null,
    ),
  })

  return [disburse, recordPayment, waiveFee, lateFee, dishonourFee, writeOff]
}

function mk(
  id: AccountActionId,
  label: string,
  opts: { primary?: boolean; danger?: boolean; disabledReason: string | null },
): AccountAction {
  return {
    id,
    label,
    visible: true,
    primary: opts.primary ?? false,
    danger: opts.danger ?? false,
    disabledReason: opts.disabledReason,
    enabled: opts.disabledReason === null,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/lib/get-account-actions.test.ts --config ./vitest.config.mts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/getAccountActions.ts tests/unit/lib/get-account-actions.test.ts
git commit -m "feat(servicing): add getAccountActions action model with tests"
```

---

## Task 3: `accountTriage` — signal + sort + attention (pure, TDD)

**Files:**
- Create: `src/lib/accountTriage.ts`
- Test: `tests/unit/lib/account-triage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/account-triage.test.ts
import { describe, it, expect } from 'vitest'
import {
  getAccountSignal,
  sortAccountsForRail,
  getAttentionItems,
} from '@/lib/accountTriage'
import type { LoanAccountData, ScheduledPayment } from '@/hooks/queries/useCustomer'

const TODAY = new Date('2026-06-09T12:00:00Z')

const pay = (n: number, dueDate: string, status: ScheduledPayment['status']): ScheduledPayment =>
  ({ paymentNumber: n, dueDate, amount: 80, status } as ScheduledPayment)

const acc = (o: Partial<LoanAccountData> & { loanAccountId: string }): LoanAccountData =>
  ({
    id: o.loanAccountId,
    accountNumber: o.loanAccountId,
    accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 0, totalOutstanding: 0, totalPaid: 0 },
    liveBalance: null,
    lastPayment: { date: null, amount: null },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z',
    updatedAt: '2026-03-14T00:00:00Z',
    ...o,
  }) as LoanAccountData

describe('getAccountSignal', () => {
  it('paid_off and written_off are closed', () => {
    expect(getAccountSignal(acc({ loanAccountId: 'A', accountStatus: 'paid_off' }), TODAY).tier).toBe('closed')
    expect(getAccountSignal(acc({ loanAccountId: 'B', accountStatus: 'written_off' }), TODAY).tier).toBe('closed')
  })

  it('pending_disbursement is pending', () => {
    expect(getAccountSignal(acc({ loanAccountId: 'C', accountStatus: 'pending_disbursement' }), TODAY).tier).toBe('pending')
  })

  it('active with a past-due unpaid instalment is overdue with daysOverdue', () => {
    const s = getAccountSignal(
      acc({
        loanAccountId: 'D',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 2, paymentFrequency: 'fortnightly', createdDate: null,
          payments: [pay(1, '2026-06-06', 'scheduled'), pay(2, '2026-06-20', 'scheduled')] },
      }),
      TODAY,
    )
    expect(s.tier).toBe('overdue')
    expect(s.isOverdue).toBe(true)
    expect(s.daysOverdue).toBe(3)
    expect(s.nextDueDate).toBe('2026-06-06')
  })

  it('active fully up-to-date is active with the next future due date', () => {
    const s = getAccountSignal(
      acc({
        loanAccountId: 'E',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 2, paymentFrequency: 'fortnightly', createdDate: null,
          payments: [pay(1, '2026-05-09', 'paid'), pay(2, '2026-06-20', 'scheduled')] },
      }),
      TODAY,
    )
    expect(s.tier).toBe('active')
    expect(s.daysOverdue).toBe(0)
    expect(s.nextDueDate).toBe('2026-06-20')
  })

  it('in_arrears status is overdue even without schedule rows', () => {
    expect(getAccountSignal(acc({ loanAccountId: 'F', accountStatus: 'in_arrears' }), TODAY).tier).toBe('overdue')
  })
})

describe('sortAccountsForRail', () => {
  it('orders overdue → pending → active and separates closed', () => {
    const accounts = [
      acc({ loanAccountId: 'paid', accountStatus: 'paid_off', updatedAt: '2026-05-02T00:00:00Z' }),
      acc({ loanAccountId: 'pend', accountStatus: 'pending_disbursement' }),
      acc({ loanAccountId: 'live', accountStatus: 'active',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-06-20', 'scheduled')] } }),
      acc({ loanAccountId: 'over', accountStatus: 'active',
        repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-05-28', 'scheduled')] } }),
    ]
    const { active, closed } = sortAccountsForRail(accounts, TODAY)
    expect(active.map((a) => a.loanAccountId)).toEqual(['over', 'pend', 'live'])
    expect(closed.map((a) => a.loanAccountId)).toEqual(['paid'])
  })
})

describe('getAttentionItems', () => {
  it('emits vulnerable, overdue and pending chips in order', () => {
    const accounts = [
      acc({ loanAccountId: 'over', repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-05-28', 'scheduled')] } }),
      acc({ loanAccountId: 'pend', accountStatus: 'pending_disbursement' }),
    ]
    const items = getAttentionItems({ vulnerable: true, accounts, today: TODAY })
    expect(items.map((i) => i.kind)).toEqual(['vulnerable', 'overdue', 'pending_disbursement'])
    expect(items[1].accountId).toBe('over')
    expect(items[0].accountId).toBeNull()
  })

  it('returns empty when nothing needs attention', () => {
    const accounts = [acc({ loanAccountId: 'ok', repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null, payments: [pay(1, '2026-06-20', 'scheduled')] } })]
    expect(getAttentionItems({ vulnerable: false, accounts, today: TODAY })).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/lib/account-triage.test.ts --config ./vitest.config.mts`
Expected: FAIL — `Cannot find module '@/lib/accountTriage'`.

- [ ] **Step 3: Implement `accountTriage`**

```ts
// src/lib/accountTriage.ts
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

export type AccountTier = 'overdue' | 'pending' | 'active' | 'closed'

export interface AccountSignal {
  tier: AccountTier
  isOverdue: boolean
  daysOverdue: number
  nextDueDate: string | null
}

export interface AttentionItem {
  kind: 'vulnerable' | 'overdue' | 'pending_disbursement' | 'writeoff_pending'
  label: string
  accountId: string | null
  severity: 'high' | 'medium'
}

const MS_PER_DAY = 86_400_000
const TIER_RANK: Record<AccountTier, number> = { overdue: 0, pending: 1, active: 2, closed: 3 }

const startOfDay = (d: Date): number => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

const outstanding = (a: LoanAccountData): number =>
  a.liveBalance?.totalOutstanding ?? a.balances?.totalOutstanding ?? 0

export function getAccountSignal(account: LoanAccountData, today: Date = new Date()): AccountSignal {
  const status = account.accountStatus
  if (status === 'paid_off' || status === 'written_off') {
    return { tier: 'closed', isOverdue: false, daysOverdue: 0, nextDueDate: null }
  }
  if (status === 'pending_disbursement') {
    return { tier: 'pending', isOverdue: false, daysOverdue: 0, nextDueDate: null }
  }

  const unpaid = (account.repaymentSchedule?.payments ?? [])
    .filter((p) => p.status !== 'paid' && p.dueDate)
    .sort((a, b) => +new Date(a.dueDate as string) - +new Date(b.dueDate as string))

  const nextDueDate = unpaid[0]?.dueDate ?? null
  const todayMs = startOfDay(today)
  const pastDue = unpaid.filter((p) => startOfDay(new Date(p.dueDate as string)) < todayMs)
  const isOverdue = status === 'in_arrears' || pastDue.length > 0
  const daysOverdue =
    pastDue.length > 0
      ? Math.floor((todayMs - startOfDay(new Date(pastDue[0].dueDate as string))) / MS_PER_DAY)
      : 0

  return { tier: isOverdue ? 'overdue' : 'active', isOverdue, daysOverdue, nextDueDate }
}

export function sortAccountsForRail(
  accounts: LoanAccountData[],
  today: Date = new Date(),
): { active: LoanAccountData[]; closed: LoanAccountData[] } {
  const withSig = accounts.map((a) => ({ a, s: getAccountSignal(a, today) }))

  const active = withSig
    .filter((x) => x.s.tier !== 'closed')
    .sort((x, y) => {
      if (TIER_RANK[x.s.tier] !== TIER_RANK[y.s.tier]) return TIER_RANK[x.s.tier] - TIER_RANK[y.s.tier]
      if (x.s.tier === 'overdue' && x.s.daysOverdue !== y.s.daysOverdue) return y.s.daysOverdue - x.s.daysOverdue
      return outstanding(y.a) - outstanding(x.a)
    })
    .map((x) => x.a)

  const closed = withSig
    .filter((x) => x.s.tier === 'closed')
    .sort((x, y) => +new Date(y.a.updatedAt ?? 0) - +new Date(x.a.updatedAt ?? 0))
    .map((x) => x.a)

  return { active, closed }
}

export function getAttentionItems(opts: {
  vulnerable: boolean
  accounts: LoanAccountData[]
  pendingWriteOffAccountIds?: string[]
  today?: Date
}): AttentionItem[] {
  const { vulnerable, accounts, pendingWriteOffAccountIds = [], today = new Date() } = opts
  const items: AttentionItem[] = []

  if (vulnerable) {
    items.push({ kind: 'vulnerable', label: 'Vulnerable customer', accountId: null, severity: 'high' })
  }

  const sigs = accounts.map((a) => ({ a, s: getAccountSignal(a, today) }))

  const overdue = sigs.filter((x) => x.s.tier === 'overdue').sort((x, y) => y.s.daysOverdue - x.s.daysOverdue)
  if (overdue.length) {
    items.push({
      kind: 'overdue',
      label: overdue.length === 1 ? '1 account overdue' : `${overdue.length} accounts overdue`,
      accountId: overdue[0].a.loanAccountId,
      severity: 'high',
    })
  }

  const pending = sigs.filter((x) => x.s.tier === 'pending')
  if (pending.length) {
    items.push({
      kind: 'pending_disbursement',
      label: pending.length === 1 ? '1 pending disbursement' : `${pending.length} pending disbursement`,
      accountId: pending[0].a.loanAccountId,
      severity: 'medium',
    })
  }

  const wo = accounts.filter((a) => pendingWriteOffAccountIds.includes(a.loanAccountId))
  if (wo.length) {
    items.push({
      kind: 'writeoff_pending',
      label: wo.length === 1 ? '1 write-off pending' : `${wo.length} write-offs pending`,
      accountId: wo[0].loanAccountId,
      severity: 'medium',
    })
  }

  return items
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/lib/account-triage.test.ts --config ./vitest.config.mts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/accountTriage.ts tests/unit/lib/account-triage.test.ts
git commit -m "feat(servicing): add accountTriage signal/sort/attention helpers with tests"
```

---

## Task 4: Compact rail row — refactor `LoanAccountCard`

**Files:**
- Modify: `src/components/ServicingView/LoanAccountCard.tsx`
- Modify: `tests/unit/ui/loan-account-card.test.tsx`

- [ ] **Step 1: Replace the test with the compact-row contract**

Replace the entire body of `tests/unit/ui/loan-account-card.test.tsx` with:

```tsx
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LoanAccountCard } from '@/components/ServicingView/LoanAccountCard'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const TODAY = new Date('2026-06-09T12:00:00Z')

const createMockAccount = (overrides: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'acc-1',
    loanAccountId: 'LOAN-001',
    accountNumber: 'ACC-12345',
    accountStatus: 'active',
    loanTerms: { loanAmount: 5000, loanFee: 500, totalPayable: 5500, openedDate: '2024-01-15' },
    balances: { currentBalance: 3500, totalOutstanding: 3750, totalPaid: 1750 },
    liveBalance: null,
    lastPayment: { date: '2024-06-01', amount: 250 },
    repaymentSchedule: { scheduleId: 'sched-1', numberOfPayments: 12, paymentFrequency: 'monthly', payments: [], createdDate: null },
    createdAt: '2024-01-15T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    ...overrides,
  }) as LoanAccountData

describe('LoanAccountCard (compact rail row)', () => {
  afterEach(() => cleanup())

  test('renders account number and outstanding balance', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText('ACC-12345')).toBeInTheDocument()
    expect(screen.getByText('$3,750.00')).toBeInTheDocument()
  })

  test('shows "Pending disbursement" status line for pending accounts', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'pending_disbursement' })} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/Pending disbursement/i)).toBeInTheDocument()
  })

  test('shows days-overdue line for an overdue account', () => {
    const account = createMockAccount({
      repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null,
        payments: [{ paymentNumber: 1, dueDate: '2026-05-28', amount: 80, status: 'scheduled' } as never] },
    })
    render(<LoanAccountCard account={account} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/12 days overdue/i)).toBeInTheDocument()
  })

  test('shows "Paid off" for closed accounts', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'paid_off' })} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/Paid off/i)).toBeInTheDocument()
  })

  test('marks the selected row via aria-pressed', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} isSelected today={TODAY} />)
    expect(screen.getByTestId('loan-account-card-LOAN-001')).toHaveAttribute('aria-pressed', 'true')
  })

  test('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    const account = createMockAccount()
    render(<LoanAccountCard account={account} onSelect={onSelect} today={TODAY} />)
    fireEvent.click(screen.getByTestId('loan-account-card-LOAN-001'))
    expect(onSelect).toHaveBeenCalledWith(account)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/loan-account-card.test.tsx --config ./vitest.config.mts`
Expected: FAIL — `today` prop not accepted / "12 days overdue" not found / "Click for details" gone.

- [ ] **Step 3: Implement the compact row**

Replace `src/components/ServicingView/LoanAccountCard.tsx` with:

```tsx
'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { getAccountSignal, type AccountSignal } from '@/lib/accountTriage'
import styles from './LoanAccountCard.module.css'

export interface LoanAccountCardProps {
  account: LoanAccountData
  isSelected?: boolean
  onSelect: (account: LoanAccountData) => void
  /** Injectable for deterministic tests; defaults to now. */
  today?: Date
}

const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const dateFormatter = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' })

const DOT_CLASS: Record<AccountSignal['tier'], string> = {
  overdue: styles.dotOverdue,
  pending: styles.dotPending,
  active: styles.dotActive,
  closed: styles.dotClosed,
}

function statusLine(account: LoanAccountData, signal: AccountSignal): string {
  switch (signal.tier) {
    case 'overdue':
      return signal.daysOverdue > 0 ? `${signal.daysOverdue} days overdue` : 'In arrears'
    case 'pending':
      return 'Pending disbursement'
    case 'closed':
      return account.accountStatus === 'written_off' ? 'Written off' : 'Paid off'
    case 'active':
    default:
      return signal.nextDueDate ? `On track · next ${dateFormatter.format(new Date(signal.nextDueDate))}` : 'On track'
  }
}

/**
 * Compact account row for the triaged rail. One line of status, one balance.
 */
export const LoanAccountCard: React.FC<LoanAccountCardProps> = ({ account, isSelected = false, onSelect, today }) => {
  const signal = getAccountSignal(account, today)
  const outstanding = account.liveBalance?.totalOutstanding ?? account.balances?.totalOutstanding ?? 0

  return (
    <button
      type="button"
      className={`${styles.row} ${isSelected ? styles.rowSelected : ''} ${signal.tier === 'closed' ? styles.rowClosed : ''}`}
      onClick={() => onSelect(account)}
      aria-pressed={isSelected}
      data-testid={`loan-account-card-${account.loanAccountId}`}
    >
      <div className={styles.rowTop}>
        <span className={`${styles.dot} ${DOT_CLASS[signal.tier]}`} aria-hidden />
        <span className={styles.accountNumber}>{account.accountNumber}</span>
      </div>
      <div className={styles.rowBottom}>
        <span className={`${styles.statusLine} ${styles[`status_${signal.tier}`] ?? ''}`}>
          {statusLine(account, signal)}
        </span>
        <span className={styles.balance}>{currencyFormatter.format(outstanding)}</span>
      </div>
    </button>
  )
}
```

- [ ] **Step 4: Create the row stylesheet**

```css
/* src/components/ServicingView/LoanAccountCard.module.css */
.row {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid var(--theme-elevation-150, #e3e6eb);
  border-radius: 7px;
  background: var(--theme-elevation-0, #fff);
  padding: 8px;
  margin-bottom: 7px;
  cursor: pointer;
}
.rowSelected { border: 2px solid #2f6fb0; background: #f1f7fc; padding: 7px; }
.rowClosed { opacity: 0.72; }
.rowTop { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.rowBottom { display: flex; align-items: center; justify-content: space-between; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.dotOverdue { background: #e5484d; }
.dotPending { background: #e5a000; }
.dotActive { background: #30a46c; }
.dotClosed { background: #aab2bd; }
.accountNumber { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; color: var(--theme-text, #1f2733); }
.statusLine { font-size: 11px; font-weight: 600; }
.status_overdue { color: #c0362c; }
.status_pending { color: #b7791f; }
.status_active { color: #14854f; }
.status_closed { color: #8a93a0; font-weight: 400; }
.balance { font-size: 13px; font-weight: 700; color: var(--theme-text, #1f2733); }
.rowClosed .balance { color: #8a93a0; font-weight: 600; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/loan-account-card.test.tsx --config ./vitest.config.mts`
Expected: PASS (6 tests). (12 days overdue = 28 May → 9 Jun.)

- [ ] **Step 6: Commit**

```bash
git add src/components/ServicingView/LoanAccountCard.tsx src/components/ServicingView/LoanAccountCard.module.css tests/unit/ui/loan-account-card.test.tsx
git commit -m "refactor(servicing): make LoanAccountCard a compact triaged rail row"
```

---

## Task 5: `AccountRail` — grouped, triaged list

**Files:**
- Create: `src/components/ServicingView/AccountRail.tsx`, `src/components/ServicingView/AccountRail.module.css`
- Test: `tests/unit/ui/account-rail.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/ui/account-rail.test.tsx
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { AccountRail } from '@/components/ServicingView/AccountRail'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const TODAY = new Date('2026-06-09T12:00:00Z')
const acc = (id: string, o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id, loanAccountId: id, accountNumber: id, accountStatus: 'active',
    loanTerms: { loanAmount: 0, loanFee: 0, totalPayable: 0, openedDate: null },
    balances: { currentBalance: 0, totalOutstanding: 0, totalPaid: 0 },
    liveBalance: null, lastPayment: { date: null, amount: null },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 0, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
  }) as LoanAccountData

describe('AccountRail', () => {
  afterEach(() => cleanup())

  test('renders the account count header', () => {
    render(<AccountRail accounts={[acc('A'), acc('B')]} selectedAccountId={null} onSelectAccount={vi.fn()} today={TODAY} />)
    expect(screen.getByText('Accounts (2)')).toBeInTheDocument()
  })

  test('shows a Closed divider when closed accounts exist', () => {
    render(<AccountRail accounts={[acc('A'), acc('Z', { accountStatus: 'paid_off' })]} selectedAccountId={null} onSelectAccount={vi.fn()} today={TODAY} />)
    expect(screen.getByText('CLOSED')).toBeInTheDocument()
  })

  test('renders an empty state when there are no accounts', () => {
    render(<AccountRail accounts={[]} selectedAccountId={null} onSelectAccount={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/No loan accounts/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/account-rail.test.tsx --config ./vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AccountRail`**

```tsx
// src/components/ServicingView/AccountRail.tsx
'use client'

import { useMemo } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { sortAccountsForRail } from '@/lib/accountTriage'
import { LoanAccountCard } from './LoanAccountCard'
import styles from './AccountRail.module.css'

export interface AccountRailProps {
  accounts: LoanAccountData[]
  selectedAccountId: string | null
  onSelectAccount: (account: LoanAccountData) => void
  today?: Date
}

const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

export const AccountRail: React.FC<AccountRailProps> = ({ accounts, selectedAccountId, onSelectAccount, today }) => {
  const { active, closed } = useMemo(() => sortAccountsForRail(accounts, today), [accounts, today])
  const total = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.liveBalance?.totalOutstanding ?? a.balances?.totalOutstanding ?? 0), 0),
    [accounts],
  )

  if (accounts.length === 0) {
    return (
      <div className={styles.rail} data-testid="account-rail">
        <h3 className={styles.title}>Accounts</h3>
        <p className={styles.empty}>No loan accounts found</p>
      </div>
    )
  }

  return (
    <div className={styles.rail} data-testid="account-rail">
      <h3 className={styles.title}>Accounts ({accounts.length})</h3>
      <p className={styles.total}>
        Total outstanding <strong>{currencyFormatter.format(total)}</strong>
      </p>

      {active.map((a) => (
        <LoanAccountCard key={a.id} account={a} isSelected={a.loanAccountId === selectedAccountId} onSelect={onSelectAccount} today={today} />
      ))}

      {closed.length > 0 && (
        <>
          <div className={styles.divider}>
            <span className={styles.dividerLabel}>CLOSED</span>
          </div>
          {closed.map((a) => (
            <LoanAccountCard key={a.id} account={a} isSelected={a.loanAccountId === selectedAccountId} onSelect={onSelectAccount} today={today} />
          ))}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create the rail stylesheet**

```css
/* src/components/ServicingView/AccountRail.module.css */
.rail { background: var(--theme-elevation-0, #fff); border: 1px solid var(--theme-elevation-150, #e3e6eb); border-radius: 8px; padding: 10px; height: 100%; box-sizing: border-box; }
.title { font-size: 13px; font-weight: 700; color: var(--theme-text, #1f2733); margin: 0 0 2px; }
.total { color: #8a93a0; font-size: 11px; margin: 0 0 10px; }
.total strong { color: var(--theme-text, #1f2733); }
.empty { color: #8a93a0; font-size: 12px; }
.divider { display: flex; align-items: center; gap: 6px; margin: 12px 0 7px; }
.divider::before, .divider::after { content: ''; height: 1px; background: var(--theme-elevation-100, #eceef1); flex: 1; }
.dividerLabel { color: #aab2bd; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/account-rail.test.tsx --config ./vitest.config.mts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ServicingView/AccountRail.tsx src/components/ServicingView/AccountRail.module.css tests/unit/ui/account-rail.test.tsx
git commit -m "feat(servicing): add triaged AccountRail"
```

---

## Task 6: `AttentionStrip`

**Files:**
- Create: `src/components/ServicingView/AttentionStrip.tsx`, `src/components/ServicingView/AttentionStrip.module.css`
- Test: `tests/unit/ui/attention-strip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/ui/attention-strip.test.tsx
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { AttentionStrip } from '@/components/ServicingView/AttentionStrip'
import type { AttentionItem } from '@/lib/accountTriage'

afterEach(() => cleanup())

const items: AttentionItem[] = [
  { kind: 'vulnerable', label: 'Vulnerable customer', accountId: null, severity: 'high' },
  { kind: 'overdue', label: '1 account overdue', accountId: 'LOAN-9', severity: 'high' },
]

describe('AttentionStrip', () => {
  test('renders nothing when there are no items', () => {
    const { container } = render(<AttentionStrip items={[]} onSelectAccount={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders a chip per item', () => {
    render(<AttentionStrip items={items} onSelectAccount={vi.fn()} />)
    expect(screen.getByText('Vulnerable customer')).toBeInTheDocument()
    expect(screen.getByText('1 account overdue')).toBeInTheDocument()
  })

  test('clicking a chip with an accountId selects that account', () => {
    const onSelectAccount = vi.fn()
    render(<AttentionStrip items={items} onSelectAccount={onSelectAccount} />)
    fireEvent.click(screen.getByText('1 account overdue'))
    expect(onSelectAccount).toHaveBeenCalledWith('LOAN-9')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/attention-strip.test.tsx --config ./vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AttentionStrip`**

```tsx
// src/components/ServicingView/AttentionStrip.tsx
'use client'

import type { AttentionItem } from '@/lib/accountTriage'
import styles from './AttentionStrip.module.css'

export interface AttentionStripProps {
  items: AttentionItem[]
  onSelectAccount: (accountId: string) => void
}

const ICON: Record<AttentionItem['kind'], string> = {
  vulnerable: '⚠',
  overdue: '●',
  pending_disbursement: '⏳',
  writeoff_pending: '📝',
}

export const AttentionStrip: React.FC<AttentionStripProps> = ({ items, onSelectAccount }) => {
  if (items.length === 0) return null

  return (
    <div className={styles.strip} data-testid="attention-strip">
      <span className={styles.label}>NEEDS ATTENTION</span>
      {items.map((item) => {
        const clickable = item.accountId !== null
        return (
          <button
            key={`${item.kind}-${item.accountId ?? 'customer'}`}
            type="button"
            className={`${styles.chip} ${styles[item.kind]} ${clickable ? styles.clickable : ''}`}
            onClick={() => item.accountId && onSelectAccount(item.accountId)}
            disabled={!clickable}
            data-testid={`attention-chip-${item.kind}`}
          >
            <span aria-hidden>{ICON[item.kind]}</span> {item.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Create the strip stylesheet**

```css
/* src/components/ServicingView/AttentionStrip.module.css */
.strip { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 8px 2px 12px; }
.label { color: #8a93a0; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
.chip { border-radius: 13px; padding: 4px 11px; font-size: 12px; font-weight: 600; border: 1px solid transparent; }
.clickable { cursor: pointer; }
.vulnerable { background: #fdecea; color: #b4231a; border-color: #f0b8b1; font-weight: 700; }
.overdue { background: #fbeceb; color: #c0362c; border-color: #f1c4bf; }
.pending_disbursement { background: #fdf3e0; color: #b7791f; border-color: #f0dcae; }
.writeoff_pending { background: #eef2fb; color: #2f5bb0; border-color: #cdd9f0; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/attention-strip.test.tsx --config ./vitest.config.mts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ServicingView/AttentionStrip.tsx src/components/ServicingView/AttentionStrip.module.css tests/unit/ui/attention-strip.test.tsx
git commit -m "feat(servicing): add AttentionStrip (replaces vulnerable banner)"
```

---

## Task 7: `AccountSummaryBar` — sticky summary, IDs, actions

**Files:**
- Create: `src/components/ServicingView/AccountPanel/AccountSummaryBar.tsx`
- Test: `tests/unit/ui/account-summary-bar.test.tsx`

This component shows the account number (+ copy), the muted copyable `loanAccountId`, status + Live/Cached, total outstanding + next payment, and the action buttons (primary inline + `Waive fee` + `More ▾` menu) driven by `getAccountActions`. The aging badge stays in scope but is read via `useAccountAging`, so the test mocks that hook.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/ui/account-summary-bar.test.tsx
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

vi.mock('@/hooks/queries/useAccountAging', () => ({
  useAccountAging: () => ({ dpd: 0, bucket: 'current', isInArrears: false, isFallback: true, isLoading: false }),
}))

import { AccountSummaryBar } from '@/components/ServicingView/AccountPanel/AccountSummaryBar'

const account = (o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'a1', loanAccountId: 'e09a63be-9d43-4992-bdf2-216f6f4e5a1e', accountNumber: 'I9NWJ8XVXKJ3',
    accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: '2026-05-23', amount: 80 },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z', ...o,
  }) as LoanAccountData

const handlers = () => ({
  onRecordRepayment: vi.fn(), onWaiveFee: vi.fn(), onApplyLateFee: vi.fn(),
  onApplyDishonourFee: vi.fn(), onRequestWriteOff: vi.fn(), onDisburseLoan: vi.fn(),
  onRefresh: vi.fn(), onClose: vi.fn(),
})

describe('AccountSummaryBar', () => {
  beforeEach(() => { /* read-only store defaults to false */ })
  afterEach(() => cleanup())

  test('shows account number and total outstanding', () => {
    render(<AccountSummaryBar account={account()} hasPendingWriteOff={false} {...handlers()} />)
    expect(screen.getByText('I9NWJ8XVXKJ3')).toBeInTheDocument()
    expect(screen.getByText('$170.00')).toBeInTheDocument()
  })

  test('shows a truncated, copyable loanAccountId', () => {
    render(<AccountSummaryBar account={account()} hasPendingWriteOff={false} {...handlers()} />)
    // truncated form contains the start of the UUID
    expect(screen.getByText(/e09a63be/)).toBeInTheDocument()
  })

  test('record payment is the primary action for a live account and fires its handler', () => {
    const h = handlers()
    render(<AccountSummaryBar account={account()} hasPendingWriteOff={false} {...h} />)
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }))
    expect(h.onRecordRepayment).toHaveBeenCalled()
  })

  test('pending_disbursement shows Disburse loan as primary', () => {
    render(<AccountSummaryBar account={account({ accountStatus: 'pending_disbursement' })} hasPendingWriteOff={false} {...handlers()} />)
    expect(screen.getByRole('button', { name: /disburse loan/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/account-summary-bar.test.tsx --config ./vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AccountSummaryBar`**

```tsx
// src/components/ServicingView/AccountPanel/AccountSummaryBar.tsx
'use client'

import { useState } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useAccountAging } from '@/hooks/queries/useAccountAging'
import { useUIStore } from '@/stores/ui'
import { useOptimisticStore } from '@/stores/optimistic'
import { CopyButton } from '@/components/ui'
import { getStatusConfig } from '../account-status'
import { getAccountActions, type AccountAction } from '@/lib/getAccountActions'
import { getAccountSignal } from '@/lib/accountTriage'
import styles from './AccountSummaryBar.module.css'

export interface AccountSummaryBarProps {
  account: LoanAccountData
  hasPendingWriteOff: boolean
  onRecordRepayment: () => void
  onWaiveFee: () => void
  onApplyLateFee: () => void
  onApplyDishonourFee: () => void
  onRequestWriteOff: () => void
  onDisburseLoan: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
  onClose?: () => void
  showClose?: boolean
}

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)

export const AccountSummaryBar: React.FC<AccountSummaryBarProps> = (props) => {
  const { account, hasPendingWriteOff } = props
  const readOnly = useUIStore((s) => s.readOnlyMode)
  const hasPendingAction = useOptimisticStore((s) => s.hasPendingAction)
  const status = getStatusConfig(account.accountStatus)
  const signal = getAccountSignal(account)
  const [moreOpen, setMoreOpen] = useState(false)

  const isTerminal = account.accountStatus === 'paid_off' || account.accountStatus === 'written_off'
  const { isInArrears, bucket, isFallback } = useAccountAging({ accountId: account.loanAccountId, enabled: !isTerminal })
  const showAging = !isTerminal && !isFallback && (isInArrears || bucket !== 'current')

  const totalOutstanding = account.liveBalance?.totalOutstanding ?? account.balances?.totalOutstanding ?? 0
  const live = account.liveBalance !== null

  const actions = getAccountActions(account, {
    readOnly,
    hasPendingWriteOff,
    pendingRepayment: hasPendingAction(account.loanAccountId, 'record-repayment'),
    pendingWaive: hasPendingAction(account.loanAccountId, 'waive-fee'),
  })

  const handler: Record<AccountAction['id'], () => void> = {
    disburse: props.onDisburseLoan,
    'record-payment': props.onRecordRepayment,
    'waive-fee': props.onWaiveFee,
    'apply-late-fee': props.onApplyLateFee,
    'apply-dishonour-fee': props.onApplyDishonourFee,
    'request-write-off': props.onRequestWriteOff,
  }

  const visible = actions.filter((a) => a.visible)
  const primary = visible.find((a) => a.primary) ?? null
  const inline = visible.find((a) => a.id === 'waive-fee') ?? null
  const menu = visible.filter((a) => a !== primary && a !== inline)

  const Btn = (a: AccountAction, variant: 'primary' | 'secondary') => (
    <button
      key={a.id}
      type="button"
      className={`${styles.btn} ${variant === 'primary' ? styles.btnPrimary : styles.btnSecondary} ${a.danger ? styles.btnDanger : ''}`}
      onClick={handler[a.id]}
      disabled={!a.enabled}
      title={a.disabledReason ?? undefined}
      data-testid={`summary-action-${a.id}`}
    >
      {a.label}
    </button>
  )

  return (
    <div className={styles.bar} data-testid="account-summary-bar">
      <div className={styles.left}>
        <div className={styles.idRow}>
          <span className={styles.accountNumber}>{account.accountNumber}</span>
          <CopyButton value={account.accountNumber} label="Copy account number" />
          <span className={`${styles.status} ${styles[status.colorClass] ?? ''}`}>{status.label}</span>
          {showAging && <span className={styles.aging}>{signal.daysOverdue > 0 ? `${signal.daysOverdue}d overdue` : 'In arrears'}</span>}
          <span className={live ? styles.live : styles.cached}>{live ? 'Live' : 'Cached'}</span>
        </div>
        <div className={styles.subId}>
          ID {shortId(account.loanAccountId)} <CopyButton value={account.loanAccountId} label="Copy loan account ID" />
        </div>
        <div className={styles.figures}>
          <div>
            <div className={styles.figLabel}>Total outstanding</div>
            <div className={styles.figValue}>{currency.format(totalOutstanding)}</div>
          </div>
          {signal.nextDueDate && (
            <div>
              <div className={styles.figLabel}>Next payment</div>
              <div className={`${styles.figValue} ${signal.isOverdue ? styles.figOverdue : ''}`}>{currency.format(account.lastPayment?.amount ?? 0)}</div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.actions}>
          {primary && Btn(primary, 'primary')}
          {inline && Btn(inline, 'secondary')}
          {menu.length > 0 && (
            <div className={styles.menuWrap}>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setMoreOpen((v) => !v)} data-testid="summary-action-more" aria-expanded={moreOpen}>
                More ▾
              </button>
              {moreOpen && (
                <div className={styles.menu} role="menu">
                  {menu.map((a) => (
                    <button key={a.id} type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMoreOpen(false); handler[a.id]() }} disabled={!a.enabled} title={a.disabledReason ?? undefined} data-testid={`summary-action-${a.id}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {props.onRefresh && (
          <button type="button" className={styles.refresh} onClick={props.onRefresh} disabled={props.isRefreshing} aria-label="Refresh data" data-testid="refresh-account-data">⟳</button>
        )}
        {props.showClose && props.onClose && (
          <button type="button" className={styles.close} onClick={props.onClose} aria-label="Close account panel" data-testid="close-account-panel">✕</button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create the summary-bar stylesheet**

```css
/* src/components/ServicingView/AccountPanel/AccountSummaryBar.module.css */
.bar { display: flex; gap: 12px; align-items: flex-start; background: var(--theme-elevation-50, #fafbfc); border-bottom: 1px solid var(--theme-elevation-100, #eceef1); padding: 12px 14px; }
.left { flex: 1; min-width: 0; }
.idRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 2px; }
.accountNumber { font-family: ui-monospace, monospace; font-weight: 700; font-size: 15px; color: var(--theme-text, #1f2733); }
.subId { font-family: ui-monospace, monospace; font-size: 11px; color: #aab2bd; display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.status { border-radius: 11px; padding: 1px 9px; font-size: 11px; font-weight: 600; }
.aging { background: #fbeceb; color: #c0362c; border: 1px solid #f1c4bf; border-radius: 11px; padding: 1px 9px; font-size: 11px; font-weight: 600; }
.live { color: #14854f; font-size: 11px; font-weight: 600; }
.cached { color: #b7791f; font-size: 11px; font-weight: 600; }
.figures { display: flex; gap: 22px; }
.figLabel { color: #8a93a0; font-size: 11px; }
.figValue { font-weight: 700; font-size: 20px; color: var(--theme-text, #1f2733); }
.figOverdue { color: #c0362c; }
.right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.actions { display: flex; gap: 6px; align-items: center; }
.btn { border-radius: 6px; padding: 7px 13px; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btnPrimary { background: #2563eb; color: #fff; }
.btnSecondary { background: #fff; color: #374151; border-color: var(--theme-elevation-150, #d6dae1); }
.btnDanger { color: #c0362c; }
.menuWrap { position: relative; }
.menu { position: absolute; right: 0; top: calc(100% + 4px); background: #fff; border: 1px solid var(--theme-elevation-150, #d6dae1); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.12); padding: 4px; z-index: 20; min-width: 180px; }
.menuItem { display: block; width: 100%; text-align: left; padding: 8px 10px; font-size: 12.5px; border: none; background: none; border-radius: 5px; cursor: pointer; }
.menuItem:hover:not(:disabled) { background: var(--theme-elevation-50, #f4f5f7); }
.menuItem:disabled { opacity: 0.5; cursor: not-allowed; }
.refresh, .close { background: none; border: none; cursor: pointer; font-size: 14px; color: #6b7280; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/account-summary-bar.test.tsx --config ./vitest.config.mts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/ServicingView/AccountPanel/AccountSummaryBar.tsx src/components/ServicingView/AccountPanel/AccountSummaryBar.module.css tests/unit/ui/account-summary-bar.test.tsx
git commit -m "feat(servicing): add AccountSummaryBar with inline actions and colocated IDs"
```

> **Note on "Next payment":** the figure above reuses `lastPayment.amount` as a stand-in for the per-instalment amount, matching the data currently available on `LoanAccountData`. If a dedicated next-instalment amount is wanted, source it from `repaymentSchedule.payments` (the instalment whose `dueDate === signal.nextDueDate`) — a one-line follow-up, out of scope here.

---

## Task 8: `ContextPane` — tabbed Communications / Applications

**Files:**
- Create: `src/components/ServicingView/ContextPane.tsx`, `src/components/ServicingView/ContextPane.module.css`
- Test: `tests/unit/ui/context-pane.test.tsx`

`ContextPane` renders two tabs and shows `CommunicationsPanel` (default) or `ApplicationsPanel`. The child panels are mocked in the test so this task stays a pure layout unit.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/ui/context-pane.test.tsx
import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('@/components/ServicingView/Communications/CommunicationsPanel', () => ({
  CommunicationsPanel: () => <div data-testid="mock-comms" />,
}))
vi.mock('@/components/ServicingView/ApplicationsPanel', () => ({
  ApplicationsPanel: () => <div data-testid="mock-apps" />,
}))

import { ContextPane } from '@/components/ServicingView/ContextPane'

const props = {
  customerDocId: 'c1', customerBusinessId: 'CUST-1', customerName: 'Jane', selectedAccountId: null,
  accounts: [], onNavigateToAccount: () => {},
}

afterEach(() => cleanup())

describe('ContextPane', () => {
  test('shows Communications by default', () => {
    render(<ContextPane {...props} />)
    expect(screen.getByTestId('mock-comms')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-apps')).not.toBeInTheDocument()
  })

  test('switches to Applications when its tab is clicked', () => {
    render(<ContextPane {...props} />)
    fireEvent.click(screen.getByRole('tab', { name: /applications/i }))
    expect(screen.getByTestId('mock-apps')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/context-pane.test.tsx --config ./vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ContextPane`**

```tsx
// src/components/ServicingView/ContextPane.tsx
'use client'

import { useState } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { CommunicationsPanel } from './Communications/CommunicationsPanel'
import { ApplicationsPanel } from './ApplicationsPanel'
import styles from './ContextPane.module.css'

export interface ContextPaneProps {
  customerDocId: string
  customerBusinessId: string
  customerName?: string
  selectedAccountId: string | null
  accounts: LoanAccountData[]
  onNavigateToAccount: (accountId: string) => void
}

type ContextTab = 'communications' | 'applications'

export const ContextPane: React.FC<ContextPaneProps> = (props) => {
  const [tab, setTab] = useState<ContextTab>('communications')

  return (
    <div className={styles.pane} data-testid="context-pane">
      <div className={styles.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'communications'} className={`${styles.tab} ${tab === 'communications' ? styles.tabActive : ''}`} onClick={() => setTab('communications')}>
          Communications
        </button>
        <button type="button" role="tab" aria-selected={tab === 'applications'} className={`${styles.tab} ${tab === 'applications' ? styles.tabActive : ''}`} onClick={() => setTab('applications')}>
          Applications
        </button>
      </div>
      <div className={styles.body}>
        {tab === 'communications' ? (
          <CommunicationsPanel
            customerDocId={props.customerDocId}
            customerBusinessId={props.customerBusinessId}
            customerName={props.customerName}
            selectedAccountId={props.selectedAccountId}
            accounts={props.accounts}
            onNavigateToAccount={props.onNavigateToAccount}
          />
        ) : (
          <ApplicationsPanel customerIdString={props.customerBusinessId} />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create the context-pane stylesheet**

```css
/* src/components/ServicingView/ContextPane.module.css */
.pane { background: var(--theme-elevation-0, #fff); border: 1px solid var(--theme-elevation-150, #e3e6eb); border-radius: 8px; height: 100%; display: flex; flex-direction: column; overflow: hidden; box-sizing: border-box; }
.tabs { display: flex; border-bottom: 1px solid var(--theme-elevation-100, #eceef1); }
.tab { flex: 1; padding: 9px; font-size: 12.5px; color: #6b7280; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; }
.tabActive { color: #2563eb; font-weight: 600; border-bottom-color: #2563eb; }
.body { flex: 1; overflow-y: auto; padding: 10px; }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/context-pane.test.tsx --config ./vitest.config.mts`
Expected: PASS (2 tests).

> If `CommunicationsPanel`/`ApplicationsPanel` prop names differ from those above, align `ContextPane`'s passthrough to the real props (confirm against `Communications/CommunicationsPanel.tsx` and `ApplicationsPanel/index.tsx`). The `ServicingView` wiring in Task 11 already passes these exact props today.

- [ ] **Step 6: Commit**

```bash
git add src/components/ServicingView/ContextPane.tsx src/components/ServicingView/ContextPane.module.css tests/unit/ui/context-pane.test.tsx
git commit -m "feat(servicing): add tabbed ContextPane (communications/applications)"
```

---

## Task 9: Reflow `OverviewTab` into a card grid

**Files:**
- Modify: `src/components/ServicingView/AccountPanel/OverviewTab.tsx`
- Create: `tests/unit/ui/overview-tab.test.tsx`

Keep every field and `RepaymentScheduleList`; remove the bottom "Loan Account ID" section (now in the summary bar); wrap content in a 2-column card grid.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/ui/overview-tab.test.tsx
import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/hooks/queries/useCarryingAmountBreakdown', () => ({
  useCarryingAmountBreakdown: () => ({ breakdown: null }),
}))

import { OverviewTab } from '@/components/ServicingView/AccountPanel/OverviewTab'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const account = (): LoanAccountData =>
  ({
    id: 'a1', loanAccountId: 'e09a63be-9d43-4992-bdf2-216f6f4e5a1e', accountNumber: 'I9NWJ8XVXKJ3', accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: '2026-05-23', amount: 80 },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z',
  }) as LoanAccountData

afterEach(() => cleanup())

describe('OverviewTab', () => {
  test('renders balance figures', () => {
    render(<OverviewTab account={account()} />)
    expect(screen.getByText('$170.00')).toBeInTheDocument()
    expect(screen.getByText('$160.00')).toBeInTheDocument()
  })

  test('does NOT render a "Loan Account ID" section (moved to summary bar)', () => {
    render(<OverviewTab account={account()} />)
    expect(screen.queryByText(/Loan Account ID/i)).not.toBeInTheDocument()
  })

  test('renders loan terms', () => {
    render(<OverviewTab account={account()} />)
    expect(screen.getByText('$480.00')).toBeInTheDocument() // total payable
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/overview-tab.test.tsx --config ./vitest.config.mts`
Expected: FAIL — current `OverviewTab` still renders the "Loan Account ID" section.

- [ ] **Step 3: Edit `OverviewTab.tsx`**

Remove the final "Loan ID" section (the block rendering `Loan Account ID` + `CopyButton`, lines ~213–222 of the current file) and its now-unused `CopyButton` import. Wrap the Balance + Repayment-progress in a row and Loan-terms + Documents in a row using a new grid class. Minimal structural change — keep all existing inner markup and the `RepaymentScheduleList` usage. Add to `AccountPanel/styles.module.css`:

```css
/* AccountPanel/styles.module.css — append */
.overviewGridTwo { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.overviewGridTwo > * { flex: 1 1 260px; }
```

Wrap the **Current Balance** section and the **Repayment Schedule** summary/last-payment region in a `<div className={styles.overviewGridTwo}>…</div>`, and likewise group **Loan Terms** with the **Loan agreement** link. Concretely, in `OverviewTab.tsx`:
- Delete the JSX block starting `{/* Loan ID */}` through its closing `</div>` (the last section before the component's outer closing tag).
- Delete `import { CopyButton } from '@/components/ui'` (no longer used).
- Surround the existing "Balance Section" and "Last Payment" sections with one `overviewGridTwo` wrapper, and the "Loan Terms" + "Loan agreement" sections with another, so they sit side-by-side. Leave the full-width "Repayment Schedule" section between them as-is.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/overview-tab.test.tsx --config ./vitest.config.mts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing schedule test to confirm no regression**

Run: `pnpm exec vitest run tests/unit/ui/repayment-schedule-list.test.tsx --config ./vitest.config.mts`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/components/ServicingView/AccountPanel/OverviewTab.tsx src/components/ServicingView/AccountPanel/styles.module.css tests/unit/ui/overview-tab.test.tsx
git commit -m "refactor(servicing): reflow OverviewTab into card grid; drop bottom ID row"
```

---

## Task 10: Drive `ActionsTab` from `getAccountActions`

**Files:**
- Modify: `src/components/ServicingView/AccountPanel/ActionsTab.tsx`
- Create: `tests/unit/ui/actions-tab.test.tsx`

Render one card per `getAccountActions()` entry that is `visible`, keep the existing descriptions/amounts, and wire `onClick` to the matching handler. Preserves today's behaviour plus the pending-disbursement gating.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/ui/actions-tab.test.tsx
import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ActionsTab } from '@/components/ServicingView/AccountPanel/ActionsTab'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const account = (o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'a1', loanAccountId: 'LOAN-1', accountNumber: 'ACC-1', accountStatus: 'active',
    loanTerms: { loanAmount: 400, loanFee: 80, totalPayable: 480, openedDate: '2026-03-14' },
    balances: { currentBalance: 160, totalOutstanding: 170, totalPaid: 320 },
    liveBalance: { principalBalance: 160, feeBalance: 10, totalOutstanding: 170, asOf: '2026-06-09T00:00:00Z' },
    lastPayment: { date: null, amount: null },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 6, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-03-14T00:00:00Z', updatedAt: '2026-06-09T00:00:00Z', ...o,
  }) as LoanAccountData

const h = () => ({
  onRecordRepayment: vi.fn(), onWaiveFee: vi.fn(), onApplyLateFee: vi.fn(),
  onApplyDishonourFee: vi.fn(), onRequestWriteOff: vi.fn(), onDisburseLoan: vi.fn(),
})

afterEach(() => cleanup())

describe('ActionsTab', () => {
  test('live account: record-payment enabled, no disburse card', () => {
    render(<ActionsTab account={account()} hasPendingWriteOff={false} {...h()} />)
    expect(screen.getByTestId('action-record-repayment')).toBeEnabled()
    expect(screen.queryByTestId('action-disburse-loan')).not.toBeInTheDocument()
  })

  test('pending_disbursement: disburse present, record-payment disabled', () => {
    render(<ActionsTab account={account({ accountStatus: 'pending_disbursement' })} hasPendingWriteOff={false} {...h()} />)
    expect(screen.getByTestId('action-disburse-loan')).toBeEnabled()
    expect(screen.getByTestId('action-record-repayment')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/actions-tab.test.tsx --config ./vitest.config.mts`
Expected: FAIL — today's `ActionsTab` does not disable record-payment for pending accounts (second test fails).

- [ ] **Step 3: Refactor `ActionsTab.tsx`**

Replace the per-card conditional logic with a data-driven render. Keep the component's existing props, the read-only banner, the `data-testid`s, and the descriptions. Body:

```tsx
'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useUIStore } from '@/stores/ui'
import { useOptimisticStore } from '@/stores/optimistic'
import { getAccountActions, type AccountActionId } from '@/lib/getAccountActions'
import styles from './styles.module.css'

export interface ActionsTabProps {
  account: LoanAccountData
  onRecordRepayment: () => void
  onWaiveFee: () => void
  onApplyLateFee: () => void
  onApplyDishonourFee: () => void
  onRequestWriteOff?: () => void
  onDisburseLoan?: () => void
  hasPendingWriteOff?: boolean
}

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

const COPY: Record<AccountActionId, { icon: string; description: string }> = {
  disburse: { icon: '🏦', description: 'Record disbursement of funds to the customer. This transitions the account to active and begins the repayment schedule.' },
  'record-payment': { icon: '💳', description: 'Record a manual repayment for this account. Use this for payments received outside of automatic debit.' },
  'waive-fee': { icon: '🎁', description: 'Waive outstanding fees for this account as a goodwill gesture or to resolve a dispute.' },
  'apply-late-fee': { icon: '⏰', description: 'Apply a late fee for missed or overdue payments on this account.' },
  'apply-dishonour-fee': { icon: '🔄', description: 'Apply a dishonour fee for a failed direct debit on this account.' },
  'request-write-off': { icon: '📝', description: 'Submit a write-off request for this account. Requires approval from a supervisor.' },
}

export const ActionsTab: React.FC<ActionsTabProps> = (props) => {
  const { account, hasPendingWriteOff = false } = props
  const readOnly = useUIStore((s) => s.readOnlyMode)
  const hasPendingAction = useOptimisticStore((s) => s.hasPendingAction)

  const handler: Record<AccountActionId, (() => void) | undefined> = {
    disburse: props.onDisburseLoan,
    'record-payment': props.onRecordRepayment,
    'waive-fee': props.onWaiveFee,
    'apply-late-fee': props.onApplyLateFee,
    'apply-dishonour-fee': props.onApplyDishonourFee,
    'request-write-off': props.onRequestWriteOff,
  }
  const testId: Record<AccountActionId, string> = {
    disburse: 'action-disburse-loan',
    'record-payment': 'action-record-repayment',
    'waive-fee': 'action-waive-fee',
    'apply-late-fee': 'action-apply-late-fee',
    'apply-dishonour-fee': 'action-apply-dishonour-fee',
    'request-write-off': 'action-request-writeoff',
  }

  const actions = getAccountActions(account, {
    readOnly,
    hasPendingWriteOff,
    pendingRepayment: hasPendingAction(account.loanAccountId, 'record-repayment'),
    pendingWaive: hasPendingAction(account.loanAccountId, 'waive-fee'),
  }).filter((a) => a.visible && handler[a.id])

  const totalOutstanding = account.liveBalance?.totalOutstanding ?? account.balances?.totalOutstanding ?? 0

  return (
    <div className={styles.actionsTab} role="tabpanel" id="tabpanel-actions" aria-labelledby="tab-actions" data-testid="actions-tab">
      <h4 className={styles.actionsTitle}>Available Actions</h4>
      {readOnly && (
        <div className={styles.actionsReadOnlyWarning} role="alert">
          <span className={styles.actionsWarningIcon}>🔒</span>
          <span>System is in read-only mode. Actions are temporarily disabled.</span>
        </div>
      )}
      {actions.map((a) => (
        <div className={styles.actionCard} key={a.id}>
          <div className={styles.actionCardHeader}>
            <span className={styles.actionCardIcon}>{COPY[a.id].icon}</span>
            <span className={styles.actionCardTitle}>{a.label}</span>
            {a.id === 'request-write-off' && hasPendingWriteOff && <span className={styles.actionCardBadge}>Pending</span>}
          </div>
          <p className={styles.actionCardDescription}>{COPY[a.id].description}</p>
          <div className={styles.actionCardFooter}>
            <span className={styles.actionCardMeta}>{currency.format(totalOutstanding)}</span>
            <button
              type="button"
              className={`${styles.actionCardBtn} ${a.primary ? styles.actionCardBtnPrimary : ''} ${a.danger ? styles.actionCardBtnDanger : ''}`}
              onClick={handler[a.id]}
              disabled={!a.enabled}
              title={a.disabledReason ?? undefined}
              data-testid={testId[a.id]}
            >
              {a.label}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/actions-tab.test.tsx --config ./vitest.config.mts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ServicingView/AccountPanel/ActionsTab.tsx tests/unit/ui/actions-tab.test.tsx
git commit -m "refactor(servicing): drive ActionsTab from getAccountActions"
```

---

## Task 11: Use `AccountSummaryBar` + drop `AccountSwitcher` in `AccountPanel`

**Files:**
- Modify: `src/components/ServicingView/AccountPanel/AccountPanel.tsx`

- [ ] **Step 1: Swap header and remove switcher**

In `AccountPanel.tsx`:
- Replace the `import { AccountHeader } from './AccountHeader'` with `import { AccountSummaryBar } from './AccountSummaryBar'`.
- Remove `import { AccountSwitcher } from './AccountSwitcher'` and the `otherAccounts` `useMemo` and the trailing `{otherAccounts.length > 0 && (<AccountSwitcher … />)}` block.
- Replace the `<AccountHeader … />` element with:

```tsx
<AccountSummaryBar
  account={account}
  hasPendingWriteOff={hasPendingWriteOff ?? false}
  onRecordRepayment={onRecordRepayment}
  onWaiveFee={onWaiveFee}
  onApplyLateFee={onApplyLateFee}
  onApplyDishonourFee={onApplyDishonourFee}
  onRequestWriteOff={onRequestWriteOff ?? (() => {})}
  onDisburseLoan={onDisburseLoan ?? (() => {})}
  onRefresh={onRefresh}
  isRefreshing={isRefreshing}
  onClose={onClose}
  showClose={showClose}
/>
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `AccountPanel.tsx` (unused `AccountHeader`/`AccountSwitcher`/`otherAccounts` removed).

- [ ] **Step 3: Commit**

```bash
git add src/components/ServicingView/AccountPanel/AccountPanel.tsx
git commit -m "refactor(servicing): AccountPanel uses AccountSummaryBar, drops in-panel switcher"
```

---

## Task 12: Restructure `ServicingView` into the three-pane grid

**Files:**
- Modify: `src/components/ServicingView/ServicingView.tsx`
- Create: `tests/unit/ui/servicing-view-layout.test.tsx`

- [ ] **Step 1: Write the failing test (mock data hooks)**

```tsx
// tests/unit/ui/servicing-view-layout.test.tsx
import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const acc = (id: string, o: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id, loanAccountId: id, accountNumber: id, accountStatus: 'active',
    loanTerms: { loanAmount: 0, loanFee: 0, totalPayable: 0, openedDate: null },
    balances: { currentBalance: 0, totalOutstanding: 0, totalPaid: 0 },
    liveBalance: null, lastPayment: { date: null, amount: null },
    repaymentSchedule: { scheduleId: 's', numberOfPayments: 0, paymentFrequency: 'fortnightly', payments: [], createdDate: null },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
  }) as LoanAccountData

const customer = {
  id: 'doc1', customerId: 'CUST-1', fullName: 'Jane Doe', vulnerableFlag: false,
  loanAccounts: [acc('over', { accountStatus: 'in_arrears' }), acc('paid', { accountStatus: 'paid_off' })],
}

vi.mock('@/hooks/queries/useCustomer', () => ({
  useCustomer: () => ({ data: customer, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
}))
vi.mock('@/hooks/queries/useFeesCount', () => ({ useFeesCount: () => 0 }))
vi.mock('@/hooks/queries/usePendingWriteOff', () => ({ usePendingWriteOff: () => ({ data: null, isError: false }) }))
vi.mock('@/hooks/useTrackCustomerView', () => ({ useTrackCustomerView: () => {} }))
vi.mock('@/hooks/queries/useAccountAging', () => ({ useAccountAging: () => ({ dpd: 0, bucket: 'current', isInArrears: false, isFallback: true, isLoading: false }) }))
vi.mock('@/components/ServicingView/Communications/CommunicationsPanel', () => ({ CommunicationsPanel: () => <div data-testid="mock-comms" /> }))
vi.mock('@/components/ServicingView/ApplicationsPanel', () => ({ ApplicationsPanel: () => <div data-testid="mock-apps" /> }))

import { ServicingView } from '@/components/ServicingView/ServicingView'

afterEach(() => cleanup())

describe('ServicingView cockpit layout', () => {
  test('renders rail, attention strip, detail and context panes', () => {
    render(<ServicingView customerId="CUST-1" />)
    expect(screen.getByTestId('account-rail')).toBeInTheDocument()
    expect(screen.getByTestId('attention-strip')).toBeInTheDocument()
    expect(screen.getByTestId('context-pane')).toBeInTheDocument()
  })

  test('auto-selects the top-triaged (in-arrears) account, populating the summary bar', () => {
    render(<ServicingView customerId="CUST-1" />)
    expect(screen.getByTestId('account-summary-bar')).toBeInTheDocument()
    expect(screen.getByText('over')).toBeInTheDocument() // selected account number in summary
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/servicing-view-layout.test.tsx --config ./vitest.config.mts`
Expected: FAIL — no `account-rail`/`attention-strip`/`context-pane` test ids yet.

- [ ] **Step 3: Edit `ServicingView.tsx`**

Make these changes (preserve all existing hooks, handlers, drawer state, and the loading/error branches):

1. Replace imports: remove `VulnerableCustomerBanner`, `LoanAccountCard`; add
   ```tsx
   import { AccountRail } from './AccountRail'
   import { AttentionStrip } from './AttentionStrip'
   import { ContextPane } from './ContextPane'
   import { getAttentionItems, sortAccountsForRail } from '@/lib/accountTriage'
   ```
2. Delete the inline `LoanAccountsList` and `AccountSelectionPrompt` components (the rail and the auto-select replace them).
3. Update auto-select: replace the existing "auto-select if only one account" effect body so that, when no `?accountId=` param applies and nothing is selected, it selects the top-triaged account:
   ```tsx
   if (!selectedAccountId && accounts.length > 0) {
     const { active, closed } = sortAccountsForRail(accounts)
     const top = active[0] ?? closed[0]
     if (top) setSelectedAccountId(top.loanAccountId)
   }
   ```
   (Keep the `?accountId=` URL handling above it exactly as-is.)
4. Compute attention items near the other derived values:
   ```tsx
   const attentionItems = useMemo(
     () => getAttentionItems({
       vulnerable: customer?.vulnerableFlag ?? false,
       accounts,
       pendingWriteOffAccountIds: selectedAccountId && hasPendingWriteOff ? [selectedAccountId] : [],
     }),
     [customer?.vulnerableFlag, accounts, selectedAccountId, hasPendingWriteOff],
   )
   ```
5. Replace the data-loaded `return (...)` body's `<div className={styles.content}>…</div>` with the three-pane grid:
   ```tsx
   <AttentionStrip items={attentionItems} onSelectAccount={handleSwitchAccount} />
   <div className={styles.cockpit}>
     <div className={styles.railCol}>
       <AccountRail accounts={accounts} selectedAccountId={selectedAccountId} onSelectAccount={handleSelectAccount} />
     </div>
     <div className={styles.detailCol}>
       {selectedAccount ? (
         <AccountPanel
           account={selectedAccount}
           allAccounts={accounts}
           activeTab={activeTab}
           onTabChange={handleTabChange}
           onClose={handleClosePanel}
           onSwitchAccount={handleSwitchAccount}
           onWaiveFee={handleOpenWaiveFee}
           onRecordRepayment={handleOpenRecordRepayment}
           onApplyLateFee={handleOpenApplyLateFee}
           onApplyDishonourFee={handleOpenApplyDishonourFee}
           onBulkWaive={handleBulkWaive}
           feesCount={feesCount}
           onRefresh={handleRefresh}
           isRefreshing={isFetchingData}
           onRequestWriteOff={handleOpenWriteOff}
           hasPendingWriteOff={hasPendingWriteOff}
           onDisburseLoan={handleOpenDisburseLoan}
         />
       ) : (
         <div className={styles.detailEmpty}>Select an account from the list.</div>
       )}
     </div>
     <div className={styles.contextCol}>
       <ContextPane
         customerDocId={customer?.id ?? ''}
         customerBusinessId={customerId}
         customerName={customer?.fullName ?? undefined}
         selectedAccountId={selectedAccountId}
         accounts={accounts}
         onNavigateToAccount={handleSwitchAccount}
       />
     </div>
   </div>
   ```
   Keep all the drawer JSX (`WaiveFeeDrawer` … `DisburseLoanDrawer`) exactly as-is, after this grid.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/servicing-view-layout.test.tsx --config ./vitest.config.mts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ServicingView/ServicingView.tsx tests/unit/ui/servicing-view-layout.test.tsx
git commit -m "feat(servicing): restructure ServicingView into three-pane cockpit"
```

---

## Task 13: Cockpit layout CSS + responsive

**Files:**
- Modify: `src/components/ServicingView/styles.module.css`

- [ ] **Step 1: Add the grid + responsive rules**

Append to `styles.module.css` (and widen the container — change the existing `.container { max-width: 1200px }` to `max-width: 1920px`):

```css
.cockpit {
  display: grid;
  grid-template-columns: 232px minmax(380px, 1fr) 308px;
  gap: 12px;
  align-items: start;
}
.railCol { position: sticky; top: 12px; }
.detailCol { min-width: 0; }
.detailEmpty { background: var(--theme-elevation-0, #fff); border: 1px solid var(--theme-elevation-150, #e3e6eb); border-radius: 8px; padding: 40px; text-align: center; color: #8a93a0; }
.contextCol { position: sticky; top: 12px; max-height: calc(100vh - 120px); }

/* 1100–1440: drop the context column (revealed via a toggle/overlay) */
@media (max-width: 1440px) {
  .cockpit { grid-template-columns: 220px minmax(360px, 1fr); }
  .contextCol { display: none; }
}
/* <1100: stack rail above detail */
@media (max-width: 1100px) {
  .cockpit { grid-template-columns: 1fr; }
  .railCol { position: static; }
}
```

> The 1100–1440 "context as overlay toggle" affordance is deferred to Task 14; this step makes the layout responsive (context hidden) so nothing breaks at narrow widths in the meantime.

- [ ] **Step 2: Verify the app builds**

Run: `pnpm build`
Expected: build succeeds (Next.js compiles; no TS/CSS-module errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/ServicingView/styles.module.css
git commit -m "feat(servicing): three-pane cockpit grid with responsive collapse"
```

---

## Task 14: Context-pane toggle for mid-width screens

**Files:**
- Modify: `src/components/ServicingView/ServicingView.tsx`, `src/components/ServicingView/styles.module.css`

- [ ] **Step 1: Add a context toggle visible only 1100–1440**

In `ServicingView.tsx`, add `const [contextOpen, setContextOpen] = useState(false)`. Wrap `.contextCol` so that, at mid width, it renders as a slide-over when `contextOpen`, and add a toggle button in the detail column header area:

```tsx
<button type="button" className={styles.contextToggle} onClick={() => setContextOpen((v) => !v)} data-testid="context-toggle">
  💬 Communications
</button>
```
Give `.contextCol` an additional class `${contextOpen ? styles.contextOpen : ''}`.

Add CSS:
```css
.contextToggle { display: none; }
@media (max-width: 1440px) and (min-width: 1101px) {
  .contextToggle { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 8px; border: 1px solid var(--theme-elevation-150, #d6dae1); border-radius: 6px; padding: 6px 10px; background: #fff; cursor: pointer; }
  .contextOpen { display: block !important; position: fixed; right: 16px; top: 80px; bottom: 16px; width: 340px; z-index: 50; box-shadow: 0 8px 30px rgba(0,0,0,.18); }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ServicingView/ServicingView.tsx src/components/ServicingView/styles.module.css
git commit -m "feat(servicing): context-pane slide-over toggle for mid-width screens"
```

---

## Task 15: Delete dead components + fix keyboard hint

**Files:**
- Delete: `src/components/ServicingView/AccountPanel/AccountSwitcher.tsx`
- Delete: `src/components/ServicingView/VulnerableCustomerBanner.tsx`
- Modify: `src/components/ServicingView/AccountPanel/AccountTabs.tsx`

- [ ] **Step 1: Confirm there are no remaining importers**

Run:
```bash
grep -rn "AccountSwitcher\|VulnerableCustomerBanner" src tests
```
Expected: no matches (Tasks 11 and 12 removed the usages). If any test file references them, delete that test file in this step.

- [ ] **Step 2: Delete the files**

Run:
```bash
git rm src/components/ServicingView/AccountPanel/AccountSwitcher.tsx \
       src/components/ServicingView/AccountPanel/AccountSwitcher.module.css \
       src/components/ServicingView/VulnerableCustomerBanner.tsx \
       src/components/ServicingView/VulnerableCustomerBanner.module.css 2>/dev/null; true
```
(If a `.module.css` peer does not exist, the `git rm` for it is a no-op; that's fine.)

- [ ] **Step 3: Fix the keyboard hint**

In `AccountTabs.tsx`, find the keyboard-hint text that reads `1`–`4` and change it to `1`–`6` (six tabs exist: Overview, Transactions, Fees, Accruals, ECL, Actions).

- [ ] **Step 4: Type-check + run the full unit suite**

Run: `pnpm exec tsc --noEmit -p tsconfig.json && pnpm test:int`
Expected: no type errors; all unit/integration tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(servicing): remove AccountSwitcher + VulnerableCustomerBanner; fix tab hint to 1-6"
```

---

## Task 16: E2E — cockpit selection, keyboard, and payment→transaction link

**Files:**
- Create: `tests/e2e/servicing-cockpit.spec.ts`

> E2E requires a seeded customer with ≥2 accounts. Reuse the existing e2e auth/setup helpers in `tests/e2e/helpers` and the customer the current `tests/e2e` suite uses. If the current suite uses a fixed customer id, reuse it here.

- [ ] **Step 1: Write the e2e spec**

```ts
// tests/e2e/servicing-cockpit.spec.ts
import { test, expect } from '@playwright/test'

// Replace CUSTOMER_ID with the seeded multi-account customer used by the existing e2e suite.
const CUSTOMER_ID = process.env.E2E_SERVICING_CUSTOMER_ID ?? 'B6F9D06B'

test.describe('Servicing cockpit', () => {
  test('shows the three panes and auto-selects an account', async ({ page }) => {
    await page.goto(`/admin/servicing/${CUSTOMER_ID}`)
    await expect(page.getByTestId('account-rail')).toBeVisible()
    await expect(page.getByTestId('context-pane')).toBeVisible()
    await expect(page.getByTestId('account-summary-bar')).toBeVisible()
  })

  test('keyboard 2 switches to Transactions tab', async ({ page }) => {
    await page.goto(`/admin/servicing/${CUSTOMER_ID}`)
    await expect(page.getByTestId('account-summary-bar')).toBeVisible()
    await page.keyboard.press('2')
    await expect(page.getByTestId('transactions-tab')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm exec playwright test tests/e2e/servicing-cockpit.spec.ts`
Expected: PASS. If the seeded customer id differs, set `E2E_SERVICING_CUSTOMER_ID` and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/servicing-cockpit.spec.ts
git commit -m "test(servicing): e2e cockpit panes + keyboard nav"
```

---

## Task 17: Full verification

- [ ] **Step 1: Lint, type-check, unit/int, build**

Run:
```bash
pnpm lint && pnpm exec tsc --noEmit -p tsconfig.json && pnpm test:int && pnpm build
```
Expected: all green.

- [ ] **Step 2: Manual smoke (dev server)**

Run `pnpm dev`, open `/admin/servicing/<a multi-account customer>`, and confirm against the spec §14 checklist:
- three panes visible ≥1440; top-triaged account auto-selected; attention chips present and click-to-select;
- summary-bar actions correct per status (pending → Disburse primary, money actions disabled);
- Overview is a card grid with no bottom "Loan Account ID"; the loanAccountId is copyable in the summary bar;
- a repayment row expands and its transaction chip jumps to the Transactions tab;
- read-only mode disables all actions; narrowing the window collapses the context pane then stacks the rail.

- [ ] **Step 3: Open a PR (when the user asks)**

```bash
git push -u origin feature/servicing-cockpit-redesign
gh pr create --fill --base main
```

---

## Self-review (completed by plan author)

- **Spec coverage:** §3 layout → Tasks 12–14; §5 components → Tasks 4–8, 11; §7 actions → Tasks 2, 7, 10; §8 triage/selection → Tasks 3, 12; §9 behaviours → Tasks 12–14 (+ preserved hotkeys via existing `useAccountPanelHotkeys`); §10 Overview → Task 9; §11 identifiers → Task 7; §13 testing → Tasks 2–12, 16; §14 changes → Tasks 4,7,10,12,15. No uncovered spec section.
- **Placeholder scan:** no "TBD/TODO/handle edge cases" in steps; the two "Note"/"deferred" callouts are explicit scope decisions, not missing code.
- **Type consistency:** `getAccountSignal`/`sortAccountsForRail`/`getAttentionItems`/`AttentionItem` (Task 3) and `getAccountActions`/`AccountAction`/`AccountActionId`/`AccountActionContext` (Task 2) are used with identical names/signatures in Tasks 4–12. `data-testid`s (`action-record-repayment`, etc.) match the existing values so any existing tests keep passing.
