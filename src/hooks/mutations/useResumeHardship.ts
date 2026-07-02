/**
 * Resume Hardship Mutation Hook — Collections operator action (BTB-198 WS5)
 *
 * POSTs `/api/collections/actions/resume-hardship`, a synchronous gRPC
 * command against the headless collections engine. Thin wrapper around the
 * shared `useCollectionsAction` factory (C7 review) — see
 * `useCollectionsAction.ts` for the onMutate/onSuccess/onError machinery,
 * and `useFlagHardship.ts` for the deliberate deltas from `useWaiveFee`
 * (no version-store wiring, no `billie-retry-action` listener).
 */

import { useCallback } from 'react'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
import { useCollectionsAction } from './useCollectionsAction'

export interface ResumeHardshipParams {
  accountId: string
}

/**
 * Mutation hook for resuming a hardship-paused collections case.
 *
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345").
 */
export function useResumeHardship(accountLabel?: string) {
  const { mutate, mutateAsync, isPending, isSuccess, isError, error, isReadOnlyMode } =
    useCollectionsAction<ResumeHardshipParams>(
      {
        action: 'resume-hardship',
        endpoint: '/api/collections/actions/resume-hardship',
        defaultErrorMessage: 'Failed to resume hardship',
        buildBody: (params, idempotencyKey) => ({
          accountId: params.accountId,
          idempotencyKey,
        }),
        buildSuccessToast: (params) => ({
          title: 'Hardship resumed',
          description: `Case ${params.accountId} resumed from hardship pause.`,
        }),
        cannotToastTitle: 'Cannot resume hardship',
        buildFailedActionPayload: () => ({}),
      },
      accountLabel,
    )

  const resumeHardship = useCallback(
    (params: ResumeHardshipParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'resume-hardship')
      mutate({ ...params, idempotencyKey })
    },
    [mutate],
  )

  const resumeHardshipAsync = useCallback(
    async (params: ResumeHardshipParams) => {
      const idempotencyKey = generateIdempotencyKey(params.accountId, 'resume-hardship')
      return mutateAsync({ ...params, idempotencyKey })
    },
    [mutateAsync],
  )

  return {
    resumeHardship,
    resumeHardshipAsync,
    isPending,
    isLoading: isPending,
    isSuccess,
    isError,
    error,
    isReadOnlyMode,
  }
}
