/**
 * POST /api/ledger/disburse: how the route reports a rejected disbursement.
 *
 * BTB-517: once a loan has been cancelled before disbursement the ledger
 * refuses DisburseLoan with FAILED_PRECONDITION `Loan is CANCELLED — cannot
 * disburse.` The route turns that into a 409 LOAN_CANCELLED the drawer shows
 * as an error. The older ALREADY_DISBURSED mapping and the generic
 * FAILED_PRECONDITION mapping must keep working.
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
    user: { id: 'user-1', email: 'ops@billie.loans', role: 'operations' },
    payload: {},
  })),
}))

const mockDisburseLoan = vi.hoisted(() => vi.fn())
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ disburseLoan: mockDisburseLoan }),
  generateIdempotencyKey: (prefix: string) => `server-${prefix}`,
}))

import { POST } from '@/app/api/ledger/disburse/route'

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
type Res = { body: Record<string, any>; status: number }

const BODY = {
  loanAccountId: 'LA-1',
  bankReference: 'BANK-REF-1',
  idempotencyKey: 'disburse-key-12345678',
}

const grpcError = (code: number, details: string) =>
  Object.assign(new Error(`${code} ${details}`), { code, details })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/ledger/disburse: rejections', () => {
  it('disburse maps cancelled rejection to 409 LOAN_CANCELLED', async () => {
    mockDisburseLoan.mockRejectedValue(grpcError(9, 'Loan is CANCELLED — cannot disburse.'))

    const res = (await POST(makeRequest(BODY))) as unknown as Res

    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      error: 'LOAN_CANCELLED',
      message: 'Loan is CANCELLED — cannot disburse.',
    })
  })

  it('matches the cancelled rejection by its details text, not the exact string', async () => {
    mockDisburseLoan.mockRejectedValue(
      grpcError(9, 'Loan is CANCELLED (A110C401) — cannot disburse.'),
    )

    const res = (await POST(makeRequest(BODY))) as unknown as Res

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('LOAN_CANCELLED')
    // The message shown to the operator is the fixed copy.
    expect(res.body.message).toBe('Loan is CANCELLED — cannot disburse.')
  })

  it('keeps ALREADY_DISBURSED for a duplicate disbursement', async () => {
    mockDisburseLoan.mockRejectedValue(grpcError(6, 'Loan has already been disbursed'))

    const res = (await POST(makeRequest(BODY))) as unknown as Res

    expect(res.status).toBe(409)
    expect(res.body.error).toBe('ALREADY_DISBURSED')
  })

  it('still sends any other FAILED_PRECONDITION through the generic 422 mapping', async () => {
    mockDisburseLoan.mockRejectedValue(grpcError(9, 'Loan is in status ACTIVE'))

    const res = (await POST(makeRequest(BODY))) as unknown as Res

    expect(res.status).toBe(422)
    expect(res.body.error).not.toBe('LOAN_CANCELLED')
  })
})
