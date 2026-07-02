/**
 * Flag Hardship Mutation Hook — Collections operator action (BTB-198 WS5)
 *
 * POSTs `/api/collections/actions/flag-hardship`, a synchronous gRPC
 * command against the headless collections engine. Thin wrapper around the
 * shared `useCollectionsAction` factory (C7 review) — see
 * `useCollectionsAction.ts` for the onMutate/onSuccess/onError machinery,
 * and the deliberate deltas from `useWaiveFee` (no version-store wiring,
 * no `billie-retry-action` listener).
 */

import { useCallback } from 'react'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
import { useCollectionsAction } from './useCollectionsAction'

export interface FlagHardshipParams {
  accountId: string
  reason: string
}

/**
 * Mutation hook for flagging a collections case as hardship-paused.
 *
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345").
 */
export function useFlagHardship(accountLabel?: string) {
  const { mutate, mutateAsync, isPending, isSuccess, isError, error, isReadOnlyMode } =
    useCollectionsAction<FlagHardshipParams>(
      {
        action: 'flag-hardship',
        endpoint: '/api/collections/actions/flag-hardship',
        defaultErrorMessage: 'Failed to flag hardship',
        buildBody: (params, idempotencyKey) => ({
          accountId: params.accountId,
          reason: params.reason,
          idempotencyKey,
        }),
        buildSuccessToast: (params) => ({
          title: 'Hardship flagged',
          description: `Case ${params.accountId} is now paused for hardship.`,
        }),
        cannotToastTitle: 'Cannot flag hardship',
        buildFailedActionPayload: (params) => ({ reason: params.reason }),
      },
      accountLabel,
    )

  const flagHardship = useCallback(
    (params: FlagHardshipParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'flag-hardship')
      mutate({ ...params, idempotencyKey })
    },
    [mutate],
  )

  const flagHardshipAsync = useCallback(
    async (params: FlagHardshipParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'flag-hardship')
      return mutateAsync({ ...params, idempotencyKey })
    },
    [mutateAsync],
  )

  return {
    flagHardship,
    flagHardshipAsync,
    isPending,
    isLoading: isPending,
    isSuccess,
    isError,
    error,
    isReadOnlyMode,
  }
}
