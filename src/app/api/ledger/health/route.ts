/**
 * API Route: GET /api/ledger/health
 *
 * Health check endpoint for the gRPC ledger service.
 * Returns status (connected/degraded/offline) based on response time.
 *
 * Response:
 * - status: 'connected' | 'degraded' | 'offline'
 * - latencyMs: response time in milliseconds
 * - message: human-readable status message
 * - checkedAt: ISO timestamp of the check
 */

import { NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import {
  HEALTH_CHECK_TEST_ACCOUNT,
  HEALTH_DEGRADED_THRESHOLD_MS,
  HEALTH_OFFLINE_THRESHOLD_MS,
} from '@/lib/constants'
import type { LedgerHealthStatus, LedgerHealthResponse } from '@/types/ledger-health'

// Re-export types for consumers who import from the route
export type { LedgerHealthStatus, LedgerHealthResponse }

/**
 * Determine health status based on latency
 */
function getStatusFromLatency(latencyMs: number): LedgerHealthStatus {
  if (latencyMs < HEALTH_DEGRADED_THRESHOLD_MS) {
    return 'connected'
  }
  if (latencyMs < HEALTH_OFFLINE_THRESHOLD_MS) {
    return 'degraded'
  }
  return 'offline'
}

/**
 * Get message for health status
 */
function getStatusMessage(status: LedgerHealthStatus): string {
  switch (status) {
    case 'connected':
      return 'Ledger Connected'
    case 'degraded':
      return 'Ledger Degraded - some operations may be slow'
    case 'offline':
      return 'Ledger Offline - read-only mode active'
  }
}

export async function GET() {
  const startTime = performance.now()
  const checkedAt = new Date().toISOString()

  const client = getLedgerClient()

  // Try multiple methods as fallback to ensure we can detect service availability
  // Even if one method fails, others might work
  const healthCheckMethods = [
    // Primary: getBalance (lightweight)
    () => client.getBalance({ loanAccountId: HEALTH_CHECK_TEST_ACCOUNT }),
    // Fallback: getAccruedYield (we know this works based on user feedback)
    () => client.getAccruedYield({ accountId: HEALTH_CHECK_TEST_ACCOUNT }),
  ]

  let lastError: unknown = null
  let latencyMs = 0

  // Try each method until one succeeds
  for (const healthCheckMethod of healthCheckMethods) {
    try {
      await Promise.race([
        healthCheckMethod(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), HEALTH_OFFLINE_THRESHOLD_MS)
        ),
      ])

      // Success - service is reachable
      latencyMs = Math.round(performance.now() - startTime)
      const status = getStatusFromLatency(latencyMs)

      const response: LedgerHealthResponse = {
        status,
        latencyMs,
        message: getStatusMessage(status),
        checkedAt,
      }

      return NextResponse.json(response)
    } catch (error: unknown) {
      lastError = error
      const grpcError = error as { code?: number; message?: string; details?: string }
      
      // If we got NOT_FOUND (code 5) or UNIMPLEMENTED (code 12), the service responded
      // This means it's healthy, just the method/account doesn't exist
      if (grpcError.code === 5 || grpcError.code === 12) {
        latencyMs = Math.round(performance.now() - startTime)
        const status = getStatusFromLatency(latencyMs)
        const response: LedgerHealthResponse = {
          status,
          latencyMs,
          message: getStatusMessage(status),
          checkedAt,
        }
        return NextResponse.json(response)
      }

      // For other errors, try the next method
      continue
    }
  }

  // All methods failed - handle the error
  latencyMs = Math.round(performance.now() - startTime)
  const grpcError = lastError as { code?: number; message?: string; details?: string }

  // Check if it's a gRPC error that indicates the service is actually reachable
  // These error codes mean the service responded, so it's healthy:
  // - 5 (NOT_FOUND): Service responded, account just doesn't exist
  // - 12 (UNIMPLEMENTED): Service responded, method not implemented (but service is up)
  // - 14 (UNAVAILABLE): Service might be temporarily unavailable, but it exists
  // Any response (even an error) within timeout means the service is reachable
  if (grpcError.code === 5 || grpcError.code === 12) {
    // NOT_FOUND or UNIMPLEMENTED - service is healthy, just no such account or method
    const status = getStatusFromLatency(latencyMs)
    const response: LedgerHealthResponse = {
      status,
      latencyMs,
      message: getStatusMessage(status),
      checkedAt,
    }
    return NextResponse.json(response)
  }

  // For UNAVAILABLE (code 14), check if it's a timeout or actual unavailability
  // If we got a response quickly but it's UNAVAILABLE, the service might be degraded
  // If it timed out, it's offline
  if (grpcError.code === 14) {
    if (latencyMs < HEALTH_OFFLINE_THRESHOLD_MS) {
      // Got a response quickly but service says unavailable - treat as degraded
      const response: LedgerHealthResponse = {
        status: 'degraded',
        latencyMs,
        message: 'Ledger service temporarily unavailable',
        checkedAt,
      }
      return NextResponse.json(response)
    }
  }

  // Service is offline or unreachable - log for debugging
  console.warn('[Ledger Health] All health check methods failed. Service offline or unreachable:', {
    code: grpcError.code,
    message: grpcError.message || grpcError.details,
    latencyMs,
    checkedAt,
    lastError: lastError,
  })

  const response: LedgerHealthResponse = {
    status: 'offline',
    latencyMs,
    message: getStatusMessage('offline'),
    checkedAt,
  }

  return NextResponse.json(response)
}
