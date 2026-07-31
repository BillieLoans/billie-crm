import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { pendingConfigChangesQueryKey } from '@/hooks/queries/usePendingConfigChanges'

interface CancelConfigChangeRequest {
  changeId: string
  cancelledBy: string
}

interface CancelConfigChangeResponse {
  success: boolean
  changeId: string
  cancelledAt: string
}

/**
 * Mutation hook to cancel a pending ECL config change.
 *
 * @example
 * ```tsx
 * const { cancelChange, isPending } = useCancelConfigChange()
 *
 * const handleCancel = async () => {
 *   await cancelChange({
 *     changeId: 'change-123',
 *     cancelledBy: userId
 *   })
 * }
 * ```
 */
export function useCancelConfigChange() {
  const queryClient = useQueryClient()

  const mutation = useMutation<CancelConfigChangeResponse, Error, CancelConfigChangeRequest>({
    mutationFn: async (request) => {
      const res = await fetch(`/api/ecl-config/pending/${request.changeId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelledBy: request.cancelledBy }),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to cancel config change')
      }
      return res.json()
    },
    onSuccess: () => {
      // Invalidate pending changes to refresh list
      queryClient.invalidateQueries({ queryKey: pendingConfigChangesQueryKey })

      toast.success('Scheduled change cancelled', {
        description: 'This change will no longer take effect.',
      })
    },
    onError: (error) => {
      toast.error('Failed to cancel scheduled change', {
        description: `${error.message} — try again.`,
      })
    },
  })

  return {
    cancelChange: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}

export default useCancelConfigChange
