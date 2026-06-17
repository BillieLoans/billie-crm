# Disbursement Cut-off Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ops staff a time-based view of pending disbursements — clearly separating loans that *must* be disbursed before today's 3pm AEST cut-off, loans that have *missed* their window, and loans *scheduled* for a future day — on both the dashboard and the disbursement queue.

**Architecture:** The CRM does **not** re-derive the cut-off. billieChat computes the authoritative loan start date (3pm + public-holiday logic) and the CRM buckets pending loans by that date (`commencementDate`) against "today" in `Australia/Sydney`. All read paths go through one accessor (`getCommencementDate`) and one classifier (`classifyBucket`), so the data source (existing `openedDate` vs a future ingested field) is swappable in one place. UI is built in two altitudes: a dashboard triage band (glance + live countdown) deep-linking into a rebuilt three-section queue (the work surface).

**Tech Stack:** Payload CMS v3 / Next.js 15, React + TanStack Query, Zod v4, CSS modules, vitest (+ Testcontainers for int), Python event-processor (asyncpg) — only if the ingestion path is needed.

**Source design:** `docs/superpowers/specs/2026-06-17-disbursement-cutoff-triage-design.md`. Approved visual mockups persist in `.superpowers/brainstorm/81350-1781677926/content/` (`dashboard-directions.html`, `queue-page.html`, `early-disburse-warning.html`) — these are the source of truth for exact colours/spacing.

---

## File Structure

**New**
- `src/lib/disbursement-cutoff.ts` — timezone + bucket logic (pure functions). Single home for cut-off rules.
- `tests/unit/disbursement-cutoff.test.ts` — unit tests for the above.
- `src/components/DashboardView/CutoffCountdown.tsx` (+ `.module.css`) — live "Xh Ym to 3pm" countdown chip, shared by dashboard + queue.
- `src/components/DashboardView/DisbursementTriagePanel.tsx` (+ `.module.css`) — Direction A band.
- `src/components/PendingDisbursementsView/DisbursementSection.tsx` (+ `.module.css`) — one collapsible bucket section.
- `src/components/PendingDisbursementsView/EarlyDisburseWarningModal.tsx` (+ `.module.css`) — early-disburse guard.
- `tests/unit/ui/disbursement-triage-panel.test.tsx`, `tests/unit/ui/early-disburse-warning.test.tsx`.

**Modify**
- `src/lib/schemas/dashboard.ts` — add `commencementDate`/`bucket` to `PendingDisbursementSchema`; add `disbursementBuckets` to `DashboardResponseSchema`.
- `src/app/api/dashboard/route.ts` — classify pending loans, return per-bucket counts/totals + today done/total; refactor TZ helpers to import from the new util.
- `src/app/api/pending-disbursements/route.ts` — return `commencementDate` + `bucket`; accept `?bucket=` filter.
- `src/components/DashboardView/index.tsx` — render `DisbursementTriagePanel` at top; remove `DisbursementsHeroTile` usage.
- `src/components/PendingDisbursementsView/PendingDisbursementsView.tsx` — render three `DisbursementSection`s + wire the guard.

**Conditional (Phase 5 — only if Phase 0 fails)**
- `src/collections/LoanAccounts.ts` + a new migration — add `commencementDate` column.
- `event-processor/src/billie_servicing/handlers/account.py` (or a new handler) — ingest `loan_execution_plan_created`.

---

## Phase 0 — Data prerequisite verification (gates everything)

### Task 0: Confirm the source of `commencementDate`

**Files:** none (investigation). Record the outcome at the top of the spec under a new "Data source: DECIDED" line.

- [ ] **Step 1: Run the read-only query against an environment with real loan data (demo).**

Use the demo `DATABASE_URI` (do NOT run against prod without explicit approval). Query:

```sql
SELECT
  account_number,
  account_status,
  loan_terms_opened_date,
  created_at,
  -- Sydney-local clock time of opened_date:
  to_char(loan_terms_opened_date AT TIME ZONE 'Australia/Sydney', 'YYYY-MM-DD HH24:MI Dy') AS opened_syd,
  extract(isodow from (loan_terms_opened_date AT TIME ZONE 'Australia/Sydney')) AS opened_dow
FROM loan_accounts
WHERE loan_terms_opened_date IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;
```

- [ ] **Step 2: Decide.**

`opened_date` **is** the commencement date if: it always lands on a business day (`opened_dow` 1–5, not a public holiday), the Sydney clock time is consistent with a *start date* rather than a random signing instant, and same-day loans never show a time after 15:00. If so → **use `openedDate`** (no migration, no Python). Otherwise → **Phase 5 required** (ingest `loan_execution_plan_created`).

- [ ] **Step 3: Record the decision** in the spec ("Data source: openedDate" or "Data source: ingested commencementDate") so later tasks know whether Phase 5 runs. The accessor in Task 1 supports both with no other code changes.

---

## Phase 1 — Cut-off logic (pure, fully tested)

### Task 1: `disbursement-cutoff.ts` util

**Files:**
- Create: `src/lib/disbursement-cutoff.ts`
- Test: `tests/unit/disbursement-cutoff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/disbursement-cutoff.test.ts
import { describe, it, expect } from 'vitest'
import {
  sydneyDateString,
  classifyBucket,
  cutoffInstant,
  msUntilCutoff,
  formatCountdown,
  getCommencementDate,
} from '@/lib/disbursement-cutoff'

describe('sydneyDateString', () => {
  it('rolls a late-UTC instant into the correct Sydney calendar day', () => {
    // 2026-06-17T22:00:00Z is 2026-06-18 08:00 AEST
    expect(sydneyDateString(new Date('2026-06-17T22:00:00Z'))).toBe('2026-06-18')
  })
})

describe('classifyBucket', () => {
  const now = new Date('2026-06-17T01:00:00Z') // 2026-06-17 11:00 AEST
  it('past commencement -> overdue', () => {
    expect(classifyBucket('2026-06-16', now)).toBe('overdue')
  })
  it('same Sydney day -> today', () => {
    expect(classifyBucket('2026-06-17', now)).toBe('today')
  })
  it('future commencement -> scheduled', () => {
    expect(classifyBucket('2026-06-18', now)).toBe('scheduled')
  })
})

describe('cutoffInstant / msUntilCutoff', () => {
  it('is 15:00 AEST (UTC+10) in winter -> 05:00Z', () => {
    const now = new Date('2026-06-17T01:00:00Z')
    expect(cutoffInstant(now).toISOString()).toBe('2026-06-17T05:00:00.000Z')
  })
  it('is 15:00 AEDT (UTC+11) in summer -> 04:00Z', () => {
    const now = new Date('2026-01-15T01:00:00Z')
    expect(cutoffInstant(now).toISOString()).toBe('2026-01-15T04:00:00.000Z')
  })
  it('msUntilCutoff is positive before 3pm, negative after', () => {
    expect(msUntilCutoff(new Date('2026-06-17T01:00:00Z'))).toBeGreaterThan(0)
    expect(msUntilCutoff(new Date('2026-06-17T06:00:00Z'))).toBeLessThan(0)
  })
})

describe('formatCountdown', () => {
  it('formats hours and minutes', () => {
    expect(formatCountdown(2 * 3600_000 + 14 * 60_000)).toBe('2h 14m')
  })
  it('formats minutes only under an hour', () => {
    expect(formatCountdown(9 * 60_000)).toBe('9m')
  })
})

describe('getCommencementDate', () => {
  it('prefers a dedicated commencementDate field', () => {
    expect(
      getCommencementDate({ commencementDate: '2026-06-20', loanTerms: { openedDate: '2026-06-17' } }),
    ).toBe('2026-06-20')
  })
  it('falls back to loanTerms.openedDate', () => {
    expect(getCommencementDate({ loanTerms: { openedDate: '2026-06-17T00:00:00Z' } })).toBe(
      '2026-06-17T00:00:00Z',
    )
  })
  it('returns null when neither present', () => {
    expect(getCommencementDate({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/unit/disbursement-cutoff.test.ts --config ./vitest.config.mts`
Expected: FAIL — cannot find module `@/lib/disbursement-cutoff`.

- [ ] **Step 3: Implement the util**

```ts
// src/lib/disbursement-cutoff.ts
/**
 * Time-based disbursement bucketing.
 *
 * The authoritative loan start date (`commencementDate`) is computed upstream by
 * billieChat (3pm AEST cut-off + national public holidays). The CRM only
 * CLASSIFIES pending loans by that date relative to "today" in Australia/Sydney —
 * it never re-derives the cut-off. See
 * docs/superpowers/specs/2026-06-17-disbursement-cutoff-triage-design.md.
 */
const SYDNEY_TZ = 'Australia/Sydney'
const CUTOFF_HOUR = 15 // 3:00pm AEST/AEDT — mirrors billieChat DISBURSEMENT_CUTOFF_HOUR

export type DisbursementBucket = 'overdue' | 'today' | 'scheduled'

/** Minutes Sydney is ahead of UTC at a given instant (+600 AEST, +660 AEDT). */
export function sydneyOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SYDNEY_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)
  const pick = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const sydAsUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  )
  return Math.round((sydAsUtc - instant.getTime()) / 60_000)
}

/** Sydney calendar day as 'YYYY-MM-DD' (lexically sortable). */
export function sydneyDateString(instant: Date): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** Classify a commencement date into a bucket relative to `now` (Sydney days). */
export function classifyBucket(
  commencementDate: string | Date,
  now: Date = new Date(),
): DisbursementBucket {
  const commenceDay = sydneyDateString(new Date(commencementDate))
  const today = sydneyDateString(now)
  if (commenceDay < today) return 'overdue'
  if (commenceDay === today) return 'today'
  return 'scheduled'
}

/** The 15:00 Sydney instant on `now`'s Sydney day, as a UTC Date. */
export function cutoffInstant(now: Date = new Date()): Date {
  const [y, m, d] = sydneyDateString(now).split('-').map(Number)
  const utcGuess = Date.UTC(y, m - 1, d, CUTOFF_HOUR, 0, 0)
  const offset = sydneyOffsetMinutes(new Date(utcGuess))
  return new Date(utcGuess - offset * 60_000)
}

/** Milliseconds until today's 3pm cut-off (negative once passed). */
export function msUntilCutoff(now: Date = new Date()): number {
  return cutoffInstant(now).getTime() - now.getTime()
}

/** 'Xh Ym' (or 'Ym' under an hour). Clamps negatives to '0m' — callers handle the passed state. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(total / 60)
  const mn = total % 60
  return h > 0 ? `${h}h ${mn}m` : `${mn}m`
}

/** The one place the commencement-date source is resolved (see Phase 0). */
export function getCommencementDate(account: {
  commencementDate?: string | null
  loanTerms?: { openedDate?: string | null } | null
}): string | null {
  return account.commencementDate ?? account.loanTerms?.openedDate ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/disbursement-cutoff.test.ts --config ./vitest.config.mts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/disbursement-cutoff.ts tests/unit/disbursement-cutoff.test.ts
git commit -m "feat(disbursement): add Sydney cut-off + bucket classification util"
```

---

## Phase 2 — API & schema

### Task 2: Extend dashboard schemas

**Files:**
- Modify: `src/lib/schemas/dashboard.ts`

- [ ] **Step 1: Add fields to `PendingDisbursementSchema` and a bucket summary type.**

In `src/lib/schemas/dashboard.ts`, add to `PendingDisbursementSchema` (after `createdAt`):

```ts
  commencementDate: z.string().nullable(), // ISO date; bucket key (see disbursement-cutoff.ts)
  bucket: z.enum(['overdue', 'today', 'scheduled']),
```

Add a new schema + wire it into the response:

```ts
export const DisbursementBucketSummarySchema = z.object({
  overdue: MoneyFlowMetricSchema,
  today: MoneyFlowMetricSchema,
  scheduled: MoneyFlowMetricSchema,
  todayDoneCount: z.number().int().min(0),
  todayTotalCount: z.number().int().min(0),
  scheduledTomorrowCount: z.number().int().min(0),
})
export type DisbursementBucketSummary = z.infer<typeof DisbursementBucketSummarySchema>
```

Add to `DashboardResponseSchema` (after `pendingDisbursementsCount`):

```ts
  disbursementBuckets: DisbursementBucketSummarySchema,
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: errors only where `route.ts` doesn't yet supply the new fields (fixed in Task 3). Confirm no errors *inside* `schemas/dashboard.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schemas/dashboard.ts
git commit -m "feat(dashboard): add commencement bucket fields to schema"
```

### Task 3: Dashboard API — classify & summarise

**Files:**
- Modify: `src/app/api/dashboard/route.ts`
- Test: `tests/int/api.int.spec.ts` (add a case)

- [ ] **Step 1: Refactor TZ helpers to the shared util.** Replace the local `sydneyOffsetMinutes` in `route.ts` with an import; keep `australianDayBoundaries` but have it call the imported helper.

```ts
import { sydneyOffsetMinutes, classifyBucket, getCommencementDate, sydneyDateString } from '@/lib/disbursement-cutoff'
// delete the local function sydneyOffsetMinutes (lines ~70-91)
```

- [ ] **Step 2: Build the bucket summary from the pending docs.** The pending query (lines ~268-275) currently `limit: 10`. Raise to `limit: 200` and compute the summary over all pending docs. After building `pendingDisbursements`, insert:

```ts
const now = new Date()
const tomorrowStr = sydneyDateString(new Date(now.getTime() + 24 * 60 * 60_000))

const emptyAgg = () => ({ count: 0, total: 0 })
const agg: Record<'overdue' | 'today' | 'scheduled', { count: number; total: number }> = {
  overdue: emptyAgg(),
  today: emptyAgg(),
  scheduled: emptyAgg(),
}
let scheduledTomorrowCount = 0

const pendingWithBucket = pendingDisbursementResult.docs.map((acc) => {
  const commencementDate = getCommencementDate(acc)
  const bucket = commencementDate ? classifyBucket(commencementDate, now) : 'today' // null -> treat as needs-attention today
  agg[bucket].count += 1
  agg[bucket].total += acc.loanTerms?.loanAmount ?? 0
  if (bucket === 'scheduled' && commencementDate && sydneyDateString(new Date(commencementDate)) === tomorrowStr) {
    scheduledTomorrowCount += 1
  }
  return { acc, commencementDate, bucket }
})

const disbursementBuckets = {
  overdue: buildMetric(agg.overdue.count, agg.overdue.total),
  today: buildMetric(agg.today.count, agg.today.total),
  scheduled: buildMetric(agg.scheduled.count, agg.scheduled.total),
  // disbursed today = moneyFlowsToday.disbursed (already computed); todayTotal = remaining today + done today
  todayDoneCount: moneyFlowsToday.disbursed.count,
  todayTotalCount: agg.today.count + moneyFlowsToday.disbursed.count,
  scheduledTomorrowCount,
}
```

Then change the `pendingDisbursements` mapping to use `pendingWithBucket` and include `commencementDate` + `bucket`:

```ts
const pendingDisbursements: PendingDisbursement[] = pendingWithBucket.map(({ acc, commencementDate, bucket }) => ({
  loanAccountId: acc.loanAccountId ?? '',
  accountNumber: acc.accountNumber ?? '',
  customerName: acc.customerName ?? 'Unknown',
  customerId: acc.customerIdString ?? '',
  loanAmount: acc.loanTerms?.loanAmount ?? 0,
  loanAmountFormatted: formatCurrency(acc.loanTerms?.loanAmount ?? 0),
  createdAt: acc.createdAt,
  commencementDate,
  bucket,
  signedLoanAgreementUrl: acc.signedLoanAgreementUrl ?? undefined,
}))
```

Add `disbursementBuckets` to the `response` object.

- [ ] **Step 3: Add an integration assertion.** In `tests/int/api.int.spec.ts`, add a test that GETs `/api/dashboard` (authenticated, per existing helpers in that file) and asserts `body.disbursementBuckets` has numeric `overdue/today/scheduled` metrics and `todayTotalCount >= todayDoneCount`. Match the existing auth/setup pattern already in the file.

- [ ] **Step 4: Run int tests**

Run: `pnpm exec vitest run tests/int/api.int.spec.ts --config ./vitest.config.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dashboard/route.ts tests/int/api.int.spec.ts
git commit -m "feat(dashboard): return disbursement bucket summary"
```

### Task 4: Queue API — buckets + filter

**Files:**
- Modify: `src/app/api/pending-disbursements/route.ts`

- [ ] **Step 1: Add `commencementDate` + `bucket` to the item type and the mapped output**, and an optional `?bucket=` filter. Add to `PendingDisbursementItem`:

```ts
  commencementDate: string | null
  bucket: 'overdue' | 'today' | 'scheduled'
```

Import the util and, after building `items`, classify + optionally filter:

```ts
import { classifyBucket, getCommencementDate } from '@/lib/disbursement-cutoff'
// inside the map, set:
//   const commencementDate = getCommencementDate(acc)
//   const bucket = commencementDate ? classifyBucket(commencementDate) : 'today'
// then include commencementDate, bucket in the returned object.
const bucketParam = request.nextUrl.searchParams.get('bucket')
const filtered = bucketParam ? items.filter((i) => i.bucket === bucketParam) : items
return NextResponse.json({ totalCount: filtered.length, items: filtered })
```

(Also raise `limit` default to 200 so all buckets are present.)

- [ ] **Step 2: Manual smoke**

Run: `pnpm dev` then `curl -s 'http://localhost:3000/api/pending-disbursements?bucket=today'` (with an auth cookie) and confirm only `bucket:"today"` items return.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pending-disbursements/route.ts
git commit -m "feat(disbursement): bucket + filter the pending-disbursements queue API"
```

---

## Phase 3 — Dashboard panel (Direction A)

### Task 5: `CutoffCountdown` component

**Files:**
- Create: `src/components/DashboardView/CutoffCountdown.tsx`, `CutoffCountdown.module.css`

- [ ] **Step 1: Implement the live countdown chip.**

```tsx
// src/components/DashboardView/CutoffCountdown.tsx
'use client'
import { useEffect, useState } from 'react'
import { msUntilCutoff, formatCountdown } from '@/lib/disbursement-cutoff'
import styles from './CutoffCountdown.module.css'

/** Live "Xh Ym to 3pm" chip. After 3pm shows a red "Cut-off passed" state. */
export function CutoffCountdown({ className }: { className?: string }) {
  const [ms, setMs] = useState<number>(() => msUntilCutoff())
  useEffect(() => {
    const id = setInterval(() => setMs(msUntilCutoff()), 30_000)
    return () => clearInterval(id)
  }, [])
  const passed = ms <= 0
  const urgent = !passed && ms < 60 * 60_000
  return (
    <span className={className}>
      <span className={styles.label}>{passed ? 'Cut-off' : "Today's 3:00pm cut-off in"}</span>
      <span
        className={`${styles.chip} ${passed ? styles.passed : urgent ? styles.urgent : styles.normal}`}
        data-testid="cutoff-countdown"
      >
        {passed ? 'passed at 3:00pm' : formatCountdown(ms)}
      </span>
    </span>
  )
}
```

- [ ] **Step 2: Add CSS** (`CutoffCountdown.module.css`) — `.chip` uses `font-variant-numeric: tabular-nums`; `.normal`/`.urgent`/`.passed` map to amber / amber-bold / red per the mock (`dashboard-directions.html` countdown chip). Port exact colours from the mock.

- [ ] **Step 3: Commit**

```bash
git add src/components/DashboardView/CutoffCountdown.tsx src/components/DashboardView/CutoffCountdown.module.css
git commit -m "feat(dashboard): live 3pm cut-off countdown chip"
```

### Task 6: `DisbursementTriagePanel` + dashboard wiring

**Files:**
- Create: `src/components/DashboardView/DisbursementTriagePanel.tsx`, `DisbursementTriagePanel.module.css`
- Modify: `src/components/DashboardView/index.tsx`
- Test: `tests/unit/ui/disbursement-triage-panel.test.tsx`

- [ ] **Step 1: Write the failing component test** (render with mocked `useDashboard`).

```tsx
// tests/unit/ui/disbursement-triage-panel.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DisbursementTriagePanel } from '@/components/DashboardView/DisbursementTriagePanel'

vi.mock('@/hooks/queries/useDashboard', () => ({
  useDashboard: () => ({
    isLoading: false,
    data: {
      disbursementBuckets: {
        overdue: { count: 2, totalAmount: 1150, totalAmountFormatted: '$1,150.00' },
        today: { count: 8, totalAmount: 5940, totalAmountFormatted: '$5,940.00' },
        scheduled: { count: 14, totalAmount: 0, totalAmountFormatted: '$0.00' },
        todayDoneCount: 3,
        todayTotalCount: 11,
        scheduledTomorrowCount: 5,
      },
    },
  }),
}))

describe('DisbursementTriagePanel', () => {
  it('renders all three buckets with counts even when overdue is present', () => {
    render(<DisbursementTriagePanel />)
    expect(screen.getByTestId('bucket-overdue')).toHaveTextContent('2')
    expect(screen.getByTestId('bucket-today')).toHaveTextContent('8') // remaining
    expect(screen.getByTestId('bucket-today')).toHaveTextContent('3 of 11')
    expect(screen.getByTestId('bucket-scheduled')).toHaveTextContent('14')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/unit/ui/disbursement-triage-panel.test.tsx --config ./vitest.config.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel** (Direction A — countdown strip + three fixed bucket cells; "today" shows *remaining* + progress). Styling ports from `dashboard-directions.html` (Direction A).

```tsx
// src/components/DashboardView/DisbursementTriagePanel.tsx
'use client'
import Link from 'next/link'
import { useDashboard } from '@/hooks/queries/useDashboard'
import { CutoffCountdown } from './CutoffCountdown'
import styles from './DisbursementTriagePanel.module.css'

const QUEUE = '/admin/pending-disbursements'

export function DisbursementTriagePanel() {
  const { data, isLoading } = useDashboard()
  const b = data?.disbursementBuckets
  if (isLoading) return <div className={styles.panel} data-testid="triage-loading"><div className={styles.skeleton} /></div>

  const overdue = b?.overdue.count ?? 0
  const todayDone = b?.todayDoneCount ?? 0
  const todayTotal = b?.todayTotalCount ?? 0
  const todayRemaining = b?.today.count ?? 0
  const scheduled = b?.scheduled.count ?? 0
  const tomorrow = b?.scheduledTomorrowCount ?? 0
  const pct = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0

  return (
    <div className={styles.panel} data-testid="disbursement-triage-panel">
      <div className={styles.strip}>
        <span className={styles.title}>⏳ Disbursements</span>
        <CutoffCountdown className={styles.countdown} />
      </div>
      <div className={styles.buckets}>
        <Link href={`${QUEUE}?bucket=overdue`} className={`${styles.cell} ${styles.overdue}`} data-testid="bucket-overdue">
          <span className={styles.cellLabel}>⚠ OVERDUE</span>
          <span className={styles.cellValue}>{overdue}</span>
          <span className={styles.cellSub}>
            {overdue === 0 ? 'none ✓' : `${b?.overdue.totalAmountFormatted} · schedule at risk`}
          </span>
        </Link>

        <Link href={`${QUEUE}?bucket=today`} className={`${styles.cell} ${styles.today}`} data-testid="bucket-today">
          <span className={styles.cellLabel}>⏳ DISBURSE TODAY — before 3pm</span>
          <span className={styles.cellValue}>
            {todayRemaining}
            <span className={styles.cellValueUnit}> remaining · {b?.today.totalAmountFormatted}</span>
          </span>
          <span className={styles.cellSub}>
            {todayRemaining === 0 && todayTotal > 0 ? 'All disbursed ✓' : `${todayDone} of ${todayTotal} done`}
          </span>
          <span className={styles.progress}><span className={styles.progressFill} style={{ width: `${pct}%` }} /></span>
        </Link>

        <Link href={`${QUEUE}?bucket=scheduled`} className={`${styles.cell} ${styles.scheduled}`} data-testid="bucket-scheduled">
          <span className={styles.cellLabel}>→ SCHEDULED</span>
          <span className={styles.cellValue}>{scheduled}</span>
          <span className={styles.cellSub}>Tomorrow {tomorrow} · later {Math.max(0, scheduled - tomorrow)}</span>
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add CSS** (`DisbursementTriagePanel.module.css`) — `.buckets` is a flex row with fixed flex-basis (overdue ~23%, today flex:1, scheduled ~26%) so positions are stable regardless of data; colours/borders per Direction A in the mock. `.progress`/`.progressFill` = the amber bar.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ui/disbursement-triage-panel.test.tsx --config ./vitest.config.mts`
Expected: PASS.

- [ ] **Step 6: Wire into the dashboard.** In `src/components/DashboardView/index.tsx`: import `DisbursementTriagePanel`; render `<DisbursementTriagePanel />` immediately after `<SystemHealthStrip />` and before the header/`heroRow`. Remove `DisbursementsHeroTile` from `import` and from the `heroRow` (leave `OverdueHeroTile` + `ApprovalsHeroTile`). Delete `src/components/DashboardView/DisbursementsHeroTile.tsx`.

- [ ] **Step 7: Run dashboard-related tests + typecheck**

Run: `pnpm exec vitest run tests/unit/ui --config ./vitest.config.mts` and `pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/DashboardView/ tests/unit/ui/disbursement-triage-panel.test.tsx
git commit -m "feat(dashboard): disbursement triage band (Direction A), retire single tile"
```

---

## Phase 4 — Queue page rebuild

### Task 7: `EarlyDisburseWarningModal`

**Files:**
- Create: `src/components/PendingDisbursementsView/EarlyDisburseWarningModal.tsx`, `.module.css`
- Test: `tests/unit/ui/early-disburse-warning.test.tsx`

- [ ] **Step 1: Write the failing test.**

```tsx
// tests/unit/ui/early-disburse-warning.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { EarlyDisburseWarningModal } from '@/components/PendingDisbursementsView/EarlyDisburseWarningModal'

describe('EarlyDisburseWarningModal', () => {
  it('shows scheduled→new dates and confirms', () => {
    const onConfirm = vi.fn()
    render(
      <EarlyDisburseWarningModal
        isOpen
        accountNumber="LN-20472"
        customerName="Eva Müller"
        loanAmountFormatted="$450.00"
        commencementDate="2026-06-22"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText(/before the scheduled start date/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /disburse today anyway/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run to verify fail.** `pnpm exec vitest run tests/unit/ui/early-disburse-warning.test.tsx --config ./vitest.config.mts` → FAIL (module not found).

- [ ] **Step 3: Implement the modal** (content/styling from `early-disburse-warning.html`).

```tsx
// src/components/PendingDisbursementsView/EarlyDisburseWarningModal.tsx
'use client'
import { formatDateMedium } from '@/lib/formatters'
import styles from './EarlyDisburseWarningModal.module.css'

interface Props {
  isOpen: boolean
  accountNumber: string
  customerName: string
  loanAmountFormatted: string
  commencementDate: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function EarlyDisburseWarningModal(props: Props) {
  if (!props.isOpen) return null
  const today = formatDateMedium(new Date())
  const scheduled = props.commencementDate ? formatDateMedium(props.commencementDate) : '—'
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>⚠ Disburse before the scheduled start date?</div>
        <div className={styles.body}>
          <strong>{props.accountNumber} · {props.customerName} · {props.loanAmountFormatted}</strong>
          <p>
            This loan is scheduled to start on <strong className={styles.blue}>{scheduled}</strong>.
            Disbursing today will set the loan start date to <strong className={styles.amber}>{today}</strong> and
            recalculate the repayment schedule.
          </p>
          <div className={styles.deltaRow}>
            <div className={styles.delta}><span className={styles.deltaLabel}>Scheduled start</span><span className={styles.blue}>{scheduled}</span></div>
            <span className={styles.arrow}>→</span>
            <div className={styles.delta}><span className={styles.deltaLabel}>New start (today)</span><span className={styles.amber}>{today}</span></div>
          </div>
          <div className={styles.warn}>May push the loan beyond the <strong>62-day maximum term</strong>. Only proceed if you're certain.</div>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancel} onClick={props.onCancel}>Cancel</button>
          <button className={styles.danger} onClick={props.onConfirm}>Disburse today anyway</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add CSS** from the mock (`early-disburse-warning.html`): overlay, modal, red header gradient, `.blue`/`.amber` text, `.danger` red button.

- [ ] **Step 5: Run to verify pass.** Same command as Step 2 → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/PendingDisbursementsView/EarlyDisburseWarningModal.tsx src/components/PendingDisbursementsView/EarlyDisburseWarningModal.module.css tests/unit/ui/early-disburse-warning.test.tsx
git commit -m "feat(disbursement): early-disburse warning modal"
```

### Task 8: `DisbursementSection` + queue rebuild

**Files:**
- Create: `src/components/PendingDisbursementsView/DisbursementSection.tsx`, `.module.css`
- Modify: `src/components/PendingDisbursementsView/PendingDisbursementsView.tsx`

- [ ] **Step 1: Implement `DisbursementSection`** — a collapsible bucket with header (title + count + `$` subtotal), a table, and a `bucket`-aware date column + action. Props:

```tsx
// src/components/PendingDisbursementsView/DisbursementSection.tsx
'use client'
import { useState } from 'react'
import { formatDateMedium } from '@/lib/formatters'
import styles from './DisbursementSection.module.css'

export interface QueueItem {
  loanAccountId: string
  accountNumber: string
  customerId: string
  customerName: string
  loanAmount: number
  loanAmountFormatted: string
  commencementDate: string | null
  bucket: 'overdue' | 'today' | 'scheduled'
}

interface Props {
  bucket: 'overdue' | 'today' | 'scheduled'
  items: QueueItem[]
  totalFormatted: string
  defaultCollapsed?: boolean
  onDisburse: (item: QueueItem) => void
  onView: (item: QueueItem) => void
}

const META = {
  overdue: { title: '⚠ OVERDUE — schedule already at risk', cls: 'overdue', dateHead: 'Should have disbursed', cta: 'Disburse now' },
  today: { title: '⏳ DISBURSE TODAY — before 3:00pm', cls: 'today', dateHead: 'Must disburse by', cta: 'Disburse' },
  scheduled: { title: '→ SCHEDULED — future start dates (not yet actionable)', cls: 'scheduled', dateHead: 'Disburses on', cta: '⚠ Disburse early' },
} as const

export function DisbursementSection({ bucket, items, totalFormatted, defaultCollapsed, onDisburse, onView }: Props) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed)
  const m = META[bucket]
  return (
    <div className={`${styles.section} ${styles[m.cls]}`} data-testid={`section-${bucket}`}>
      <button className={styles.head} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.headTitle}>{collapsed ? '▸' : '▾'} {m.title}</span>
        <span className={styles.headCount}>{items.length} loans · {totalFormatted}</span>
      </button>
      {!collapsed && (
        <table className={styles.table}>
          <thead><tr><th>Account</th><th>Customer</th><th>Loan amount</th><th>{m.dateHead}</th><th /></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.loanAccountId}>
                <td>{it.accountNumber}</td>
                <td>{it.customerName}</td>
                <td>{it.loanAmountFormatted}</td>
                <td>{bucket === 'today' ? '3:00pm today' : it.commencementDate ? formatDateMedium(it.commencementDate) : '—'}</td>
                <td className={styles.actions}>
                  <button className={bucket === 'scheduled' ? styles.earlyBtn : styles.disburseBtn} onClick={() => onDisburse(it)}>{m.cta}</button>
                  <button className={styles.viewBtn} onClick={() => onView(it)}>View</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className={styles.empty}>None</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rebuild `PendingDisbursementsView`** to fetch all items, split by `bucket`, render three sections (scheduled `defaultCollapsed`), read `?bucket=` from the URL to auto-scroll/expand, and route disburse through the guard for scheduled items.

```tsx
// key additions inside PendingDisbursementsView.tsx
import { DisbursementSection, type QueueItem } from './DisbursementSection'
import { EarlyDisburseWarningModal } from './EarlyDisburseWarningModal'
import { CutoffCountdown } from '@/components/DashboardView/CutoffCountdown'
import { formatCurrency } from '@/lib/formatters'

// state:
const [pendingEarly, setPendingEarly] = useState<QueueItem | null>(null)

const byBucket = (b: QueueItem['bucket']) => items.filter((i) => i.bucket === b)
const subtotal = (b: QueueItem['bucket']) => formatCurrency(byBucket(b).reduce((s, i) => s + i.loanAmount, 0))

const handleDisburse = (item: QueueItem) => {
  if (item.bucket === 'scheduled') { setPendingEarly(item); return }
  handleOpenDisburse(item) // existing drawer opener
}

// render (replace the single table):
<div className={styles.headerRow}>
  <h1>Pending Disbursements</h1>
  <CutoffCountdown />
</div>
<DisbursementSection bucket="overdue"   items={byBucket('overdue')}   totalFormatted={subtotal('overdue')}   onDisburse={handleDisburse} onView={handleView} />
<DisbursementSection bucket="today"     items={byBucket('today')}     totalFormatted={subtotal('today')}     onDisburse={handleDisburse} onView={handleView} />
<DisbursementSection bucket="scheduled" items={byBucket('scheduled')} totalFormatted={subtotal('scheduled')} defaultCollapsed onDisburse={handleDisburse} onView={handleView} />

<EarlyDisburseWarningModal
  isOpen={!!pendingEarly}
  accountNumber={pendingEarly?.accountNumber ?? ''}
  customerName={pendingEarly?.customerName ?? ''}
  loanAmountFormatted={pendingEarly?.loanAmountFormatted ?? ''}
  commencementDate={pendingEarly?.commencementDate ?? null}
  onCancel={() => setPendingEarly(null)}
  onConfirm={() => { const it = pendingEarly!; setPendingEarly(null); handleOpenDisburse(it) }}
/>
```

(Keep the existing `DisburseLoanDrawer` wiring; `handleView` = the existing `router.push` to servicing. Update the fetch to use the existing `/api/pending-disbursements?limit=200` and map response into `QueueItem`s including `commencementDate`/`bucket`.)

- [ ] **Step 3: Add CSS** from `queue-page.html` (section borders/colours per bucket, table styling, `.earlyBtn` outlined, `.disburseBtn` amber, overdue `.disburseBtn` red via the `.overdue` section scope).

- [ ] **Step 4: Typecheck + UI tests + manual smoke**

Run: `pnpm exec tsc --noEmit` and `pnpm exec vitest run tests/unit/ui --config ./vitest.config.mts`; then `pnpm dev`, open `/admin/pending-disbursements`, confirm three sections, scheduled collapsed, early-disburse shows the modal.
Expected: no type errors, tests PASS, UI matches the mock.

- [ ] **Step 5: Commit**

```bash
git add src/components/PendingDisbursementsView/
git commit -m "feat(disbursement): rebuild queue into Overdue/Today/Scheduled sections with early-disburse guard"
```

---

## Phase 5 — commencementDate ingestion (ONLY if Phase 0 decided `openedDate` is not the commencement date)

> Skip this phase entirely if Phase 0 chose `openedDate`. `getCommencementDate` already prefers a dedicated field, so adding it transparently switches every read path.

### Task 9: Add `commencementDate` to the loan-accounts projection

**Files:**
- Modify: `src/collections/LoanAccounts.ts`
- Create: a migration via `make -C infra/fly pg-migrate-create ENV=dev NAME=loan_accounts_commencement_date`

- [ ] **Step 1: Add the field** to `LoanAccounts.ts` (top-level, near `signedLoanAgreementUrl`):

```ts
{
  name: 'commencementDate',
  type: 'date',
  index: true,
  admin: { readOnly: true, description: 'Authoritative loan start date from billieChat loan_execution_plan_created (commencement_date). Bucket key for disbursement triage.' },
},
```

- [ ] **Step 2: Generate types + migration**

Run: `pnpm generate:types` then `make -C infra/fly pg-migrate-create ENV=dev NAME=loan_accounts_commencement_date`
Expected: `src/payload-types.ts` updated; new migration file adds a nullable `commencement_date timestamp(3) with time zone` column.

- [ ] **Step 3: Commit**

```bash
git add src/collections/LoanAccounts.ts src/payload-types.ts src/migrations/
git commit -m "feat(loan-accounts): add commencementDate projection field"
```

### Task 10: Ingest `loan_execution_plan_created` in the event processor

**Files:**
- Modify: `event-processor/src/billie_servicing/handlers/account.py` (add handler) + register in `handlers/__init__.py` / `main.py`
- Test: `event-processor/tests/test_handlers.py`

> Prerequisite: confirm `loan_execution_plan_created` is delivered onto a stream the CRM consumes (`inbox:billie-servicing`). If it only exists on billieChat's `chatLedger`, coordinate routing it to the CRM inbox first — note this in the spec and do not proceed until confirmed.

- [ ] **Step 1: Write the failing test** (pytest) asserting the handler upserts `commencement_date` parsed from the event payload's `commencement_date`, keyed by `account_id`/`application_number`. Mirror the existing handler-test style in `event-processor/tests/test_handlers.py` (fixtures + a fake pool).

- [ ] **Step 2: Run it to verify it fails.** `cd event-processor && pytest tests/test_handlers.py -k commencement -v` → FAIL.

- [ ] **Step 3: Implement the handler** using shared helpers (`update_by_key`, `coerce_date` from `db.py`): parse the date string with `coerce_date`, then `update_by_key(pool, "loan_accounts", key_col, key_val, {"commencement_date": value})`. Register the message type → handler mapping alongside the other account handlers.

- [ ] **Step 4: Run to verify pass + lint.** `pytest -k commencement -v` and `ruff check .` → PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add event-processor/
git commit -m "feat(event-processor): ingest loan_execution_plan_created commencement_date"
```

---

## Self-Review (completed)

- **Spec coverage:** consume-don't-re-derive (Task 1 `classifyBucket` + `getCommencementDate`), three buckets (Tasks 3/4/6/8), data prerequisite (Phase 0 + conditional Phase 5), dashboard band A with states (Task 6 incl. zero/after-cutoff via `CutoffCountdown`), 3-section queue (Task 8), early-disburse guard (Tasks 7/8), testing (each task), YAGNI (no holiday calendar in CRM). ✓
- **Placeholder scan:** no TBD/TODO; component CSS values are explicitly delegated to the persisted, approved mock files (named) rather than left vague. ✓
- **Type consistency:** `DisbursementBucket`/`bucket` enum (`overdue|today|scheduled`) identical across util, schema, APIs, and components; `getCommencementDate`/`classifyBucket` signatures consistent; `QueueItem` shape shared by section + view. ✓
```
