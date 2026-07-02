import { jwtVerify } from 'jose'

/**
 * Verify a `payload-token` JWT's signature AND expiry using the shared secret.
 *
 * Returns `true` only when the token is well-formed, correctly signed with
 * `secret` (HS256, as issued by the Google OAuth callback) and not expired.
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
export async function verifyAuthToken(
  token: string | undefined | null,
  secret: string | undefined | null,
): Promise<boolean> {
  if (!token || !secret) return false
  try {
    await jwtVerify(token, new TextEncoder().encode(secret))
    return true
  } catch {
    // Bad signature, expired (JWTExpired), malformed — all mean "not valid".
    return false
  }
}
