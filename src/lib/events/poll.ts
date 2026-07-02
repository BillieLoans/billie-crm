/**
 * Polling Utility for Event-Sourced Projections
 *
 * After publishing a command event, the client needs to poll for the
 * resulting projection to appear in MongoDB.
 */

import { stringify } from 'qs-esm'

// =============================================================================
// Types
// =============================================================================

export interface PollOptions {
  /** Maximum number of poll attempts (default: 10) */
  maxAttempts?: number
  /** Interval between polls in milliseconds (default: 500) */
  intervalMs?: number
  /** Initial delay before first poll in milliseconds (default: 100) */
  initialDelayMs?: number
}

export interface PollResult<T> {
  /** Whether the projection was found */
  found: boolean
  /** The projection data if found */
  data?: T
  /** Number of attempts made */
  attempts: number
}

/**
 * Error thrown when polling times out.
 */
export class PollTimeoutError extends Error {
  public readonly attempts: number
  public readonly eventId: string

  constructor(eventId: string, attempts: number) {
    super(`Projection not found after ${attempts} attempts for event ${eventId}`)
    this.name = 'PollTimeoutError'
    this.attempts = attempts
    this.eventId = eventId
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// Polling Functions
// =============================================================================

/**
 * Poll for a write-off request projection by eventId.
 *
 * @param eventId - The event ID (cause field) to look for
 * @param options - Polling configuration
 * @returns The write-off request document once found
 * @throws PollTimeoutError if not found within max attempts
 */
export async function pollForWriteOffRequest<T = unknown>(
  eventId: string,
  options?: PollOptions,
): Promise<T> {
  const { maxAttempts = 10, intervalMs = 500, initialDelayMs = 100 } = options ?? {}

  // Initial delay to give the event processor time to start
  await sleep(initialDelayMs)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const query = stringify({
        where: {
          eventId: { equals: eventId },
        },
        limit: 1,
      })

      const res = await fetch(`/api/write-off-requests?${query}`)

      if (res.ok) {
        const data = await res.json()
        if (data.docs && data.docs.length > 0) {
          return data.docs[0] as T
        }
      }
    } catch {
      // Ignore fetch errors and continue polling
    }

    // Don't sleep after the last attempt
    if (attempt < maxAttempts) {
      await sleep(intervalMs)
    }
  }

  throw new PollTimeoutError(eventId, maxAttempts)
}

/**
 * Poll for a write-off request update by requestId and expected status.
 *
 * Used for approve/reject/cancel operations where we're updating
 * an existing request and waiting for the status change.
 *
 * @param requestId - The request ID (conv field) to look for
 * @param expectedStatus - The status we're waiting for
 * @param options - Polling configuration
 * @returns The updated write-off request document
 * @throws PollTimeoutError if not found within max attempts
 */
export async function pollForWriteOffUpdate<T = unknown>(
  requestId: string,
  expectedStatus: 'approved' | 'rejected' | 'cancelled',
  options?: PollOptions,
): Promise<T> {
  const { maxAttempts = 10, intervalMs = 500, initialDelayMs = 100 } = options ?? {}

  // Initial delay to give the event processor time to start
  await sleep(initialDelayMs)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const query = stringify({
        where: {
          requestId: { equals: requestId },
          status: { equals: expectedStatus },
        },
        limit: 1,
      })

      const res = await fetch(`/api/write-off-requests?${query}`)

      if (res.ok) {
        const data = await res.json()
        if (data.docs && data.docs.length > 0) {
          return data.docs[0] as T
        }
      }
    } catch {
      // Ignore fetch errors and continue polling
    }

    // Don't sleep after the last attempt
    if (attempt < maxAttempts) {
      await sleep(intervalMs)
    }
  }

  throw new PollTimeoutError(requestId, maxAttempts)
}

/**
 * Poll for a reapplication block-clear request update by requestId and expected status.
 *
 * Used for approve/reject/cancel operations where we're updating
 * an existing request and waiting for the status change.
 *
 * @param requestId - The request ID to look for
 * @param expectedStatus - The status we're waiting for
 * @param options - Polling configuration
 * @returns The updated block-clear request document
 * @throws PollTimeoutError if not found within max attempts
 */
export async function pollForBlockClearUpdate<T = unknown>(
  requestId: string,
  expectedStatus: 'approved' | 'rejected' | 'cancelled',
  options?: PollOptions,
): Promise<T> {
  const { maxAttempts = 10, intervalMs = 500, initialDelayMs = 100 } = options ?? {}

  // Initial delay to give the event processor time to start
  await sleep(initialDelayMs)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const query = stringify({
        where: {
          requestId: { equals: requestId },
          status: { equals: expectedStatus },
        },
        limit: 1,
      })

      const res = await fetch(`/api/reapplication-block-clear-requests?${query}`)

      if (res.ok) {
        const data = await res.json()
        if (data.docs && data.docs.length > 0) {
          return data.docs[0] as T
        }
      }
    } catch {
      // Ignore fetch errors and continue polling
    }

    // Don't sleep after the last attempt
    if (attempt < maxAttempts) {
      await sleep(intervalMs)
    }
  }

  throw new PollTimeoutError(requestId, maxAttempts)
}

/**
 * Generic polling function for any projection.
 *
 * @param fetchFn - Function that fetches and checks for the projection
 * @param options - Polling configuration
 * @returns The result of fetchFn when it returns a truthy value
 * @throws PollTimeoutError if not found within max attempts
 */
export async function pollUntil<T>(
  fetchFn: () => Promise<T | null | undefined>,
  options?: PollOptions & { label?: string },
): Promise<T> {
  const {
    maxAttempts = 10,
    intervalMs = 500,
    initialDelayMs = 100,
    label = 'projection',
  } = options ?? {}

  // Initial delay
  await sleep(initialDelayMs)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fetchFn()
      if (result) {
        return result
      }
    } catch {
      // Ignore errors and continue polling
    }

    // Don't sleep after the last attempt
    if (attempt < maxAttempts) {
      await sleep(intervalMs)
    }
  }

  throw new PollTimeoutError(label, maxAttempts)
}
