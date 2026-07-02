/**
 * Unit tests for the three collections read routes (BTB-198 WS5):
 *   GET  /api/collections/cases/[accountId]/economics
 *   GET  /api/collections/cases/[accountId]/contact-log
 *   POST /api/collections/economics (batch, for the WS3 net-recovery sort)
 *
 * Mocks:
 *   - next/server                          → NextResponse.json returns { body, status }
 *   - @/lib/auth                           → requireAuth is a hoisted spy
 *   - @/server/collections-service-client  → getCollectionsServiceClient is mocked
 *
 * Covers: success shape, gRPC UNAVAILABLE (code 14) graceful-degrade → 200,
 * gRPC NOT_FOUND → 404 (per-account reads only), and the batch 200-id cap → 400
 * VALIDATION.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

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
// collections-service-client mock — keep the real error predicates, mock
// only the client factory.
// ---------------------------------------------------------------------------
const mockGetClient = vi.hoisted(() => vi.fn())
const mockGetCaseEconomics = vi.hoisted(() => vi.fn())
const mockGetContactLog = vi.hoisted(() => vi.fn())
const mockListCaseEconomics = vi.hoisted(() => vi.fn())

vi.mock('@/server/collections-service-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/collections-service-client')>()
  return {
    ...actual,
    getCollectionsServiceClient: mockGetClient,
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { GET as economicsGET } from '@/app/api/collections/cases/[accountId]/economics/route'
import { GET as contactLogGET } from '@/app/api/collections/cases/[accountId]/contact-log/route'
import { POST as batchEconomicsPOST } from '@/app/api/collections/economics/route'

const AUTHED_USER = { id: 'ro-1', email: 'ro1@billie.loans', role: 'readonly' }

const makeDetailRequest = () =>
  ({ nextUrl: new URL('http://localhost/api/collections/cases/acc-1/economics') }) as any
const makeParams = (accountId: string) => ({ params: Promise.resolve({ accountId }) })
const makeBatchRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  mockRequireAuth.mockReset()
  mockRequireAuth.mockResolvedValue({ user: AUTHED_USER, payload: {} })
  mockGetClient.mockReset()
  mockGetCaseEconomics.mockReset()
  mockGetContactLog.mockReset()
  mockListCaseEconomics.mockReset()
  mockGetClient.mockReturnValue({
    getCaseEconomics: mockGetCaseEconomics,
    getContactLog: mockGetContactLog,
    listCaseEconomics: mockListCaseEconomics,
  })
})

const SAMPLE_ECONOMICS = {
  accountId: 'acc-1',
  amountOwed: '250.00',
  costOfNextStep: '1.20',
  expectedNetRecovery: '200.00',
  gateResult: { status: 'PASS', reason: 'expected recovery exceeds cost' },
  costLedger: [],
  nextStepPreview: null,
}

const SAMPLE_CONTACT_LOG = {
  accountId: 'acc-1',
  entries: [],
  contactCapStatus: { sent7d: 1, cap7d: 3, sentMonth: 2, capMonth: 10 },
}

describe('GET /api/collections/cases/[accountId]/economics', () => {
  it('401: returns requireAuth error response unchanged', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      error: { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } },
    })

    const res: any = await economicsGET(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(401)
    expect(mockGetCaseEconomics).not.toHaveBeenCalled()
  })

  it('200: success shape { economics }', async () => {
    mockGetCaseEconomics.mockResolvedValue(SAMPLE_ECONOMICS)

    const res: any = await economicsGET(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ economics: SAMPLE_ECONOMICS })
    expect(mockGetCaseEconomics).toHaveBeenCalledWith('acc-1')
  })

  it('200 degrade: gRPC UNAVAILABLE (code 14) → { economics: null, unavailable: true }', async () => {
    mockGetCaseEconomics.mockRejectedValue({ code: 14, message: '14 UNAVAILABLE: connect failed' })

    const res: any = await economicsGET(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ economics: null, unavailable: true })
  })

  it('404: gRPC NOT_FOUND → standard error envelope', async () => {
    mockGetCaseEconomics.mockRejectedValue({ code: 5 })

    const res: any = await economicsGET(makeDetailRequest(), makeParams('does-not-exist'))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('502: unmapped gRPC error → INTERNAL_ERROR', async () => {
    mockGetCaseEconomics.mockRejectedValue(new Error('boom'))

    const res: any = await economicsGET(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
  })
})

describe('GET /api/collections/cases/[accountId]/contact-log', () => {
  it('401: returns requireAuth error response unchanged', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      error: { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } },
    })

    const res: any = await contactLogGET(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(401)
    expect(mockGetContactLog).not.toHaveBeenCalled()
  })

  it('200: success shape { contactLog }', async () => {
    mockGetContactLog.mockResolvedValue(SAMPLE_CONTACT_LOG)

    const res: any = await contactLogGET(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ contactLog: SAMPLE_CONTACT_LOG })
    expect(mockGetContactLog).toHaveBeenCalledWith('acc-1')
  })

  it('200 degrade: gRPC UNAVAILABLE (code 14) → { contactLog: null, unavailable: true }', async () => {
    mockGetContactLog.mockRejectedValue({ code: 14, message: '14 UNAVAILABLE: connect failed' })

    const res: any = await contactLogGET(makeDetailRequest(), makeParams('acc-1'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ contactLog: null, unavailable: true })
  })

  it('404: gRPC NOT_FOUND → standard error envelope', async () => {
    mockGetContactLog.mockRejectedValue({ code: 5 })

    const res: any = await contactLogGET(makeDetailRequest(), makeParams('does-not-exist'))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('POST /api/collections/economics (batch)', () => {
  it('401: returns requireAuth error response unchanged', async () => {
    mockRequireAuth.mockResolvedValueOnce({
      error: { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } },
    })

    const res: any = await batchEconomicsPOST(makeBatchRequest({ accountIds: ['acc-1'] }))

    expect(res.status).toBe(401)
    expect(mockListCaseEconomics).not.toHaveBeenCalled()
  })

  it('200: success shape { items }', async () => {
    mockListCaseEconomics.mockResolvedValue([SAMPLE_ECONOMICS])

    const res: any = await batchEconomicsPOST(makeBatchRequest({ accountIds: ['acc-1'] }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [SAMPLE_ECONOMICS] })
    expect(mockListCaseEconomics).toHaveBeenCalledWith(['acc-1'])
  })

  it('200 degrade: gRPC UNAVAILABLE (code 14) → { items: [], unavailable: true }', async () => {
    mockListCaseEconomics.mockRejectedValue({ code: 14, message: '14 UNAVAILABLE: connect failed' })

    const res: any = await batchEconomicsPOST(makeBatchRequest({ accountIds: ['acc-1'] }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], unavailable: true })
  })

  it('400: >200 accountIds → VALIDATION, client never called', async () => {
    const accountIds = Array.from({ length: 201 }, (_, i) => `acc-${i}`)

    const res: any = await batchEconomicsPOST(makeBatchRequest({ accountIds }))

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(mockListCaseEconomics).not.toHaveBeenCalled()
  })

  it('400: empty accountIds → VALIDATION', async () => {
    const res: any = await batchEconomicsPOST(makeBatchRequest({ accountIds: [] }))

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('502: unmapped gRPC error → INTERNAL_ERROR', async () => {
    mockListCaseEconomics.mockRejectedValue(new Error('boom'))

    const res: any = await batchEconomicsPOST(makeBatchRequest({ accountIds: ['acc-1'] }))

    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
  })
})
