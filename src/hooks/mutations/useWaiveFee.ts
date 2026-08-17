import { useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useOptimisticStore } from '@/stores/optimistic'
import { useUIStore } from '@/stores/ui'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { useVersionStore } from '@/stores/version'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
import { transactionsQueryKey } from '@/hooks/queries/useTransactions'
import { toAppError, parseApiError } from '@/lib/utils/error'
import { copyErrorDetails } from '@/lib/utils/error-toast'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { ERROR_CODES } from '@/lib/errors/codes'
import type { PendingMutation } from '@/types/mutation'

/** Custom event detail for retry action */
interface RetryEventDetail {
  id: string
  type: string
  accountId: string
  params: Record<string, unknown>
}

export interface WaiveFeeParams {
  loanAccountId: string
  waiverAmount: number
  reason: string
  approvedBy: string
  /** Expected version for conflict detection (optional for backward compatibility) */
  expectedVersion?: string
  /**
   * Idempotency key for this user intent. Minted once by the public
   * `waiveFee`/`waiveFeeAsync` wrappers (or carried over from a failed action)
   * and held in the mutation variables, so every retry of the same intent —
   * React Query retry, toast "Retry", failed-actions replay — re-POSTs the
   * SAME key and the ledger dedupes instead of double-waiving.
   *
   * Optional so direct `mutate()` callers keep working; when absent the route
   * falls back to a server-generated key (pre-existing behaviour).
   */
  idempotencyKey?: string
}

export interface WaiveFeeResponse {
  success: boolean
  transaction: {
    id: string
    accountId: string
    type: string
    typeLabel: string
    date: string
    feeDelta: number
    totalDelta: number
    feeAfter: number
    totalAfter: number
    description: string
  }
  eventId: string
}

async function waiveFee(params: WaiveFeeParams): Promise<WaiveFeeResponse> {
  // Use fetchWithTimeout for network timeout handling
  const res = await fetchWithTimeout('/api/ledger/waive-fee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loanAccountId: params.loanAccountId,
      waiverAmount: params.waiverAmount.toString(),
      reason: params.reason,
      approvedBy: params.approvedBy,
      expectedVersion: params.expectedVersion,
      idempotencyKey: params.idempotencyKey,
    }),
  })

  if (!res.ok) {
    // Parse structured API error response
    const appError = await parseApiError(res, 'Failed to waive fee')
    throw appError
  }

  return res.json()
}

/**
 * Mutation hook for waiving fees with optimistic UI updates.
 *
 * Flow:
 * 1. Generate the idempotency key ONCE per user intent (in the public
 *    wrapper, NOT in mutationFn) so retries reuse it
 * 2. Add to optimistic store (stage: 'optimistic')
 * 3. Submit API request
 * 4a. On success: update stage to 'confirmed', show toast, invalidate queries
 * 4b. On error: update stage to 'failed', show error toast
 *
 * Also listens for `billie-retry-action` custom events to retry failed actions
 * from the Failed Actions Notification Center.
 */
export function useWaiveFee(loanAccountId?: string, accountLabel?: string) {
  const queryClient = useQueryClient()
  const { setPending, setStage, clearPending, hasPendingAction } = useOptimisticStore()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const addFailedAction = useFailedActionsStore((state) => state.addFailedAction)
  const removeAction = useFailedActionsStore((state) => state.removeAction)
  const getExpectedVersion = useVersionStore((state) => state.getExpectedVersion)
  const hasPendingWaive = loanAccountId ? hasPendingAction(loanAccountId, 'waive-fee') : false

  const mutation = useMutation({
    mutationFn: waiveFee,

    onMutate: async (params) => {
      // Reuse the intent's idempotency key as the optimistic-store id so a
      // retry re-stages the same pending mutation rather than a new one.
      const mutationId =
        params.idempotencyKey ?? generateIdempotencyKey(params.loanAccountId, 'waive-fee')

      // Create pending mutation
      const pendingMutation: PendingMutation = {
        id: mutationId,
        accountId: params.loanAccountId,
        action: 'waive-fee',
        stage: 'optimistic',
        amount: params.waiverAmount,
        createdAt: Date.now(),
      }

      // Add to optimistic store
      setPending(params.loanAccountId, pendingMutation)

      // Return context for rollback
      return { mutationId, loanAccountId: params.loanAccountId, pendingMutation }
    },

    onSuccess: (data, params, context) => {
      if (!context) return

      // Report the settled balance so the announcer can say "Balance updated
      // to $X" instead of just naming the action — but only when the waiver
      // actually moved the total. A duplicate/idempotent-replay waiver against
      // an account whose fee balance is already zero settles with
      // totalDelta === 0; reporting totalAfter there would be a true number
      // wrapped in a false "updated to" claim.
      //
      // The route parseFloat()s proto3 string fields; an unset proto string is
      // "", parseFloat("") is NaN, and JSON.stringify(NaN) emits null. So either
      // field can arrive as null despite the WaiveFeeResponse type claiming
      // `number` — and totalAfter/totalDelta are independently parsed, so one
      // can be a valid number while the other is null (an asymmetric unset).
      // `Number(null)` is 0, which passes `Number.isFinite`, so a bare
      // isFinite check lets a null totalAfter through as a false "Balance
      // updated to $0.00". Requiring `typeof === 'number'` first closes that
      // hole: null (or any other non-number JSON value) is rejected outright,
      // it doesn't get coerced to a misleading 0.
      const totalAfter = data.transaction.totalAfter
      const totalDelta = data.transaction.totalDelta
      const totalAfterIsNumber = typeof totalAfter === 'number' && Number.isFinite(totalAfter)
      const totalDeltaIsNumber = typeof totalDelta === 'number' && Number.isFinite(totalDelta)
      if (totalAfterIsNumber && totalDeltaIsNumber && totalDelta !== 0) {
        setPending(context.loanAccountId, {
          ...context.pendingMutation,
          balanceAfter: totalAfter,
        })
      }

      // Update stage to confirmed
      setStage(context.loanAccountId, context.mutationId, 'confirmed')

      // Show success toast
      toast.success('Fee waived successfully', {
        description: `$${params.waiverAmount.toFixed(2)} waived from account`,
      })

      // Invalidate transactions query to refresh list
      queryClient.invalidateQueries({
        queryKey: transactionsQueryKey(params.loanAccountId, {}),
      })

      // Invalidate customer query to refresh account data and update version store
      // This ensures the version store has the latest updatedAt for subsequent mutations
      queryClient.invalidateQueries({
        queryKey: ['customer'],
      })

      // Clear from store after short delay (allow UI to show confirmed state)
      setTimeout(() => {
        clearPending(context.loanAccountId, context.mutationId)
      }, 2000)
    },

    onError: (error, params, context) => {
      if (!context) return

      // Convert to AppError for consistent handling
      const appError = toAppError(error, 'Failed to waive fee')

      // Update stage to failed
      setStage(context.loanAccountId, context.mutationId, 'failed', appError.message)

      // Check if this is a version conflict (handled separately via callback)
      if (appError.code === ERROR_CODES.VERSION_CONFLICT) {
        // Version conflicts are not added to failed actions - they need user intervention
        toast.error('Data has changed', {
          description: 'This record was modified. Please refresh and try again.',
        })
        return
      }

      // Add to failed actions queue for retry later (only system errors)
      // Uses error code instead of brittle regex detection
      if (appError.isSystemError()) {
        addFailedAction(
          'waive-fee',
          params.loanAccountId,
          {
            waiverAmount: params.waiverAmount,
            reason: params.reason,
            approvedBy: params.approvedBy,
            // Persisted so the Failed Actions replay re-sends the ORIGINAL
            // key — the store snapshots this object into localStorage.
            idempotencyKey: params.idempotencyKey,
          },
          appError.message,
          accountLabel,
        )
      }

      // Show error toast with retry option and copy details
      toast.error('Failed to waive fee', {
        description:
          appError.code === ERROR_CODES.UNKNOWN_ERROR
            ? `${appError.message} (${appError.errorId})`
            : appError.message,
        action: appError.isRetryable()
          ? {
              label: 'Retry',
              onClick: () => {
                clearPending(context.loanAccountId, context.mutationId)
                mutation.mutate(params)
              },
            }
          : {
              label: '📋 Copy details',
              onClick: () =>
                copyErrorDetails(appError, {
                  action: 'waive-fee',
                  accountId: params.loanAccountId,
                }),
            },
      })
    },
  })

  /**
   * Handle retry events from the Failed Actions Notification Center.
   * When a retry event for 'waive-fee' is received, execute the mutation
   * and remove the action from the store on success.
   */
  const handleRetryEvent = useCallback(
    (event: Event) => {
      const customEvent = event as CustomEvent<RetryEventDetail>
      const { id, type, accountId, params } = customEvent.detail

      // Only handle waive-fee retry events
      if (type !== 'waive-fee') return

      // Extract params with current version for conflict detection
      const waiveParams: WaiveFeeParams = {
        loanAccountId: accountId,
        waiverAmount: params.waiverAmount as number,
        reason: params.reason as string,
        approvedBy: params.approvedBy as string,
        expectedVersion: getExpectedVersion(accountId),
        // Same key as the attempt that failed, so the replay is deduped by
        // the ledger if the original POST actually landed.
        idempotencyKey: params.idempotencyKey as string | undefined,
      }

      // Execute the mutation and remove from failed actions on success
      mutation
        .mutateAsync(waiveParams)
        .then(() => {
          // Successfully retried - remove from failed actions
          removeAction(id)
        })
        .catch(() => {
          // Error will be handled by onError callback
          // The action stays in the queue for another retry attempt
        })
    },
    [mutation, removeAction, getExpectedVersion],
  )

  // Listen for retry events
  useEffect(() => {
    window.addEventListener('billie-retry-action', handleRetryEvent)
    return () => {
      window.removeEventListener('billie-retry-action', handleRetryEvent)
    }
  }, [handleRetryEvent])

  /**
   * Wrapper that automatically includes expectedVersion from the version store.
   */
  const waiveFeeWithVersion = useCallback(
    (params: Omit<WaiveFeeParams, 'expectedVersion' | 'idempotencyKey'>) => {
      const expectedVersion = getExpectedVersion(params.loanAccountId)
      const idempotencyKey = generateIdempotencyKey(params.loanAccountId, 'waive-fee')
      mutation.mutate({ ...params, expectedVersion, idempotencyKey })
    },
    [mutation, getExpectedVersion],
  )

  const waiveFeeAsyncWithVersion = useCallback(
    async (params: Omit<WaiveFeeParams, 'expectedVersion' | 'idempotencyKey'>) => {
      const expectedVersion = getExpectedVersion(params.loanAccountId)
      const idempotencyKey = generateIdempotencyKey(params.loanAccountId, 'waive-fee')
      return mutation.mutateAsync({ ...params, expectedVersion, idempotencyKey })
    },
    [mutation, getExpectedVersion],
  )

  return {
    waiveFee: waiveFeeWithVersion,
    waiveFeeAsync: waiveFeeAsyncWithVersion,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    isReadOnlyMode: readOnlyMode,
    hasPendingWaive,
    /** Check if last error was a version conflict */
    isVersionConflict: mutation.error
      ? toAppError(mutation.error).code === ERROR_CODES.VERSION_CONFLICT
      : false,
  }
}
