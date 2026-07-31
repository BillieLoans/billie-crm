import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { formatDateOnly } from '@/lib/formatters'
import { pendingConfigChangesQueryKey } from '@/hooks/queries/usePendingConfigChanges'

/** Guards formatDateOnly, which throws on '' / unparseable input (Intl.DateTimeFormat
 *  rejects an Invalid Date) — effectiveDate is server-validated as YYYY-MM-DD before a
 *  200 response, but this stays defensive against a malformed/omitted gRPC echo. */
const isValidDateString = (value: string): boolean =>
  value !== '' && !Number.isNaN(new Date(value).getTime())

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
    onSuccess: (data) => {
      // Invalidate pending changes to refresh list
      queryClient.invalidateQueries({ queryKey: pendingConfigChangesQueryKey })

      toast.success('Change scheduled', {
        description: isValidDateString(data.effectiveDate)
          ? `Takes effect ${formatDateOnly(data.effectiveDate)}.`
          : 'This change has been scheduled.',
      })
    },
    onError: (error) => {
      toast.error('Failed to schedule change', {
        description: `${error.message} — check the date and value, then try again.`,
      })
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
