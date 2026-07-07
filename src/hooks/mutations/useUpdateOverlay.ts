import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { eclConfigQueryKey } from '@/hooks/queries/useECLConfig'

interface UpdateOverlayRequest {
  value: number
  updatedBy: string
  reason?: string
}

interface UpdateOverlayResponse {
  success: boolean
  newValue: number
  previousValue: number
  updatedAt: string
}

/**
 * Mutation hook to update the ECL overlay multiplier.
 *
 * @example
 * ```tsx
 * const { updateOverlay, isPending } = useUpdateOverlay()
 *
 * const handleUpdate = async () => {
 *   await updateOverlay({
 *     value: 1.25,
 *     updatedBy: userId,
 *     reason: 'Market conditions adjustment'
 *   })
 * }
 * ```
 */
export function useUpdateOverlay() {
  const queryClient = useQueryClient()

  const mutation = useMutation<UpdateOverlayResponse, Error, UpdateOverlayRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/ecl-config/overlay', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        const errorMessage =
          error.error ||
          error.message ||
          error.details ||
          `HTTP ${res.status}: Failed to update overlay multiplier`
        throw new Error(errorMessage)
      }
      return res.json()
    },
    onSuccess: (data) => {
      // Invalidate ECL config to refresh data
      queryClient.invalidateQueries({ queryKey: eclConfigQueryKey })
      queryClient.invalidateQueries({ queryKey: ['ecl-config', 'history'] })

      // Show success toast
      toast.success('Overlay multiplier updated', {
        description: `Overlay multiplier updated to ${data.newValue.toFixed(2)}x`,
      })
    },
    onError: (error) => {
      // Show error toast
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to update overlay multiplier'
      toast.error('Failed to update overlay multiplier', {
        description: errorMessage,
      })
    },
  })

  return {
    updateOverlay: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  }
}

export default useUpdateOverlay
