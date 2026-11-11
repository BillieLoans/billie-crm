/**
 * Unit tests for POST /api/commands/reapp-block-clear/different-person (BTB-569)
 *
 * Mocks (same shape as reappBlockClearRequest.test.ts):
 *   - next/server        → NextResponse.json returns { body, status } for easy assertion
 *   - @/lib/auth         → requireAuth returns a fixed ops user and a payload whose
 *                          find() serves the stopped conversation
 *   - @/server/chatledger-publisher  → spy on publishClearAuthorized
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
  publishClearAuthorized: vi.fn().mockResolvedValue({ eventId: 'evt-chatledger-1' }),
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

import { POST } from '@/app/api/commands/reapp-block-clear/different-person/route'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { publishClearAuthorized } from '@/server/chatledger-publisher'
import { createAndPublishEvent, EventPublishError } from '@/server/event-publisher'

const makeRequest = (body: unknown) => ({ json: async () => body })

const JUSTIFICATION = 'Recycled mobile number: different name, DOB and address'

/** A conversation stopped by a verified-contact match with customer MATCHED-1. */
const stoppedConversation = (blockOverrides: Record<string, unknown> = {}) => ({
  docs: [
    {
      conversationId: 'conv-stopped-1',
      reapplicationBlock: {
        reason: 'ACTIVE_LOAN',
        canonicalCustomerId: 'MATCHED-1',
        recognition: { band: 'verified_contact', matched_contact_kinds: ['phone'] },
        clearStatus: null,
        ...blockOverrides,
      },
    },
  ],
})

describe('POST /api/commands/reapp-block-clear/different-person', () => {
  beforeEach(() => {
    vi.mocked(publishClearAuthorized).mockClear()
    vi.mocked(createAndPublishEvent).mockClear()
    vi.mocked(requireAuth).mockClear()
    mockFind.mockReset()
    mockFind.mockResolvedValue(stoppedConversation())
  })

  it('requires the servicing role, the same gate as the ordinary clear', async () => {
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
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('publishes clear_authorized with DIFFERENT_PERSON, the stopped conversation and the matched customer; 202', async () => {
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
    expect(vi.mocked(publishClearAuthorized)).toHaveBeenCalledTimes(1)
    const cmd = vi.mocked(publishClearAuthorized).mock.calls[0][0]
    expect(cmd.reasons).toEqual(['DIFFERENT_PERSON'])
    expect(cmd.stopped_conversation_id).toBe('conv-stopped-1')
    // The matched customer comes from the stop's own record, not the client.
    expect(cmd.canonical_customer_id).toBe('MATCHED-1')
    expect(cmd.operator_id).toBe('ops-1')
    expect(cmd.justification).toBe(JUSTIFICATION)
    expect(cmd.request_id).toBeTruthy()
    expect(cmd.requested_at).toBeTruthy()
    // No maker-checker for this reason.
    expect((cmd as any).approval).toBeUndefined()

    expect((res as any).body).toMatchObject({
      requestId: cmd.request_id,
      eventId: 'evt-chatledger-1',
      status: 'accepted',
    })
  })

  it('records the request on the internal stream under the same request id', async () => {
    await POST(makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any)

    const cmd = vi.mocked(publishClearAuthorized).mock.calls[0][0]
    expect(vi.mocked(createAndPublishEvent)).toHaveBeenCalledTimes(1)
    const audit = vi.mocked(createAndPublishEvent).mock.calls[0][0]
    expect(audit.typ).toBe('block_clear.different_person_requested.v1')
    expect(audit.requestId).toBe(cmd.request_id)
    expect(audit.userId).toBe('ops-1')
    expect(audit.payload).toEqual({
      conversationId: 'conv-stopped-1',
      canonicalCustomerId: 'MATCHED-1',
      justification: JUSTIFICATION,
      requestedBy: 'ops-1',
      requestedByName: 'Op Erator',
    })
    // The command goes first: the record must never claim a clear nothing sent.
    expect(vi.mocked(publishClearAuthorized).mock.invocationCallOrder[0]).toBeLessThan(
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
    expect(vi.mocked(publishClearAuthorized)).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('answers 503 and records nothing when the command cannot be published', async () => {
    vi.mocked(publishClearAuthorized).mockRejectedValueOnce(
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
    ['a blank justification', { conversationId: 'conv-stopped-1', justification: '             ' }],
    ['no conversation id', { justification: JUSTIFICATION }],
    ['a body that is not JSON', null],
  ])('400 for %s; nothing published', async (_name, body) => {
    const res = await POST(makeRequest(body) as any)

    expect(res.status).toBe(400)
    expect(mockFind).not.toHaveBeenCalled()
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('404 when the conversation does not exist', async () => {
    mockFind.mockResolvedValueOnce({ docs: [] })

    const res = await POST(
      makeRequest({ conversationId: 'conv-missing', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(404)
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
  })

  it.each([
    ['an ordinary block (no recognition)', { recognition: null }, 'NOT_A_CONTACT_MATCH_STOP'],
    ['a review halt', { recognition: { band: 'review' } }, 'NOT_A_CONTACT_MATCH_STOP'],
    ['a stop that names no matched customer', { canonicalCustomerId: null }, 'NO_MATCHED_CUSTOMER'],
    ['a stop already cleared', { clearStatus: 'cleared' }, 'ALREADY_CLEARED'],
  ])('409 for %s; nothing published', async (_name, blockOverrides, code) => {
    mockFind.mockResolvedValueOnce(stoppedConversation(blockOverrides))

    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(409)
    expect((res as any).body.error.code).toBe(code)
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
    expect(vi.mocked(createAndPublishEvent)).not.toHaveBeenCalled()
  })

  it('409 for a conversation with no block at all', async () => {
    mockFind.mockResolvedValueOnce({ docs: [{ conversationId: 'conv-stopped-1' }] })

    const res = await POST(
      makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
    )

    expect(res.status).toBe(409)
    expect(vi.mocked(publishClearAuthorized)).not.toHaveBeenCalled()
  })

  it('lets a refused or still-pending clear be sent again', async () => {
    for (const clearStatus of ['rejected', 'pending']) {
      mockFind.mockResolvedValueOnce(stoppedConversation({ clearStatus }))
      const res = await POST(
        makeRequest({ conversationId: 'conv-stopped-1', justification: JUSTIFICATION }) as any,
      )
      expect(res.status).toBe(202)
    }
    expect(vi.mocked(publishClearAuthorized)).toHaveBeenCalledTimes(2)
  })
})
