/**
 * Unit tests for Task C4: public waitlist intake.
 *
 * Covers:
 *   - WaitlistIntakeSchema (zod contract for the public payload)
 *   - POST /api/intake/waitlist — gRPC-primary write with a durable Redis
 *     fallback so a signup is never lost when the platform marketingService
 *     is unavailable.
 *
 * Mocks:
 *   - next/server                         → NextResponse.json returns { body, status }
 *   - @/server/marketing-grpc-client      → upsertContact is mocked (no real gRPC call)
 *   - @/server/redis-client               → getRedisClient returns a fake ioredis-shaped
 *                                            stub (status/connect/xadd)
 *   - @/lib/intake-auth and @/lib/schemas/intake are the REAL implementations — auth and
 *     validation are exercised end-to-end, not stubbed away.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'crypto'
import type { NextRequest } from 'next/server'
import { WaitlistIntakeSchema } from '@/lib/schemas/intake'

// ---------------------------------------------------------------------------
// next/server mock — must be declared before importing the route
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
// marketing gRPC client mock
// ---------------------------------------------------------------------------
const mockUpsertContact = vi.hoisted(() => vi.fn())
vi.mock('@/server/marketing-grpc-client', () => ({
  upsertContact: mockUpsertContact,
}))

// ---------------------------------------------------------------------------
// Redis client mock — ioredis-shaped stub
// ---------------------------------------------------------------------------
const mockXadd = vi.hoisted(() => vi.fn(async () => '1-1'))
const mockConnect = vi.hoisted(() => vi.fn(async () => undefined))
const mockRedis = vi.hoisted(() => ({
  status: 'ready',
  connect: mockConnect,
  xadd: mockXadd,
}))
const mockGetRedisClient = vi.hoisted(() => vi.fn(() => mockRedis))
vi.mock('@/server/redis-client', () => ({
  getRedisClient: mockGetRedisClient,
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/intake/waitlist/route'

const API_KEY = 'test-key'
const HMAC_SECRET = 'test-secret'

function makeSignedRequest(
  bodyObj: unknown,
  opts?: { apiKey?: string; signature?: string; skipAuthHeaders?: boolean },
): NextRequest {
  const raw = JSON.stringify(bodyObj)
  const headers: Record<string, string> = {}
  if (!opts?.skipAuthHeaders) {
    headers['x-api-key'] = opts?.apiKey ?? API_KEY
    headers['x-signature'] =
      opts?.signature ?? createHmac('sha256', HMAC_SECRET).update(raw).digest('hex')
  }
  return new Request('http://x/api/intake/waitlist', {
    method: 'POST',
    headers,
    body: raw,
  }) as unknown as NextRequest
}

/** Turn the flat [k, v, k, v, ...] xadd field list back into an object. */
function xaddFieldsToObject(fields: unknown[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < fields.length; i += 2) {
    out[fields[i] as string] = fields[i + 1] as string
  }
  return out
}

// =============================================================================
// WaitlistIntakeSchema
// =============================================================================

describe('WaitlistIntakeSchema', () => {
  test('minimal valid payload', () => {
    const r = WaitlistIntakeSchema.safeParse({
      mobile: '0400 000 001',
      consent: { granted: true, method: 'waitlist_form' },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.source).toBe('other')
  })

  test('requires mobile or email', () => {
    expect(
      WaitlistIntakeSchema.safeParse({ consent: { granted: true, method: 'x' } }).success,
    ).toBe(false)
    expect(
      WaitlistIntakeSchema.safeParse({
        email: 'a@b.co',
        consent: { granted: true, method: 'x' },
      }).success,
    ).toBe(true)
  })

  test('rejects unknown source', () => {
    expect(
      WaitlistIntakeSchema.safeParse({
        mobile: '0400000001',
        source: 'tv',
        consent: { granted: true, method: 'x' },
      }).success,
    ).toBe(false)
  })

  test('defaults consent channels to sms', () => {
    const r = WaitlistIntakeSchema.safeParse({
      mobile: '0400000001',
      consent: { granted: true, method: 'x' },
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.consent.channels).toEqual(['sms'])
  })

  test('rejects malformed email', () => {
    expect(
      WaitlistIntakeSchema.safeParse({
        email: 'not-an-email',
        consent: { granted: true, method: 'x' },
      }).success,
    ).toBe(false)
  })
})

// =============================================================================
// POST /api/intake/waitlist
// =============================================================================

describe('POST /api/intake/waitlist', () => {
  beforeEach(() => {
    process.env.INTAKE_API_KEY = API_KEY
    process.env.INTAKE_HMAC_SECRET = HMAC_SECRET
    mockUpsertContact.mockReset()
    mockXadd.mockReset().mockResolvedValue('1-1')
    mockConnect.mockReset().mockResolvedValue(undefined)
    mockGetRedisClient.mockClear()
    mockRedis.status = 'ready'
  })

  const validBody = {
    mobile: '0400000001',
    first_name: 'Ash',
    source: 'meta',
    consent: { granted: true, method: 'waitlist_form' },
  }

  test('401s when the signature is invalid', async () => {
    const req = makeSignedRequest(validBody, { signature: 'deadbeef' })
    const res = (await POST(req)) as { body: unknown; status: number }
    expect(res.status).toBe(401)
    expect(mockUpsertContact).not.toHaveBeenCalled()
  })

  test('401s when auth headers are missing entirely', async () => {
    const req = makeSignedRequest(validBody, { skipAuthHeaders: true })
    const res = (await POST(req)) as { body: unknown; status: number }
    expect(res.status).toBe(401)
  })

  test('400s on a schema-invalid payload (no mobile or email)', async () => {
    const req = makeSignedRequest({ consent: { granted: true, method: 'x' } })
    const res = (await POST(req)) as { body: { error: { code: string } }; status: number }
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(mockUpsertContact).not.toHaveBeenCalled()
  })

  test('accepts via gRPC and returns 200 with contactId, never touching Redis', async () => {
    mockUpsertContact.mockResolvedValue({
      contactId: 'contact-1',
      eventId: 'event-1',
      created: true,
      idempotentReplay: false,
    })
    const req = makeSignedRequest(validBody)
    const res = (await POST(req)) as {
      body: { status: string; contactId?: string }
      status: number
    }
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('accepted')
    expect(res.body.contactId).toBe('contact-1')
    expect(mockXadd).not.toHaveBeenCalled()

    // idempotency_key defaults to a stable value derived from mobile/email
    const call = mockUpsertContact.mock.calls[0][0]
    expect(call.idempotencyKey).toBe('intake:0400000001')
    expect(call.firstName).toBe('Ash')
    expect(call.waitlist).toBe(true)
  })

  test('falls back to Redis and returns 200 queued when gRPC fails', async () => {
    mockUpsertContact.mockRejectedValue(new Error('UNAVAILABLE'))
    const req = makeSignedRequest(validBody)
    const res = (await POST(req)) as { body: { status: string }; status: number }
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('queued')
    expect(mockXadd).toHaveBeenCalledTimes(1)

    const [stream, id, ...fields] = mockXadd.mock.calls[0]
    expect(stream).toBe('inbox:marketing')
    expect(id).toBe('*')
    const envelope = xaddFieldsToObject(fields)
    expect(envelope.cls).toBe('cmd')
    expect(envelope.typ).toBe('contact.intake.requested.v1')
    expect(envelope.agt).toBe('billie-crm')

    const payload = JSON.parse(envelope.payload)
    expect(payload).toMatchObject({
      first_name: 'Ash',
      mobile: '0400000001',
      source: 'meta',
      waitlist: true,
      actor: 'intake',
      idempotency_key: 'intake:0400000001',
    })
    expect(payload.consent).toEqual({ granted: true, method: 'waitlist_form', channels: ['sms'] })
    // required keys per the platform's build_contact_observed contract
    for (const key of [
      'first_name',
      'email',
      'mobile',
      'city',
      'postcode',
      'source',
      'utm',
      'platforms',
      'channel_preference',
      'referred_by_code',
      'waitlist',
      'consent',
      'actor',
      'idempotency_key',
    ]) {
      expect(payload).toHaveProperty(key)
    }
  })

  test('connects a lazy Redis client before xadd when status is "wait"', async () => {
    mockUpsertContact.mockRejectedValue(new Error('UNAVAILABLE'))
    mockRedis.status = 'wait'
    const req = makeSignedRequest(validBody)
    await POST(req)
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  test('returns 503 when both gRPC and Redis fail — signup genuinely at risk', async () => {
    mockUpsertContact.mockRejectedValue(new Error('UNAVAILABLE'))
    mockXadd.mockRejectedValue(new Error('ECONNREFUSED'))
    const req = makeSignedRequest(validBody)
    const res = (await POST(req)) as { body: { error: { code: string } }; status: number }
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('INTAKE_UNAVAILABLE')
  })

  test('respects a caller-supplied idempotency_key', async () => {
    mockUpsertContact.mockResolvedValue({
      contactId: 'contact-2',
      eventId: 'event-2',
      created: false,
      idempotentReplay: true,
    })
    const req = makeSignedRequest({ ...validBody, idempotency_key: 'client-supplied-key' })
    await POST(req)
    expect(mockUpsertContact.mock.calls[0][0].idempotencyKey).toBe('client-supplied-key')
  })
})
