/**
 * Rate limiting for API routes.
 *
 * `rateLimit` is the one to use: it counts in Redis when `REDIS_URL` is set,
 * so the limit holds across every server process (prod runs more than one
 * machine), and falls back to this process's memory when Redis is not
 * configured or not reachable. `checkRateLimit` is the in-memory counter on
 * its own, kept for the synchronous callers that predate Redis here.
 *
 * The in-memory store evicts expired windows as it goes and is capped, so a
 * flood of distinct keys (one per source address, say) cannot grow it
 * without bound.
 *
 * NFR9: Assessment detail routes rate-limited at 30 req/min/user.
 */

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()

/** Expired windows are swept this often (calls), and whenever the store is this big. */
const SWEEP_EVERY = 1_000
export const MEMORY_STORE_CAP = 50_000
let calls = 0

export interface RateLimitOptions {
  /** Max requests per window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
}

function sweep(now: number): void {
  for (const [key, window] of store) {
    if (window.resetAt <= now) store.delete(key)
  }
  // Still at the cap after dropping the expired: drop the oldest windows so
  // the one about to be added fits.
  if (store.size >= MEMORY_STORE_CAP) {
    const excess = store.size - MEMORY_STORE_CAP + 1
    let dropped = 0
    for (const key of store.keys()) {
      if (dropped++ >= excess) break
      store.delete(key)
    }
  }
}

/**
 * Check and record a rate-limited request in this process's memory.
 * Returns true if the request should be allowed, false if rate limited.
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): boolean {
  const now = Date.now()
  if (++calls % SWEEP_EVERY === 0 || store.size >= MEMORY_STORE_CAP) sweep(now)
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

/** Tests only: how many windows the in-memory store holds. */
export function memoryStoreSize(): number {
  return store.size
}

/** Tests only: forget every window. */
export function resetRateLimits(): void {
  store.clear()
  calls = 0
}

const REDIS_PREFIX = 'crm:ratelimit:'

/**
 * Check and record a rate-limited request, shared across processes through
 * Redis when it is configured. A Redis failure never blocks a request: the
 * count falls back to this process.
 */
export async function rateLimit(key: string, opts: RateLimitOptions): Promise<boolean> {
  if (process.env.REDIS_URL) {
    try {
      const { getRedisClient } = await import('@/server/redis-client')
      const redis = getRedisClient()
      const redisKey = `${REDIS_PREFIX}${key}`
      const count = await redis.incr(redisKey)
      // A new window gets its expiry; one that lost it (a crash between the
      // two commands) gets it back rather than counting forever.
      if (count === 1 || (await redis.pttl(redisKey)) < 0) {
        await redis.pexpire(redisKey, opts.windowMs)
      }
      return count <= opts.limit
    } catch (error) {
      console.error('[rateLimit] Redis unavailable, counting in memory:', (error as Error).message)
    }
  }
  return checkRateLimit(key, opts)
}

/** Default assessment route rate limit: 30 req/min */
export const ASSESSMENT_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 60_000,
}
