import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useOptimisticStore } from '@/stores/optimistic'
import { useUIStore } from '@/stores/ui'
import { generateIdempotencyKey } from '@/lib/utils/idempotency'
import { toAppError, parseApiError } from '@/lib/utils/error'
import { copyErrorDetails } from '@/lib/utils/error-toast'
import { fetchWithTimeout } from '@/lib/utils/fetch-with-timeout'
import type { PendingMutation } from '@/types/mutation'

export interface RecordDisbursementParams {
  loanAccountId: string
  disbursementAmount: string
  bankReference: string
  paymentMethod?: string
  notes?: string
}

export interface RecordDisbursementResponse {
  success: boolean
  transaction: {
    id: string
    accountId: string
    type: string
    description: string
  }
  eventId: string
}

async function recordDisbursement(params: RecordDisbursementParams): Promise<RecordDisbursementResponse> {
  const idempotencyKey = generateIdempotencyKey(params.loanAccountId, 'record-disbursement')

  const res = await fetchWithTimeout('/api/ledger/disbursement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loanAccountId: params.loanAccountId,
      disbursementAmount: params.disbursementAmount,
      bankReference: params.bankReference,
      paymentMethod: params.paymentMethod || 'bank_transfer',
      notes: params.notes,
      actualDisbursementAt: new Date().toISOString(),
      idempotencyKey,
    }),
  })

  if (!res.ok) {
    const appError = await parseApiError(res, 'Failed to record disbursement')
    throw appError
  }

  return res.json()
}

/**
 * Mutation hook for recording disbursements with optimistic UI.
 * 
 * Triggers the GAP-07 disbursement workflow: transitions account from
 * AWAITING_DISBURSEMENT to ACTIVE and starts accrual/ECL.
 */
export function useRecordDisbursement(loanAccountId?: string) {
  const queryClient = useQueryClient()
  const { setPending, setStage, clearPending, hasPendingAction } = useOptimisticStore()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const hasPendingDisbursement = loanAccountId ? hasPendingAction(loanAccountId, 'record-disbursement') : false

  const mutation = useMutation({
    mutationFn: recordDisbursement,

    onMutate: async (params) => {
      const mutationId = generateIdempotencyKey(params.loanAccountId, 'record-disbursement')
      const pendingMutation: PendingMutation = {
        id: mutationId,
        accountId: params.loanAccountId,
        action: 'record-disbursement',
        stage: 'optimistic',
        amount: parseFloat(params.disbursementAmount),
        createdAt: Date.now(),
      }
      setPending(params.loanAccountId, pendingMutation)
      return { mutationId, loanAccountId: params.loanAccountId }
    },

    onSuccess: (_data, params, context) => {
      if (!context) return
      setStage(context.loanAccountId, context.mutationId, 'confirmed')

      toast.success('Disbursement recorded', {
        description: `$${parseFloat(params.disbursementAmount).toFixed(2)} disbursed — account is now ACTIVE`,
      })

      queryClient.invalidateQueries({ queryKey: ['customer'] })
      queryClient.invalidateQueries({
        queryKey: ['transactions', params.loanAccountId],
      })

      setTimeout(() => {
        clearPending(context.loanAccountId, context.mutationId)
      }, 2000)
    },

    onError: (error, params, context) => {
      if (!context) return
      const appError = toAppError(error, 'Failed to record disbursement')
      setStage(context.loanAccountId, context.mutationId, 'failed', appError.message)

      toast.error('Failed to record disbursement', {
        description: appError.message,
        action: appError.isRetryable()
          ? {
              label: 'Retry',
              onClick: () => {
                clearPending(context.loanAccountId, context.mutationId)
                mutation.mutate(params)
              },
            }
          : {
              label: 'Copy details',
              onClick: () => copyErrorDetails(appError, {
                action: 'record-disbursement',
                accountId: params.loanAccountId,
              }),
            },
      })
    },
  })

  const triggerDisbursement = useCallback(
    (params: RecordDisbursementParams) => {
      mutation.mutate(params)
    },
    [mutation]
  )

  return {
    triggerDisbursement,
    isPending: mutation.isPending,
    isReadOnlyMode: readOnlyMode,
    hasPendingDisbursement,
  }
}
