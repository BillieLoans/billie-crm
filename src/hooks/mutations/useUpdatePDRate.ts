import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { eclConfigQueryKey } from '@/hooks/queries/useECLConfig'

interface UpdatePDRateRequest {
  bucket: string
  rate: number
  updatedBy: string
  reason?: string
}

interface UpdatePDRateResponse {
  success: boolean
  bucket: string
  newRate: number
  previousRate: number
  updatedAt: string
}

/**
 * Mutation hook to update a PD rate for a specific bucket.
 *
 * @example
 * ```tsx
 * const { updatePDRate, isPending } = useUpdatePDRate()
 *
 * const handleUpdate = async () => {
 *   await updatePDRate({
 *     bucket: 'EARLY_ARREARS',
 *     rate: 0.08,
 *     updatedBy: userId,
 *     reason: 'Annual review adjustment'
 *   })
 * }
 * ```
 */
export function useUpdatePDRate() {
  const queryClient = useQueryClient()

  const mutation = useMutation<UpdatePDRateResponse, Error, UpdatePDRateRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/ecl-config/pd-rate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to update PD rate')
      }
      return res.json()
    },
    onSuccess: (data) => {
      // Invalidate ECL config to refresh data
      queryClient.invalidateQueries({ queryKey: eclConfigQueryKey })
      queryClient.invalidateQueries({ queryKey: ['ecl-config', 'history'] })

      // Show success toast
      toast.success('PD rate updated', {
        description: `Bucket "${data.bucket}" rate updated to ${(data.newRate * 100).toFixed(2)}%`,
      })
    },
    onError: (error) => {
      // Show error toast
      const errorMessage = error instanceof Error ? error.message : 'Failed to update PD rate'
      toast.error('Failed to update PD rate', {
        description: errorMessage,
      })
    },
  })

  return {
    updatePDRate: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  }
}

export default useUpdatePDRate
