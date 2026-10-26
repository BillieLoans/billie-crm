// @vitest-environment node
// jose's HS256 sign/verify relies on `instanceof Uint8Array`, which breaks under
// the default jsdom environment (cross-realm Uint8Array). This logic is pure
// server/edge crypto with no DOM, so run it in the node environment.
import { describe, test, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { SignJWT } from 'jose'
import { payloadSigningKey, verifyAuthToken } from '@/lib/verifyAuthToken'

/**
 * Tests for src/lib/verifyAuthToken.ts — the signature-verifying token validator
 * used by src/proxy.ts.
 *
 * The bug this fixes: proxy.ts previously routed /admin ↔ /admin/login ↔
 * /admin/dashboard using an UNSIGNED `exp`-only check (isJwtNotExpired), while
 * the views/API use payload.auth() (full signature verification). When a token
 * was structurally-valid-and-unexpired but NOT verifiable (e.g. signed with a
 * stale/rotated secret), the two layers disagreed: the proxy bounced the user to
 * the dashboard while every view 403'd — the "data flashes, then 403, then back
 * to dashboard" symptom. verifyAuthToken makes the proxy agree with payload.auth.
 */

const SECRET = 'test-secret-value-1234567890-abcdef'

/** Payload's `payload.secret`: the first 32 hex chars of SHA-256(config.secret). */
const payloadSecret = (secret: string) =>
  createHash('sha256').update(secret).digest('hex').slice(0, 32)

/**
 * Sign a payload-token JWT exactly like src/app/(payload)/api/auth/google/callback
 * and Payload's own login: with `payload.secret`, not the configured secret.
 */
async function signToken(
  opts: { secret?: string; expiresInSeconds?: number } = {},
): Promise<string> {
  const secret = opts.secret ?? SECRET
  const ttl = opts.expiresInSeconds ?? 3600
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ id: 'user-1', collection: 'users', email: 'test@billie.loans' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(new TextEncoder().encode(payloadSecret(secret)))
}

describe('verifyAuthToken', () => {
  test('accepts a correctly-signed, unexpired token', async () => {
    const token = await signToken()
    expect(await verifyAuthToken(token, SECRET)).toBe(true)
  })

  test('derives the same key as payload.secret', async () => {
    expect(new TextDecoder().decode(await payloadSigningKey(SECRET))).toBe(payloadSecret(SECRET))
  })

  test('rejects a token signed with the raw configured secret', async () => {
    // Nothing issues these; accepting them would mean the proxy checks a
    // different key from payload.auth(), which rejected every real session.
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({ id: 'user-1', collection: 'users' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setExpirationTime(now + 3600)
      .sign(new TextEncoder().encode(SECRET))
    expect(await verifyAuthToken(token, SECRET)).toBe(false)
  })

  test('rejects a token signed with a different secret (stale/rotated/tampered)', async () => {
    // THE BUG: the old unsigned check returned true here (exp is fine), so the
    // proxy treated it as logged-in and bounced to the dashboard while
    // payload.auth() rejected it. verifyAuthToken must reject it.
    const token = await signToken({ secret: 'a-completely-different-secret-value' })
    expect(await verifyAuthToken(token, SECRET)).toBe(false)
  })

  test('rejects an expired token even when correctly signed', async () => {
    const token = await signToken({ expiresInSeconds: -3600 })
    expect(await verifyAuthToken(token, SECRET)).toBe(false)
  })

  test('fails closed when no secret is available', async () => {
    const token = await signToken()
    expect(await verifyAuthToken(token, undefined)).toBe(false)
    expect(await verifyAuthToken(token, '')).toBe(false)
  })

  test('rejects an undefined or empty token', async () => {
    expect(await verifyAuthToken(undefined, SECRET)).toBe(false)
    expect(await verifyAuthToken('', SECRET)).toBe(false)
  })

  test('rejects a structurally-invalid / garbage token', async () => {
    expect(await verifyAuthToken('not-a-jwt', SECRET)).toBe(false)
    expect(await verifyAuthToken('header.payload', SECRET)).toBe(false)
    expect(await verifyAuthToken('a.b.c', SECRET)).toBe(false)
  })
})
