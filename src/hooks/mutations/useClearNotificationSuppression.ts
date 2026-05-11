import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import { suppressionQueryKey } from '@/hooks/queries/useNotificationSuppression'

export interface ClearSuppressionParams {
  customerId: string
}

interface ClearSuppressionResponse {
  customerId: string
  cleared: boolean
}

async function clearSuppression(params: ClearSuppressionParams): Promise<ClearSuppressionResponse> {
  const res = await fetch(
    `/api/notifications/suppression?customerId=${encodeURIComponent(params.customerId)}`,
    { method: 'DELETE' },
  )

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: { message: 'Failed to re-enable notifications' } }))
    throw new Error(err.error?.message || 'Failed to re-enable notifications')
  }

  return res.json()
}

export function useClearNotificationSuppression() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: clearSuppression,
    retry: 0,

    onSuccess: (data) => {
      if (data.cleared) {
        toast.success('Notifications re-enabled', {
          description: 'This customer will receive notifications normally again.',
        })
      } else {
        toast.info('No active suppression to clear')
      }
      queryClient.invalidateQueries({ queryKey: suppressionQueryKey(data.customerId) })
    },

    onError: (error) => {
      showErrorToast(error, {
        title: 'Failed to re-enable notifications',
        action: 'clear-notification-suppression',
      })
    },
  })

  return {
    clearSuppression: mutation.mutate,
    clearSuppressionAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
