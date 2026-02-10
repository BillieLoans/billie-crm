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
      console.log('[Redis] Connected to', REDIS_URL)
    })

    redisClient.on('close', () => {
      console.log('[Redis] Connection closed')
    })
  }

  return redisClient
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
