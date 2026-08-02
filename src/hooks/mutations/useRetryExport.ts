import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { exportJobsQueryKey } from '@/hooks/queries/useExportJobs'

export interface RetryExportResponse {
  success: boolean
  jobId: string
  status: 'pending' | 'processing'
}

/**
 * Mutation hook to retry a failed export job.
 *
 * @example
 * ```tsx
 * const { retryExport, isPending } = useRetryExport()
 *
 * const handleRetry = async () => {
 *   await retryExport('job-123')
 * }
 * ```
 */
export function useRetryExport() {
  const queryClient = useQueryClient()

  const mutation = useMutation<RetryExportResponse, Error, string>({
    mutationFn: async (jobId) => {
      const res = await fetch(`/api/export/jobs/${jobId}/retry`, {
        method: 'POST',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        const errorMessage =
          (typeof error.details === 'string' && error.details) ||
          (typeof error.error === 'string' && error.error) ||
          (typeof error.error?.message === 'string' && error.error.message) ||
          error.message ||
          'Failed to retry export'
        throw new Error(errorMessage)
      }
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: exportJobsQueryKey })

      toast.success('Export retry started', {
        description: `Export ${data.jobId} has been queued for retry.`,
      })
    },
    onError: (error) => {
      toast.error('Failed to retry export', {
        description: `${error.message} — try again, or contact support if it persists.`,
      })
    },
  })

  return {
    retryExport: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}

export default useRetryExport
