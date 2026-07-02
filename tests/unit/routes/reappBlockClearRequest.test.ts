/**
 * Unit tests for POST /api/commands/reapp-block-clear/request
 *
 * Mocks:
 *   - next/server        → NextResponse.json returns { body, status } for easy assertion
 *   - @/lib/auth         → requireAuth returns a fixed ops user (no Payload/Redis needed)
 *   - @/server/chatledger-publisher  → spy on publishClearAuthorized
 *   - @/server/event-publisher       → spy on createAndPublishEvent; real EventPublishError re-exported
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
// Auth mock — returns a fixed ops user; no Payload/Redis side-effects
// ---------------------------------------------------------------------------
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    user: { id: 'ops-1', firstName: 'Op', lastName: undefined, role: 'operations', email: 'op@x' },
    payload: {},
  }),
}))

// ---------------------------------------------------------------------------
// chatledger-publisher mock
// ---------------------------------------------------------------------------
vi.mock('@/server/chatledger-publisher', () => ({
  publishClearAuthorized: vi.fn().mockResolvedValue({ eventId: 'evt-chatledger-1' }),
}))

// ---------------------------------------------------------------------------
// event-publisher mock — keep EventPublishError constructable so catch branches work
// ---------------------------------------------------------------------------
vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: vi.fn().mockResolvedValue({
    eventId: 'evt-internal-1',
    requestId: 'req-internal-1',
    status: 'accepted',
    message: 'OK',
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
import { POST } from '@/app/api/commands/reapp-block-clear/request/route'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import { createAndPublishEvent } from '@/server/event-publisher'

// Helper: build a minimal NextRequest-like object
const makeRequest = (body: unknown) => ({ json: async () => body })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/commands/reapp-block-clear/request', () => {
  beforeEach(() => {
    vi.mocked(publishClearAuthorized).mockClear()
    vi.mocked(createAndPublishEvent).mockClear()
  })

  it('(a) SERVICEABILITY (single-op) → publishClearAuthorized called with operator_id=ops-1, reasons, justification, request_id; no approval; createAndPublishEvent NOT called; 202', async () => {
    const res = await POST(
      makeRequest({
        canonicalCustomerId: 'c123',
        conversationId: 'conv-1',
        reasons: ['SERVICEABILITY'],
        justification: 'manual review passed',
      }) as any,
    )

    expect(res.status).toBe(202)
    expect(vi.mocked(publishClearAuthorized)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()

    const arg = vi.mocked(publishClearAuthorized).mock.calls[0][0]
    expect(arg.operator_id).toBe('ops-1')
    expect(arg.reasons).toEqual(['SERVICEABILITY'])
    expect(arg.justification).toBe('manual review passed')
    expect(arg.request_id).toBeTruthy()
    // No approval field on single-op path
    expect((arg as any).approval).toBeUndefined()
  })

  it('(b) PRIOR_DEFAULT (maker-checker) → createAndPublishEvent called with typ=block_clear_approval.requested.v1; publishClearAuthorized NOT called; 202', async () => {
    const res = await POST(
      makeRequest({
        canonicalCustomerId: 'c123',
        reasons: ['PRIOR_DEFAULT'],
        justification: 'credit remediation complete',
      }) as any,
    )

    expect(res.status).toBe(202)
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()

    const arg = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(arg.typ).toBe('block_clear_approval.requested.v1')
    expect(arg.payload.requestedBy).toBe('ops-1')
    expect(arg.payload.reasons).toEqual(['PRIOR_DEFAULT'])
    expect(arg.payload.justification).toBe('credit remediation complete')
  })

  it('(b2) PRIOR_SERIOUS_ARREARS (maker-checker) → createAndPublishEvent called; publishClearAuthorized NOT called; 202', async () => {
    const res = await POST(
      makeRequest({
        canonicalCustomerId: 'c123',
        reasons: ['PRIOR_SERIOUS_ARREARS'],
        justification: 'arrears resolved',
      }) as any,
    )

    expect(res.status).toBe(202)
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()

    const arg = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(arg.typ).toBe('block_clear_approval.requested.v1')
  })

  it('(c) invalid body (empty reasons array) → 400; no publish calls', async () => {
    const res = await POST(
      makeRequest({
        canonicalCustomerId: 'c123',
        reasons: [], // fails min(1)
        justification: 'some justification',
      }) as any,
    )

    expect(res.status).toBe(400)
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(c) invalid body (missing justification) → 400', async () => {
    const res = await POST(
      makeRequest({
        canonicalCustomerId: 'c123',
        reasons: ['SERVICEABILITY'],
        // missing justification
      }) as any,
    )

    expect(res.status).toBe(400)
  })
})
