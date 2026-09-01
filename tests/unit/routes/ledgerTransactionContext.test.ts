/**
 * Operator-entered context must survive the round trip to the Transactions tab.
 *
 * GET /api/ledger/transactions — the ledger stamps the operator's reason/notes
 * into `metadata` (and `notes` for the types that take a free-text note), so
 * both have to reach the client or the detail panel has nothing to show.
 *
 * POST /api/ledger/repayment — the Record Repayment drawer collects Notes; the
 * route has to forward them to the ledger.
 *
 * `@/server/grpc-client` is fully mocked (its module body loads the proto at
 * import time).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockPayloadFind = vi.hoisted(() =>
  vi.fn(async () => ({ docs: [] as Record<string, unknown>[] })),
)

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'user-1', email: 'ops@billie.loans', role: 'admin' },
    payload: { find: mockPayloadFind },
  })),
}))

vi.mock('@/lib/utils/version-check', () => ({
  checkVersion: vi.fn(async () => ({ isValid: true })),
  createVersionConflictResponse: vi.fn(() => ({ error: 'VERSION_CONFLICT' })),
}))

vi.mock('@/lib/utils/api-error', () => ({
  handleApiError: vi.fn((error: unknown) => ({ body: { error: String(error) }, status: 500 })),
  createValidationError: vi.fn((details: unknown) => ({
    body: { error: 'Validation failed', details },
    status: 400,
  })),
}))

const mockGetTransactions = vi.hoisted(() => vi.fn())
const mockRecordRepayment = vi.hoisted(() => vi.fn())
const mockApplyLateFee = vi.hoisted(() => vi.fn())
const mockApplyDishonourFee = vi.hoisted(() => vi.fn())
const mockDisburseLoan = vi.hoisted(() => vi.fn())

vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({
    getTransactions: mockGetTransactions,
    recordRepayment: mockRecordRepayment,
    applyLateFee: mockApplyLateFee,
    applyDishonourFee: mockApplyDishonourFee,
    disburseLoan: mockDisburseLoan,
  }),
  generateIdempotencyKey: vi.fn(() => 'server-fallback-repay'),
  timestampToDate: () => new Date('2026-09-01T00:00:00Z'),
  getTransactionTypeLabel: () => 'Label',
  TransactionType: {},
}))

import { GET as transactionsGET } from '@/app/api/ledger/transactions/route'
import { POST as repaymentPOST } from '@/app/api/ledger/repayment/route'
import { POST as lateFeePOST } from '@/app/api/ledger/late-fee/route'
import { POST as dishonourFeePOST } from '@/app/api/ledger/dishonour-fee/route'
import { POST as disbursePOST } from '@/app/api/ledger/disburse/route'

const makeGet = (params: Record<string, string>) =>
  ({ nextUrl: { searchParams: new URLSearchParams(params) } }) as unknown as NextRequest

const makePost = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

/** Shape the ledger returns from GetTransactions. */
const ledgerTx = (overrides: Record<string, unknown> = {}) => ({
  transactionId: 'tx-1',
  loanAccountId: 'LA-1',
  type: 'FEE_WAIVER',
  transactionDate: { seconds: '1788220440', nanos: 0 },
  effectiveDate: '2026-09-01',
  principalDelta: '0.00',
  feeDelta: '-10.00',
  totalDelta: '-10.00',
  principalAfter: '200.00',
  feeAfter: '0.00',
  totalAfter: '200.00',
  description: 'Fee waiver: Goodwill',
  referenceType: 'waiver',
  referenceId: 'WAIV-1',
  createdBy: 'user-1',
  createdAt: { seconds: '1788220440', nanos: 0 },
  ...overrides,
})

const repaymentTx = {
  transactionId: 'tx-2',
  loanAccountId: 'LA-1',
  type: 'REPAYMENT',
  transactionDate: { seconds: '0', nanos: 0 },
  principalDelta: '-100.00',
  feeDelta: '0.00',
  totalDelta: '-100.00',
  principalAfter: '0.00',
  feeAfter: '0.00',
  totalAfter: '0.00',
  description: 'Payment received',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecordRepayment.mockResolvedValue({ transaction: repaymentTx, eventId: 'evt-1' })
  mockApplyLateFee.mockResolvedValue({ transaction: repaymentTx, eventId: 'evt-1' })
  mockApplyDishonourFee.mockResolvedValue({ transaction: repaymentTx, eventId: 'evt-1' })
  mockDisburseLoan.mockResolvedValue({
    success: true,
    message: 'Loan disbursed successfully',
    disbursementTransactionId: 'TXN-1',
    feeTransactionId: '',
    eventId: 'evt-1',
    idempotentReplay: false,
  })
  mockPayloadFind.mockResolvedValue({ docs: [] })
})

describe('GET /api/ledger/transactions', () => {
  it('passes the ledger metadata through to the client', async () => {
    mockGetTransactions.mockResolvedValue({
      loanAccountId: 'LA-1',
      transactions: [
        ledgerTx({
          metadata: { reason: 'Goodwill - hardship call', approved_by: 'k.wallace' },
        }),
      ],
      totalCount: 1,
    })

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { transactions: { metadata: Record<string, string> }[] }
    }

    expect(res.body.transactions[0].metadata).toEqual({
      reason: 'Goodwill - hardship call',
      approved_by: 'k.wallace',
    })
  })

  it('passes the operator notes through to the client', async () => {
    mockGetTransactions.mockResolvedValue({
      loanAccountId: 'LA-1',
      transactions: [ledgerTx({ notes: 'Customer called to arrange early payout' })],
      totalCount: 1,
    })

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { transactions: { notes?: string }[] }
    }

    expect(res.body.transactions[0].notes).toBe('Customer called to arrange early payout')
  })

  it('defaults metadata to an empty object when the ledger omits it', async () => {
    mockGetTransactions.mockResolvedValue({
      loanAccountId: 'LA-1',
      transactions: [ledgerTx()],
      totalCount: 1,
    })

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { transactions: { metadata: Record<string, string> }[] }
    }

    expect(res.body.transactions[0].metadata).toEqual({})
  })
})

describe('POST /api/ledger/repayment', () => {
  it('forwards operator notes to the ledger', async () => {
    await repaymentPOST(
      makePost({
        loanAccountId: 'LA-1',
        amount: '100.00',
        paymentId: 'PAY-1',
        notes: 'Customer called to arrange early payout',
      }),
    )

    expect(mockRecordRepayment).toHaveBeenCalledWith(
      expect.objectContaining({ notes: 'Customer called to arrange early payout' }),
    )
  })

  it('rejects notes longer than the ledger accepts', async () => {
    const res = (await repaymentPOST(
      makePost({
        loanAccountId: 'LA-1',
        amount: '100.00',
        paymentId: 'PAY-1',
        notes: 'x'.repeat(1001),
      }),
    )) as { status: number }

    expect(res.status).toBe(400)
    expect(mockRecordRepayment).not.toHaveBeenCalled()
  })
})

/**
 * Who performed a servicing action was never sent to the ledger, so every
 * CRM-originated transaction recorded created_by="system" — a manual repayment
 * had no attribution at all. The actor is the authenticated session user; it is
 * never taken from the request body.
 */
describe('operator attribution', () => {
  it('sends the acting operator with a repayment', async () => {
    await repaymentPOST(
      makePost({ loanAccountId: 'LA-1', amount: '100.00', paymentId: 'PAY-1' }),
    )

    expect(mockRecordRepayment).toHaveBeenCalledWith(
      expect.objectContaining({ actionedBy: 'user-1' }),
    )
  })

  it('sends the acting operator with a late fee', async () => {
    await lateFeePOST(
      makePost({ loanAccountId: 'LA-1', feeAmount: '10.00', daysPastDue: 3 }),
    )

    expect(mockApplyLateFee).toHaveBeenCalledWith(
      expect.objectContaining({ actionedBy: 'user-1' }),
    )
  })

  it('sends the acting operator with a dishonour fee', async () => {
    await dishonourFeePOST(makePost({ loanAccountId: 'LA-1', feeAmount: '10.00' }))

    expect(mockApplyDishonourFee).toHaveBeenCalledWith(
      expect.objectContaining({ actionedBy: 'user-1' }),
    )
  })

  it('sends the acting operator with a disbursement', async () => {
    await disbursePOST(makePost({ loanAccountId: 'LA-1', bankReference: 'DD-1' }))

    expect(mockDisburseLoan).toHaveBeenCalledWith(
      expect.objectContaining({ actionedBy: 'user-1' }),
    )
  })

  it('ignores an actor supplied in the request body', async () => {
    await repaymentPOST(
      makePost({
        loanAccountId: 'LA-1',
        amount: '100.00',
        paymentId: 'PAY-1',
        actionedBy: 'someone-else',
      }),
    )

    expect(mockRecordRepayment).toHaveBeenCalledWith(
      expect.objectContaining({ actionedBy: 'user-1' }),
    )
  })
})

/**
 * Actor ids on a transaction are Payload user UUIDs. Rendering the raw GUID in
 * the servicing UI is useless to an operator, so the route resolves them once,
 * server-side, into a lookup the client can render.
 */
describe('GET /api/ledger/transactions — actor resolution', () => {
  const withTransactions = (transactions: unknown[]) =>
    mockGetTransactions.mockResolvedValue({
      loanAccountId: 'LA-1',
      transactions,
      totalCount: transactions.length,
    })

  const ACTOR_ID = '95979e54-7f2e-4578-a9d0-807c8951da68'

  it('resolves a createdBy id to a person', async () => {
    withTransactions([ledgerTx({ createdBy: ACTOR_ID })])
    mockPayloadFind.mockResolvedValue({
      docs: [
        { id: ACTOR_ID, firstName: 'Kathryn', lastName: 'Wallace', email: 'k.wallace@billie.loans' },
      ],
    })

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { actors: Record<string, string> }
    }

    expect(res.body.actors[ACTOR_ID]).toBe('Kathryn Wallace')
  })

  it('resolves an approver id held in metadata', async () => {
    withTransactions([ledgerTx({ metadata: { approved_by: ACTOR_ID } })])
    mockPayloadFind.mockResolvedValue({
      docs: [{ id: ACTOR_ID, email: 'k.wallace@billie.loans' }],
    })

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { actors: Record<string, string> }
    }

    expect(res.body.actors[ACTOR_ID]).toBe('k.wallace@billie.loans')
  })

  it('never looks up the system actor', async () => {
    withTransactions([ledgerTx({ createdBy: 'system' })])

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { actors: Record<string, string> }
    }

    expect(mockPayloadFind).not.toHaveBeenCalled()
    expect(res.body.actors).toEqual({})
  })

  it('omits an id that does not resolve, rather than inventing a name', async () => {
    withTransactions([ledgerTx({ createdBy: ACTOR_ID })])
    mockPayloadFind.mockResolvedValue({ docs: [] })

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { actors: Record<string, string> }
    }

    expect(res.body.actors).toEqual({})
  })

  it('still returns transactions when the user lookup fails', async () => {
    withTransactions([ledgerTx({ createdBy: ACTOR_ID })])
    mockPayloadFind.mockRejectedValue(new Error('users collection unavailable'))

    const res = (await transactionsGET(makeGet({ loanAccountId: 'LA-1' }))) as unknown as {
      body: { transactions: unknown[]; actors: Record<string, string> }
    }

    expect(res.body.transactions).toHaveLength(1)
    expect(res.body.actors).toEqual({})
  })
})
