import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDateOnly } from '@/lib/formatters'

/** Guards formatDateOnly, which throws on '' / unparseable input (Intl.DateTimeFormat
 *  rejects an Invalid Date) — period-close-mapper.ts defaults periodDate to '' when the
 *  gRPC response omits it, so this is a reachable case, not just defensive paranoia. */
const isValidDateString = (value: string): boolean =>
  value !== '' && !Number.isNaN(new Date(value).getTime())

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
        const errorMessage =
          (typeof error.details === 'string' && error.details) ||
          error.error ||
          error.message ||
          'Failed to finalize period close'
        throw new Error(errorMessage)
      }
      return res.json()
    },
    onSuccess: (data) => {
      // Invalidate closed periods to refresh history
      queryClient.invalidateQueries({ queryKey: ['period-close', 'history'] })

      toast.success('Period closed', {
        description: isValidDateString(data.periodDate)
          ? `Period ${formatDateOnly(data.periodDate)} is now closed.`
          : 'The period is now closed.',
      })
    },
    onError: (error) => {
      toast.error('Failed to close period', {
        description: `${error.message} — check the preview and anomaly status, then retry.`,
      })
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
