/**
 * Unit tests for POST /api/commands/writeoff/approve — ledger idempotency & error mapping
 *
 * Covers the P0 remediation:
 *   1. Deterministic ledger idempotency key (`writeoff-approve-${requestId}`, no timestamp),
 *      so the ledger's own 24h dedup window can absorb sequential retries.
 *   2. gRPC FAILED_PRECONDITION (code 9) → 422 non-retryable; other gRPC errors → 503 retryable.
 *   3. The "ledger posted" marker is written BEFORE the event publish, and a retry after a failed
 *      publish re-publishes the event WITHOUT posting to the ledger again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockAuth = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    user: { id: 'sup-1', firstName: 'Sup', lastName: 'User', role: 'supervisor', email: 'sup@x' },
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
  getPayload: vi.fn().mockResolvedValue({ auth: mockAuth, find: mockFind }),
}))

vi.mock('@payload-config', () => ({ default: {} }))

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ entries: () => [] }),
}))

const mockWriteOff = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    eventId: 'ledger-evt-1',
    transaction: { transactionId: 'txn-123' },
  }),
)

vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: vi.fn(() => ({ writeOff: mockWriteOff })),
}))

const mockRedisGet = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const mockRedisSet = vi.hoisted(() => vi.fn().mockResolvedValue('OK'))

vi.mock('@/server/redis-client', () => ({
  getRedisClient: vi.fn(() => ({ get: mockRedisGet, set: mockRedisSet })),
}))

const mockPublish = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    eventId: 'evt-approve-1',
    requestId: 'req-abc',
    status: 'accepted',
    message: 'Write-off approved',
  }),
)

vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: mockPublish,
  EventPublishError: class EventPublishError extends Error {
    public readonly attempts: number
    constructor(msg: string, opts?: { attempts?: number }) {
      super(msg)
      this.name = 'EventPublishError'
      this.attempts = opts?.attempts ?? 1
    }
  },
}))

import { POST } from '@/app/api/commands/writeoff/approve/route'
import { EventPublishError } from '@/server/event-publisher'

const makeRequest = (body: unknown) => ({ json: async () => body })

const validBody = {
  requestId: 'req-abc',
  requestNumber: 'WOR-001',
  comment: 'Reviewed and approved after verification',
}

describe('POST /api/commands/writeoff/approve — ledger idempotency & error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({
      user: { id: 'sup-1', firstName: 'Sup', lastName: 'User', role: 'supervisor', email: 'sup@x' },
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
    mockWriteOff.mockResolvedValue({
      eventId: 'ledger-evt-1',
      transaction: { transactionId: 'txn-123' },
    })
    mockRedisGet.mockResolvedValue(null)
    mockRedisSet.mockResolvedValue('OK')
    mockPublish.mockResolvedValue({
      eventId: 'evt-approve-1',
      requestId: 'req-abc',
      status: 'accepted',
      message: 'Write-off approved',
    })
  })

  it('uses a deterministic idempotency key with no timestamp entropy', async () => {
    await POST(makeRequest(validBody) as any)

    expect(mockWriteOff).toHaveBeenCalledTimes(1)
    const { idempotencyKey } = mockWriteOff.mock.calls[0][0]
    expect(idempotencyKey).toBe('writeoff-approve-req-abc')
  })

  it('produces the same idempotency key across repeated attempts', async () => {
    await POST(makeRequest(validBody) as any)
    mockRedisGet.mockResolvedValue(null) // marker unavailable — worst case
    await POST(makeRequest(validBody) as any)

    expect(mockWriteOff).toHaveBeenCalledTimes(2)
    expect(mockWriteOff.mock.calls[0][0].idempotencyKey).toBe(
      mockWriteOff.mock.calls[1][0].idempotencyKey,
    )
  })

  it('maps gRPC FAILED_PRECONDITION (9) to a non-retryable 422 and does not publish', async () => {
    mockWriteOff.mockRejectedValueOnce(
      Object.assign(new Error('rejected'), { code: 9, details: 'Account already written off' }),
    )

    const res = (await POST(makeRequest(validBody) as any)) as any

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('LEDGER_REJECTED')
    expect(res.body.error.message).toBe('Account already written off')
    expect(mockPublish).not.toHaveBeenCalled()
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it('maps gRPC UNAVAILABLE (14) to a retryable 503', async () => {
    mockWriteOff.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 14 }))

    const res = (await POST(makeRequest(validBody) as any)) as any

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('LEDGER_ERROR')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('writes the ledger-posted marker before publishing the event', async () => {
    const order: string[] = []
    mockRedisSet.mockImplementation(async () => {
      order.push('marker')
      return 'OK'
    })
    mockPublish.mockImplementation(async () => {
      order.push('publish')
      return { eventId: 'evt-1', requestId: 'req-abc', status: 'accepted', message: 'ok' }
    })

    await POST(makeRequest(validBody) as any)

    expect(order).toEqual(['marker', 'publish'])
    expect(mockRedisSet).toHaveBeenCalledWith(
      'writeoff-ledger-posted:req-abc',
      expect.any(String),
      'EX',
      86400,
      'NX',
    )
  })

  it('retry after a failed publish re-publishes WITHOUT re-posting to the ledger', async () => {
    // Attempt 1: ledger succeeds, publish fails → 503
    mockPublish.mockRejectedValueOnce(new EventPublishError('redis down'))
    const first = (await POST(makeRequest(validBody) as any)) as any
    expect(first.status).toBe(503)
    expect(first.body.error.code).toBe('EVENT_PUBLISH_FAILED')
    expect(mockWriteOff).toHaveBeenCalledTimes(1)

    // The marker persisted the ledger identifiers before the publish attempt.
    const stored = mockRedisSet.mock.calls[0][1]

    // Attempt 2: the projection row is still `pending`, so the retry reaches the ledger step —
    // the marker must short-circuit it.
    mockRedisGet.mockResolvedValue(stored)

    const second = (await POST(makeRequest(validBody) as any)) as any

    expect(second.status).toBe(202)
    expect(mockWriteOff).toHaveBeenCalledTimes(1) // NOT called again
    expect(mockPublish).toHaveBeenCalledTimes(2)

    // The re-published event carries the original ledger identifiers.
    const payload = mockPublish.mock.calls[1][0].payload
    expect(payload.ledgerEventId).toBe('ledger-evt-1')
    expect(payload.transactionId).toBe('txn-123')
  })

  it('falls through to the ledger call when the marker read fails (deterministic key protects)', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('redis unreachable'))

    const res = (await POST(makeRequest(validBody) as any)) as any

    expect(res.status).toBe(202)
    expect(mockWriteOff).toHaveBeenCalledTimes(1)
  })

  it('still returns 202 when writing the marker fails', async () => {
    mockRedisSet.mockRejectedValueOnce(new Error('redis unreachable'))

    const res = (await POST(makeRequest(validBody) as any)) as any

    expect(res.status).toBe(202)
    expect(mockPublish).toHaveBeenCalledTimes(1)
  })
})
