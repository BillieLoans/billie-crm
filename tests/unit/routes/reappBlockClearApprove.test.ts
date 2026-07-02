/**
 * Unit tests for POST /api/commands/reapp-block-clear/approve
 *
 * Mocks:
 *   - next/server             → NextResponse.json returns { body, status }
 *   - payload                 → getPayload returns { auth: mockAuth, find: mockFind }
 *   - @payload-config         → default export stub
 *   - next/headers            → headers() returns stub with entries()
 *   - @/server/chatledger-publisher  → spy on publishClearAuthorized
 *   - @/server/event-publisher       → spy on createAndPublishEvent; real EventPublishError
 *
 * CRITICAL: self-approval 403 must assert NEITHER publishClearAuthorized
 * NOR createAndPublishEvent was called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// next/server mock
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
// Payload mock — auth and find are hoisted spies so tests can override them
// ---------------------------------------------------------------------------
const mockAuth = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    user: {
      id: 'sup-1',
      firstName: 'Sup',
      lastName: 'User',
      role: 'supervisor',
      email: 'sup@x',
    },
  }),
)

const mockFind = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    docs: [
      {
        requestedBy: 'ops-1',
        status: 'pending',
        canonicalCustomerId: 'c123',
        reasons: ['PRIOR_DEFAULT'],
        justification: 'credit remediation complete',
        requestNumber: 'RBC-001',
        requestedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }),
)

vi.mock('payload', () => ({
  getPayload: vi.fn().mockResolvedValue({
    auth: mockAuth,
    find: mockFind,
  }),
}))

vi.mock('@payload-config', () => ({ default: {} }))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ entries: () => [] }),
}))

// ---------------------------------------------------------------------------
// chatledger-publisher mock
// ---------------------------------------------------------------------------
vi.mock('@/server/chatledger-publisher', () => ({
  publishClearAuthorized: vi.fn().mockResolvedValue({ eventId: 'evt-chatledger-1' }),
}))

// ---------------------------------------------------------------------------
// event-publisher mock
// ---------------------------------------------------------------------------
vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: vi.fn().mockResolvedValue({
    eventId: 'evt-approve-1',
    requestId: 'req-abc',
    status: 'accepted',
    message: 'Block clear approved',
  }),
  EventPublishError: class EventPublishError extends Error {
    public readonly attempts: number
    constructor(msg: string, opts?: { attempts?: number }) {
      super(msg)
      this.name = 'EventPublishError'
      this.attempts = opts?.attempts ?? 1
    }
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/commands/reapp-block-clear/approve/route'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import { createAndPublishEvent } from '@/server/event-publisher'

const makeRequest = (body: unknown) => ({ json: async () => body })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/commands/reapp-block-clear/approve', () => {
  beforeEach(() => {
    vi.mocked(publishClearAuthorized).mockClear()
    vi.mocked(createAndPublishEvent).mockClear()
    mockAuth.mockClear()
    mockFind.mockClear()
    // Reset to defaults
    mockAuth.mockResolvedValue({
      user: {
        id: 'sup-1',
        firstName: 'Sup',
        lastName: 'User',
        role: 'supervisor',
        email: 'sup@x',
      },
    })
    mockFind.mockResolvedValue({
      docs: [
        {
          requestedBy: 'ops-1',
          status: 'pending',
          canonicalCustomerId: 'c123',
          reasons: ['PRIOR_DEFAULT'],
          justification: 'credit remediation complete',
          requestNumber: 'RBC-001',
          requestedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
  })

  it('(a) happy path: checker≠maker, pending → publishClearAuthorized with operator_id=requestedBy, approval.approved_by=user.id; createAndPublishEvent with approved.v1; 202', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(202)

    // payload.find must be called with depth: 0 to enforce scalar IDs
    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({ depth: 0 }))

    // publishClearAuthorized must be called with maker as operator_id and checker as approved_by
    expect(vi.mocked(publishClearAuthorized)).toHaveBeenCalledTimes(1)
    const clearArg = vi.mocked(publishClearAuthorized).mock.calls[0][0]
    expect(clearArg.operator_id).toBe('ops-1') // MAKER
    expect(clearArg.approval?.approved_by).toBe('sup-1') // CHECKER
    // maker≠checker guarantee
    expect(clearArg.operator_id).not.toBe(clearArg.approval?.approved_by)
    expect(clearArg.request_id).toBe('req-abc')
    expect(clearArg.canonical_customer_id).toBe('c123')
    expect(clearArg.reasons).toEqual(['PRIOR_DEFAULT'])
    expect(clearArg.justification).toBe('credit remediation complete')
    expect(clearArg.approval?.approved_by_name).toBe('Sup User')
    expect(clearArg.approval?.approval_request_id).toBe('RBC-001') // doc.requestNumber

    // createAndPublishEvent must be called with approved event type
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)
    const eventArg = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(eventArg.typ).toBe('block_clear_approval.approved.v1')
    expect(eventArg.payload.approvedBy).toBe('sup-1')
    expect(eventArg.payload.requestId).toBe('req-abc')
    expect(eventArg.requestId).toBe('req-abc')
  })

  it('(b) SELF_APPROVAL: requestedBy===user.id → 403 SELF_APPROVAL; NEITHER publishClearAuthorized NOR createAndPublishEvent called', async () => {
    // The checker IS the maker
    mockFind.mockResolvedValueOnce({
      docs: [
        {
          requestedBy: 'sup-1', // same as checker
          status: 'pending',
          canonicalCustomerId: 'c123',
          reasons: ['PRIOR_DEFAULT'],
          justification: 'self request',
          requestNumber: 'RBC-002',
          requestedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const res = await POST(
      makeRequest({
        requestId: 'req-self',
        requestNumber: 'RBC-002',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SELF_APPROVAL')

    // CRITICAL: no publish calls must be made
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(c) non-pending (already approved): status≠pending → 400 INVALID_STATE; no publish', async () => {
    mockFind.mockResolvedValueOnce({
      docs: [
        {
          requestedBy: 'ops-1',
          status: 'approved',
          canonicalCustomerId: 'c123',
          reasons: ['PRIOR_DEFAULT'],
          justification: 'already done',
          requestNumber: 'RBC-003',
          requestedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const res = await POST(
      makeRequest({
        requestId: 'req-done',
        requestNumber: 'RBC-003',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_STATE')
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(d) not found: empty docs → 404 NOT_FOUND; no publish', async () => {
    mockFind.mockResolvedValueOnce({ docs: [] })

    const res = await POST(
      makeRequest({
        requestId: 'req-missing',
        requestNumber: 'RBC-999',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(e) no approval authority (operations role) → 403 FORBIDDEN; no publish', async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: 'ops-2',
        firstName: 'Ops',
        lastName: undefined,
        role: 'operations', // no approval authority
        email: 'ops2@x',
      },
    })

    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(f) invalid body (comment too short) → 400 VALIDATION_ERROR; no publish', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        comment: 'short', // min 10 chars
      }) as any,
    )

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(g) unauthenticated (no user) → 401 UNAUTHENTICATED; no publish', async () => {
    mockAuth.mockResolvedValueOnce({ user: null })

    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(h) null requestedBy on stored doc → 500 DATA_INTEGRITY; no publish', async () => {
    mockFind.mockResolvedValueOnce({
      docs: [
        {
          requestedBy: null, // corrupt row
          status: 'pending',
          canonicalCustomerId: 'c123',
          reasons: ['PRIOR_DEFAULT'],
          justification: 'credit remediation complete',
          requestNumber: 'RBC-001',
          requestedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })

    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(500)
    expect(res.body.error.code).toBe('DATA_INTEGRITY')
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })
})
