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

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({
    user: { id: 'user-1', email: 'ops@billie.loans', role: 'admin' },
    payload: {},
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

vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({
    getTransactions: mockGetTransactions,
    recordRepayment: mockRecordRepayment,
  }),
  generateIdempotencyKey: vi.fn(() => 'server-fallback-repay'),
  timestampToDate: () => new Date('2026-09-01T00:00:00Z'),
  getTransactionTypeLabel: () => 'Label',
  TransactionType: {},
}))

import { GET as transactionsGET } from '@/app/api/ledger/transactions/route'
import { POST as repaymentPOST } from '@/app/api/ledger/repayment/route'

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
