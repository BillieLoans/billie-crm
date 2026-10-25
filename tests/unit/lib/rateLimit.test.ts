/**
 * Unit tests for the rate limiter: windows, eviction of expired windows, the
 * size cap, and the Redis path with its fallback.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

const redis = {
  incr: vi.fn(),
  pttl: vi.fn(),
  pexpire: vi.fn(),
}
vi.mock('@/server/redis-client', () => ({ getRedisClient: () => redis }))

import {
  MEMORY_STORE_CAP,
  checkRateLimit,
  memoryStoreSize,
  rateLimit,
  resetRateLimits,
} from '@/lib/utils/rateLimit'

const previousRedisUrl = process.env.REDIS_URL

beforeEach(() => {
  resetRateLimits()
  vi.useFakeTimers()
  redis.incr.mockReset()
  redis.pttl.mockReset()
  redis.pexpire.mockReset()
  delete process.env.REDIS_URL
})

afterEach(() => {
  vi.useRealTimers()
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = previousRedisUrl
})

describe('checkRateLimit (in memory)', () => {
  test('allows up to the limit in a window, then refuses until it resets', () => {
    const opts = { limit: 3, windowMs: 1000 }
    expect([1, 2, 3].map(() => checkRateLimit('k', opts))).toEqual([true, true, true])
    expect(checkRateLimit('k', opts)).toBe(false)
    vi.advanceTimersByTime(1001)
    expect(checkRateLimit('k', opts)).toBe(true)
  })

  test('evicts expired windows, so distinct keys cannot grow the store without bound', () => {
    const opts = { limit: 1, windowMs: 10 }
    for (let i = 0; i < 1500; i++) checkRateLimit(`ip-${i}`, opts)
    expect(memoryStoreSize()).toBeGreaterThan(1000)
    vi.advanceTimersByTime(20)
    // The sweep runs every 1,000 calls.
    for (let i = 0; i < 1000; i++) checkRateLimit(`later-${i}`, opts)
    expect(memoryStoreSize()).toBeLessThanOrEqual(1000)
  })

  test('never holds more than the cap, even with live windows', () => {
    const opts = { limit: 1, windowMs: 60_000 }
    for (let i = 0; i < MEMORY_STORE_CAP + 500; i++) checkRateLimit(`live-${i}`, opts)
    expect(memoryStoreSize()).toBeLessThanOrEqual(MEMORY_STORE_CAP)
  })
})

describe('rateLimit (shared)', () => {
  test('counts in memory when Redis is not configured', async () => {
    const opts = { limit: 1, windowMs: 1000 }
    expect(await rateLimit('m', opts)).toBe(true)
    expect(await rateLimit('m', opts)).toBe(false)
    expect(redis.incr).not.toHaveBeenCalled()
  })

  test('counts in Redis when it is, setting the window expiry once', async () => {
    process.env.REDIS_URL = 'redis://test'
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3)
    redis.pttl.mockResolvedValue(500)
    const opts = { limit: 2, windowMs: 1000 }
    expect(await rateLimit('r', opts)).toBe(true)
    expect(await rateLimit('r', opts)).toBe(true)
    expect(await rateLimit('r', opts)).toBe(false)
    expect(redis.pexpire).toHaveBeenCalledTimes(1)
    expect(redis.pexpire).toHaveBeenCalledWith('crm:ratelimit:r', 1000)
  })

  test('restores a lost expiry', async () => {
    process.env.REDIS_URL = 'redis://test'
    redis.incr.mockResolvedValue(5)
    redis.pttl.mockResolvedValue(-1)
    await rateLimit('lost', { limit: 10, windowMs: 1000 })
    expect(redis.pexpire).toHaveBeenCalledWith('crm:ratelimit:lost', 1000)
  })

  test('falls back to memory when Redis fails, never blocking the request', async () => {
    process.env.REDIS_URL = 'redis://test'
    redis.incr.mockRejectedValue(new Error('down'))
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const opts = { limit: 1, windowMs: 1000 }
    expect(await rateLimit('f', opts)).toBe(true)
    expect(await rateLimit('f', opts)).toBe(false)
    warn.mockRestore()
  })
})
