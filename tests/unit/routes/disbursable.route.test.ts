/**
 * GET /api/ledger/disbursable: the platform's verdict on whether a loan can be
 * disbursed (BTB-517).
 *
 * The Pending Disbursements payment panel calls this before it shows any payout
 * details. The CRM holds no rule of its own, so the route relays the ledger's
 * CheckDisbursable answer and fails closed: every gRPC error becomes one fixed
 * 503 that carries none of the error's own text.
 *
 * `@/server/grpc-client` is mocked (its module body loads the proto at import
 * time).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      body,
      status: init?.status ?? 200,
      headers: init?.headers ?? {},
    })),
  },
}))

const state = vi.hoisted(() => ({
  /** null = not signed in (401). */
  user: { id: 'user-1', email: 'ops@billie.loans', role: 'operations' } as {
    id: string
    email: string
    role: string
  } | null,
}))

// The mock honours the route's access check, so a wrong predicate fails a test.
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async (accessCheck?: (u: unknown) => boolean) => {
    if (!state.user) {
      return { error: { body: { error: { code: 'UNAUTHENTICATED' } }, status: 401 } }
    }
    if (accessCheck && !accessCheck(state.user)) {
      return { error: { body: { error: { code: 'FORBIDDEN' } }, status: 403 } }
    }
    return { user: state.user, payload: {} }
  }),
}))

const mockCheckDisbursable = vi.hoisted(() => vi.fn())
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ checkDisbursable: mockCheckDisbursable }),
}))

import { GET } from '@/app/api/ledger/disbursable/route'

type Res = { body: Record<string, any>; status: number; headers: Record<string, string> }

const makeRequest = (query: string) =>
  ({ nextUrl: { searchParams: new URLSearchParams(query) } }) as unknown as NextRequest

const call = async (query = 'loanAccountId=LA-1') =>
  (await GET(makeRequest(query))) as unknown as Res

const grpcError = (code: number, details: string) =>
  Object.assign(new Error(`${code} ${details}`), { code, details })

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'user-1', email: 'ops@billie.loans', role: 'operations' }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/ledger/disbursable: access', () => {
  it('is 401 when nobody is signed in, and never asks the ledger', async () => {
    state.user = null

    const res = await call()

    expect(res.status).toBe(401)
    expect(mockCheckDisbursable).not.toHaveBeenCalled()
  })

  it.each(['readonly', 'service', 'marketing'])(
    'is 403 for the %s role (servicing roles only, like DisburseLoan)',
    async (role) => {
      state.user = { id: 'user-2', email: 'x@billie.loans', role }

      const res = await call()

      expect(res.status).toBe(403)
      expect(mockCheckDisbursable).not.toHaveBeenCalled()
    },
  )

  it.each(['operations', 'supervisor', 'admin'])('lets the %s role ask', async (role) => {
    state.user = { id: 'user-2', email: 'x@billie.loans', role }
    mockCheckDisbursable.mockResolvedValue({
      disbursable: true,
      reason: 'DISBURSABLE',
      status: 'PENDING_DISBURSEMENT',
      message: '',
    })

    const res = await call()

    expect(res.status).toBe(200)
  })
})

describe('GET /api/ledger/disbursable: request', () => {
  it('is 400 without a loanAccountId, and never asks the ledger', async () => {
    const res = await call('')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/loanAccountId/)
    expect(mockCheckDisbursable).not.toHaveBeenCalled()
  })

  it('is 400 for an empty loanAccountId', async () => {
    const res = await call('loanAccountId=')

    expect(res.status).toBe(400)
    expect(mockCheckDisbursable).not.toHaveBeenCalled()
  })
})

describe('GET /api/ledger/disbursable: the verdict', () => {
  it('passes the loan to the ledger and maps its answer, uncached', async () => {
    mockCheckDisbursable.mockResolvedValue({
      disbursable: true,
      reason: 'DISBURSABLE',
      status: 'PENDING_DISBURSEMENT',
      message: '',
    })

    const res = await call('loanAccountId=LA-1')

    expect(mockCheckDisbursable).toHaveBeenCalledWith({ loanAccountId: 'LA-1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      disbursable: true,
      reason: 'DISBURSABLE',
      status: 'PENDING_DISBURSEMENT',
      message: '',
    })
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('relays a refusal as 200 with the platform reason, status and message', async () => {
    mockCheckDisbursable.mockResolvedValue({
      disbursable: false,
      reason: 'CANCELLED',
      status: 'CANCELLED',
      message: 'Loan is CANCELLED — cannot disburse.',
    })

    const res = await call()

    // A refusal is an answer, not an error: the panel words it from `reason`.
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      disbursable: false,
      reason: 'CANCELLED',
      status: 'CANCELLED',
      message: 'Loan is CANCELLED — cannot disburse.',
    })
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('treats anything but a true `disbursable` as a refusal', async () => {
    // A gRPC default on an empty response must never read as permission.
    mockCheckDisbursable.mockResolvedValue({ reason: '', status: '', message: '' })

    const res = await call()

    expect(res.status).toBe(200)
    expect(res.body.disbursable).toBe(false)
  })

  it('URL-decodes the loanAccountId', async () => {
    mockCheckDisbursable.mockResolvedValue({
      disbursable: false,
      reason: 'NO_LEDGER_RECORD',
      status: '',
      message: 'No ledger record yet',
    })

    await call('loanAccountId=LA%2F1')

    expect(mockCheckDisbursable).toHaveBeenCalledWith({ loanAccountId: 'LA/1' })
  })
})

describe('GET /api/ledger/disbursable: failures fail closed', () => {
  it.each([
    ['UNAVAILABLE', 14, 'connection refused 10.0.3.7:50051'],
    ['UNIMPLEMENTED (an older platform)', 12, 'Method not found: CheckDisbursable'],
    ['DEADLINE_EXCEEDED', 4, 'Deadline exceeded after 10.001s'],
    ['PERMISSION_DENIED', 7, 'caller lacks scope ledger:read'],
    ['INTERNAL', 13, 'redis: stack trace at accountingLedgerService/grpc/server.py:412'],
  ])('maps %s to 503 DISBURSABLE_CHECK_FAILED', async (_name, code, details) => {
    mockCheckDisbursable.mockRejectedValue(grpcError(code, details))

    const res = await call()

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('DISBURSABLE_CHECK_FAILED')
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('does not leak the error text or gRPC details to the browser', async () => {
    mockCheckDisbursable.mockRejectedValue(
      grpcError(14, 'connect ECONNREFUSED 10.0.3.7:50051 (accounting-ledger.internal)'),
    )

    const res = await call()

    const serialised = JSON.stringify(res.body)
    expect(serialised).not.toMatch(/ECONNREFUSED|10\.0\.3\.7|internal|50051/)
    expect(Object.keys(res.body).sort()).toEqual(['error', 'message'])
    expect(res.body.message).toEqual(expect.any(String))
    expect(res.body.message).not.toBe('')
  })

  it('maps a non-gRPC failure the same way', async () => {
    mockCheckDisbursable.mockRejectedValue(new TypeError('boom'))

    const res = await call()

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('DISBURSABLE_CHECK_FAILED')
    expect(JSON.stringify(res.body)).not.toMatch(/boom/)
  })

  it('logs the failure server-side for diagnosis', async () => {
    mockCheckDisbursable.mockRejectedValue(grpcError(14, 'down'))

    await call()

    expect(console.error).toHaveBeenCalled()
  })
})
