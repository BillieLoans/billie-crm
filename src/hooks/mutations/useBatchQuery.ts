import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface BatchQueryRequest {
  accountIds: string[]
  includeBalance?: boolean
  includeECL?: boolean
  includeAccrual?: boolean
  includeAging?: boolean
}

export interface BatchQueryAccountResult {
  accountId: string
  found: boolean
  balance?: {
    principal: number
    fees: number
    total: number
  }
  ecl?: {
    amount: number
    bucket: string
    pdRate: number
  }
  accrual?: {
    accruedAmount: number
    daysElapsed: number
    progress: number
  }
  aging?: {
    dpd: number
    bucket: string
  }
}

export interface BatchQueryResponse {
  results: BatchQueryAccountResult[]
  foundCount: number
  notFoundCount: number
}

/**
 * Mutation hook to query multiple accounts at once.
 *
 * @example
 * ```tsx
 * const { batchQuery, isPending, data } = useBatchQuery()
 *
 * const handleQuery = async () => {
 *   const results = await batchQuery({
 *     accountIds: ['acc-1', 'acc-2', 'acc-3'],
 *     includeBalance: true,
 *     includeECL: true
 *   })
 *   // results.results - array of account data
 * }
 * ```
 */
export function useBatchQuery() {
  const mutation = useMutation<BatchQueryResponse, Error, BatchQueryRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/investigation/batch-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        const errorMessage =
          (typeof error.details === 'string' && error.details) ||
          (typeof error.error === 'string' && error.error) ||
          (typeof error.error?.message === 'string' && error.error.message) ||
          error.message ||
          'Failed to execute batch query'
        throw new Error(errorMessage)
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success('Batch query complete', {
        description: `${data.foundCount} found, ${data.notFoundCount} not found.`,
      })
    },
    onError: (error) => {
      toast.error('Batch query failed', {
        description: `${error.message} — check the account IDs and try again.`,
      })
    },
  })

  return {
    batchQuery: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  }
}

export default useBatchQuery
