'use client'

import { useMutation } from '@tanstack/react-query'
import type { ReportRunResponse } from '@/server/reporting/run-report'

export type { ReportRunResponse }

export interface RunReportParams {
  slug: string
  parameters: Record<string, unknown>
  draft?: boolean
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

async function runReport({ slug, parameters, draft }: RunReportParams): Promise<ReportRunResponse> {
  const res = await fetch(`/api/reports/${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ parameters, draft: draft === true }),
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
 * Run a report (BTB-506). Errors are shown in the view's error summary, so
 * there is no toast here.
 */
export function useRunReport() {
  return useMutation({ mutationFn: runReport })
}
