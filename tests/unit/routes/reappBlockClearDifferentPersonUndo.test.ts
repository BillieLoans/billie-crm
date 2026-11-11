/**
 * Unit tests for POST /api/commands/reapp-block-clear/different-person/undo (BTB-569)
 *
 * Mocks (same shape as reappBlockClearDifferentPerson.test.ts):
 *   - next/server        → NextResponse.json returns { body, status } for easy assertion
 *   - @/lib/auth         → requireAuth returns a fixed ops user and a payload whose
 *                          find() serves the stopped conversation
 *   - @/server/chatledger-publisher  → spy on publishClearRevokeAuthorized
 *   - @/server/event-publisher       → spy on createAndPublishEvent; real-shaped EventPublishError
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

const { mockFind } = vi.hoisted(() => ({ mockFind: vi.fn() }))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    user: { id: 'ops-1', firstName: 'Op', lastName: 'Erator', role: 'operations', email: 'op@x' },
    payload: { find: mockFind },
  }),
}))

vi.mock('@/server/chatledger-publisher', () => ({
  publishClearRevokeAuthorized: vi.fn().mockResolvedValue({ eventId: 'evt-chatledger-1' }),
}))

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

import { POST } from '@/app/api/commands/reapp-block-clear/different-person/undo/route'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { publishClearRevokeAuthorized } from '@/server/chatledger-publisher'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'

const makeRequest = (body: unknown) => ({ json: async () => body })

const JUSTIFICATION = 'Same person after all: the licence on the new application matches'

/** A verified-contact stop with customer MATCHED-1 whose different-person clear is in effect. */
const clearedStop = (blockOverrides: Record<string, unknown> = {}) => ({
  docs: [
    {
      conversationId: 'conv-stopped-1',
      reapplicationBlock: {
        reason: 'ACTIVE_LOAN',
        canonicalCustomerId: 'MATCHED-1',
        recognition: { band: 'verified_contact', matched_contact_kinds: ['phone'] },
        clearStatus: 'cleared',
        clearRequestId: 'req-clear-1',
        ...blockOverrides,
      },
    },
  ],
})

describe('POST /api/commands/reapp-block-clear/different-person/undo', () => {
  beforeEach(() => {
    vi.mocked(publishClearRevokeAuthorized).mockClear()
    vi.mocked(createAndPublishEvent).mockClear()
    vi.mocked(requireAuth).mockClear()
    mockFind.mockReset()
    mockFind.mockResolvedValue(clearedStop())
  })

  it('requires the servicing role, the same gate as the clear it undoes', async () => {
    await POST(makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any)
    expect(vi.mocked(requireAuth)).toHaveBeenCalledWith(canService)
  })

  it('returns the auth error and publishes nothing when the user may not clear', async () => {
    const denied = { body: { error: { code: 'FORBIDDEN' } }, status: 403 }
    vi.mocked(requireAuth).mockResolvedValueOnce({ error: denied } as any)

    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
    )

    expect(res).toBe(denied)
    expect(mockFind).not.toHaveBeenCalled()
    expect(vi.mocked(publishClearRevokeAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it("publishes clear_revoke_authorized with exactly billieChat's fields; 202", async () => {
    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: `  ${JUSTIFICATION}  ` }) as any,
    )

    expect(res.status).toBe(202)
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'conversations',
        where: { conversationId: { equals: 'conv-stopped-1' } },
      }),
    )
    expect(vi.mocked(publishClearRevokeAuthorized)).toHaveBeenCalledTimes(1)
    const cmd = vi.mocked(publishClearRevokeAuthorized).mock.calls[0][0]
    expect(cmd.request_id).toBeTruthy()
    expect(cmd).toEqual({
      request_id: cmd.request_id,
      operator_id: 'ops-1',
      justification: JUSTIFICATION,
      // The matched customer comes from the stop's own record, not the client.
      canonical_customer_id: 'MATCHED-1',
      reasons: ['DIFFERENT_PERSON'],
      stopped_conversation_id: 'conv-stopped-1',
    })

    expect((res as any).body).toMatchObject({
      requestId: cmd.request_id,
      eventId: 'evt-chatledger-1',
      status: 'accepted',
    })
  })

  it('ignores a customer or reasons the client tries to name', async () => {
    await POST(
      makeRequest({
        conversationId: 'conv-stopped-1',
        justification: JUSTIFICATION,
        canonicalCustomerId: 'SOMEONE-ELSE',
        canonical_customer_id: 'SOMEONE-ELSE',
        reasons: ['ACTIVE_LOAN'],
      }) as any,
    )

    const cmd = vi.mocked(publishClearRevokeAuthorized).mock.calls[0][0]
    expect(cmd.canonical_customer_id).toBe('MATCHED-1')
    expect(cmd.reasons).toEqual(['DIFFERENT_PERSON'])
  })

  it('records the request on the internal stream under the same request id', async () => {
    await POST(makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any)

    const cmd = vi.mocked(publishClearRevokeAuthorized).mock.calls[0][0]
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)
    const audit = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(audit.typ).toBe('block_clear.different_person_revoke_requested.v1')
    expect(audit.requestId).toBe(cmd.request_id)
    expect(audit.userId).toBe('ops-1')
    expect(audit.payload).toEqual({
      conversationId: 'conv-stopped-1',
      canonicalCustomerId: 'MATCHED-1',
      justification: JUSTIFICATION,
      requestedBy: 'ops-1',
      requestedByName: 'Op Erator',
      clearRequestId: 'req-clear-1',
    })
    // The command goes first: the record must never claim an undo nothing sent.
    expect(vi.mocked(publishClearRevokeAuthorized).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(createAndPublishEvent).mock.invocationCallOrder[0],
    )
  })

  it('still answers 202 when only the request record fails to publish', async () => {
    vi.mocked(createAndPublishEvent).mockRejectedValueOnce(
      new EventPublishError('internal stream down', { attempts: 3 }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(202)
    expect(vi.mocked(publishClearRevokeAuthorized)).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('answers 503 and records nothing when the command cannot be published', async () => {
    vi.mocked(publishClearRevokeAuthorized).mockRejectedValueOnce(
      new EventPublishError('chatLedger down', { attempts: 3 }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(503)
    expect((res as any).body.error.code).toBe('EVENT_PUBLISH_FAILED')
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it.each([
    ['no justification', { conversationId: 'conv-stopped-1' }],
    ['a justification under the minimum', { conversationId: 'conv-stopped-1', justification: 'too short' }],
    [
      'a justification one character under the minimum',
      { conversationId: 'conv-stopped-1', justification: 'x'.repeat(MIN_APPROVAL_COMMENT_LENGTH - 1) },
    ],
    ['a blank justification', { conversationId: 'conv-stopped-1', justification: '             ' }],
    ['no conversation id', { justification: JUSTIFICATION }],
    ['a body that is not JSON', null],
  ])('400 for %s; nothing published', async (_name, body) => {
    const res = await POST(makeRequest(body) as any)

    expect(res.status).toBe(400)
    expect(mockFind).not.toHaveBeenCalled()
    expect(vi.mocked(publishClearRevokeAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('accepts a justification of exactly the minimum, as the clear does', async () => {
    const res = await POST(
      makeRequest({
        conversationId: 'conv-stopped-1',
        justification: 'x'.repeat(MIN_APPROVAL_COMMENT_LENGTH),
      }) as any,
    )
    expect(res.status).toBe(202)
  })

  it('404 when the conversation does not exist', async () => {
    mockFind.mockResolvedValueOnce({ docs: [] })

    const res = await POST(
      makeRequest({ conversationId: 'conv-missing', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(404)
    expect(vi.mocked(publishClearRevokeAuthorized)).not.toHaveBeenCalled()
  })

  it.each([
    ['an ordinary cleared block (no recognition)', { recognition: null }, 'NOT_A_CONTACT_MATCH_STOP'],
    ['a cleared review halt', { recognition: { band: 'review' } }, 'NOT_A_CONTACT_MATCH_STOP'],
    ['a stop that was never cleared', { clearStatus: null }, 'NOT_CLEARED'],
    ['a stop whose clear is only requested', { clearStatus: 'pending' }, 'NOT_CLEARED'],
    ['a stop whose clear was refused', { clearStatus: 'rejected' }, 'NOT_CLEARED'],
    [
      'a stop whose clear has already been undone',
      { clearStatus: null, clearRevokeStatus: 'revoked' },
      'NOT_CLEARED',
    ],
    ['a cleared stop that names no matched customer', { canonicalCustomerId: null }, 'NO_MATCHED_CUSTOMER'],
  ])('409 for %s; nothing published', async (_name, blockOverrides, code) => {
    mockFind.mockResolvedValueOnce(clearedStop(blockOverrides))

    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(409)
    expect((res as any).body.error.code).toBe(code)
    expect(vi.mocked(publishClearRevokeAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('409 for a conversation with no block at all', async () => {
    mockFind.mockResolvedValueOnce({ docs: [{ conversationId: 'conv-stopped-1' }] })

    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(409)
    expect(vi.mocked(publishClearRevokeAuthorized)).not.toHaveBeenCalled()
  })

  it('lets a refused or still-pending undo be sent again while the clear stands', async () => {
    for (const clearRevokeStatus of ['rejected', 'pending']) {
      mockFind.mockResolvedValueOnce(clearedStop({ clearRevokeStatus }))
      const res = await POST(
        makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
      )
      expect(res.status).toBe(202)
    }
    expect(vi.mocked(publishClearRevokeAuthorized)).toHaveBeenCalledTimes(2)
  })
})
