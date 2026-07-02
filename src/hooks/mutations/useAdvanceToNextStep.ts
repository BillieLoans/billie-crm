/**
 * Advance To Next Step Mutation Hook — Collections operator action (BTB-198 WS5)
 *
 * POSTs `/api/collections/actions/advance`, a synchronous gRPC command
 * against the headless collections engine. This is the human escalation
 * gate (requires approval authority, not just servicing access, on the
 * route side); FAILED_PRECONDITION → 409 also covers the cost-of-recovery
 * economic gate (BTB-194, once deployed) — the reason arrives verbatim in
 * the error message. Thin wrapper around the shared `useCollectionsAction`
 * factory (C7 review) — see `useCollectionsAction.ts` for the
 * onMutate/onSuccess/onError machinery, and `useFlagHardship.ts` for the
 * deliberate deltas from `useWaiveFee` (no version-store wiring, no
 * `billie-retry-action` listener).
 */

import { useCallback } from 'react'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
import { useCollectionsAction } from './useCollectionsAction'

export interface AdvanceToNextStepParams {
  accountId: string
}

/**
 * Mutation hook for advancing a collections case to its next escalation
 * rung.
 *
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345").
 */
export function useAdvanceToNextStep(accountLabel?: string) {
  const { mutate, mutateAsync, isPending, isSuccess, isError, error, isReadOnlyMode } =
    useCollectionsAction<AdvanceToNextStepParams>(
      {
        action: 'advance-step',
        endpoint: '/api/collections/actions/advance',
        defaultErrorMessage: 'Failed to advance case',
        buildBody: (params, idempotencyKey) => ({
          accountId: params.accountId,
          idempotencyKey,
        }),
        buildSuccessToast: (params, data) => ({
          title: 'Case advanced',
          description: `Case ${params.accountId} moved to ${data.newState}.`,
        }),
        cannotToastTitle: 'Cannot advance case',
        buildFailedActionPayload: () => ({}),
      },
      accountLabel,
    )

  const advanceToNextStep = useCallback(
    (params: AdvanceToNextStepParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'advance-step')
      mutate({ ...params, idempotencyKey })
    },
    [mutate],
  )

  const advanceToNextStepAsync = useCallback(
    async (params: AdvanceToNextStepParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'advance-step')
      return mutateAsync({ ...params, idempotencyKey })
    },
    [mutateAsync],
  )

  return {
    advanceToNextStep,
    advanceToNextStepAsync,
    isPending,
    isLoading: isPending,
    isSuccess,
    isError,
    error,
    isReadOnlyMode,
  }
}
