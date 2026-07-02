/**
 * Advance To Next Step Mutation Hook — Collections operator action (BTB-198 WS5)
 *
 * POSTs `/api/collections/actions/advance`, a synchronous gRPC command
 * against the headless collections engine. This is the human escalation
 * gate (requires approval authority, not just servicing access, on the
 * route side); FAILED_PRECONDITION → 409 also covers the cost-of-recovery
 * economic gate (BTB-194, once deployed) — the reason arrives verbatim in
 * the error message. See useFlagHardship.ts for the deliberate deltas from
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

export interface AdvanceToNextStepParams {
  accountId: string
}

interface AdvanceToNextStepRequest extends AdvanceToNextStepParams {
  idempotencyKey: string
}

async function advanceToNextStepRequest(
  params: AdvanceToNextStepRequest,
): Promise<CollectionsActionResult> {
  const res = await fetchWithTimeout('/api/collections/actions/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId: params.accountId,
      idempotencyKey: params.idempotencyKey,
    }),
  })

  if (!res.ok) {
    throw await parseCollectionsActionError(res, 'Failed to advance case')
  }

  const data = await res.json()
  return data.result as CollectionsActionResult
}

/**
 * Mutation hook for advancing a collections case to its next escalation
 * rung.
 *
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345").
 */
export function useAdvanceToNextStep(accountLabel?: string) {
  const queryClient = useQueryClient()
  const { setPending, setStage, clearPending } = useOptimisticStore()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const addFailedAction = useFailedActionsStore((state) => state.addFailedAction)

  const mutation = useMutation({
    mutationFn: advanceToNextStepRequest,

    onMutate: async (params) => {
      const pendingMutation: PendingMutation = {
        id: params.idempotencyKey,
        accountId: params.accountId,
        action: 'advance-step',
        stage: 'optimistic',
        createdAt: Date.now(),
      }

      setPending(params.accountId, pendingMutation)

      return { mutationId: params.idempotencyKey, accountId: params.accountId }
    },

    onSuccess: (data, params, context) => {
      if (!context) return

      setStage(context.accountId, context.mutationId, 'confirmed')

      toast.success('Case advanced', {
        description: `Case ${params.accountId} moved to ${data.newState}.`,
      })

      queryClient.invalidateQueries({ queryKey: ['collections-cases'] })

      setTimeout(() => {
        clearPending(context.accountId, context.mutationId)
      }, 2000)
    },

    onError: (error, params, context) => {
      if (!context) return

      const appError = toAppError(error, 'Failed to advance case')

      setStage(context.accountId, context.mutationId, 'failed', appError.message)

      // 409 FAILED_PRECONDITION carries the state/economic-gate reason
      // verbatim in the message — show it as-is, don't queue for retry.
      if (appError.statusCode === 409) {
        toast.error('Cannot advance case', { description: appError.message })
        return
      }

      if (appError.isSystemError()) {
        addFailedAction('advance-step', params.accountId, {}, appError.message, accountLabel)
      }

      toast.error('Failed to advance case', {
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
                  action: 'advance-step',
                  accountId: params.accountId,
                }),
            },
      })
    },
  })

  const advanceToNextStep = useCallback(
    (params: AdvanceToNextStepParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'advance-step')
      mutation.mutate({ ...params, idempotencyKey })
    },
    [mutation],
  )

  const advanceToNextStepAsync = useCallback(
    async (params: AdvanceToNextStepParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'advance-step')
      return mutation.mutateAsync({ ...params, idempotencyKey })
    },
    [mutation],
  )

  return {
    advanceToNextStep,
    advanceToNextStepAsync,
    isPending: mutation.isPending,
    isLoading: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    isReadOnlyMode: readOnlyMode,
  }
}
