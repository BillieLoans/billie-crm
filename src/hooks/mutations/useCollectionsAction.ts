/**
 * Shared internal factory for the Collections operator action mutation
 * hooks (BTB-198 WS5: useFlagHardship, useResumeHardship,
 * useApplyStopContact, useAdvanceToNextStep — C7 review).
 *
 * All four hooks were an identical ~150-190 line copy-paste of
 * onMutate-stage / onSuccess-toast+invalidate+clearPending /
 * onError-409-verbatim-toast+system-error-addFailedAction, differing only
 * by action name, URL, request-body shape, and toast copy. This factory
 * captures the shared machinery; each hook file now only supplies its
 * per-action config and maps the factory's generic return onto its own
 * public API (which must stay byte-identical — see collections-mutations
 * tests).
 *
 * NOT exported from `./index.ts` or `@/hooks` — internal to this
 * directory, consumed only by the four hook files above.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useOptimisticStore } from '@/stores/optimistic'
import { useUIStore } from '@/stores/ui'
import { useFailedActionsStore, type FailedActionType } from '@/stores/failed-actions'
import { toAppError } from '@/lib/utils/error'
import { copyErrorDetails } from '@/lib/utils/error-toast'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import { parseCollectionsActionError } from '@/lib/collections/action-error-client'
import { ERROR_CODES } from '@/lib/errors/codes'
import type { PendingMutation } from '@/types/mutation'
import type { CollectionsActionResult } from '@/types/collections'

/** Variables passed into the underlying mutation: the hook's own params
 * plus the caller-generated idempotency key. */
type CollectionsMutationVariables<TParams> = TParams & { idempotencyKey: string }

/** Optimistic-store staging context threaded from onMutate to onSuccess/onError. */
interface CollectionsMutationContext {
  mutationId: string
  accountId: string
}

export interface CollectionsActionConfig<TParams extends { accountId: string }> {
  /** `FailedActionType` value + `PendingMutation.action` string for this action. */
  action: FailedActionType
  /** POST endpoint for the action (e.g. `/api/collections/actions/flag-hardship`). */
  endpoint: string
  /**
   * Default/fallback error message. All four original hooks used the exact
   * same string in three places — the `parseCollectionsActionError`
   * fallback, the `toAppError` fallback, and the generic (non-409) error
   * toast title — so one config field covers all three.
   */
  defaultErrorMessage: string
  /** Builds the JSON request body from params + the generated idempotencyKey. */
  buildBody: (params: TParams, idempotencyKey: string) => Record<string, unknown>
  /** Builds the success toast title/description from params + the mutation result. */
  buildSuccessToast: (
    params: TParams,
    data: CollectionsActionResult,
  ) => { title: string; description: string }
  /** Toast title shown on a 409 FAILED_PRECONDITION (server message shown verbatim). */
  cannotToastTitle: string
  /** Builds the `params` payload recorded on the failed-actions queue. */
  buildFailedActionPayload: (params: TParams) => Record<string, unknown>
}

/**
 * Shared mutation machinery for a single Collections operator action.
 *
 * @param config - Per-action wiring (endpoint, body shape, toast copy).
 * @param accountLabel - Optional human-readable account label attached to
 *   failed actions (e.g. "LOAN-12345"), forwarded from the calling hook.
 */
export function useCollectionsAction<TParams extends { accountId: string }>(
  config: CollectionsActionConfig<TParams>,
  accountLabel?: string,
) {
  const queryClient = useQueryClient()
  const { setPending, setStage, clearPending } = useOptimisticStore()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const addFailedAction = useFailedActionsStore((state) => state.addFailedAction)

  const mutation = useMutation<
    CollectionsActionResult,
    unknown,
    CollectionsMutationVariables<TParams>,
    CollectionsMutationContext | undefined
  >({
    mutationFn: async (params) => {
      const res = await fetchWithTimeout(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config.buildBody(params, params.idempotencyKey)),
      })

      if (!res.ok) {
        throw await parseCollectionsActionError(res, config.defaultErrorMessage)
      }

      const data = await res.json()
      return data.result as CollectionsActionResult
    },

    onMutate: async (params) => {
      const pendingMutation: PendingMutation = {
        id: params.idempotencyKey,
        accountId: params.accountId,
        action: config.action,
        stage: 'optimistic',
        createdAt: Date.now(),
      }

      setPending(params.accountId, pendingMutation)

      return { mutationId: params.idempotencyKey, accountId: params.accountId }
    },

    onSuccess: (data, params, context) => {
      if (!context) return

      setStage(context.accountId, context.mutationId, 'confirmed')

      const { title, description } = config.buildSuccessToast(params, data)
      toast.success(title, { description })

      queryClient.invalidateQueries({ queryKey: ['collections-cases'] })

      setTimeout(() => {
        clearPending(context.accountId, context.mutationId)
      }, 2000)
    },

    onError: (error, params, context) => {
      if (!context) return

      const appError = toAppError(error, config.defaultErrorMessage)

      setStage(context.accountId, context.mutationId, 'failed', appError.message)

      // 409 FAILED_PRECONDITION carries the state/economic-gate reason
      // verbatim in the message — show it as-is, don't queue for retry.
      if (appError.statusCode === 409) {
        toast.error(config.cannotToastTitle, { description: appError.message })
        return
      }

      if (appError.isSystemError()) {
        addFailedAction(
          config.action,
          params.accountId,
          config.buildFailedActionPayload(params),
          appError.message,
          accountLabel,
        )
      }

      toast.error(config.defaultErrorMessage, {
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
                  action: config.action,
                  accountId: params.accountId,
                }),
            },
      })
    },
  })

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    isReadOnlyMode: readOnlyMode,
  }
}
