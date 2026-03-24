import { useMutation, useQueryClient } from '@tanstack/react-query'
import { exportJobsQueryKey, type ExportJobType, type ExportFormat } from '@/hooks/queries/useExportJobs'

export interface CreateExportJobRequest {
  type: ExportJobType
  format: ExportFormat
  createdBy: string
  options?: {
    periodDate?: string
    accountIds?: string[]
    startDate?: string
    endDate?: string
    includeCalculationBreakdown?: boolean
  }
}

export interface CreateExportJobResponse {
  success: boolean
  jobId: string
  status: 'pending' | 'processing'
  message?: string
}

/**
 * Maps UI-friendly export type names to gRPC enum values expected by the API route.
 */
const EXPORT_TYPE_MAP: Record<ExportJobType, string> = {
  journal_entries: 'EXPORT_TYPE_JOURNAL_ENTRIES',
  audit_trail: 'EXPORT_TYPE_AUDIT_TRAIL',
  methodology: 'EXPORT_TYPE_METHODOLOGY',
}

/**
 * Maps UI-friendly format names to gRPC enum values expected by the API route.
 */
const EXPORT_FORMAT_MAP: Record<ExportFormat, string> = {
  csv: 'EXPORT_FORMAT_CSV',
  json: 'EXPORT_FORMAT_JSON',
  xlsx: 'EXPORT_FORMAT_CSV', // fallback — xlsx not in gRPC proto
}

/**
 * Mutation hook to create a new export job.
 *
 * @example
 * ```tsx
 * const { createExportJob, isPending } = useCreateExportJob()
 *
 * const handleExport = async () => {
 *   const result = await createExportJob({
 *     type: 'journal_entries',
 *     format: 'csv',
 *     createdBy: userId,
 *     options: { periodDate: '2026-01-31' }
 *   })
 *   // result.jobId - ID of created job
 * }
 * ```
 */
export function useCreateExportJob() {
  const queryClient = useQueryClient()

  const mutation = useMutation<CreateExportJobResponse, Error, CreateExportJobRequest>({
    mutationFn: async (request) => {
      // Transform UI-friendly types to the gRPC enum values the API route expects,
      // and flatten options into top-level fields.
      const body = {
        exportType: EXPORT_TYPE_MAP[request.type],
        exportFormat: EXPORT_FORMAT_MAP[request.format],
        createdBy: request.createdBy,
        periodDate: request.options?.periodDate,
        accountIds: request.options?.accountIds,
        dateRangeStart: request.options?.startDate,
        dateRangeEnd: request.options?.endDate,
        includeCalculationBreakdown: request.options?.includeCalculationBreakdown,
      }

      const res = await fetch('/api/export/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to create export job')
      }
      return res.json()
    },
    onSuccess: () => {
      // Invalidate jobs list to show new job
      queryClient.invalidateQueries({ queryKey: exportJobsQueryKey })
    },
  })

  return {
    createExportJob: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
  }
}

export default useCreateExportJob
