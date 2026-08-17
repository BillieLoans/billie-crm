/**
 * Version Check Utility
 *
 * Provides server-side version checking for optimistic locking.
 * Compares the expected version (from client) with the current version in database.
 *
 * ADVISORY ONLY — this is a staleness hint for the operator, not a concurrency control:
 *  - the loan-accounts row is a projection updated asynchronously by the Python event
 *    processor, so `updatedAt` can lag a just-posted ledger transaction;
 *  - it fails open (no expectedVersion, account missing, or any error => isValid) and can be
 *    switched off via VERSION_CONFLICT_CHECK_ENABLED;
 *  - nothing spans the check and the subsequent gRPC post, so it cannot serialise two operators.
 * The real integrity controls are the client idempotency keys forwarded to the ledger and the
 * ledger's own business rules. See docs/money-movement-policy.md (audit P2-6).
 */

import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { VERSION_CONFLICT_CHECK_ENABLED, VERSION_CONFLICT_ERROR_CODE } from '@/lib/constants'
import { ERROR_MESSAGES } from '@/lib/errors/messages'

export interface VersionCheckResult {
  isValid: boolean
  currentVersion?: string
  expectedVersion?: string
  error?: {
    code: string
    message: string
    currentVersion: string
    expectedVersion: string
  }
}

/**
 * Check if the expected version matches the current version in the database.
 *
 * @param loanAccountId - The loan account ID to check
 * @param expectedVersion - The version the client expects (updatedAt timestamp)
 * @returns Result indicating if version is valid or conflict details
 *
 * @example
 * ```typescript
 * const result = await checkVersion(loanAccountId, expectedVersion)
 * if (!result.isValid) {
 *   return NextResponse.json(result.error, { status: 409 })
 * }
 * // Proceed with mutation
 * ```
 */
export async function checkVersion(
  loanAccountId: string,
  expectedVersion?: string,
): Promise<VersionCheckResult> {
  // Skip check if feature is disabled
  if (!VERSION_CONFLICT_CHECK_ENABLED) {
    return { isValid: true }
  }

  // Skip check if no expected version provided (graceful fallback for migration)
  if (!expectedVersion) {
    console.warn(
      `[Version Check] No expectedVersion provided for account ${loanAccountId}. Allowing request to proceed.`,
    )
    return { isValid: true }
  }

  try {
    const payload = await getPayload({ config: configPromise })

    // Find the loan account by loanAccountId
    const result = await payload.find({
      collection: 'loan-accounts',
      where: {
        loanAccountId: { equals: loanAccountId },
      },
      limit: 1,
    })

    if (result.docs.length === 0) {
      // Account not found - let the actual operation handle this
      console.warn(
        `[Version Check] Account ${loanAccountId} not found. Allowing request to proceed.`,
      )
      return { isValid: true }
    }

    const account = result.docs[0]
    const currentVersion = account.updatedAt as string

    // Compare versions (as ISO 8601 strings, direct comparison works)
    if (currentVersion !== expectedVersion) {
      console.info(
        `[Version Check] Conflict detected for ${loanAccountId}. ` +
          `Expected: ${expectedVersion}, Current: ${currentVersion}`,
      )
      return {
        isValid: false,
        currentVersion,
        expectedVersion,
        error: {
          code: VERSION_CONFLICT_ERROR_CODE,
          message: ERROR_MESSAGES.VERSION_CONFLICT,
          currentVersion,
          expectedVersion,
        },
      }
    }

    return {
      isValid: true,
      currentVersion,
      expectedVersion,
    }
  } catch (error) {
    // On error, log but allow request to proceed (fail open for resilience)
    console.error('[Version Check] Error checking version:', error)
    return { isValid: true }
  }
}

/**
 * Create a version conflict error response.
 * Use this in API routes when checkVersion returns isValid: false.
 */
export function createVersionConflictResponse(result: VersionCheckResult) {
  return {
    error: VERSION_CONFLICT_ERROR_CODE,
    message: ERROR_MESSAGES.VERSION_CONFLICT,
    currentVersion: result.currentVersion,
    expectedVersion: result.expectedVersion,
  }
}
