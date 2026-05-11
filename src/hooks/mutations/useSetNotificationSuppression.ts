import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import type { SuppressionMode } from '@/lib/notifications/suppression'
import {
  suppressionQueryKey,
  type SuppressionData,
} from '@/hooks/queries/useNotificationSuppression'

export interface SetSuppressionParams {
  customerId: string
  mode: SuppressionMode
  reason: string
  /** ISO 8601. Omit or null for indefinite. */
  expiresAt?: string | null
}

interface SetSuppressionResponse {
  suppression: SuppressionData
}

const MODE_LABELS: Record<SuppressionMode, string> = {
  all: 'all notifications paused',
  non_essential: 'non-essential notifications paused',
  marketing_only: 'marketing notifications paused',
}

async function setSuppression(params: SetSuppressionParams): Promise<SuppressionData> {
  const res = await fetch('/api/notifications/suppression', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerId: params.customerId,
      mode: params.mode,
      reason: params.reason.trim(),
      expiresAt: params.expiresAt ?? null,
    }),
  })

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: { message: 'Failed to update notification suppression' } }))
    throw new Error(err.error?.message || 'Failed to update notification suppression')
  }

  const data: SetSuppressionResponse = await res.json()
  return data.suppression
}

export function useSetNotificationSuppression() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: setSuppression,
    retry: 0,

    onSuccess: (data) => {
      toast.success(`Notifications updated — ${MODE_LABELS[data.mode ?? 'non_essential']}`, {
        description: data.reason ? `Reason: ${data.reason}` : undefined,
      })
      queryClient.invalidateQueries({ queryKey: suppressionQueryKey(data.customerId) })
    },

    onError: (error) => {
      showErrorToast(error, {
        title: 'Failed to update notification controls',
        action: 'set-notification-suppression',
      })
    },
  })

  return {
    setSuppression: mutation.mutate,
    setSuppressionAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
