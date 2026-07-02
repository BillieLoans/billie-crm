/**
 * Apply Stop-Contact Mutation Hook — Collections operator action (BTB-198 WS5)
 *
 * POSTs `/api/collections/actions/stop-contact`, a synchronous gRPC
 * command against the headless collections engine (dispute, deceased,
 * legal, etc.). Thin wrapper around the shared `useCollectionsAction`
 * factory (C7 review) — see `useCollectionsAction.ts` for the
 * onMutate/onSuccess/onError machinery, and `useFlagHardship.ts` for the
 * deliberate deltas from `useWaiveFee` (no version-store wiring, no
 * `billie-retry-action` listener).
 */

import { useCallback } from 'react'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
import { useCollectionsAction } from './useCollectionsAction'

export interface ApplyStopContactParams {
  accountId: string
  reason?: string
}

/**
 * Mutation hook for applying a stop-contact flag to a collections case.
 *
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345").
 */
export function useApplyStopContact(accountLabel?: string) {
  const { mutate, mutateAsync, isPending, isSuccess, isError, error, isReadOnlyMode } =
    useCollectionsAction<ApplyStopContactParams>(
      {
        action: 'stop-contact',
        endpoint: '/api/collections/actions/stop-contact',
        defaultErrorMessage: 'Failed to apply stop-contact',
        buildBody: (params, idempotencyKey) => ({
          accountId: params.accountId,
          reason: params.reason,
          idempotencyKey,
        }),
        buildSuccessToast: (params) => ({
          title: 'Stop-contact applied',
          description: `Contact halted for case ${params.accountId}.`,
        }),
        cannotToastTitle: 'Cannot apply stop-contact',
        buildFailedActionPayload: (params) => ({ reason: params.reason }),
      },
      accountLabel,
    )

  const applyStopContact = useCallback(
    (params: ApplyStopContactParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'stop-contact')
      mutate({ ...params, idempotencyKey })
    },
    [mutate],
  )

  const applyStopContactAsync = useCallback(
    async (params: ApplyStopContactParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'stop-contact')
      return mutateAsync({ ...params, idempotencyKey })
    },
    [mutateAsync],
  )

  return {
    applyStopContact,
    applyStopContactAsync,
    isPending,
    isLoading: isPending,
    isSuccess,
    isError,
    error,
    isReadOnlyMode,
  }
}
