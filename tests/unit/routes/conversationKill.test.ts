/**
 * Unit tests for POST /api/commands/conversation-kill
 *
 * Mocks:
 *   - next/server        → NextResponse.json returns { body, status } for easy assertion
 *   - @/lib/auth         → requireAuth resolves to a mutable current user (no Payload/Redis needed)
 *   - @/server/chatledger-publisher  → spy on publishConversationKill
 *   - @/server/event-publisher       → real EventPublishError re-exported so catch branches work
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
// Auth mock — requireAuth resolves to whatever `currentUser` currently points at,
// so individual tests can swap roles before calling POST.
// ---------------------------------------------------------------------------
let currentUser: {
  id: string
  firstName?: string
  lastName?: string
  role: string
  email: string
} = {
  id: 'sup-1',
  firstName: 'Sup',
  lastName: undefined,
  role: 'supervisor',
  email: 'sup@x',
}

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ user: currentUser, payload: {} })),
}))

// ---------------------------------------------------------------------------
// chatledger-publisher mock
// ---------------------------------------------------------------------------
vi.mock('@/server/chatledger-publisher', () => ({
  publishConversationKill: vi.fn().mockResolvedValue({ eventId: 'evt-chatledger-1' }),
}))

// ---------------------------------------------------------------------------
// event-publisher mock — keep EventPublishError constructable so catch branches work
// ---------------------------------------------------------------------------
vi.mock('@/server/event-publisher', () => ({
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
import { POST } from '@/app/api/commands/conversation-kill/route'
import { publishConversationKill } from '@/server/chatledger-publisher'
import { EventPublishError } from '@/server/event-publisher'

// Helper: build a minimal NextRequest-like object
const makeRequest = (body: unknown) => ({ json: async () => body })

const validBody = {
  conversationId: 'conv-1',
  customerId: 'cust-1',
  reasonCategory: 'fraud_abuse',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/commands/conversation-kill', () => {
  beforeEach(() => {
    vi.mocked(publishConversationKill).mockClear()
    vi.mocked(publishConversationKill).mockResolvedValue({ eventId: 'evt-chatledger-1' })
    currentUser = {
      id: 'sup-1',
      firstName: 'Sup',
      lastName: undefined,
      role: 'supervisor',
      email: 'sup@x',
    }
  })

  it('(1) supervisor/admin + valid body → 202, publishConversationKill called once with expected payload', async () => {
    const res = await POST(makeRequest(validBody) as any)

    expect(res.status).toBe(202)
    expect(vi.mocked(publishConversationKill)).toHaveBeenCalledTimes(1)

    const arg = vi.mocked(publishConversationKill).mock.calls[0][0]
    expect(arg.conversation_id).toBe('conv-1')
    expect(arg.actor).toBe('user:sup-1')
    expect(arg.reason_category).toBe('fraud_abuse')
    expect(arg.block_requested).toBe(false)
    expect(arg.request_id).toBeTruthy()

    expect((res.body as any).status).toBe('accepted')
  })

  it('(2) operations-role user → 403, publisher NOT called', async () => {
    currentUser = {
      id: 'ops-1',
      firstName: 'Op',
      lastName: undefined,
      role: 'operations',
      email: 'op@x',
    }

    const res = await POST(makeRequest(validBody) as any)

    expect(res.status).toBe(403)
    expect(vi.mocked(publishConversationKill)).not.toHaveBeenCalled()
  })

  it('(3) invalid body (missing conversationId) → 400 VALIDATION_ERROR', async () => {
    const res = await POST(
      makeRequest({
        customerId: 'cust-1',
        reasonCategory: 'fraud_abuse',
      }) as any,
    )

    expect(res.status).toBe(400)
    expect((res.body as any).error.code).toBe('VALIDATION_ERROR')
    expect(vi.mocked(publishConversationKill)).not.toHaveBeenCalled()
  })

  it('(3b) invalid body (bad reasonCategory) → 400 VALIDATION_ERROR', async () => {
    const res = await POST(
      makeRequest({
        conversationId: 'conv-1',
        customerId: 'cust-1',
        reasonCategory: 'not_a_real_category',
      }) as any,
    )

    expect(res.status).toBe(400)
    expect((res.body as any).error.code).toBe('VALIDATION_ERROR')
    expect(vi.mocked(publishConversationKill)).not.toHaveBeenCalled()
  })

  it('(4) publisher throws EventPublishError → 503 EVENT_PUBLISH_FAILED', async () => {
    vi.mocked(publishConversationKill).mockRejectedValueOnce(
      new EventPublishError('Failed to publish event after retries', { attempts: 3 }),
    )

    const res = await POST(makeRequest(validBody) as any)

    expect(res.status).toBe(503)
    expect((res.body as any).error.code).toBe('EVENT_PUBLISH_FAILED')
  })
})
