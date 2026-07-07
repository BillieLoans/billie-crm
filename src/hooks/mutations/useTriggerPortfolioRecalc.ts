import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

interface TriggerRecalcRequest {
  triggeredBy: string
  accountIds?: string[] // Optional - if provided, only recalc these accounts
}

interface TriggerRecalcResponse {
  success: boolean
  jobId: string
  accountCount: number
  status: 'queued' | 'processing' | 'completed' | 'failed'
  startedAt?: string
  completedAt?: string
  error?: string
}

/**
 * Mutation hook to trigger portfolio ECL recalculation.
 *
 * @example
 * ```tsx
 * const { triggerRecalc, isPending } = useTriggerPortfolioRecalc()
 *
 * const handleRecalc = async () => {
 *   const result = await triggerRecalc({
 *     triggeredBy: userId
 *   })
 *   // Poll for completion using result.jobId
 * }
 * ```
 */
export function useTriggerPortfolioRecalc() {
  const queryClient = useQueryClient()

  const mutation = useMutation<TriggerRecalcResponse, Error, TriggerRecalcRequest>({
    mutationFn: async (request) => {
      const endpoint = request.accountIds
        ? '/api/ledger/ecl/recalc/bulk'
        : '/api/ledger/ecl/recalc/portfolio'

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        const errorMessage =
          error.error ||
          error.message ||
          error.details ||
          `HTTP ${res.status}: Failed to trigger recalculation`
        throw new Error(errorMessage)
      }
      return res.json()
    },
    onSuccess: (data) => {
      // Invalidate portfolio ECL data after recalc starts
      queryClient.invalidateQueries({ queryKey: ['portfolio-ecl'] })

      // Show success toast
      toast.success('ECL recalculation started', {
        description: `Processing ${data.accountCount} accounts`,
      })
    },
    onError: (error) => {
      // Show error toast
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to trigger recalculation'
      toast.error('Failed to trigger recalculation', {
        description: errorMessage,
      })
    },
  })

  return {
    triggerRecalc: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  }
}

export default useTriggerPortfolioRecalc
