/**
 * Unit tests for B1: POST /api/webhooks/clicksend.
 *
 * Accept-and-enqueue webhook — shared-secret auth (fail-closed, header or query),
 * form-urlencoded + JSON body handling, enqueue then 200. next/server and
 * @/server/event-publisher are mocked; the schema + safeEqual are real.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockPublish = vi.hoisted(() => vi.fn(async () => ({ status: 'accepted' })))
vi.mock('@/server/event-publisher', () => ({
  createAndPublishEvent: mockPublish,
}))

import { POST } from '@/app/api/webhooks/clicksend/route'

const SECRET = 'clicksend-shared-secret'

function req(opts: {
  body: string
  contentType?: string
  headerSecret?: string
  querySecret?: string
}): NextRequest {
  const url = opts.querySecret
    ? `http://x/api/webhooks/clicksend?secret=${encodeURIComponent(opts.querySecret)}`
    : 'http://x/api/webhooks/clicksend'
  const headers: Record<string, string> = {
    'content-type': opts.contentType ?? 'application/x-www-form-urlencoded',
  }
  if (opts.headerSecret) headers['x-webhook-secret'] = opts.headerSecret
  return new Request(url, { method: 'POST', headers, body: opts.body }) as unknown as NextRequest
}

const form = 'from=%2B61487722156&body=hello+back&message_id=IN-1&to=%2B61400000000'

beforeEach(() => {
  process.env.CLICKSEND_WEBHOOK_SECRET = SECRET
  mockPublish.mockReset().mockResolvedValue({ status: 'accepted' })
})

describe('POST /api/webhooks/clicksend — auth', () => {
  test('401 when no secret is provided', async () => {
    const res = (await POST(req({ body: form }))) as { status: number }
    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  test('401 when the secret is wrong', async () => {
    const res = (await POST(req({ body: form, headerSecret: 'nope' }))) as { status: number }
    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  test('fail-closed: 401 even with a secret when the env secret is unset', async () => {
    delete process.env.CLICKSEND_WEBHOOK_SECRET
    const res = (await POST(req({ body: form, headerSecret: SECRET }))) as { status: number }
    expect(res.status).toBe(401)
  })

  test('accepts the secret via query param', async () => {
    const res = (await POST(req({ body: form, querySecret: SECRET }))) as { status: number }
    expect(res.status).toBe(200)
  })
})

describe('POST /api/webhooks/clicksend — ingest', () => {
  test('form-urlencoded: enqueues clicksend.inbound.received.v1 and 200s', async () => {
    const res = (await POST(req({ body: form, headerSecret: SECRET }))) as {
      body: { status: string }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('accepted')
    expect(mockPublish).toHaveBeenCalledTimes(1)
    const arg = mockPublish.mock.calls[0][0]
    expect(arg.typ).toBe('clicksend.inbound.received.v1')
    expect(arg.userId).toBe('clicksend')
    expect(arg.payload.from).toBe('+61487722156')
    expect(arg.payload.body).toBe('hello back')
    expect(arg.payload.message_id).toBe('IN-1')
  })

  test('JSON body is handled too', async () => {
    const res = (await POST(
      req({
        body: JSON.stringify({ from: '+61487722156', body: 'json reply', message_id: 'IN-2' }),
        contentType: 'application/json',
        headerSecret: SECRET,
      }),
    )) as { status: number }
    expect(res.status).toBe(200)
    expect(mockPublish.mock.calls[0][0].payload.body).toBe('json reply')
  })

  test('400 when `from` is missing', async () => {
    const res = (await POST(req({ body: 'body=orphan+reply', headerSecret: SECRET }))) as {
      body: { error: { code: string } }
      status: number
    }
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(mockPublish).not.toHaveBeenCalled()
  })

  test('503 when the enqueue fails (ClickSend retries)', async () => {
    mockPublish.mockRejectedValue(new Error('redis down'))
    const res = (await POST(req({ body: form, headerSecret: SECRET }))) as {
      body: { error: { code: string } }
      status: number
    }
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('WEBHOOK_UNAVAILABLE')
  })
})
