/**
 * Unit tests for POST /api/commands/writeoff/cancel — authz ordering.
 *
 * Regression guard for the skip-authz-when-not-found pattern (fixed alongside
 * the block-clear cancel route): a missing request must 404, never fall
 * through to publish; and the lookup must use depth:0 so requestedBy stays a
 * scalar id for the requester comparison.
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

const mockFind = vi.hoisted(() => vi.fn().mockResolvedValue({ docs: [{ requestedBy: 'ops-1' }] }))
const mockUser = vi.hoisted(() => ({
  current: { id: 'ops-1', firstName: 'Op', lastName: undefined, role: 'operations', email: 'op@x' },
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockImplementation(async () => ({
    user: mockUser.current,
    payload: { find: mockFind },
  })),
}))

vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: vi.fn().mockResolvedValue({
    eventId: 'evt-wo-cancel-1',
    requestId: 'req-wo-1',
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

import { POST } from '@/app/api/commands/writeoff/cancel/route'
import { createAndPublishEvent } from '@/server/event-publisher'
import type { NextRequest } from 'next/server'

const makeRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

const VALID_BODY = { requestId: 'req-wo-1', requestNumber: 'WO-TEST-1' }

describe('POST /api/commands/writeoff/cancel — authz ordering', () => {
  beforeEach(() => {
    vi.mocked(createAndPublishEvent).mockClear()
    mockFind.mockClear()
    mockFind.mockResolvedValue({ docs: [{ requestedBy: 'ops-1' }] })
    mockUser.current = {
      id: 'ops-1',
      firstName: 'Op',
      lastName: undefined,
      role: 'operations',
      email: 'op@x',
    }
  })

  it('404s on an unknown requestId and never publishes', async () => {
    mockFind.mockResolvedValue({ docs: [] })
    const res = (await POST(makeRequest(VALID_BODY))) as unknown as {
      status: number
      body: { error?: { code: string } }
    }
    expect(res.status).toBe(404)
    expect(res.body.error?.code).toBe('NOT_FOUND')
    expect(createAndPublishEvent).not.toHaveBeenCalled()
  })

  it('403s a non-requester without approval authority and never publishes', async () => {
    mockFind.mockResolvedValue({ docs: [{ requestedBy: 'someone-else' }] })
    const res = (await POST(makeRequest(VALID_BODY))) as unknown as {
      status: number
      body: { error?: { code: string } }
    }
    expect(res.status).toBe(403)
    expect(res.body.error?.code).toBe('FORBIDDEN')
    expect(createAndPublishEvent).not.toHaveBeenCalled()
  })

  it('lets the original requester cancel (202) with a depth:0 lookup', async () => {
    const res = (await POST(makeRequest(VALID_BODY))) as unknown as { status: number }
    expect(res.status).toBe(202)
    expect(createAndPublishEvent).toHaveBeenCalledTimes(1)
    expect(mockFind).toHaveBeenCalledWith(expect.objectContaining({ depth: 0 }))
  })

  it('lets a supervisor cancel someone else’s request (202)', async () => {
    mockFind.mockResolvedValue({ docs: [{ requestedBy: 'someone-else' }] })
    mockUser.current = {
      id: 'sup-1',
      firstName: 'Sue',
      lastName: undefined,
      role: 'supervisor',
      email: 'sue@x',
    }
    const res = (await POST(makeRequest(VALID_BODY))) as unknown as { status: number }
    expect(res.status).toBe(202)
    expect(createAndPublishEvent).toHaveBeenCalledTimes(1)
  })
})
