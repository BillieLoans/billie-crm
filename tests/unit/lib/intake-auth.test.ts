/**
 * Unit tests for the public waitlist intake auth guard (C4).
 *
 * verifyIntakeAuth checks two independent factors carried on every inbound
 * request from the public marketing site:
 *   - x-api-key   — a shared secret identifying the caller
 *   - x-signature — HMAC-SHA256(rawBody, INTAKE_HMAC_SECRET), hex-encoded
 *
 * Both comparisons must be constant-time (timingSafeEqual) to avoid leaking
 * key material via response-time side channels, and must not throw when the
 * provided value has a different length than the expected value.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { createHmac } from 'crypto'

describe('verifyIntakeAuth', () => {
  beforeEach(() => {
    process.env.INTAKE_API_KEY = 'test-key'
    process.env.INTAKE_HMAC_SECRET = 'test-secret'
  })

  test('accepts valid key + signature', async () => {
    const { verifyIntakeAuth } = await import('@/lib/intake-auth')
    const body = '{"mobile":"0400000001"}'
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex')
    const req = new Request('http://x/api/intake/waitlist', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'x-signature': sig },
    })
    expect(verifyIntakeAuth(req as never, body)).toBe(true)
  })

  test('rejects wrong key and wrong signature', async () => {
    const { verifyIntakeAuth } = await import('@/lib/intake-auth')
    const body = '{}'
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex')
    const bad1 = new Request('http://x', {
      method: 'POST',
      headers: { 'x-api-key': 'nope', 'x-signature': sig },
    })
    const bad2 = new Request('http://x', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'x-signature': 'deadbeef' },
    })
    expect(verifyIntakeAuth(bad1 as never, body)).toBe(false)
    expect(verifyIntakeAuth(bad2 as never, body)).toBe(false)
  })

  test('rejects a signature computed over a different body (tamper detection)', async () => {
    const { verifyIntakeAuth } = await import('@/lib/intake-auth')
    const signedBody = '{"mobile":"0400000001"}'
    const sig = createHmac('sha256', 'test-secret').update(signedBody).digest('hex')
    const tamperedBody = '{"mobile":"0400000002"}'
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'x-signature': sig },
    })
    expect(verifyIntakeAuth(req as never, tamperedBody)).toBe(false)
  })

  test('rejects when headers are missing entirely', async () => {
    const { verifyIntakeAuth } = await import('@/lib/intake-auth')
    const req = new Request('http://x', { method: 'POST' })
    expect(verifyIntakeAuth(req as never, '{}')).toBe(false)
  })

  test('rejects when server-side secrets are not configured', async () => {
    delete process.env.INTAKE_API_KEY
    delete process.env.INTAKE_HMAC_SECRET
    const { verifyIntakeAuth } = await import('@/lib/intake-auth')
    const body = '{}'
    const sig = createHmac('sha256', 'test-secret').update(body).digest('hex')
    const req = new Request('http://x', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key', 'x-signature': sig },
    })
    expect(verifyIntakeAuth(req as never, body)).toBe(false)
  })
})
