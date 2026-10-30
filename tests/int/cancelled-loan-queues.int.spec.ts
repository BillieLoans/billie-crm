/**
 * Cancelled loans in the disbursement queues and on the dashboard (BTB-517).
 *
 * AC13: a loan cancelled before disbursement leaves every pending list. Both
 * routes already filter on `account_status = 'pending_disbursement'` with
 * strict equality; this pins it against the real schema, together with the
 * dashboard's new cancelled count. Only the session and the ledger health
 * probe are replaced.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'
import { sydneyDateString } from '@/lib/disbursement-cutoff'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const session = vi.hoisted(() => ({ user: null as unknown, payload: null as unknown }))
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ user: session.user, payload: session.payload })),
}))

vi.mock('@/server/ledger-health', () => ({
  checkLedgerHealth: vi.fn(async () => ({ status: 'connected', latencyMs: 3 })),
}))

import { GET as getPendingDisbursements } from '@/app/api/pending-disbursements/route'
import { GET as getDashboard } from '@/app/api/dashboard/route'

const P = 'CXLQUEUE'

let payload: Payload
let pool: QueryablePool
let cancelledCountBefore = 0

type Res = { body: Record<string, any>; status: number }
const request = (url: string) => ({ nextUrl: new URL(url) }) as unknown as NextRequest

async function cleanup() {
  await pool.query(
    `DELETE FROM loan_accounts_repayment_schedule_payments
      WHERE _parent_id IN (SELECT id FROM loan_accounts WHERE loan_account_id LIKE $1)`,
    [`${P}%`],
  )
  await pool.query(`DELETE FROM loan_accounts WHERE loan_account_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM customers WHERE customer_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE 'cxlqueue-%'`)
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as QueryablePool
  await cleanup()
  cancelledCountBefore = (
    await payload.count({
      collection: 'loan-accounts',
      where: { accountStatus: { equals: 'cancelled' } },
    })
  ).totalDocs

  session.user = await payload.create({
    collection: 'users',
    data: {
      email: `cxlqueue-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: 'supervisor',
      firstName: 'Sam',
      lastName: 'Supervisor',
    },
  })
  session.payload = payload

  await payload.create({
    collection: 'customers',
    data: { customerId: `${P}-CUS`, firstName: 'Cass', lastName: 'Customer' } as any,
  })
  const today = sydneyDateString(new Date())
  for (const [suffix, status] of [
    ['PENDING', 'pending_disbursement'],
    ['CANCELLED', 'cancelled'],
  ] as const) {
    await payload.create({
      collection: 'loan-accounts',
      data: {
        loanAccountId: `${P}-${suffix}`,
        accountNumber: `${P}-${suffix}`,
        accountStatus: status,
        customerIdString: `${P}-CUS`,
        customerName: 'Cass Customer',
        commencementDate: `${today}T00:00:00.000Z`,
        loanTerms: { loanAmount: 500 },
      } as any,
    })
  }
})

afterAll(cleanup)

describe('cancelled loans leave the disbursement queues (AC13)', () => {
  it('pending disbursements excludes cancelled (AC13)', async () => {
    const res = (await getPendingDisbursements(
      request('http://localhost/api/pending-disbursements?limit=200'),
    )) as unknown as Res
    expect(res.status).toBe(200)
    const ids = (res.body.items as Array<{ loanAccountId: string }>).map((i) => i.loanAccountId)
    expect(ids).toContain(`${P}-PENDING`)
    expect(ids).not.toContain(`${P}-CANCELLED`)
  })

  it('dashboard returns cancelledBeforeDisbursementCount', async () => {
    const res = (await getDashboard(request('http://localhost/api/dashboard'))) as unknown as Res
    expect(res.status).toBe(200)
    expect(res.body.cancelledBeforeDisbursementCount).toBe(cancelledCountBefore + 1)
  })

  it('the dashboard pending list and buckets leave the cancelled loan out', async () => {
    const res = (await getDashboard(request('http://localhost/api/dashboard'))) as unknown as Res
    const ids = (res.body.pendingDisbursements as Array<{ loanAccountId: string }>).map(
      (i) => i.loanAccountId,
    )
    expect(ids).toContain(`${P}-PENDING`)
    expect(ids).not.toContain(`${P}-CANCELLED`)

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM loan_accounts WHERE account_status = 'pending_disbursement'`,
    )
    const b = res.body.disbursementBuckets
    expect(b.overdue.count + b.today.count + b.scheduled.count).toBe(rows[0].n)
  })
})
