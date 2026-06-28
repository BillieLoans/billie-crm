/**
 * Redis Client Singleton
 *
 * Provides a shared Redis connection for event publishing.
 * Uses ioredis for robust connection handling.
 */

import Redis from 'ioredis'

// =============================================================================
// Configuration
// =============================================================================

/**
 * Redis connection URL.
 * Default: redis://localhost:6383 (local development)
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6383'

// =============================================================================
// Singleton Instance
// =============================================================================

let redisClient: Redis | null = null

/**
 * Get the Redis client singleton.
 * Creates a new connection if one doesn't exist.
 *
 * @returns Redis client instance
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    // Warn once at connection time if Redis is not using TLS in production
    if (process.env.NODE_ENV === 'production' && !REDIS_URL.startsWith('rediss://')) {
      console.warn('[Redis] WARNING: Redis URL does not use TLS (rediss://) in production')
    }

    redisClient = new Redis(REDIS_URL, {
      // Reconnection settings
      retryStrategy: (times) => {
        // Exponential backoff with max 30 seconds
        const delay = Math.min(times * 100, 30000)
        return delay
      },
      maxRetriesPerRequest: 3,
      // Connection settings
      connectTimeout: 10000,
      // TCP keepalive — detect dead connections proactively (every 10s)
      keepAlive: 10000,
      // Don't buffer commands when disconnected
      enableOfflineQueue: false,
      // Lazy connect - don't connect until first command
      lazyConnect: true,
    })

    redisClient.on('error', (error) => {
      console.error('[Redis] Connection error:', error.message)
    })

    redisClient.on('connect', () => {
      const redactedUrl = REDIS_URL.replace(/:\/\/[^@]*@/, '://***@')
      console.log('[Redis] Connected to', redactedUrl)
    })

    redisClient.on('close', () => {
      console.log('[Redis] Connection closed')
    })
  }

  return redisClient
}

// =============================================================================
// ChatLedger Redis Singleton
// =============================================================================

let chatLedgerClient: Redis | null = null

/**
 * Get the chatLedger Redis client singleton.
 *
 * In production both Redis clients resolve to the same instance (shared Redis).
 * In development with a split-Redis setup (e.g. billieChat on port 6382 vs
 * billie-crm on port 6383) set CHATLEDGER_REDIS_URL to point at the chatLedger
 * instance. Falls back to REDIS_URL when the override is not set.
 *
 * @returns Redis client instance for the shared chatLedger stream
 */
export function getChatLedgerRedisClient(): Redis {
  if (!chatLedgerClient) {
    const url = process.env.CHATLEDGER_REDIS_URL ?? REDIS_URL
    chatLedgerClient = new Redis(url, {
      retryStrategy: (times) => Math.min(times * 100, 30000),
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      keepAlive: 10000,
      enableOfflineQueue: false,
      lazyConnect: true,
    })
    chatLedgerClient.on('error', (e) => console.error('[ChatLedger Redis] error:', e.message))
  }
  return chatLedgerClient
}

/**
 * Close the Redis connection.
 * Call this during graceful shutdown.
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
  }
}

/**
 * Check if Redis is connected and responsive.
 *
 * @returns true if Redis is healthy
 */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const client = getRedisClient()
    const result = await client.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}
