/**
 * Apply Stop-Contact Mutation Hook — Collections operator action (BTB-198 WS5)
 *
 * POSTs `/api/collections/actions/stop-contact`, a synchronous gRPC
 * command against the headless collections engine (dispute, deceased,
 * legal, etc.). See useFlagHardship.ts for the deliberate deltas from
 * `useWaiveFee` (no version-store wiring, no `billie-retry-action`
 * listener) — the same reasoning applies here.
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

export interface ApplyStopContactParams {
  accountId: string
  reason?: string
}

interface ApplyStopContactRequest extends ApplyStopContactParams {
  idempotencyKey: string
}

async function applyStopContactRequest(
  params: ApplyStopContactRequest,
): Promise<CollectionsActionResult> {
  const res = await fetchWithTimeout('/api/collections/actions/stop-contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: params.accountId,
      reason: params.reason,
      idempotencyKey: params.idempotencyKey,
    }),
  })

  if (!res.ok) {
    throw await parseCollectionsActionError(res, 'Failed to apply stop-contact')
  }

  const data = await res.json()
  return data.result as CollectionsActionResult
}

/**
 * Mutation hook for applying a stop-contact flag to a collections case.
 *
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345").
 */
export function useApplyStopContact(accountLabel?: string) {
  const queryClient = useQueryClient()
  const { setPending, setStage, clearPending } = useOptimisticStore()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const addFailedAction = useFailedActionsStore((state) => state.addFailedAction)

  const mutation = useMutation({
    mutationFn: applyStopContactRequest,

    onMutate: async (params) => {
      const pendingMutation: PendingMutation = {
        id: params.idempotencyKey,
        accountId: params.accountId,
        action: 'stop-contact',
        stage: 'optimistic',
        createdAt: Date.now(),
      }

      setPending(params.accountId, pendingMutation)

      return { mutationId: params.idempotencyKey, accountId: params.accountId }
    },

    onSuccess: (data, params, context) => {
      if (!context) return

      setStage(context.accountId, context.mutationId, 'confirmed')

      toast.success('Stop-contact applied', {
        description: `Contact halted for case ${params.accountId}.`,
      })

      queryClient.invalidateQueries({ queryKey: ['collections-cases'] })

      setTimeout(() => {
        clearPending(context.accountId, context.mutationId)
      }, 2000)
    },

    onError: (error, params, context) => {
      if (!context) return

      const appError = toAppError(error, 'Failed to apply stop-contact')

      setStage(context.accountId, context.mutationId, 'failed', appError.message)

      // 409 FAILED_PRECONDITION carries the state/economic-gate reason
      // verbatim in the message — show it as-is, don't queue for retry.
      if (appError.statusCode === 409) {
        toast.error('Cannot apply stop-contact', { description: appError.message })
        return
      }

      if (appError.isSystemError()) {
        addFailedAction(
          'stop-contact',
          params.accountId,
          { reason: params.reason },
          appError.message,
          accountLabel,
        )
      }

      toast.error('Failed to apply stop-contact', {
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
                  action: 'stop-contact',
                  accountId: params.accountId,
                }),
            },
      })
    },
  })

  const applyStopContact = useCallback(
    (params: ApplyStopContactParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'stop-contact')
      mutation.mutate({ ...params, idempotencyKey })
    },
    [mutation],
  )

  const applyStopContactAsync = useCallback(
    async (params: ApplyStopContactParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'stop-contact')
      return mutation.mutateAsync({ ...params, idempotencyKey })
    },
    [mutation],
  )

  return {
    applyStopContact,
    applyStopContactAsync,
    isPending: mutation.isPending,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    isReadOnlyMode: readOnlyMode,
  }
}
