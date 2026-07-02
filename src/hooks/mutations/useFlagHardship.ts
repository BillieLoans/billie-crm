/**
 * Flag Hardship Mutation Hook — Collections operator action (BTB-198 WS5)
 *
 * POSTs `/api/collections/actions/flag-hardship`, a synchronous gRPC
 * command against the headless collections engine. Follows the
 * `useWaiveFee` pattern (optimistic store staging, failed-actions queue,
 * idempotency key, toasts) with two deliberate deltas:
 *
 * - No version-store wiring — collections commands carry no
 *   `expectedVersion`.
 * - No `billie-retry-action` window-event listener. That mechanism is
 *   opt-in per action type: `FailedActionsPanel` always dispatches the
 *   event on retry, but nothing breaks if no hook is listening for a given
 *   `type` (see `write-off-request`, an existing `FailedActionType` with
 *   no listener anywhere in the codebase) — the action still queues,
 *   lists, and can be dismissed normally; only the "Retry" button is a
 *   no-op until a listener is wired. Since registration isn't required for
 *   the panel to function, it's left out here per the WS5 plan.
 */

import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useOptimisticStore } from '@/stores/optimistic'
import { useUIStore } from '@/stores/ui'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
import { toAppError } from '@/lib/utils/error'
import { copyErrorDetails } from '@/lib/utils/error-toast'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { parseCollectionsActionError } from '@/lib/collections/action-error-client'
import { ERROR_CODES } from '@/lib/errors/codes'
import type { PendingMutation } from '@/types/mutation'
import type { CollectionsActionResult } from '@/types/collections'

export interface FlagHardshipParams {
  accountId: string
  reason: string
}

interface FlagHardshipRequest extends FlagHardshipParams {
  idempotencyKey: string
}

async function flagHardshipRequest(
  params: FlagHardshipRequest,
): Promise<CollectionsActionResult> {
  const res = await fetchWithTimeout('/api/collections/actions/flag-hardship', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: params.accountId,
      reason: params.reason,
      idempotencyKey: params.idempotencyKey,
    }),
  })

  if (!res.ok) {
    throw await parseCollectionsActionError(res, 'Failed to flag hardship')
  }

  const data = await res.json()
  return data.result as CollectionsActionResult
}

/**
 * Mutation hook for flagging a collections case as hardship-paused.
 *
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345").
 */
export function useFlagHardship(accountLabel?: string) {
  const queryClient = useQueryClient()
  const { setPending, setStage, clearPending } = useOptimisticStore()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const addFailedAction = useFailedActionsStore((state) => state.addFailedAction)

  const mutation = useMutation({
    mutationFn: flagHardshipRequest,

    onMutate: async (params) => {
      const pendingMutation: PendingMutation = {
        id: params.idempotencyKey,
        accountId: params.accountId,
        action: 'flag-hardship',
        stage: 'optimistic',
        createdAt: Date.now(),
      }

      setPending(params.accountId, pendingMutation)

      return { mutationId: params.idempotencyKey, accountId: params.accountId }
    },

    onSuccess: (data, params, context) => {
      if (!context) return

      setStage(context.accountId, context.mutationId, 'confirmed')

      toast.success('Hardship flagged', {
        description: `Case ${params.accountId} is now paused for hardship.`,
      })

      queryClient.invalidateQueries({ queryKey: ['collections-cases'] })

      setTimeout(() => {
        clearPending(context.accountId, context.mutationId)
      }, 2000)
    },

    onError: (error, params, context) => {
      if (!context) return

      const appError = toAppError(error, 'Failed to flag hardship')

      setStage(context.accountId, context.mutationId, 'failed', appError.message)

      // 409 FAILED_PRECONDITION carries the state/economic-gate reason
      // verbatim in the message — show it as-is, don't queue for retry.
      if (appError.statusCode === 409) {
        toast.error('Cannot flag hardship', { description: appError.message })
        return
      }

      if (appError.isSystemError()) {
        addFailedAction(
          'flag-hardship',
          params.accountId,
          { reason: params.reason },
          appError.message,
          accountLabel,
        )
      }

      toast.error('Failed to flag hardship', {
        description:
          appError.code === ERROR_CODES.UNKNOWN_ERROR
            ? `${appError.message} (${appError.errorId})`
            : appError.message,
        action: appError.isRetryable()
          ? {
              label: 'Retry',
              onClick: () => {
                clearPending(context.accountId, context.mutationId)
                mutation.mutate(params)
              },
            }
          : {
              label: '📋 Copy details',
              onClick: () =>
                copyErrorDetails(appError, {
                  action: 'flag-hardship',
                  accountId: params.accountId,
                }),
            },
      })
    },
  })

  const flagHardship = useCallback(
    (params: FlagHardshipParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'flag-hardship')
      mutation.mutate({ ...params, idempotencyKey })
    },
    [mutation],
  )

  const flagHardshipAsync = useCallback(
    async (params: FlagHardshipParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'flag-hardship')
      return mutation.mutateAsync({ ...params, idempotencyKey })
    },
    [mutation],
  )

  return {
    flagHardship,
    flagHardshipAsync,
    isPending: mutation.isPending,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    isReadOnlyMode: readOnlyMode,
  }
}
