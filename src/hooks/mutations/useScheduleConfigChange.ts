import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pendingConfigChangesQueryKey } from '@/hooks/queries/usePendingConfigChanges'

interface ScheduleConfigChangeRequest {
  parameter: 'overlay_multiplier' | 'pd_rate' | 'lgd'
  bucket?: string // Required for pd_rate changes
  newValue: number
  effectiveDate: string // ISO date
  createdBy: string
  reason?: string
}

interface ScheduleConfigChangeResponse {
  success: boolean
  changeId: string
  effectiveDate: string
}

/**
 * Mutation hook to schedule a future ECL config change.
 *
 * @example
 * ```tsx
 * const { scheduleChange, isPending } = useScheduleConfigChange()
 *
 * const handleSchedule = async () => {
 *   await scheduleChange({
 *     parameter: 'overlay_multiplier',
 *     newValue: 1.3,
 *     effectiveDate: '2026-02-01',
 *     createdBy: userId,
 *     reason: 'Quarterly adjustment'
 *   })
 * }
 * ```
 */
export function useScheduleConfigChange() {
  const queryClient = useQueryClient()

  const mutation = useMutation<ScheduleConfigChangeResponse, Error, ScheduleConfigChangeRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/ecl-config/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        const errorMessage =
          error.error ||
          error.message ||
          error.details ||
          `HTTP ${res.status}: Failed to schedule config change`
        throw new Error(errorMessage)
      }
      return res.json()
    },
    onSuccess: () => {
      // Invalidate pending changes to refresh list
      queryClient.invalidateQueries({ queryKey: pendingConfigChangesQueryKey })
    },
  })

  return {
    scheduleChange: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  }
}

export default useScheduleConfigChange
