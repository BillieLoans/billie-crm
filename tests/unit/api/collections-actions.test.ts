/**
 * Unit tests for the four collections operator action routes (BTB-198 WS5):
 *   POST /api/collections/actions/flag-hardship
 *   POST /api/collections/actions/resume-hardship
 *   POST /api/collections/actions/stop-contact
 *   POST /api/collections/actions/advance
 *
 * Mocks:
 *   - next/server                          → NextResponse.json returns { body, status }
 *   - @/lib/auth                           → requireAuth is re-implemented against the
 *                                             REAL @/lib/access checks (canService /
 *                                             hasApprovalAuthority), so role gating is
 *                                             exercised end-to-end rather than stubbed away.
 *   - @/server/collections-service-client  → getCollectionsServiceClient is mocked, but
 *                                             isNotFound / isFailedPrecondition /
 *                                             isResourceExhausted are the real predicates
 *                                             (imported via importOriginal) so error mapping
 *                                             matches production behaviour.
 *
 * Covers per route: 401 unauthenticated, 403 wrong role, 400 invalid body (Zod fieldErrors),
 * success (operatorId = agent:${email} + idempotencyKey passed through to the client),
 * 409 FAILED_PRECONDITION (gate reason surfaced via err.details), 429 RESOURCE_EXHAUSTED.
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
// Auth mock — re-implements requireAuth's contract using the REAL access
// checks, so role gating is exercised rather than stubbed.
// ---------------------------------------------------------------------------
const mockCurrentUser = vi.hoisted(() => ({
  current: null as null | { id: string; email: string; role: string },
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async (accessCheck?: (user: unknown) => boolean) => {
    const user = mockCurrentUser.current
    if (!user) {
      return {
        error: { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } },
      }
    }
    if (accessCheck && !accessCheck(user)) {
      return {
        error: { status: 403, body: { error: { code: 'FORBIDDEN' } } },
      }
    }
    return { user, payload: {} }
  }),
}))

// ---------------------------------------------------------------------------
// collections-service-client mock — keep the real error predicates, mock
// only the client factory.
// ---------------------------------------------------------------------------
const mockGetClient = vi.hoisted(() => vi.fn())
const mockFlagHardship = vi.hoisted(() => vi.fn())
const mockResumeFromHardship = vi.hoisted(() => vi.fn())
const mockApplyStopContact = vi.hoisted(() => vi.fn())
const mockAdvanceToNextStep = vi.hoisted(() => vi.fn())

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
import { POST as flagHardshipPOST } from '@/app/api/collections/actions/flag-hardship/route'
import { POST as resumeHardshipPOST } from '@/app/api/collections/actions/resume-hardship/route'
import { POST as stopContactPOST } from '@/app/api/collections/actions/stop-contact/route'
import { POST as advancePOST } from '@/app/api/collections/actions/advance/route'
import { canService, hasApprovalAuthority } from '@/lib/access'

const OPS_USER = { id: 'ops-1', email: 'ops1@billie.loans', role: 'operations' }
const SUPERVISOR_USER = { id: 'sup-1', email: 'sup1@billie.loans', role: 'supervisor' }
const READONLY_USER = { id: 'ro-1', email: 'ro1@billie.loans', role: 'readonly' }

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

type RouteCase = {
  name: string
  POST: (req: NextRequest) => Promise<unknown>
  clientMethod: ReturnType<typeof vi.fn>
  clientMethodName: string
  accessCheck: (user: unknown) => boolean
  validBody: Record<string, unknown>
  invalidBody: Record<string, unknown>
  invalidField: string
  // The subset of validBody expected to be forwarded to the client, minus operatorId.
  forwardedExtra: Record<string, unknown>
}

const ROUTES: RouteCase[] = [
  {
    name: 'flag-hardship',
    POST: flagHardshipPOST,
    clientMethod: mockFlagHardship,
    clientMethodName: 'flagHardship',
    accessCheck: canService,
    validBody: { accountId: 'acc-1', reason: 'lost job', idempotencyKey: 'idem-12345678' },
    invalidBody: { accountId: 'acc-1', idempotencyKey: 'idem-12345678' }, // missing reason
    invalidField: 'reason',
    forwardedExtra: { reason: 'lost job' },
  },
  {
    name: 'resume-hardship',
    POST: resumeHardshipPOST,
    clientMethod: mockResumeFromHardship,
    clientMethodName: 'resumeFromHardship',
    accessCheck: canService,
    validBody: { accountId: 'acc-1', idempotencyKey: 'idem-12345678' },
    invalidBody: { accountId: 'acc-1' }, // missing idempotencyKey
    invalidField: 'idempotencyKey',
    forwardedExtra: {},
  },
  {
    name: 'stop-contact',
    POST: stopContactPOST,
    clientMethod: mockApplyStopContact,
    clientMethodName: 'applyStopContact',
    accessCheck: canService,
    validBody: { accountId: 'acc-1', reason: 'dispute', idempotencyKey: 'idem-12345678' },
    invalidBody: { accountId: 'acc-1', idempotencyKey: 'short' }, // idempotencyKey too short
    invalidField: 'idempotencyKey',
    forwardedExtra: { reason: 'dispute' },
  },
  {
    name: 'advance',
    POST: advancePOST,
    clientMethod: mockAdvanceToNextStep,
    clientMethodName: 'advanceToNextStep',
    accessCheck: hasApprovalAuthority,
    validBody: { accountId: 'acc-1', idempotencyKey: 'idem-12345678' },
    invalidBody: { idempotencyKey: 'idem-12345678' }, // missing accountId
    invalidField: 'accountId',
    forwardedExtra: {},
  },
]

describe.each(ROUTES)('POST /api/collections/actions/$name', (route) => {
  beforeEach(() => {
    mockCurrentUser.current = null
    mockGetClient.mockReset()
    mockFlagHardship.mockReset()
    mockResumeFromHardship.mockReset()
    mockApplyStopContact.mockReset()
    mockAdvanceToNextStep.mockReset()
    mockGetClient.mockReturnValue({
      flagHardship: mockFlagHardship,
      resumeFromHardship: mockResumeFromHardship,
      applyStopContact: mockApplyStopContact,
      advanceToNextStep: mockAdvanceToNextStep,
    })
  })

  it('401: unauthenticated → error response unchanged, client never called', async () => {
    mockCurrentUser.current = null

    const res: any = await route.POST(makeRequest(route.validBody))

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(route.clientMethod).not.toHaveBeenCalled()
  })

  it('403: wrong role → FORBIDDEN, client never called', async () => {
    // Pick a user that fails this route's access check. For `advance`
    // (hasApprovalAuthority), that's the operations role explicitly called
    // out in the task brief. For the canService routes, use readonly.
    mockCurrentUser.current = route.accessCheck === hasApprovalAuthority ? OPS_USER : READONLY_USER
    expect(route.accessCheck(mockCurrentUser.current)).toBe(false)

    const res: any = await route.POST(makeRequest(route.validBody))

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(route.clientMethod).not.toHaveBeenCalled()
  })

  it('400: invalid body → VALIDATION with fieldErrors, client never called', async () => {
    mockCurrentUser.current = SUPERVISOR_USER

    const res: any = await route.POST(makeRequest(route.invalidBody))

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(res.body.error.details).toHaveProperty(route.invalidField)
    expect(route.clientMethod).not.toHaveBeenCalled()
  })

  it('200: success passes operatorId (agent:${email}) + idempotencyKey through to the client', async () => {
    mockCurrentUser.current = SUPERVISOR_USER
    route.clientMethod.mockResolvedValue({
      accountId: route.validBody.accountId,
      newState: 'active',
      emittedEventId: 'evt-1',
    })

    const res: any = await route.POST(makeRequest(route.validBody))

    expect(res.status).toBe(200)
    expect(res.body.result).toEqual({
      accountId: route.validBody.accountId,
      newState: 'active',
      emittedEventId: 'evt-1',
    })
    expect(route.clientMethod).toHaveBeenCalledWith({
      accountId: route.validBody.accountId,
      operatorId: `agent:${SUPERVISOR_USER.email}`,
      idempotencyKey: route.validBody.idempotencyKey,
      ...route.forwardedExtra,
    })
  })

  it('409: FAILED_PRECONDITION surfaces the gRPC gate reason in the envelope message', async () => {
    mockCurrentUser.current = SUPERVISOR_USER
    route.clientMethod.mockRejectedValue({
      code: 9, // FAILED_PRECONDITION
      details: 'economic gate failed: expected net recovery is negative',
    })

    const res: any = await route.POST(makeRequest(route.validBody))

    expect(res.status).toBe(409)
    expect(res.body.error).toEqual({
      code: 'FAILED_PRECONDITION',
      message: 'economic gate failed: expected net recovery is negative',
    })
  })

  it('429: RESOURCE_EXHAUSTED → CONTACT_CAP', async () => {
    mockCurrentUser.current = SUPERVISOR_USER
    route.clientMethod.mockRejectedValue({
      code: 8, // RESOURCE_EXHAUSTED
      details: 'contact cap reached: 3/3 sent in 7d window',
    })

    const res: any = await route.POST(makeRequest(route.validBody))

    expect(res.status).toBe(429)
    expect(res.body.error).toEqual({
      code: 'CONTACT_CAP',
      message: 'contact cap reached: 3/3 sent in 7d window',
    })
  })

  it('404: NOT_FOUND → unknown account', async () => {
    mockCurrentUser.current = SUPERVISOR_USER
    route.clientMethod.mockRejectedValue({ code: 5 /* NOT_FOUND */ })

    const res: any = await route.POST(makeRequest(route.validBody))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('502: unmapped gRPC error → INTERNAL_ERROR', async () => {
    mockCurrentUser.current = SUPERVISOR_USER
    route.clientMethod.mockRejectedValue(new Error('connection reset'))

    const res: any = await route.POST(makeRequest(route.validBody))

    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('INTERNAL_ERROR')
  })
})

// ---------------------------------------------------------------------------
// Operations-role positive path (C6 review): the advance-403 test above
// proves `operations` is rejected by `hasApprovalAuthority`, but nothing
// previously proved `operations` is *accepted* by `canService` on the
// servicing routes it's meant to use. Cover that here with flag-hardship.
// ---------------------------------------------------------------------------
describe('POST /api/collections/actions/flag-hardship (operations role)', () => {
  beforeEach(() => {
    mockCurrentUser.current = null
    mockGetClient.mockReset()
    mockFlagHardship.mockReset()
    mockGetClient.mockReturnValue({ flagHardship: mockFlagHardship })
  })

  it('200: operations token can flag-hardship (canService accepts operations)', async () => {
    mockCurrentUser.current = OPS_USER
    mockFlagHardship.mockResolvedValue({
      accountId: 'acc-1',
      newState: 'active',
      emittedEventId: 'evt-1',
    })

    const res: any = await flagHardshipPOST(
      makeRequest({ accountId: 'acc-1', reason: 'lost job', idempotencyKey: 'idem-12345678' }),
    )

    expect(res.status).toBe(200)
    expect(res.body.result).toEqual({
      accountId: 'acc-1',
      newState: 'active',
      emittedEventId: 'evt-1',
    })
    expect(mockFlagHardship).toHaveBeenCalledWith({
      accountId: 'acc-1',
      operatorId: `agent:${OPS_USER.email}`,
      reason: 'lost job',
      idempotencyKey: 'idem-12345678',
    })
  })
})
