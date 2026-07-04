/**
 * Unit tests for B2: public feedback intake (POST /api/intake/feedback).
 *
 * gRPC-primary (SubmitFeedback) with a durable chatLedger fallback — the same
 * intake-via-broker posture as the waitlist route.
 *
 * Mocks:
 *   - next/server                     → NextResponse.json returns { body, status }
 *   - @/server/marketing-grpc-client  → submitFeedback is mocked (no real gRPC)
 *   - @/server/chatledger-publisher   → publishFeedbackSubmitted is mocked; the
 *                                        fallback publishes the command here and
 *                                        the Broker routes it to marketingService
 *   - @/lib/intake-auth and @/lib/schemas/intake are the REAL implementations.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockSubmitFeedback = vi.hoisted(() => vi.fn())
vi.mock('@/server/marketing-grpc-client', () => ({
  submitFeedback: mockSubmitFeedback,
}))

const mockPublishFeedback = vi.hoisted(() => vi.fn(async () => ({ eventId: 'evt-1' })))
vi.mock('@/server/chatledger-publisher', () => ({
  publishFeedbackSubmitted: mockPublishFeedback,
}))

import { POST } from '@/app/api/intake/feedback/route'

const API_KEY = 'test-key'
const HMAC_SECRET = 'test-secret'

function makeSignedRequest(
  bodyObj: unknown,
  opts?: { signature?: string; skipAuthHeaders?: boolean },
): NextRequest {
  const raw = JSON.stringify(bodyObj)
  const headers: Record<string, string> = {}
  if (!opts?.skipAuthHeaders) {
    headers['x-api-key'] = API_KEY
    headers['x-signature'] =
      opts?.signature ?? createHmac('sha256', HMAC_SECRET).update(raw).digest('hex')
  }
  return new Request('http://x/api/intake/feedback', {
    method: 'POST',
    headers,
    body: raw,
  }) as unknown as NextRequest
}

describe('POST /api/intake/feedback', () => {
  beforeEach(() => {
    process.env.INTAKE_API_KEY = API_KEY
    process.env.INTAKE_HMAC_SECRET = HMAC_SECRET
    mockSubmitFeedback.mockReset()
    mockPublishFeedback.mockReset().mockResolvedValue({ eventId: 'evt-1' })
  })

  const validBody = {
    contact_id: 'c-1',
    type: 'bug',
    text: 'the app crashed on submit',
  }

  test('401s when the signature is invalid', async () => {
    const res = (await POST(makeSignedRequest(validBody, { signature: 'deadbeef' }))) as {
      status: number
    }
    expect(res.status).toBe(401)
    expect(mockSubmitFeedback).not.toHaveBeenCalled()
  })

  test('400s when contact_id or text is missing', async () => {
    const res = (await POST(makeSignedRequest({ type: 'bug' }))) as {
      body: { error: { code: string } }
      status: number
    }
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(mockSubmitFeedback).not.toHaveBeenCalled()
  })

  test('accepts via gRPC and returns 200 with feedbackId, never touching the fallback', async () => {
    mockSubmitFeedback.mockResolvedValue({
      feedbackId: 'fb-1',
      eventId: 'ev-1',
      idempotentReplay: false,
    })
    const res = (await POST(makeSignedRequest(validBody))) as {
      body: { status: string; feedbackId?: string }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('accepted')
    expect(res.body.feedbackId).toBe('fb-1')
    expect(mockPublishFeedback).not.toHaveBeenCalled()

    const call = mockSubmitFeedback.mock.calls[0][0]
    expect(call.contactId).toBe('c-1')
    expect(call.type).toBe('bug')
    expect(call.actor).toBe('intake')
    // derived idempotency key: feedback:<contact>:<hash>
    expect(call.idempotencyKey).toMatch(/^feedback:c-1:[0-9a-f]{16}$/)
  })

  test('falls back to chatLedger and returns 200 queued when gRPC fails', async () => {
    mockSubmitFeedback.mockRejectedValue(new Error('UNAVAILABLE'))
    const res = (await POST(makeSignedRequest(validBody))) as {
      body: { status: string }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('queued')
    expect(mockPublishFeedback).toHaveBeenCalledTimes(1)

    const payload = mockPublishFeedback.mock.calls[0][0]
    expect(payload).toMatchObject({
      contact_id: 'c-1',
      type: 'bug',
      text: 'the app crashed on submit',
      actor: 'intake',
    })
    // optional fields normalised to null (not dropped by JSON.stringify)
    for (const key of [
      'idempotency_key',
      'contact_id',
      'customer_id',
      'type',
      'severity',
      'text',
      'product_area',
      'actor',
    ]) {
      expect(payload).toHaveProperty(key)
    }
    expect(payload.customer_id).toBeNull()
    expect(payload.severity).toBeNull()
  })

  test('returns 503 when both gRPC and the chatLedger fallback fail', async () => {
    mockSubmitFeedback.mockRejectedValue(new Error('UNAVAILABLE'))
    mockPublishFeedback.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = (await POST(makeSignedRequest(validBody))) as {
      body: { error: { code: string } }
      status: number
    }
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('INTAKE_UNAVAILABLE')
  })

  test('respects a caller-supplied idempotency_key', async () => {
    mockSubmitFeedback.mockResolvedValue({
      feedbackId: 'fb-2',
      eventId: 'ev-2',
      idempotentReplay: true,
    })
    await POST(makeSignedRequest({ ...validBody, idempotency_key: 'client-key' }))
    expect(mockSubmitFeedback.mock.calls[0][0].idempotencyKey).toBe('client-key')
  })
})
