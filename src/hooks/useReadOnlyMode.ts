'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useLedgerHealth } from '@/hooks/queries/useLedgerHealth'
import { useUIStore } from '@/stores/ui'
import { TOAST_ID_SYSTEM_RESTORED } from '@/lib/constants'
import type { LedgerHealthStatus } from '@/types/ledger-health'

/**
 * Options for the useReadOnlyMode hook
 */
export interface UseReadOnlyModeOptions {
  /** Show toast when system recovers (default: true) */
  showRecoveryToast?: boolean
  /** Treat 'degraded' as offline (default: false) */
  treatDegradedAsOffline?: boolean
  /**
   * Poll ledger health and sync the store (default: true). Disable for
   * roles behind the lending wall — with the query off, the health status
   * defaults to 'offline', which must NOT be synced into read-only mode.
   */
  enabled?: boolean
}

/**
 * Hook to sync ledger health status with read-only mode.
 *
 * Automatically sets `readOnlyMode` in the UI store based on ledger health:
 * - Ledger offline → readOnlyMode = true
 * - Ledger connected → readOnlyMode = false
 *
 * Also shows a toast notification when the system recovers.
 *
 * @example
 * ```tsx
 * // Use in a top-level component (e.g., providers)
 * function ReadOnlyModeSync() {
 *   useReadOnlyMode()
 *   return null
 * }
 * ```
 */
export function useReadOnlyMode(options: UseReadOnlyModeOptions = {}) {
  const { showRecoveryToast = true, treatDegradedAsOffline = false, enabled = true } = options

  const { status, isLoading } = useLedgerHealth({ enabled })
  const setReadOnlyMode = useUIStore((state) => state.setReadOnlyMode)
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)

  // Track previous status to detect recovery
  const previousStatusRef = useRef<LedgerHealthStatus | null>(null)
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    // Not polling (lending-walled role) or still on initial load — the
    // 'offline' default from a disabled query must not flip read-only mode.
    if (!enabled || isLoading) return

    // Determine if current status should trigger read-only mode
    const shouldBeReadOnly =
      status === 'offline' || (treatDegradedAsOffline && status === 'degraded')

    // Check for recovery (was offline, now connected)
    const wasOffline =
      previousStatusRef.current === 'offline' ||
      (treatDegradedAsOffline && previousStatusRef.current === 'degraded')
    const isNowOnline = !shouldBeReadOnly

    // Update read-only mode in store
    setReadOnlyMode(shouldBeReadOnly)

    // Show recovery toast (but not on initial load)
    if (hasInitializedRef.current && wasOffline && isNowOnline && showRecoveryToast) {
      toast.success('System restored', {
        description: 'Ledger connection restored. All actions are now available.',
        id: TOAST_ID_SYSTEM_RESTORED,
      })
    }

    // Update previous status ref
    previousStatusRef.current = status
    hasInitializedRef.current = true
  }, [status, isLoading, enabled, setReadOnlyMode, showRecoveryToast, treatDegradedAsOffline])

  return {
    /** Whether read-only mode is active */
    isReadOnly: readOnlyMode,
    /** Current ledger health status */
    status,
    /** Whether we're still checking initial status */
    isLoading,
  }
}
