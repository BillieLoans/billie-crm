'use client'

import { useQuery } from '@tanstack/react-query'
import type { UsageSummary } from '@/server/reporting/usage'

export type { UsageSummary }

/** How Reports is used (report authors). */
export function useReportUsage(enabled: boolean) {
  return useQuery({
    queryKey: ['reports', 'usage'],
    queryFn: async (): Promise<UsageSummary> => {
      const res = await fetch('/api/reports/usage', { credentials: 'include' })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error?.message ?? 'The usage figures could not be loaded.')
      }
      return body as UsageSummary
    },
    enabled,
    staleTime: 5 * 60_000,
  })
}
