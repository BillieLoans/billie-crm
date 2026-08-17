/**
 * Integration coverage for the dashboard SQL aggregates.
 *
 * These run against the real Postgres container from tests/utils/globalSetup.ts,
 * so they verify the actual table/column names and the Sydney-day arithmetic —
 * the two things the previous in-memory implementations got wrong.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import {
  getDashboardPool,
  fetchMoneyFlowsToday,
  fetchUpcomingPayments,
  fetchDisbursementBucketTotals,
  type QueryablePool,
} from '@/lib/dashboard-aggregates'
import { sydneyDateString, nextSydneyDateString } from '@/lib/disbursement-cutoff'

let payload: Payload
let pool: QueryablePool

const CUSTOMER_ID = 'CUST-DASH-AGG'
const PREFIX = 'DASHAGG'

async function reset() {
  await pool.query(
    `DELETE FROM loan_accounts_repayment_schedule_payments
      WHERE _parent_id IN (SELECT id FROM loan_accounts WHERE loan_account_id LIKE $1)`,
    [`${PREFIX}%`],
  )
  await pool.query('DELETE FROM loan_accounts WHERE loan_account_id LIKE $1', [`${PREFIX}%`])
  await pool.query('DELETE FROM customers WHERE customer_id = $1', [CUSTOMER_ID])
}

/** Insert a loan account and return its uuid. */
async function insertAccount(opts: {
  suffix: string
  status: 'active' | 'pending_disbursement'
  amount?: number
  commencementDate?: string | null
  openedDate?: string | null
  disbursedDate?: string | null
  customerUuid?: string | null
}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO loan_accounts
       (loan_account_id, account_number, account_status, loan_terms_loan_amount,
        commencement_date, loan_terms_opened_date, loan_terms_disbursed_date,
        customer_id_id, customer_id_string)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      `${PREFIX}-${opts.suffix}`,
      `ACC-${opts.suffix}`,
      opts.status,
      opts.amount ?? null,
      opts.commencementDate ?? null,
      opts.openedDate ?? null,
      opts.disbursedDate ?? null,
      opts.customerUuid ?? null,
      opts.customerUuid ? CUSTOMER_ID : null,
    ],
  )
  return rows[0].id as string
}

async function insertPayment(opts: {
  parentId: string
  paymentNumber: number
  dueDate: string
  amount: number
  status?: 'scheduled' | 'paid'
  amountPaid?: number
  paidDate?: string | null
}) {
  await pool.query(
    `INSERT INTO loan_accounts_repayment_schedule_payments
       (_order, _parent_id, id, payment_number, due_date, amount, status, amount_paid, paid_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      opts.paymentNumber,
      opts.parentId,
      `${PREFIX}-pay-${opts.parentId}-${opts.paymentNumber}`,
      opts.paymentNumber,
      opts.dueDate,
      opts.amount,
      opts.status ?? 'scheduled',
      opts.amountPaid ?? null,
      opts.paidDate ?? null,
    ],
  )
}

describe('dashboard SQL aggregates', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    const resolved = getDashboardPool(payload)
    expect(resolved).toBeDefined()
    pool = resolved as QueryablePool
  })

  beforeEach(reset)
  afterAll(reset)

  describe('fetchUpcomingPayments', () => {
    // Wed 17 Jun 2026, 11:00 AEST.
    const now = new Date('2026-06-17T01:00:00Z')
    const today = sydneyDateString(now) // 2026-06-17

    it('classifies overdue / due today / upcoming on Sydney calendar days', async () => {
      const customer = await pool.query(
        `INSERT INTO customers (customer_id, full_name) VALUES ($1, $2) RETURNING id`,
        [CUSTOMER_ID, 'Dash Aggregate'],
      )
      const accountId = await insertAccount({
        suffix: 'A',
        status: 'active',
        customerUuid: customer.rows[0].id as string,
      })

      // 2026-06-17T13:00:00Z is 23:00 on 17 Jun Sydney — "due today", but
      // "tomorrow" to any server-timezone (UTC) comparison.
      await insertPayment({
        parentId: accountId,
        paymentNumber: 1,
        dueDate: '2026-06-16T05:00:00Z',
        amount: 100,
      })
      await insertPayment({
        parentId: accountId,
        paymentNumber: 2,
        dueDate: '2026-06-17T13:00:00Z',
        amount: 200,
      })
      await insertPayment({
        parentId: accountId,
        paymentNumber: 3,
        dueDate: '2026-06-20T05:00:00Z',
        amount: 300,
      })
      // Beyond the 14-day horizon → excluded.
      await insertPayment({
        parentId: accountId,
        paymentNumber: 4,
        dueDate: '2026-07-20T05:00:00Z',
        amount: 400,
      })
      // Already paid → excluded.
      await insertPayment({
        parentId: accountId,
        paymentNumber: 5,
        dueDate: '2026-06-18T05:00:00Z',
        amount: 500,
        status: 'paid',
      })

      const result = await fetchUpcomingPayments(pool, today)

      expect(result.map((p) => p.amount)).toEqual([100, 200, 300])
      expect(result.map((p) => p.status)).toEqual(['overdue', 'due_today', 'upcoming'])
      expect(result.map((p) => p.daysUntilDue)).toEqual([-1, 0, 3])
      expect(result[0].customerName).toBe('Dash Aggregate')
      expect(result[0].customerId).toBe(CUSTOMER_ID)
      expect(result[0].amountFormatted).toBe('$100.00')
    })

    it('covers every active account, not just the first page', async () => {
      // 120 accounts, one payment each — the old 100-account page missed the tail.
      for (let i = 0; i < 120; i++) {
        const id = await insertAccount({ suffix: `bulk-${i}`, status: 'active' })
        // Later index → earlier due date, so the most urgent rows sit past row 100.
        const day = String(17 - Math.floor(i / 40)).padStart(2, '0')
        await insertPayment({
          parentId: id,
          paymentNumber: 1,
          dueDate: `2026-06-${day}T05:00:00Z`,
          amount: 10 + i,
        })
      }

      const result = await fetchUpcomingPayments(pool, today)
      expect(result).toHaveLength(10)
      // The 10 most urgent are all from the last block (due 15 Jun).
      expect(result.every((p) => p.dueDate.startsWith('2026-06-15'))).toBe(true)
      expect(result.every((p) => p.daysUntilDue === -2)).toBe(true)
    })

    it('returns an empty list without a pool', async () => {
      expect(await fetchUpcomingPayments(undefined, today)).toEqual([])
    })
  })

  describe('fetchDisbursementBucketTotals', () => {
    const now = new Date('2026-06-17T01:00:00Z')
    const today = sydneyDateString(now)
    const tomorrow = nextSydneyDateString(now)

    it('sums counts AND dollars over every pending loan', async () => {
      await insertAccount({
        suffix: 'p1',
        status: 'pending_disbursement',
        amount: 100,
        commencementDate: '2026-06-16T00:00:00Z',
      })
      await insertAccount({
        suffix: 'p2',
        status: 'pending_disbursement',
        amount: 200,
        commencementDate: '2026-06-17T00:00:00Z',
      })
      // No commencementDate → falls back to openedDate.
      await insertAccount({
        suffix: 'p3',
        status: 'pending_disbursement',
        amount: 50,
        openedDate: '2026-06-18T00:00:00Z',
      })
      await insertAccount({
        suffix: 'p4',
        status: 'pending_disbursement',
        amount: 75,
        commencementDate: '2026-06-20T00:00:00Z',
      })
      // Neither date → surfaced in today's queue.
      await insertAccount({ suffix: 'p5', status: 'pending_disbursement', amount: 25 })
      // Not pending → ignored.
      await insertAccount({ suffix: 'p6', status: 'active', amount: 9999 })

      const s = await fetchDisbursementBucketTotals(pool, today, tomorrow, 3)

      expect(s.overdue).toEqual({ count: 1, total: 100 })
      expect(s.today).toEqual({ count: 2, total: 225 })
      expect(s.scheduled).toEqual({ count: 2, total: 125 })
      expect(s.scheduledTomorrowCount).toBe(1)
      expect(s.todayDoneCount).toBe(3)
      expect(s.todayTotalCount).toBe(5)
    })

    it('stays consistent above the old 200-document cap', async () => {
      for (let i = 0; i < 210; i++) {
        await insertAccount({
          suffix: `cap-${i}`,
          status: 'pending_disbursement',
          amount: 10,
          commencementDate: '2026-06-17T00:00:00Z',
        })
      }

      const s = await fetchDisbursementBucketTotals(pool, today, tomorrow, 0)
      expect(s.today.count).toBe(210)
      // The bug: totals summed over 200 docs while the count came from totalDocs.
      expect(s.today.total).toBe(2100)
    })

    it('returns zeroed buckets when nothing is pending', async () => {
      const s = await fetchDisbursementBucketTotals(pool, today, tomorrow, 0)
      expect(s.overdue).toEqual({ count: 0, total: 0 })
      expect(s.today).toEqual({ count: 0, total: 0 })
      expect(s.scheduled).toEqual({ count: 0, total: 0 })
      expect(s.scheduledTomorrowCount).toBe(0)
    })
  })

  describe('fetchMoneyFlowsToday', () => {
    it('uses the Sydney day window, not the UTC one', async () => {
      const now = new Date('2026-06-17T01:00:00Z') // 11:00 AEST on 17 Jun
      const accountId = await insertAccount({
        suffix: 'flow',
        status: 'active',
        amount: 1000,
        disbursedDate: '2026-06-17T02:00:00Z',
      })

      // 23:30 Sydney on 17 Jun — inside the Sydney day, next day in UTC.
      await insertPayment({
        parentId: accountId,
        paymentNumber: 1,
        dueDate: '2026-06-17T13:30:00Z',
        amount: 120,
        status: 'paid',
        amountPaid: 120,
        paidDate: '2026-06-17T13:30:00Z',
      })
      // 09:00 Sydney on 16 Jun — the previous Sydney day, excluded.
      await insertPayment({
        parentId: accountId,
        paymentNumber: 2,
        dueDate: '2026-06-15T23:00:00Z',
        amount: 900,
      })

      const flows = await fetchMoneyFlowsToday(pool, now)

      expect(flows.paymentsExpected.count).toBe(1)
      expect(flows.paymentsExpected.totalAmount).toBe(120)
      expect(flows.paymentsReceived.count).toBe(1)
      expect(flows.paymentsReceived.totalAmount).toBe(120)
      expect(flows.paymentsReceived.totalAmountFormatted).toBe('$120.00')
      expect(flows.disbursed.count).toBe(1)
      expect(flows.disbursed.totalAmount).toBe(1000)
    })

    it('spans 25 hours on the AEDT->AEST changeover day', async () => {
      const now = new Date('2026-04-05T01:00:00Z') // 12:00 AEDT, Sun 5 Apr 2026
      const accountId = await insertAccount({ suffix: 'dst', status: 'active' })

      // 2026-04-05T13:30:00Z is 23:30 AEST on 5 Apr — only inside the window if
      // the day is treated as 25h rather than start + 24h.
      await insertPayment({
        parentId: accountId,
        paymentNumber: 1,
        dueDate: '2026-04-05T13:30:00Z',
        amount: 60,
      })
      // Start of the next Sydney day → excluded.
      await insertPayment({
        parentId: accountId,
        paymentNumber: 2,
        dueDate: '2026-04-05T14:00:00Z',
        amount: 70,
      })

      const flows = await fetchMoneyFlowsToday(pool, now)
      expect(flows.paymentsExpected.count).toBe(1)
      expect(flows.paymentsExpected.totalAmount).toBe(60)
    })

    it('returns empty metrics without a pool', async () => {
      const flows = await fetchMoneyFlowsToday(undefined, new Date())
      expect(flows.paymentsExpected.count).toBe(0)
      expect(flows.disbursed.totalAmountFormatted).toBe('$0.00')
    })
  })
})
