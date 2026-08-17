/**
 * SQL aggregates behind GET /api/dashboard.
 *
 * These run on the Postgres adapter's underlying `pg.Pool` rather than the
 * Local API: every figure here is a whole-table count/sum, and paginating
 * documents to add them up in JS is exactly how the dashboard used to report
 * numbers that silently understated reality past the first page.
 *
 * Every day window is an Australia/Sydney window (the business timezone), not a
 * server-local one — the app runs in UTC on Fly.io.
 */

import { currencyFormatter } from '@/lib/formatters'
import { sydneyDayUtcRange, type DisbursementBucketTotals } from '@/lib/disbursement-cutoff'
import type { MoneyFlowMetric, MoneyFlowsToday, UpcomingPayment } from '@/lib/schemas/dashboard'

/** Sydney is the business timezone; every day window here uses it. */
const SYDNEY_TZ = 'Australia/Sydney'

/** Payments further out than this are not "upcoming" for the dashboard. */
const UPCOMING_HORIZON_DAYS = 14

/** How many upcoming payments the dashboard shows. */
const UPCOMING_LIMIT = 10

/** Minimal shape of the pg pool the Postgres adapter exposes. */
export interface QueryablePool {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
}

/** The Postgres adapter's underlying `pg.Pool`, when the adapter is Postgres. */
export function getDashboardPool(payload: unknown): QueryablePool | undefined {
  const db = (payload as { db?: { pool?: unknown } } | null | undefined)?.db
  return db?.pool as QueryablePool | undefined
}

/** node-pg returns COUNT as a bigint string and numeric SUM as a string. */
export function toNumber(value: unknown): number {
  const n = value != null ? Number(value) : 0
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount)
}

export const EMPTY_METRIC: MoneyFlowMetric = {
  count: 0,
  totalAmount: 0,
  totalAmountFormatted: currencyFormatter.format(0),
}

export function buildMetric(count: number, totalAmount: number): MoneyFlowMetric {
  return {
    count,
    totalAmount,
    totalAmountFormatted: formatCurrency(totalAmount),
  }
}

/**
 * Aggregate today's money flows (expected, received, disbursed) for the
 * Australian working day, from the `loan_accounts` parent table and the
 * `loan_accounts_repayment_schedule_payments` child table.
 */
export async function fetchMoneyFlowsToday(
  pool: QueryablePool | undefined,
  now: Date = new Date(),
): Promise<MoneyFlowsToday> {
  if (!pool) {
    return {
      paymentsExpected: EMPTY_METRIC,
      paymentsReceived: EMPTY_METRIC,
      disbursed: EMPTY_METRIC,
    }
  }

  const { start, end } = sydneyDayUtcRange(now)

  const toMetric = (row: Record<string, unknown> | undefined) =>
    buildMetric(toNumber(row?.count), toNumber(row?.total))

  const [expectedResult, receivedResult, disbursedResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::bigint AS count, COALESCE(SUM(amount), 0) AS total
         FROM loan_accounts_repayment_schedule_payments
        WHERE due_date >= $1 AND due_date < $2`,
      [start, end],
    ),
    pool.query(
      `SELECT COUNT(*)::bigint AS count, COALESCE(SUM(amount_paid), 0) AS total
         FROM loan_accounts_repayment_schedule_payments
        WHERE paid_date >= $1 AND paid_date < $2`,
      [start, end],
    ),
    pool.query(
      `SELECT COUNT(*)::bigint AS count, COALESCE(SUM(loan_terms_loan_amount), 0) AS total
         FROM loan_accounts
        WHERE loan_terms_disbursed_date >= $1 AND loan_terms_disbursed_date < $2`,
      [start, end],
    ),
  ])

  return {
    paymentsExpected: toMetric(expectedResult.rows[0]),
    paymentsReceived: toMetric(receivedResult.rows[0]),
    disbursed: toMetric(disbursedResult.rows[0]),
  }
}

/**
 * The 10 most urgent scheduled payments across EVERY active account.
 *
 * This used to scan an arbitrary, unsorted 100-account page of the Local API,
 * so past 100 active accounts the list was simply wrong. In SQL the ordering is
 * total and the coverage complete.
 *
 * `todaySydney` is the 'YYYY-MM-DD' Sydney day; day arithmetic runs on Sydney
 * calendar dates, so Postgres' tz database handles DST rather than a ±24h step.
 */
export async function fetchUpcomingPayments(
  pool: QueryablePool | undefined,
  todaySydney: string,
): Promise<UpcomingPayment[]> {
  if (!pool) return []

  const { rows } = await pool.query(
    `SELECT la.loan_account_id,
            la.account_number,
            la.customer_id_string,
            c.full_name AS customer_name,
            p.due_date,
            p.amount,
            ((p.due_date AT TIME ZONE $2::text)::date - $1::date) AS days_until_due
       FROM loan_accounts_repayment_schedule_payments p
       JOIN loan_accounts la ON la.id = p._parent_id
       LEFT JOIN customers c ON c.id = la.customer_id_id
      WHERE la.account_status = 'active'
        AND p.status = 'scheduled'
        AND p.due_date IS NOT NULL
        AND (p.due_date AT TIME ZONE $2::text)::date <= ($1::date + $3::int)
      ORDER BY p.due_date ASC
      LIMIT $4::int`,
    [todaySydney, SYDNEY_TZ, UPCOMING_HORIZON_DAYS, UPCOMING_LIMIT],
  )

  return rows.map((row) => {
    const daysUntilDue = toNumber(row.days_until_due)
    const amount = toNumber(row.amount)
    const status: UpcomingPayment['status'] =
      daysUntilDue < 0 ? 'overdue' : daysUntilDue === 0 ? 'due_today' : 'upcoming'

    return {
      loanAccountId: String(row.loan_account_id ?? ''),
      accountNumber: String(row.account_number ?? ''),
      customerName: (row.customer_name as string | null) ?? 'Unknown',
      customerId: (row.customer_id_string as string | null) ?? '',
      dueDate: new Date(row.due_date as string | Date).toISOString(),
      amount,
      amountFormatted: formatCurrency(amount),
      daysUntilDue,
      status,
    }
  })
}

/**
 * Per-bucket counts and dollar totals over EVERY pending-disbursement account.
 *
 * The totals used to be summed over a 200-document page while the headline
 * count came from `totalDocs`, so above 200 pending loans the dollars silently
 * understated the count. Both now come from the same full-table aggregate.
 *
 * Accounts with no commencement date land in "today" so ops still see them —
 * this mirrors the per-row classification the route applies to its list preview.
 */
export async function fetchDisbursementBucketTotals(
  pool: QueryablePool,
  todaySydney: string,
  tomorrowSydney: string,
  disbursedTodayCount: number,
): Promise<DisbursementBucketTotals> {
  const { rows } = await pool.query(
    `WITH pending AS (
       SELECT loan_terms_loan_amount AS amount,
              (COALESCE(commencement_date, loan_terms_opened_date) AT TIME ZONE $3::text)::date
                AS commence_day
         FROM loan_accounts
        WHERE account_status = 'pending_disbursement'
     )
     SELECT CASE
              WHEN commence_day IS NULL THEN 'today'
              WHEN commence_day < $1::date THEN 'overdue'
              WHEN commence_day = $1::date THEN 'today'
              ELSE 'scheduled'
            END AS bucket,
            COUNT(*)::bigint AS count,
            COALESCE(SUM(amount), 0) AS total,
            COUNT(*) FILTER (WHERE commence_day = $2::date)::bigint AS tomorrow_count
       FROM pending
      GROUP BY 1`,
    [todaySydney, tomorrowSydney, SYDNEY_TZ],
  )

  const agg = {
    overdue: { count: 0, total: 0 },
    today: { count: 0, total: 0 },
    scheduled: { count: 0, total: 0 },
  }
  let scheduledTomorrowCount = 0

  for (const row of rows) {
    const bucket = String(row.bucket) as keyof typeof agg
    if (!(bucket in agg)) continue
    agg[bucket] = { count: toNumber(row.count), total: toNumber(row.total) }
    if (bucket === 'scheduled') {
      scheduledTomorrowCount = toNumber(row.tomorrow_count)
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
