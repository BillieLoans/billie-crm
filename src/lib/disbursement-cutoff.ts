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

/** Loan shape the bucket summary needs. */
export interface BucketableLoan {
  loanAmount: number
  commencementDate: string | null
  bucket: DisbursementBucket
}

/** Raw (unformatted) per-bucket counts/totals for the dashboard summary. */
export interface DisbursementBucketTotals {
  overdue: { count: number; total: number }
  today: { count: number; total: number }
  scheduled: { count: number; total: number }
  todayDoneCount: number
  todayTotalCount: number
  scheduledTomorrowCount: number
}

/** The Sydney calendar day AFTER `now`'s Sydney day — DST-safe (uses noon UTC, never ±24h). */
export function nextSydneyDateString(now: Date = new Date()): string {
  const [y, m, d] = sydneyDateString(now).split('-').map(Number)
  // Noon UTC on the next day is ~22:00/23:00 Sydney the same calendar day → never crosses a DST boundary.
  return sydneyDateString(new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0)))
}

/** Aggregate already-classified pending loans into the dashboard bucket summary. */
export function summariseDisbursementBuckets(
  loans: BucketableLoan[],
  disbursedTodayCount: number,
  now: Date = new Date(),
): DisbursementBucketTotals {
  const tomorrowStr = nextSydneyDateString(now)
  const agg = {
    overdue: { count: 0, total: 0 },
    today: { count: 0, total: 0 },
    scheduled: { count: 0, total: 0 },
  }
  let scheduledTomorrowCount = 0
  for (const loan of loans) {
    agg[loan.bucket].count += 1
    agg[loan.bucket].total += loan.loanAmount
    if (
      loan.bucket === 'scheduled' &&
      loan.commencementDate &&
      sydneyDateString(new Date(loan.commencementDate)) === tomorrowStr
    ) {
      scheduledTomorrowCount += 1
    }
  }
  return {
    overdue: agg.overdue,
    today: agg.today,
    scheduled: agg.scheduled,
    todayDoneCount: disbursedTodayCount,
    todayTotalCount: agg.today.count + disbursedTodayCount,
    scheduledTomorrowCount,
  }
}
