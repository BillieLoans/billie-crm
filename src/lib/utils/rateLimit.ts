/**
 * Simple in-memory rate limiter for API routes.
 * Limits requests per user per time window.
 *
 * NFR9: Assessment detail routes rate-limited at 30 req/min/user.
 */

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()

export interface RateLimitOptions {
  /** Max requests per window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
}

/**
 * Check and record a rate-limited request.
 * Returns true if the request should be allowed, false if rate limited.
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): boolean {
  const now = Date.now()
  const existing = store.get(key)

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs })
    return true
  }

  if (existing.count >= opts.limit) {
    return false
  }

  existing.count++
  return true
}

/** Default assessment route rate limit: 30 req/min */
export const ASSESSMENT_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 60_000,
}
