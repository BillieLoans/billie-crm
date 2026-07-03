/**
 * Auth guard for the public waitlist intake route.
 *
 * The marketing site is unauthenticated (no Payload session), so it can't
 * use `requireAuth`. Instead it carries a shared API key plus an
 * HMAC-SHA256 signature of the raw request body, both checked here in
 * constant time to avoid leaking key material via timing side channels.
 *
 * Required env vars: INTAKE_API_KEY, INTAKE_HMAC_SECRET.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * Constant-time string comparison. Returns false (without throwing) when
 * lengths differ, rather than passing mismatched buffers to
 * `timingSafeEqual`, which throws a RangeError in that case.
 */
function safeEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided)
  const expectedBuf = Buffer.from(expected)
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)
}

export function verifyIntakeAuth(request: NextRequest | Request, rawBody: string): boolean {
  const apiKey = process.env.INTAKE_API_KEY
  const hmacSecret = process.env.INTAKE_HMAC_SECRET
  if (!apiKey || !hmacSecret) return false

  const providedKey = request.headers.get('x-api-key') ?? ''
  const providedSig = request.headers.get('x-signature') ?? ''
  const expectedSig = createHmac('sha256', hmacSecret).update(rawBody).digest('hex')

  const keyOk = safeEqual(providedKey, apiKey)
  const sigOk = safeEqual(providedSig, expectedSig)
  return keyOk && sigOk
}
