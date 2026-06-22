import { useMutation, useQueryClient } from '@tanstack/react-query'

interface FinalizeRequest {
  previewId: string
  finalizedBy: string
}

export interface GeneratedJournalEntry {
  id: string
  type: string
  description: string
  debitAccount: string
  creditAccount: string
  amount: number
  createdAt: string
}

export interface FinalizeResponse {
  success: boolean
  periodDate: string
  finalizedAt: string
  journalEntries: GeneratedJournalEntry[]
  totalAccounts: number
  totalECLAllowance: number
  totalAccruedYield: number
}

/**
 * Mutation hook to finalize a period close.
 *
 * @example
 * ```tsx
 * const { finalizePeriodClose, isPending } = useFinalizePeriodClose()
 *
 * const handleFinalize = async () => {
 *   const result = await finalizePeriodClose({
 *     previewId,
 *     finalizedBy: userId
 *   })
 *   // Show success with result.journalEntries
 * }
 * ```
 */
export function useFinalizePeriodClose() {
  const queryClient = useQueryClient()

  const mutation = useMutation<FinalizeResponse, Error, FinalizeRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/period-close/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to finalize period close')
      }
      return res.json()
    },
    onSuccess: () => {
      // Invalidate closed periods to refresh history
      queryClient.invalidateQueries({ queryKey: ['period-close', 'history'] })
    },
  })

  return {
    finalizePeriodClose: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  }
}

export default useFinalizePeriodClose
