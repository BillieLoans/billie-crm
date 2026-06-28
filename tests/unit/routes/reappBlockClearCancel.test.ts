/**
 * Unit tests for POST /api/commands/reapp-block-clear/cancel
 *
 * Mocks:
 *   - next/server        → NextResponse.json returns { body, status }
 *   - @/lib/auth         → requireAuth returns ops user + payload.find spy
 *   - @/server/event-publisher       → spy on createAndPublishEvent
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
// Auth mock — payload.find is a spy so we can configure per-test
// vi.hoisted needed so mockFind is available inside the factory
// ---------------------------------------------------------------------------
const mockFind = vi.hoisted(() => vi.fn().mockResolvedValue({ docs: [{ requestedBy: 'ops-1' }] }))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    user: { id: 'ops-1', firstName: 'Op', lastName: undefined, role: 'operations', email: 'op@x' },
    payload: { find: mockFind },
  }),
}))

// ---------------------------------------------------------------------------
// event-publisher mock
// ---------------------------------------------------------------------------
vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: vi.fn().mockResolvedValue({
    eventId: 'evt-cancel-1',
    requestId: 'req-cancel-1',
    status: 'accepted',
    message: 'Cancelled',
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
import { POST } from '@/app/api/commands/reapp-block-clear/cancel/route'
import { createAndPublishEvent } from '@/server/event-publisher'

const makeRequest = (body: unknown) => ({ json: async () => body })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/commands/reapp-block-clear/cancel', () => {
  beforeEach(() => {
    vi.mocked(createAndPublishEvent).mockClear()
    mockFind.mockClear()
  })

  it('happy path (original requester): publishes block_clear_approval.cancelled.v1 and returns 202', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'RBC-123',
      }) as any,
    )

    expect(res.status).toBe(202)
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)

    const arg = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(arg.typ).toBe('block_clear_approval.cancelled.v1')
  })

  it('invalid body (missing requestNumber) → 400', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        // missing requestNumber
      }) as any,
    )

    expect(res.status).toBe(400)
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })
})
