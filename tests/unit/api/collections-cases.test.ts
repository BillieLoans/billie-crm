/**
 * Unit tests for GET /api/collections/cases and GET /api/collections/cases/[accountId]
 * (BTB-200 WS2 — Task 3)
 *
 * Mocks:
 *   - next/server          → NextResponse.json returns { body, status } for easy assertion
 *   - @/lib/auth            → requireAuth is a hoisted spy so tests can flip between an
 *                             authed user (with a mock `payload`) and a 401 error response
 *   - @/server/grpc-client  → getLedgerClient returns a mock with a getOverdueAccounts spy
 *
 * Covers: 401 unauthenticated, filter mapping (state/rung/flags/customerId) into the
 * payload.find where-clause, pagination echo, aging join keyed by accountId, ledger
 * UNAVAILABLE (code 14) → agingUnavailable + null aging + 200, and detail 404.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// next/server mock — must be first so hoisting works
// ---------------------------------------------------------------------------
vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

// ---------------------------------------------------------------------------
// Auth mock — hoisted spy so each test can control the auth outcome
// ---------------------------------------------------------------------------
const mockRequireAuth = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ requireAuth: mockRequireAuth }))

// ---------------------------------------------------------------------------
// Payload mock — hoisted `find` spy shared via the mocked `payload` object
// returned from `requireAuth`
// ---------------------------------------------------------------------------
const mockFind = vi.hoisted(() => vi.fn())
const mockPayload = { find: mockFind }

// ---------------------------------------------------------------------------
// grpc-client mock — hoisted getOverdueAccounts spy
// ---------------------------------------------------------------------------
const mockGetOverdueAccounts = vi.hoisted(() => vi.fn())
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: vi.fn(() => ({ getOverdueAccounts: mockGetOverdueAccounts })),
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { GET } from '@/app/api/collections/cases/route'
import { GET as GET_DETAIL } from '@/app/api/collections/cases/[accountId]/route'

const AUTHED_USER = { id: 'ops-1', role: 'operations' }

const makeListRequest = (qs = '') =>
  ({ nextUrl: new URL(`http://localhost/api/collections/cases${qs}`) }) as any

const makeDetailRequest = () => ({ nextUrl: new URL('http://localhost/api/collections/cases/x') }) as any
const makeParams = (accountId: string) => ({ params: Promise.resolve({ accountId }) })

/** Default collection-cases + loan-accounts find implementation, per-test overridable. */
function setFindImpl(opts: {
  cases?: { docs: any[]; totalDocs?: number; page?: number; totalPages?: number; hasNextPage?: boolean }
  loanAccounts?: { docs: any[] }
}) {
  const cases = { totalDocs: 0, page: 1, totalPages: 1, hasNextPage: false, docs: [], ...opts.cases }
  const loanAccounts = opts.loanAccounts ?? { docs: [] }
  mockFind.mockImplementation(async (args: any) => {
    if (args.collection === 'collection-cases') return cases
    if (args.collection === 'loan-accounts') return loanAccounts
    throw new Error(`Unexpected collection in test: ${args.collection}`)
  })
}

describe('GET /api/collections/cases', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset()
    mockFind.mockReset()
    mockGetOverdueAccounts.mockReset()
    mockRequireAuth.mockResolvedValue({ user: AUTHED_USER, payload: mockPayload })
    mockGetOverdueAccounts.mockResolvedValue({ accounts: [], totalCount: 0 })
    setFindImpl({})
  })

  it('401: returns requireAuth error response unchanged, no payload.find call', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      error: { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } },
    })

    const res: any = await GET(makeListRequest())

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('filter mapping: state/rung/hardshipPaused/stoppedContact/customerId → payload.find where-clause', async () => {
    await GET(
      makeListRequest('?state=open&rung=2&hardshipPaused=true&stoppedContact=true&customerId=cust-1'),
    )

    const casesCall = mockFind.mock.calls.find((c) => c[0].collection === 'collection-cases')
    expect(casesCall).toBeDefined()
    expect(casesCall![0].where).toEqual({
      and: [
        { state: { equals: 'open' } },
        { rung: { equals: 2 } },
        { hardshipPaused: { equals: true } },
        { stoppedContact: { equals: true } },
        { customerId: { equals: 'cust-1' } },
      ],
    })
    expect(casesCall![0].sort).toBe('-updatedAt')
  })

  it('filter mapping: no query params → where is undefined (no filters)', async () => {
    await GET(makeListRequest())

    const casesCall = mockFind.mock.calls.find((c) => c[0].collection === 'collection-cases')
    expect(casesCall![0].where).toBeUndefined()
  })

  it('pagination: echoes page/limit through to payload.find and response body', async () => {
    setFindImpl({
      cases: { docs: [], totalDocs: 42, page: 2, totalPages: 5, hasNextPage: true },
    })

    const res: any = await GET(makeListRequest('?page=2&limit=10'))

    const casesCall = mockFind.mock.calls.find((c) => c[0].collection === 'collection-cases')
    expect(casesCall![0].page).toBe(2)
    expect(casesCall![0].limit).toBe(10)

    expect(res.body.totalDocs).toBe(42)
    expect(res.body.page).toBe(2)
    expect(res.body.totalPages).toBe(5)
    expect(res.body.hasNextPage).toBe(true)
  })

  it('pagination: limit is clamped to a max of 100', async () => {
    await GET(makeListRequest('?limit=500'))

    const casesCall = mockFind.mock.calls.find((c) => c[0].collection === 'collection-cases')
    expect(casesCall![0].limit).toBe(100)
  })

  it('aging join: matches ledger accounts to cases keyed by accountId, enriches with loan-account fields', async () => {
    setFindImpl({
      cases: {
        docs: [
          {
            accountId: 'acc-1',
            customerId: 'cust-1',
            state: 'open',
            rung: 1,
            hardshipPaused: false,
            stoppedContact: false,
            overdueAmount: 100,
            daysOverdue: 5,
            lastStep: 2,
            openedAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
      loanAccounts: {
        docs: [
          {
            loanAccountId: 'acc-1',
            accountNumber: 'ACC-001',
            customerIdString: 'cust-1',
            customerName: 'Jane Doe',
          },
        ],
      },
    })
    mockGetOverdueAccounts.mockResolvedValue({
      accounts: [{ accountId: 'acc-1', dpd: 10, bucket: 'early_arrears', totalOverdueAmount: '150.00' }],
      totalCount: 1,
    })

    const res: any = await GET(makeListRequest())

    expect(mockGetOverdueAccounts).toHaveBeenCalledWith({ pageSize: 1000 })
    expect(res.body.cases).toHaveLength(1)
    expect(res.body.cases[0]).toMatchObject({
      accountId: 'acc-1',
      accountNumber: 'ACC-001',
      customerName: 'Jane Doe',
      customerId: 'cust-1',
      aging: { dpd: 10, bucket: 'early_arrears', totalOverdue: '150.00' },
    })
    expect(res.body.agingUnavailable).toBe(false)
  })

  it('aging join: a case whose accountId has no matching ledger account gets aging: null', async () => {
    setFindImpl({
      cases: {
        docs: [
          {
            accountId: 'acc-no-match',
            customerId: null,
            state: 'open',
            rung: null,
            hardshipPaused: false,
            stoppedContact: false,
            overdueAmount: null,
            daysOverdue: null,
            lastStep: null,
            openedAt: null,
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
    })
    mockGetOverdueAccounts.mockResolvedValue({
      accounts: [{ accountId: 'some-other-acc', dpd: 3, bucket: 'current', totalOverdueAmount: '0.00' }],
    })

    const res: any = await GET(makeListRequest())

    expect(res.body.cases[0].aging).toBeNull()
  })

  it('ledger UNAVAILABLE (code 14): agingUnavailable=true, aging null on every row, still 200', async () => {
    setFindImpl({
      cases: {
        docs: [
          {
            accountId: 'acc-1',
            customerId: 'cust-1',
            state: 'open',
            rung: 1,
            hardshipPaused: false,
            stoppedContact: false,
            overdueAmount: 100,
            daysOverdue: 5,
            lastStep: 2,
            openedAt: null,
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
    })
    mockGetOverdueAccounts.mockRejectedValueOnce({ code: 14, message: '14 UNAVAILABLE: connect failed' })

    const res: any = await GET(makeListRequest())

    expect(res.status).toBe(200)
    expect(res.body.agingUnavailable).toBe(true)
    expect(res.body.cases[0].aging).toBeNull()
  })

  it('non-UNAVAILABLE ledger error propagates as 500 with the standard error envelope', async () => {
    mockGetOverdueAccounts.mockRejectedValueOnce(new Error('boom'))

    const res: any = await GET(makeListRequest())

    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch collection cases' },
    })
  })

  it('filter mapping: an invalid ?rung= value is dropped (no where clause added)', async () => {
    await GET(makeListRequest('?rung=abc'))

    const casesCall = mockFind.mock.calls.find((c) => c[0].collection === 'collection-cases')
    expect(casesCall![0].where).toBeUndefined()
  })
})

describe('GET /api/collections/cases/[accountId]', () => {
  beforeEach(() => {
    mockRequireAuth.mockReset()
    mockFind.mockReset()
    mockGetOverdueAccounts.mockReset()
    mockRequireAuth.mockResolvedValue({ user: AUTHED_USER, payload: mockPayload })
    mockGetOverdueAccounts.mockResolvedValue({ accounts: [], totalCount: 0 })
    setFindImpl({})
  })

  it('401: returns requireAuth error response unchanged', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      error: { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } },
    })

    const res: any = await GET_DETAIL(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(401)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('404: no matching case → {error:{code:"NOT_FOUND"}}', async () => {
    setFindImpl({ cases: { docs: [] } })

    const res: any = await GET_DETAIL(makeDetailRequest(), makeParams('does-not-exist'))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('happy path: enriches the single row with loan-account + aging data', async () => {
    setFindImpl({
      cases: {
        docs: [
          {
            accountId: 'acc-1',
            customerId: 'cust-1',
            state: 'awaiting_human',
            rung: 5,
            hardshipPaused: true,
            stoppedContact: false,
            overdueAmount: 250,
            daysOverdue: 20,
            lastStep: 5,
            openedAt: '2026-05-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
      loanAccounts: {
        docs: [
          {
            loanAccountId: 'acc-1',
            accountNumber: 'ACC-001',
            customerIdString: 'cust-1',
            customerName: 'Jane Doe',
          },
        ],
      },
    })
    mockGetOverdueAccounts.mockResolvedValue({
      accounts: [{ accountId: 'acc-1', dpd: 20, bucket: 'late_arrears', totalOverdueAmount: '250.00' }],
    })

    const res: any = await GET_DETAIL(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(200)
    expect(res.body.case).toMatchObject({
      accountId: 'acc-1',
      accountNumber: 'ACC-001',
      customerName: 'Jane Doe',
      state: 'awaiting_human',
      hardshipPaused: true,
      aging: { dpd: 20, bucket: 'late_arrears', totalOverdue: '250.00' },
    })
  })

  it('ledger UNAVAILABLE (code 14): aging is null, row still returned with 200', async () => {
    setFindImpl({
      cases: {
        docs: [
          {
            accountId: 'acc-1',
            customerId: 'cust-1',
            state: 'open',
            rung: 1,
            hardshipPaused: false,
            stoppedContact: false,
            overdueAmount: 100,
            daysOverdue: 5,
            lastStep: 2,
            openedAt: null,
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
    })
    mockGetOverdueAccounts.mockRejectedValueOnce({ code: 14, message: '14 UNAVAILABLE: connect failed' })

    const res: any = await GET_DETAIL(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(200)
    expect(res.body.case.aging).toBeNull()
  })

  it('non-UNAVAILABLE ledger error propagates as 500 with the standard error envelope', async () => {
    setFindImpl({
      cases: {
        docs: [
          {
            accountId: 'acc-1',
            customerId: 'cust-1',
            state: 'open',
            rung: 1,
            hardshipPaused: false,
            stoppedContact: false,
            overdueAmount: 100,
            daysOverdue: 5,
            lastStep: 2,
            openedAt: null,
            updatedAt: '2026-06-02T00:00:00.000Z',
          },
        ],
      },
    })
    mockGetOverdueAccounts.mockRejectedValueOnce(new Error('boom'))

    const res: any = await GET_DETAIL(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred. Please try again.' },
    })
  })
})
