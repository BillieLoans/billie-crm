import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

export interface RandomSampleRequest {
  sampleSize: number
  seed?: number // Optional seed for reproducibility
  filters?: {
    bucket?: string
    minECL?: number
    maxECL?: number
    minCarryingAmount?: number
    maxCarryingAmount?: number
    minDPD?: number
    maxDPD?: number
  }
}

export interface RandomSampleResponse {
  accountIds: string[]
  sampleSize: number
  seed: number
  matchingAccountCount: number
  filters: RandomSampleRequest['filters']
}

/**
 * Mutation hook to generate a random sample of accounts.
 *
 * @example
 * ```tsx
 * const { generateSample, isPending, data } = useRandomSample()
 *
 * const handleSample = async () => {
 *   const result = await generateSample({
 *     sampleSize: 100,
 *     filters: { bucket: 'EARLY_ARREARS' }
 *   })
 *   // result.accountIds - array of sampled account IDs
 * }
 * ```
 */
export function useRandomSample() {
  const mutation = useMutation<RandomSampleResponse, Error, RandomSampleRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/investigation/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to generate sample')
      }
      return res.json()
    },
    onSuccess: (data) => {
      const count = data.accountIds.length
      toast.success('Sample generated', {
        description: `${count} of ${data.matchingAccountCount} matching accounts sampled.`,
      })
    },
    onError: (error) => {
      toast.error('Failed to generate sample', {
        description: `${error.message} — check the sample size and filters, then try again.`,
      })
    },
  })

  return {
    generateSample: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  }
}

export default useRandomSample
