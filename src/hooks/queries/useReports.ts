'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReportSpec, ReportSummary } from '@/server/reporting/run-report'

export type { ReportSpec, ReportSummary }

export interface ReportsResponse {
  reports: ReportSummary[]
  /** True for admins and supervisors, who can edit reports and run drafts. */
  canAuthor: boolean
}

export const reportsKeys = {
  all: ['reports'] as const,
  list: ['reports', 'list'] as const,
}

async function fetchReports(): Promise<ReportsResponse> {
  const res = await fetch('/api/reports', { credentials: 'include' })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message ?? 'Reports could not be loaded. Try again.')
  }
  return res.json()
}

/** The reports the signed-in user may run (BTB-506); authors also get drafts. */
export function useReports() {
  return useQuery({
    queryKey: reportsKeys.list,
    queryFn: fetchReports,
    staleTime: 60_000,
  })
}
