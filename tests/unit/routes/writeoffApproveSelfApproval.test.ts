/**
 * Unit tests for POST /api/commands/writeoff/approve — self-approval guard
 *
 * Mocks:
 *   - next/server             → NextResponse.json returns { body, status }
 *   - payload                 → getPayload returns { auth: mockAuth, find: mockFind }
 *   - @payload-config         → default export stub
 *   - next/headers            → headers() returns stub with entries()
 *   - @/server/grpc-client    → getLedgerClient returns mock with writeOff spy
 *   - @/server/event-publisher → spy on createAndPublishEvent; real EventPublishError
 *
 * CRITICAL: self-approval 403 must assert NEITHER the ledger client writeOff
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
        loanAccountId: 'acct-123',
        reason: 'Customer unable to repay',
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
// grpc-client mock — mock getLedgerClient to return a mock client
// ---------------------------------------------------------------------------
const mockWriteOff = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    eventId: 'ledger-evt-1',
    transaction: { transactionId: 'txn-123' },
  }),
)

vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: vi.fn(() => ({
    writeOff: mockWriteOff,
  })),
}))

// ---------------------------------------------------------------------------
// event-publisher mock
// ---------------------------------------------------------------------------
vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: vi.fn().mockResolvedValue({
    eventId: 'evt-approve-1',
    requestId: 'req-abc',
    status: 'accepted',
    message: 'Write-off approved',
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
import { POST } from '@/app/api/commands/writeoff/approve/route'
import { getLedgerClient } from '@/server/grpc-client'
import { createAndPublishEvent } from '@/server/event-publisher'

const makeRequest = (body: unknown) => ({ json: async () => body })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/commands/writeoff/approve — self-approval guard', () => {
  beforeEach(() => {
    vi.mocked(createAndPublishEvent).mockClear()
    vi.mocked(getLedgerClient).mockClear()
    mockWriteOff.mockClear()
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
          loanAccountId: 'acct-123',
          reason: 'Customer unable to repay',
        },
      ],
    })
  })

  it('(a) happy path: checker≠maker, pending → ledger writeOff called; createAndPublishEvent called; 202', async () => {
    const res = await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'WOR-001',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(202)

    // payload.find must be called with depth: 0 to enforce scalar requestedBy id
    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({ depth: 0 }))

    // Ledger must be called
    expect(mockWriteOff).toHaveBeenCalledTimes(1)

    // createAndPublishEvent must be called
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)
    const eventArg = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(eventArg.payload.approvedBy).toBe('sup-1')
    expect(eventArg.payload.requestId).toBe('req-abc')
  })

  it('(b) SELF_APPROVAL: requestedBy===user.id → 403 SELF_APPROVAL; NEITHER ledger writeOff NOR createAndPublishEvent called', async () => {
    // The checker IS the maker — same id as the authenticated user
    mockFind.mockResolvedValueOnce({
      docs: [
        {
          requestedBy: 'sup-1', // same as authenticated user sup-1
          status: 'pending',
          loanAccountId: 'acct-123',
          reason: 'Customer unable to repay',
        },
      ],
    })

    const res = await POST(
      makeRequest({
        requestId: 'req-self',
        requestNumber: 'WOR-002',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SELF_APPROVAL')
    expect(res.body.error.message).toMatch(/cannot approve your own/i)

    // CRITICAL: no ledger or publish calls must be made
    expect(mockWriteOff).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(b2) SELF_APPROVAL with numeric id coercion: requestedBy===user.id as different types → 403 SELF_APPROVAL', async () => {
    // Verify String() coercion works across type boundaries
    mockAuth.mockResolvedValueOnce({
      user: {
        id: 42, // numeric id
        firstName: 'Admin',
        lastName: 'User',
        role: 'supervisor',
        email: 'admin@x',
      },
    })
    mockFind.mockResolvedValueOnce({
      docs: [
        {
          requestedBy: 42, // same numeric id
          status: 'pending',
          loanAccountId: 'acct-123',
          reason: 'Customer unable to repay',
        },
      ],
    })

    const res = await POST(
      makeRequest({
        requestId: 'req-self-2',
        requestNumber: 'WOR-003',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('SELF_APPROVAL')
    expect(mockWriteOff).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('(c) find called with depth: 0 (no relationship population, scalar requestedBy)', async () => {
    await POST(
      makeRequest({
        requestId: 'req-abc',
        requestNumber: 'WOR-001',
        comment: 'Reviewed and approved after verification',
      }) as any,
    )

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'write-off-requests',
        depth: 0,
      }),
    )
  })
})
