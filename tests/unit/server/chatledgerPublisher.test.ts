import { describe, it, expect, vi, beforeEach } from 'vitest'

const xadd = vi.fn().mockResolvedValue('1-0')
const connect = vi.fn().mockResolvedValue(undefined)
const mockClient = { xadd, connect, status: 'ready' }
vi.mock('@/server/redis-client', () => ({
  getChatLedgerRedisClient: () => mockClient,
}))

import {
  publishClearAuthorized,
  publishContactIntakeRequested,
  publishFeedbackSubmitted,
} from '@/server/chatledger-publisher'
import { EventPublishError } from '@/server/event-publisher'
import type {
  ContactIntakeCommandPayload,
  FeedbackSubmitCommandPayload,
} from '@/lib/events/types'

beforeEach(() => {
  xadd.mockClear()
  xadd.mockResolvedValue('1-0')
  connect.mockClear()
  mockClient.status = 'ready'
})

describe('publishClearAuthorized', () => {
  it('xadds a chatLedger LedgerMessage with agt=billie-crm and the ops conv', async () => {
    const res = await publishClearAuthorized({
      canonical_customer_id: 'c123',
      reasons: ['SERVICEABILITY'],
      operator_id: 'ops-1',
      justification: 'manual assessment',
      request_id: 'req-1',
      requested_at: '2026-06-28T00:00:00.000Z',
    })
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(1)
    const [stream, star, ...flat] = xadd.mock.calls[0]
    expect(stream).toBe('chatLedger')
    expect(star).toBe('*')
    const fields = Object.fromEntries(
      flat.reduce((acc: string[][], v: string, i: number) => {
        if (i % 2 === 0) acc.push([v, flat[i + 1]])
        return acc
      }, []),
    )
    expect(fields.agt).toBe('billie-crm')
    expect(fields.typ).toBe('reapplication_block.clear_authorized.v1')
    expect(fields.conv).toBe('ops:block-clear:req-1')
    expect(fields.usr).toBe('c123')
    expect(fields.cls).toBe('cmd')
    expect(JSON.parse(fields.payload).request_id).toBe('req-1')
    expect(fields.seq).toBe('1')
    expect(fields.cause).toBeTruthy()
  })

  it('connects first when the lazy client has not connected yet', async () => {
    mockClient.status = 'wait'
    await publishClearAuthorized({
      canonical_customer_id: 'c123',
      reasons: ['SERVICEABILITY'],
      operator_id: 'ops-1',
      justification: 'manual assessment',
      request_id: 'req-2',
      requested_at: '2026-06-28T00:00:00.000Z',
    })
    expect(connect).toHaveBeenCalled()
    expect(xadd).toHaveBeenCalledTimes(1)
  })

  it('retries a transient xadd failure and succeeds', async () => {
    xadd
      .mockRejectedValueOnce(
        new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      )
      .mockResolvedValueOnce('1-1')
    const res = await publishClearAuthorized({
      canonical_customer_id: 'c123',
      reasons: ['SERVICEABILITY'],
      operator_id: 'ops-1',
      justification: 'manual assessment',
      request_id: 'req-3',
      requested_at: '2026-06-28T00:00:00.000Z',
    })
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(2)
  })

  it('throws EventPublishError after exhausting retries', async () => {
    xadd.mockRejectedValue(new Error('down'))
    await expect(
      publishClearAuthorized({
        canonical_customer_id: 'c123',
        reasons: ['SERVICEABILITY'],
        operator_id: 'ops-1',
        justification: 'manual assessment',
        request_id: 'req-4',
        requested_at: '2026-06-28T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(EventPublishError)
    expect(xadd).toHaveBeenCalledTimes(3)
  })
})

function sampleIntakePayload(
  overrides: Partial<ContactIntakeCommandPayload> = {},
): ContactIntakeCommandPayload {
  return {
    idempotency_key: 'intake:0400000001',
    first_name: 'Ash',
    email: null,
    mobile: '0400000001',
    city: null,
    postcode: null,
    source: 'meta',
    utm: {},
    platforms: [],
    channel_preference: null,
    referred_by_code: null,
    waitlist: true,
    consent: { granted: true, method: 'waitlist_form', channels: ['sms'] },
    actor: 'intake',
    ...overrides,
  }
}

describe('publishContactIntakeRequested', () => {
  it('xadds a chatLedger command with agt=billie-crm, cmd typ, and the intake conv', async () => {
    const res = await publishContactIntakeRequested(sampleIntakePayload())
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(1)
    const [stream, star, ...flat] = xadd.mock.calls[0]
    expect(stream).toBe('chatLedger')
    expect(star).toBe('*')
    const fields = Object.fromEntries(
      flat.reduce((acc: string[][], v: string, i: number) => {
        if (i % 2 === 0) acc.push([v, flat[i + 1]])
        return acc
      }, []),
    )
    expect(fields.agt).toBe('billie-crm')
    expect(fields.typ).toBe('contact.intake.requested.v1')
    expect(fields.conv).toBe('contact-intake:intake:0400000001')
    expect(fields.usr).toBe('intake')
    expect(fields.cls).toBe('cmd')
    expect(fields.seq).toBe('1')
    expect(fields.cause).toBeTruthy()
    expect(JSON.parse(fields.payload).idempotency_key).toBe('intake:0400000001')
  })

  it('connects first when the lazy client has not connected yet', async () => {
    mockClient.status = 'wait'
    await publishContactIntakeRequested(sampleIntakePayload({ idempotency_key: 'intake:k2' }))
    expect(connect).toHaveBeenCalled()
    expect(xadd).toHaveBeenCalledTimes(1)
  })

  it('retries a transient xadd failure and succeeds', async () => {
    xadd
      .mockRejectedValueOnce(
        new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      )
      .mockResolvedValueOnce('1-1')
    const res = await publishContactIntakeRequested(sampleIntakePayload({ idempotency_key: 'intake:k3' }))
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(2)
  })

  it('throws EventPublishError after exhausting retries', async () => {
    xadd.mockRejectedValue(new Error('down'))
    await expect(
      publishContactIntakeRequested(sampleIntakePayload({ idempotency_key: 'intake:k4' })),
    ).rejects.toBeInstanceOf(EventPublishError)
    expect(xadd).toHaveBeenCalledTimes(3)
  })
})

function sampleFeedbackPayload(
  overrides: Partial<FeedbackSubmitCommandPayload> = {},
): FeedbackSubmitCommandPayload {
  return {
    idempotency_key: 'feedback:c-1:abcdef0123456789',
    contact_id: 'c-1',
    customer_id: null,
    type: 'bug',
    severity: null,
    text: 'app crashed',
    product_area: null,
    actor: 'intake',
    ...overrides,
  }
}

describe('publishFeedbackSubmitted', () => {
  it('xadds a chatLedger command with agt=billie-crm, cmd typ, and the feedback conv', async () => {
    const res = await publishFeedbackSubmitted(sampleFeedbackPayload())
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(1)
    const [stream, star, ...flat] = xadd.mock.calls[0]
    expect(stream).toBe('chatLedger')
    expect(star).toBe('*')
    const fields = Object.fromEntries(
      flat.reduce((acc: string[][], v: string, i: number) => {
        if (i % 2 === 0) acc.push([v, flat[i + 1]])
        return acc
      }, []),
    )
    expect(fields.agt).toBe('billie-crm')
    expect(fields.typ).toBe('feedback.submit.requested.v1')
    expect(fields.conv).toBe('feedback-intake:feedback:c-1:abcdef0123456789')
    expect(fields.usr).toBe('intake')
    expect(fields.cls).toBe('cmd')
    expect(JSON.parse(fields.payload).contact_id).toBe('c-1')
  })

  it('retries a transient xadd failure and succeeds', async () => {
    xadd
      .mockRejectedValueOnce(
        new Error("Stream isn't writeable and enableOfflineQueue options is false"),
      )
      .mockResolvedValueOnce('1-1')
    const res = await publishFeedbackSubmitted(sampleFeedbackPayload({ idempotency_key: 'k3' }))
    expect(res.eventId).toBeTruthy()
    expect(xadd).toHaveBeenCalledTimes(2)
  })

  it('throws EventPublishError after exhausting retries', async () => {
    xadd.mockRejectedValue(new Error('down'))
    await expect(
      publishFeedbackSubmitted(sampleFeedbackPayload({ idempotency_key: 'k4' })),
    ).rejects.toBeInstanceOf(EventPublishError)
    expect(xadd).toHaveBeenCalledTimes(3)
  })
})
