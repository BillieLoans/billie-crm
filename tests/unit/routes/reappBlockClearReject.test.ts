/**
 * Unit tests for POST /api/commands/reapp-block-clear/reject
 *
 * Mocks:
 *   - next/server             → NextResponse.json returns { body, status }
 *   - payload                 → getPayload returns { auth: mockAuth }
 *   - @payload-config         → default export stub
 *   - next/headers            → headers() returns stub with entries()
 *   - @/server/event-publisher       → spy on createAndPublishEvent; real EventPublishError
 *
 * No self-check on reject — any supervisor/admin can reject.
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
// Payload mock
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

vi.mock('payload', () => ({
  getPayload: vi.fn().mockResolvedValue({
    auth: mockAuth,
  }),
}))

vi.mock('@payload-config', () => ({ default: {} }))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ entries: () => [] }),
}))

// ---------------------------------------------------------------------------
// event-publisher mock
// ---------------------------------------------------------------------------
vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: vi.fn().mockResolvedValue({
    eventId: 'evt-reject-1',
    requestId: 'req-abc',
    status: 'accepted',
    message: 'Block clear rejected',
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
import { POST } from '@/app/api/commands/reapp-block-clear/reject/route'
import { createAndPublishEvent } from '@/server/event-publisher'

const makeRequest = (body: unknown) => ({ json: async () => body })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/commands/reapp-block-clear/reject', () => {
  beforeEach(() => {
    vi.mocked(createAndPublishEvent).mockClear()
    mockAuth.mockClear()
    mockAuth.mockResolvedValue({
      user: {
        id: 'sup-1',
        firstName: 'Sup',
        lastName: 'User',
        role: 'supervisor',
        email: 'sup@x',
      },
    })
  })

  it('(a) happy path: supervisor rejects → createAndPublishEvent with rejected.v1; rejectedBy=user.id; 202', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        reason: 'Insufficient evidence provided for the block clear',
      }) as any,
    )

    expect(res.status).toBe(202)
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)

    const arg = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(arg.typ).toBe('block_clear_approval.rejected.v1')
    expect(arg.payload.requestId).toBe('req-abc')
    expect(arg.payload.requestNumber).toBe('RBC-001')
    expect(arg.payload.rejectedBy).toBe('sup-1')
    expect(arg.payload.reason).toBe('Insufficient evidence provided for the block clear')
    expect(arg.requestId).toBe('req-abc')
  })

  it('(b) invalid body (reason too short) → 400 VALIDATION_ERROR; event NOT published', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        reason: 'Too short', // min 10 chars
      }) as any,
    )

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(c) invalid body (missing reason) → 400 VALIDATION_ERROR', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        // missing reason
      }) as any,
    )

    expect(res.status).toBe(400)
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(d) no approval authority (operations role) → 403 FORBIDDEN; event NOT published', async () => {
    mockAuth.mockResolvedValueOnce({
      user: {
        id: 'ops-2',
        firstName: 'Ops',
        lastName: undefined,
        role: 'operations',
        email: 'ops2@x',
      },
    })

    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        reason: 'Insufficient evidence provided for the block clear',
      }) as any,
    )

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(e) unauthenticated (no user) → 401 UNAUTHENTICATED; event NOT published', async () => {
    mockAuth.mockResolvedValueOnce({ user: null })

    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        reason: 'Insufficient evidence provided for the block clear',
      }) as any,
    )

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(f) no self-check: requester and rejecter can be the same user (unlike approve) → 202', async () => {
    // On reject, there is NO self-approval check — any supervisor can reject anyone's request
    // (including their own). This is intentional: blocking own-request rejection would prevent
    // a supervisor from withdrawing a request they mistakenly submitted.
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-001',
        reason: 'Reconsidered and deciding to reject this request',
      }) as any,
    )

    expect(res.status).toBe(202)
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)
  })
})
