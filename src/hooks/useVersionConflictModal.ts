'use client'

import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { PreservedChanges } from '@/components/VersionConflictModal'

interface VersionConflictState {
  isOpen: boolean
  loanAccountId: string | null
  preservedChanges: PreservedChanges | null
}

/**
 * Hook for managing version conflict modal state.
 *
 * Provides state and handlers for displaying the version conflict modal
 * when a mutation fails due to a version conflict.
 *
 * @example
 * ```tsx
 * const { showConflict, closeModal, refreshAndRetry, state, isRefreshing } = useVersionConflictModal()
 *
 * // When a version conflict is detected:
 * showConflict(loanAccountId, {
 *   items: [
 *     { label: 'Amount', value: '$150.00' },
 *     { label: 'Reason', value: 'Customer goodwill' },
 *   ],
 * })
 *
 * // Render the modal:
 * <VersionConflictModal
 *   isOpen={state.isOpen}
 *   onClose={closeModal}
 *   onRefresh={refreshAndRetry}
 *   isRefreshing={isRefreshing}
 *   preservedChanges={state.preservedChanges}
 * />
 * ```
 */
export function useVersionConflictModal() {
  const queryClient = useQueryClient()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [state, setState] = useState<VersionConflictState>({
    isOpen: false,
    loanAccountId: null,
    preservedChanges: null,
  })

  /**
   * Show the version conflict modal.
   */
  const showConflict = useCallback((loanAccountId: string, preservedChanges?: PreservedChanges) => {
    setState({
      isOpen: true,
      loanAccountId,
      preservedChanges: preservedChanges ?? null,
    })
  }, [])

  /**
   * Close the modal without refreshing.
   */
  const closeModal = useCallback(() => {
    setState({
      isOpen: false,
      loanAccountId: null,
      preservedChanges: null,
    })
  }, [])

  /**
   * Refresh data and close modal.
   * Invalidates customer query to get fresh data including new versions.
   */
  const refreshAndRetry = useCallback(async () => {
    setIsRefreshing(true)
    try {
      // Invalidate customer query to refresh all account data and versions
      await queryClient.invalidateQueries({ queryKey: ['customer'] })
      // Close modal after successful refresh
      closeModal()
      toast.success('Data refreshed', {
        description: 'You can now retry your action with the latest data.',
      })
    } catch (error) {
      console.error('Failed to refresh data:', error)
      toast.error('Failed to refresh data', {
        description: 'Please try again or reload the page.',
      })
      // Keep modal open on error so user can retry
    } finally {
      setIsRefreshing(false)
    }
  }, [queryClient, closeModal])

  return {
    /** Show the version conflict modal */
    showConflict,
    /** Close the modal */
    closeModal,
    /** Refresh data and close modal */
    refreshAndRetry,
    /** Current modal state */
    state,
    /** Whether refresh is in progress */
    isRefreshing,
  }
}
