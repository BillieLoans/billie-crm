'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReportRunResponse } from '@/server/reporting/run-report'

export type { ReportRunResponse }

/** One submission of a report's form. `attempt` makes a re-run a new query. */
export interface ReportRunRequest {
  slug: string
  parameters: Record<string, unknown>
  draft: boolean
  /** Also run the previous period, for comparison. */
  compare?: boolean
  attempt: number
}

/** A failed run, with per-parameter messages when the inputs were the problem. */
export class ReportRunFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fields?: Record<string, string>,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ReportRunFailure'
  }
}

async function fetchReportRun(request: ReportRunRequest): Promise<ReportRunResponse> {
  const res = await fetch(`/api/reports/${encodeURIComponent(request.slug)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      parameters: request.parameters,
      draft: request.draft,
      compare: request.compare === true,
    }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const error = body?.error ?? {}
    throw new ReportRunFailure(
      error.message ?? 'The report could not be run. Try again.',
      error.code ?? 'QUERY_FAILED',
      error.fields,
      error.detail,
    )
  }
  return body as ReportRunResponse
}

/**
 * The result of one report run (BTB-506). A run is a query keyed by its
 * submission, so a new submission starts with no stale rows on screen, and
 * nothing re-runs on focus or reconnect. `null` runs nothing.
 */
export function useReportRun(request: ReportRunRequest | null) {
  return useQuery({
    queryKey: ['reports', 'run', request],
    queryFn: () => fetchReportRun(request as ReportRunRequest),
    enabled: request !== null,
    retry: false,
    staleTime: Infinity,
    // Results can be 50,000 rows; drop them soon after the view moves on.
    gcTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
