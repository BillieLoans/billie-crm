import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

interface AcknowledgeRequest {
  previewId: string
  anomalyId: string
  acknowledgedBy: string
}

interface AcknowledgeResponse {
  success: boolean
  errorMessage?: string
  allAnomaliesAcknowledged: boolean
}

/**
 * Mutation hook to acknowledge an anomaly in a period close preview.
 *
 * @example
 * ```tsx
 * const { acknowledgeAnomaly, isPending } = useAcknowledgeAnomaly()
 *
 * const handleAcknowledge = async (anomalyId: string) => {
 *   await acknowledgeAnomaly({
 *     previewId,
 *     anomalyId,
 *     acknowledgedBy: userId
 *   })
 * }
 * ```
 */
export function useAcknowledgeAnomaly() {
  const mutation = useMutation<AcknowledgeResponse, Error, AcknowledgeRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/period-close/acknowledge-anomaly', {
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
          'Failed to acknowledge anomaly'
        throw new Error(errorMessage)
      }
      const body: AcknowledgeResponse = await res.json()
      if (body.success === false) {
        throw new Error(body.errorMessage || 'Failed to acknowledge anomaly')
      }
      return body
    },
    onSuccess: (data) => {
      toast.success('Anomaly acknowledged', {
        description: data.allAnomaliesAcknowledged
          ? 'All anomalies have been reviewed — the period is ready to finalise.'
          : 'This anomaly will no longer block finalising the period.',
      })
    },
    onError: (error) => {
      toast.error('Failed to acknowledge anomaly', {
        description: `${error.message} — try again, or contact support if it persists.`,
      })
    },
  })

  return {
    acknowledgeAnomaly: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}

export default useAcknowledgeAnomaly
