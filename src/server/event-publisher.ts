/**
 * Event Publisher
 *
 * Publishes CRM-originated events to the Redis stream.
 * Includes retry logic with exponential backoff.
 */

import { nanoid } from 'nanoid'
import { getRedisClient } from './redis-client'
import {
  REDIS_PUBLISH_STREAM,
  CRM_AGENT_ID,
  PUBLISH_MAX_RETRIES,
  PUBLISH_BACKOFF_MS,
} from '@/lib/events/config'
import type { CRMEvent, PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

/**
 * Options for creating an event.
 */
export interface CreateEventOptions<T> {
  /** Event type (e.g., "writeoff.requested.v1") */
  typ: string
  /** User ID who triggered the action */
  userId: string
  /** Event payload */
  payload: T
  /** Request ID for workflow correlation. If not provided, a new one is generated. */
  requestId?: string
}

/**
 * Error thrown when event publishing fails after all retries.
 */
export class EventPublishError extends Error {
  public readonly attempts: number
  public readonly cause: Error | undefined

  constructor(message: string, options: { attempts: number; cause?: Error }) {
    super(message)
    this.name = 'EventPublishError'
    this.attempts = options.attempts
    this.cause = options.cause
  }
}

// =============================================================================
// Event Creation
// =============================================================================

/**
 * Create a CRM event with the proper envelope structure.
 *
 * @param options - Event creation options
 * @returns The constructed CRM event
 */
export function createEvent<T>(options: CreateEventOptions<T>): CRMEvent<T> {
  const requestId = options.requestId ?? nanoid()
  const eventId = nanoid()

  return {
    conv: requestId,
    agt: CRM_AGENT_ID,
    usr: options.userId,
    seq: 1,
    cls: 'msg',
    typ: options.typ,
    cause: eventId,
    payload: options.payload,
  }
}

// =============================================================================
// Publishing
// =============================================================================

/**
 * Convert a CRM event to Redis stream fields.
 * All values must be strings for Redis.
 *
 * @param event - The CRM event to convert
 * @returns Record of string key-value pairs
 */
function eventToStreamFields(event: CRMEvent<unknown>): Record<string, string> {
  return {
    conv: event.conv,
    agt: event.agt,
    usr: event.usr,
    seq: String(event.seq),
    cls: event.cls,
    typ: event.typ,
    cause: event.cause,
    payload: JSON.stringify(event.payload),
  }
}

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Publish a CRM event to the Redis stream.
 *
 * Retries with exponential backoff on failure:
 * - Attempt 1: Immediate
 * - Attempt 2: After 100ms
 * - Attempt 3: After 200ms
 * - Failure: After 400ms total
 *
 * @param event - The CRM event to publish
 * @returns The publish response with eventId and requestId
 * @throws EventPublishError if all retries fail
 */
export async function publishEvent<T>(event: CRMEvent<T>): Promise<PublishEventResponse> {
  const redis = getRedisClient()
  const fields = eventToStreamFields(event)

  let lastError: Error | undefined

  for (let attempt = 0; attempt < PUBLISH_MAX_RETRIES; attempt++) {
    try {
      // The client is lazyConnect + enableOfflineQueue:false, so a command
      // issued before the connection is ready is rejected immediately. On a
      // TLS Redis (rediss://) the handshake can outlast the whole retry
      // budget, so await the connection explicitly on first use.
      if (redis.status === 'wait') {
        await redis.connect()
      }
      // XADD stream * field1 value1 field2 value2 ...
      // The '*' tells Redis to auto-generate the message ID
      const fieldArray = Object.entries(fields).flat()
      await redis.xadd(REDIS_PUBLISH_STREAM, '*', ...fieldArray)

      return {
        eventId: event.cause,
        requestId: event.conv,
        status: 'accepted',
        message: `Event ${event.typ} accepted for processing`,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Log the retry attempt
      console.warn(
        `[EventPublisher] Attempt ${attempt + 1}/${PUBLISH_MAX_RETRIES} failed:`,
        lastError.message,
      )

      // Don't sleep after the last attempt
      if (attempt < PUBLISH_MAX_RETRIES - 1) {
        const backoffMs = PUBLISH_BACKOFF_MS[attempt] ?? 400
        await sleep(backoffMs)
      }
    }
  }

  // All retries exhausted
  throw new EventPublishError('Failed to publish event after retries', {
    attempts: PUBLISH_MAX_RETRIES,
    cause: lastError,
  })
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Create and publish a CRM event in one step.
 *
 * @param options - Event creation options
 * @returns The publish response
 * @throws EventPublishError if publishing fails
 */
export async function createAndPublishEvent<T>(
  options: CreateEventOptions<T>,
): Promise<PublishEventResponse> {
  const event = createEvent(options)
  return publishEvent(event)
}
