/**
 * End-to-end for the transactions route's actor resolution: a REAL Payload
 * instance and Postgres, with only the ledger gRPC call mocked.
 *
 * The unit tests mock `payload.find`, so they prove the route calls it and
 * shapes the result — but not that the query matches a real row. This closes
 * that gap.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockGetTransactions = vi.hoisted(() => vi.fn())

vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({ getTransactions: mockGetTransactions }),
  getTransactionTypeLabel: () => 'Repayment',
  TransactionType: {},
}))

const mockRequireAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ requireAuth: mockRequireAuth }))

import { GET } from '@/app/api/ledger/transactions/route'

let payload: Payload
let actorId: string

beforeAll(async () => {
  payload = await getPayload({ config })
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `route-actor-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: 'operations',
      firstName: 'Kathryn',
      lastName: 'Wallace',
    },
  })
  actorId = String(user.id)

  mockRequireAuth.mockResolvedValue({
    user: { id: actorId, email: 'ops@billie.loans', role: 'admin' },
    payload,
  })
})

const makeGet = () =>
  ({ nextUrl: { searchParams: new URLSearchParams({ loanAccountId: 'LA-1' }) } }) as unknown as NextRequest

const ledgerTx = (overrides: Record<string, unknown>) => ({
  transactionId: 'tx-1',
  loanAccountId: 'LA-1',
  type: 'REPAYMENT',
  transactionDate: { seconds: '1788220440', nanos: 0 },
  effectiveDate: '2026-09-01',
  principalDelta: '-10.00',
  feeDelta: '0.00',
  totalDelta: '-10.00',
  principalAfter: '0.00',
  feeAfter: '0.00',
  totalAfter: '0.00',
  description: 'Payment received',
  referenceType: 'payment',
  referenceId: 'PAY-1',
  createdBy: 'system',
  createdAt: { seconds: '1788220440', nanos: 0 },
  ...overrides,
})

describe('GET /api/ledger/transactions — actor resolution against a real users table', () => {
  it('resolves a createdBy uuid to the operator name', async () => {
    mockGetTransactions.mockResolvedValue({
      loanAccountId: 'LA-1',
      transactions: [ledgerTx({ createdBy: actorId })],
      totalCount: 1,
    })

    const res = (await GET(makeGet())) as unknown as { body: { actors: Record<string, string> } }

    expect(res.body.actors).toEqual({ [actorId]: 'Kathryn Wallace' })
  })

  it('resolves an approver uuid held in ledger metadata', async () => {
    mockGetTransactions.mockResolvedValue({
      loanAccountId: 'LA-1',
      transactions: [ledgerTx({ type: 'FEE_WAIVER', metadata: { approved_by: actorId } })],
      totalCount: 1,
    })

    const res = (await GET(makeGet())) as unknown as { body: { actors: Record<string, string> } }

    expect(res.body.actors[actorId]).toBe('Kathryn Wallace')
  })
})
