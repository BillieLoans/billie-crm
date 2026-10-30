/**
 * POST /api/ledger/cancel-account against a real Payload and Postgres (BTB-517).
 *
 * The unit tests stub Payload. This runs the real route handler over the real
 * collections, so what they cannot prove is proved here: the supervisor's
 * claimed manual block is read from the customer's real `reapplicationBlock`
 * columns, the pinned system note passes the ContactNotes validation and hooks,
 * and a replayed cancel finds the note it left the first time and does not
 * write a second. Only the ledger gRPC client and the session are replaced.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'

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

const mockCancelAccount = vi.hoisted(() => vi.fn())
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ cancelAccount: mockCancelAccount }),
}))

import { POST } from '@/app/api/ledger/cancel-account/route'

const P = 'CANCELRT'
const KEY = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'
const NOTE = 'Customer rang and asked us to stop before the money moved.'

let payload: Payload
let pool: QueryablePool
let loanDocId = ''
let customerDocId = ''

type Res = { body: Record<string, any>; status: number }
const call = async (over: Record<string, unknown> = {}) =>
  (await POST({
    json: async () => ({
      loanAccountId: `${P}-LOAN`,
      reason: 'customer_withdrew',
      note: NOTE,
      blockConfirmation: { kind: 'manual_block_active' },
      idempotencyKey: KEY,
      ...over,
    }),
  } as unknown as NextRequest)) as unknown as Res

async function cleanup() {
  await pool.query(
    `DELETE FROM contact_notes WHERE subject = 'Loan cancelled before disbursement'
                      AND loan_account_id IN (SELECT id FROM loan_accounts WHERE loan_account_id LIKE $1)`,
    [`${P}%`],
  )
  await pool.query(`DELETE FROM loan_accounts WHERE loan_account_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM customers WHERE customer_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE 'cancelrt-%'`)
}

const notes = async () =>
  (
    await pool.query(`SELECT * FROM contact_notes WHERE loan_account_id = $1 AND subject = $2`, [
      loanDocId,
      'Loan cancelled before disbursement',
    ])
  ).rows

const setBlock = async (reason: string | null, blockedUntil: string | null = null) => {
  await pool.query(
    `UPDATE customers SET reapplication_block_reason = $2, reapplication_block_blocked_until = $3
      WHERE id = $1`,
    [customerDocId, reason, blockedUntil],
  )
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as QueryablePool
  await cleanup()
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `cancelrt-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: 'supervisor',
      firstName: 'Sam',
      lastName: 'Supervisor',
    },
  })
  session.user = user
  session.payload = payload
  const customer = await payload.create({
    collection: 'customers',
    data: { customerId: `${P}-CUS`, firstName: 'Cass', lastName: 'Customer' } as any,
  })
  customerDocId = String(customer.id)
  const loan = await payload.create({
    collection: 'loan-accounts',
    data: {
      loanAccountId: `${P}-LOAN`,
      accountNumber: `${P}-1`,
      accountStatus: 'pending_disbursement',
      customerIdString: `${P}-CUS`,
    },
  })
  loanDocId = String(loan.id)
})

afterAll(cleanup)

beforeEach(async () => {
  vi.clearAllMocks()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockCancelAccount.mockResolvedValue({
    success: true,
    message: 'Account cancelled',
    eventId: 'evt-1',
    cancelledAt: '2026-10-30T04:45:00+00:00',
    previousStatus: 'PENDING_DISBURSEMENT',
    idempotentReplay: false,
  })
  await pool.query(`DELETE FROM contact_notes WHERE loan_account_id = $1`, [loanDocId])
  await setBlock(null)
})

describe('cancel-account route over a real Payload', () => {
  it('refuses a claimed manual block that is not on the customer record (AC16)', async () => {
    await setBlock(null)

    const res = await call()

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('BLOCK_REQUIRED')
    expect(mockCancelAccount).not.toHaveBeenCalled()
    expect(await notes()).toHaveLength(0)
  })

  it('refuses a block that is active but not MANUAL_ADMIN', async () => {
    await setBlock('PEP')

    const res = await call()

    expect(res.status).toBe(422)
    expect(mockCancelAccount).not.toHaveBeenCalled()
  })

  it('cancels and leaves the pinned note when a manual block is in place', async () => {
    await setBlock('MANUAL_ADMIN')

    const res = await call()

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, noteError: false })
    expect(mockCancelAccount).toHaveBeenCalledTimes(1)

    const rows = await notes()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      channel: 'system',
      topic: 'account_update',
      customer_id: customerDocId,
      status: 'active',
    })
    expect(rows[0].created_by_id).toBe((session.user as { id: string }).id)
    expect(rows[0].content).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: `Cancelled — Customer withdrew — ${NOTE} — by Sam Supervisor at 30 Oct 2026, 3:45 pm — evidence: none`,
            },
          ],
        },
      ],
    })
  })

  it('does not write a second note when the cancel is replayed', async () => {
    await setBlock('MANUAL_ADMIN')
    await call()

    mockCancelAccount.mockResolvedValue({
      success: true,
      message: 'Account already cancelled',
      eventId: 'evt-1',
      cancelledAt: '2026-10-30T04:45:00+00:00',
      previousStatus: 'PENDING_DISBURSEMENT',
      idempotentReplay: true,
    })
    const res = await call()

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ idempotentReplay: true, noteError: false })
    expect(await notes()).toHaveLength(1)
  })

  it('writes the note on a replay when the first attempt could not', async () => {
    mockCancelAccount.mockResolvedValue({
      success: true,
      message: 'Account already cancelled',
      eventId: 'evt-1',
      cancelledAt: '2026-10-30T04:45:00+00:00',
      previousStatus: 'PENDING_DISBURSEMENT',
      idempotentReplay: true,
    })

    const res = await call({
      blockConfirmation: { kind: 'no_block_needed', reason: 'Customer is welcome back' },
    })

    expect(res.status).toBe(200)
    expect(await notes()).toHaveLength(1)
  })
})
