/**
 * In-process ledger health probe.
 *
 * Mirrors the logic behind GET /api/ledger/health, but callable directly from
 * other server code. Server-side callers must NOT loop back over HTTP to that
 * route: it is auth-guarded, and a server-to-server `fetch` carries no session
 * cookie, so such a call can only ever 401 (and would report a healthy ledger
 * as permanently "offline").
 */

import { getLedgerClient } from '@/server/grpc-client'
import {
  HEALTH_CHECK_TEST_ACCOUNT,
  HEALTH_DEGRADED_THRESHOLD_MS,
  HEALTH_OFFLINE_THRESHOLD_MS,
} from '@/lib/constants'
import type { LedgerHealthStatus, LedgerHealthResponse } from '@/types/ledger-health'

/** Latency → status. */
export function getStatusFromLatency(latencyMs: number): LedgerHealthStatus {
  if (latencyMs < HEALTH_DEGRADED_THRESHOLD_MS) return 'connected'
  if (latencyMs < HEALTH_OFFLINE_THRESHOLD_MS) return 'degraded'
  return 'offline'
}

/** Human-readable message for a status. */
export function getStatusMessage(status: LedgerHealthStatus): string {
  switch (status) {
    case 'connected':
      return 'Ledger Connected'
    case 'degraded':
      return 'Ledger Degraded - some operations may be slow'
    case 'offline':
      return 'Ledger Offline - read-only mode active'
  }
}

/**
 * Probe the ledger over gRPC and classify the result.
 *
 * gRPC codes 5 (NOT_FOUND) and 12 (UNIMPLEMENTED) still mean the service
 * answered, so they count as reachable.
 */
export async function checkLedgerHealth(): Promise<LedgerHealthResponse> {
  const startTime = performance.now()
  const checkedAt = new Date().toISOString()
  const client = getLedgerClient()

  const healthCheckMethods = [
    () => client.getBalance({ loanAccountId: HEALTH_CHECK_TEST_ACCOUNT }),
    () => client.getAccruedYield({ accountId: HEALTH_CHECK_TEST_ACCOUNT }),
  ]

  const respond = (status: LedgerHealthStatus, latencyMs: number, message?: string) => ({
    status,
    latencyMs,
    message: message ?? getStatusMessage(status),
    checkedAt,
  })

  let lastError: unknown = null

  for (const healthCheckMethod of healthCheckMethods) {
    try {
      await Promise.race([
        healthCheckMethod(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), HEALTH_OFFLINE_THRESHOLD_MS),
        ),
      ])
      const latencyMs = Math.round(performance.now() - startTime)
      return respond(getStatusFromLatency(latencyMs), latencyMs)
    } catch (error: unknown) {
      lastError = error
      const grpcError = error as { code?: number }
      if (grpcError.code === 5 || grpcError.code === 12) {
        const latencyMs = Math.round(performance.now() - startTime)
        return respond(getStatusFromLatency(latencyMs), latencyMs)
      }
      continue
    }
  }

  const latencyMs = Math.round(performance.now() - startTime)
  const grpcError = lastError as { code?: number; message?: string; details?: string }

  if (grpcError?.code === 14 && latencyMs < HEALTH_OFFLINE_THRESHOLD_MS) {
    return respond('degraded', latencyMs, 'Ledger service temporarily unavailable')
  }

  console.warn('[Ledger Health] All health check methods failed. Service offline or unreachable:', {
    code: grpcError?.code,
    message: grpcError?.message || grpcError?.details,
    latencyMs,
    checkedAt,
  })

  return respond('offline', latencyMs)
}
