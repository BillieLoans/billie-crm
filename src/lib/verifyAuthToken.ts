import { jwtVerify } from 'jose'

/**
 * Verify a `payload-token` JWT's signature AND expiry using the shared secret.
 *
 * Returns `true` only when the token is well-formed, correctly signed with the
 * key Payload derives from `secret` (HS256, as issued by Payload's own login
 * and the Google OAuth callback) and not expired. `secret` is the configured
 * PAYLOAD_SECRET; see payloadSigningKey.
 *
 * Why this exists: `src/proxy.ts` decides /admin ↔ /admin/login ↔
 * /admin/dashboard routing. It previously used an UNSIGNED `exp`-only check,
 * while the views and API routes use `payload.auth()` (full signature
 * verification + DB lookup). A token that was structurally-valid-and-unexpired
 * but not verifiable (stale/rotated secret, tampering) made the two layers
 * disagree — the proxy bounced the user to the dashboard while every view
 * 403'd. Verifying the signature here makes the proxy's notion of "valid token"
 * match `payload.auth()`'s, so the two no longer fight each other.
 *
 * Fails closed: a missing token or missing secret returns `false`. Edge-safe —
 * depends only on `jose` (Web Crypto), so it runs in the proxy/middleware
 * runtime. `jwtVerify` validates the `exp`/`nbf` claims as part of verification,
 * so no separate expiry check is needed.
 */
/**
 * The HS256 key Payload signs `payload-token` with. Payload never uses the
 * configured secret directly: `payload.secret` is the first 32 hex characters
 * of its SHA-256 (payload/dist/index.js). Verifying against the raw secret
 * rejects every real session. Web Crypto, so it runs in the proxy runtime.
 */
export async function payloadSigningKey(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return new TextEncoder().encode(hex.slice(0, 32))
}

export async function verifyAuthToken(
  token: string | undefined | null,
  secret: string | undefined | null,
): Promise<boolean> {
  if (!token || !secret) return false
  try {
    await jwtVerify(token, await payloadSigningKey(secret))
    return true
  } catch {
    // Bad signature, expired (JWTExpired), malformed — all mean "not valid".
    return false
  }
}
