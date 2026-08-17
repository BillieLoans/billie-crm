/**
 * Unit tests for client-supplied idempotency keys on the money-moving ledger
 * routes (P0-1):
 *   POST /api/ledger/repayment
 *   POST /api/ledger/waive-fee
 *   POST /api/ledger/adjustment
 *   POST /api/ledger/late-fee
 *   POST /api/ledger/dishonour-fee
 *   POST /api/ledger/disburse
 *
 * Each route must:
 *   - forward a body-supplied `idempotencyKey` verbatim to the gRPC call, and
 *   - fall back to the server-generated key when the body omits one
 *     (backwards compatibility for callers not yet updated), and
 *   - reject a key shorter than the 8-char minimum with a 400.
 *
 * `@/server/grpc-client` is fully mocked (its module body loads the proto at
 * import time); `generateIdempotencyKey` is a spy returning a sentinel so the
 * fallback path is observable.
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

const mockRecordRepayment = vi.hoisted(() => vi.fn())
const mockWaiveFee = vi.hoisted(() => vi.fn())
const mockMakeAdjustment = vi.hoisted(() => vi.fn())
const mockApplyLateFee = vi.hoisted(() => vi.fn())
const mockApplyDishonourFee = vi.hoisted(() => vi.fn())
const mockDisburseLoan = vi.hoisted(() => vi.fn())
const mockGenerateIdempotencyKey = vi.hoisted(() =>
  vi.fn((prefix: string) => `server-fallback-${prefix}`),
)

vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({
    recordRepayment: mockRecordRepayment,
    waiveFee: mockWaiveFee,
    makeAdjustment: mockMakeAdjustment,
    applyLateFee: mockApplyLateFee,
    applyDishonourFee: mockApplyDishonourFee,
    disburseLoan: mockDisburseLoan,
  }),
  generateIdempotencyKey: mockGenerateIdempotencyKey,
  timestampToDate: () => new Date('2026-01-01T00:00:00Z'),
  getTransactionTypeLabel: () => 'Label',
}))

import { POST as repaymentPOST } from '@/app/api/ledger/repayment/route'
import { POST as waiveFeePOST } from '@/app/api/ledger/waive-fee/route'
import { POST as adjustmentPOST } from '@/app/api/ledger/adjustment/route'
import { POST as lateFeePOST } from '@/app/api/ledger/late-fee/route'
import { POST as dishonourFeePOST } from '@/app/api/ledger/dishonour-fee/route'
import { POST as disbursePOST } from '@/app/api/ledger/disburse/route'

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

/** Minimal transaction shape every fee/adjustment route parseFloat()s. */
const TX = {
  transactionId: 'tx-1',
  loanAccountId: 'LA-1',
  type: 'ADJUSTMENT',
  transactionDate: { seconds: '0', nanos: 0 },
  principalDelta: '0.00',
  feeDelta: '0.00',
  totalDelta: '0.00',
  principalAfter: '0.00',
  feeAfter: '0.00',
  totalAfter: '0.00',
  description: 'desc',
}

const CLIENT_KEY = 'user-1-waive-fee-1755400000000-abcd1234'

type Case = {
  name: string
  POST: (req: NextRequest) => Promise<unknown>
  grpc: ReturnType<typeof vi.fn>
  body: Record<string, unknown>
  fallbackKey: string
}

const CASES: Case[] = [
  {
    name: 'repayment',
    POST: repaymentPOST,
    grpc: mockRecordRepayment,
    body: { loanAccountId: 'LA-1', amount: '100.00', paymentId: 'PAY-1' },
    fallbackKey: 'server-fallback-repay',
  },
  {
    name: 'waive-fee',
    POST: waiveFeePOST,
    grpc: mockWaiveFee,
    body: { loanAccountId: 'LA-1', waiverAmount: '10.00', reason: 'goodwill' },
    fallbackKey: 'server-fallback-waive',
  },
  {
    name: 'adjustment',
    POST: adjustmentPOST,
    grpc: mockMakeAdjustment,
    body: {
      loanAccountId: 'LA-1',
      principalDelta: '-5.00',
      feeDelta: '0.00',
      reason: 'correction',
    },
    fallbackKey: 'server-fallback-adjust',
  },
  {
    name: 'late-fee',
    POST: lateFeePOST,
    grpc: mockApplyLateFee,
    body: { loanAccountId: 'LA-1', feeAmount: '10.00', daysPastDue: 7 },
    fallbackKey: 'server-fallback-latefee',
  },
  {
    name: 'dishonour-fee',
    POST: dishonourFeePOST,
    grpc: mockApplyDishonourFee,
    body: { loanAccountId: 'LA-1', feeAmount: '10.00' },
    fallbackKey: 'server-fallback-dishonourfee',
  },
  {
    name: 'disburse',
    POST: disbursePOST,
    grpc: mockDisburseLoan,
    body: { loanAccountId: 'LA-1', bankReference: 'REF-1' },
    fallbackKey: 'server-fallback-disburse',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockGenerateIdempotencyKey.mockImplementation((prefix: string) => `server-fallback-${prefix}`)
  for (const grpc of [
    mockRecordRepayment,
    mockWaiveFee,
    mockMakeAdjustment,
    mockApplyLateFee,
    mockApplyDishonourFee,
  ]) {
    grpc.mockResolvedValue({ transaction: TX, eventId: 'evt-1' })
  }
  mockDisburseLoan.mockResolvedValue({
    success: true,
    message: 'ok',
    disbursementTransactionId: 'tx-1',
    feeTransactionId: 'tx-2',
    eventId: 'evt-1',
    idempotentReplay: false,
  })
})

describe.each(CASES)('POST /api/ledger/$name — idempotency key', (testCase) => {
  it('forwards a body-supplied idempotencyKey to the ledger verbatim', async () => {
    await testCase.POST(makeRequest({ ...testCase.body, idempotencyKey: CLIENT_KEY }))

    expect(testCase.grpc).toHaveBeenCalledTimes(1)
    expect(testCase.grpc.mock.calls[0][0]).toMatchObject({ idempotencyKey: CLIENT_KEY })
    expect(mockGenerateIdempotencyKey).not.toHaveBeenCalled()
  })

  it('replays the SAME key on a repeated POST (retry) so the ledger can dedupe', async () => {
    await testCase.POST(makeRequest({ ...testCase.body, idempotencyKey: CLIENT_KEY }))
    await testCase.POST(makeRequest({ ...testCase.body, idempotencyKey: CLIENT_KEY }))

    expect(testCase.grpc).toHaveBeenCalledTimes(2)
    expect(testCase.grpc.mock.calls[0][0].idempotencyKey).toBe(
      testCase.grpc.mock.calls[1][0].idempotencyKey,
    )
  })

  it('falls back to a server-generated key when the body omits one', async () => {
    await testCase.POST(makeRequest(testCase.body))

    expect(mockGenerateIdempotencyKey).toHaveBeenCalledTimes(1)
    expect(testCase.grpc.mock.calls[0][0]).toMatchObject({
      idempotencyKey: testCase.fallbackKey,
    })
  })

  it('rejects a key shorter than 8 characters with a 400', async () => {
    const res = (await testCase.POST(
      makeRequest({ ...testCase.body, idempotencyKey: 'short' }),
    )) as { status: number }

    expect(res.status).toBe(400)
    expect(testCase.grpc).not.toHaveBeenCalled()
  })
})
