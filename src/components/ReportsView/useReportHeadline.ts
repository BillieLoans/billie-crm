'use client'

import { useMemo } from 'react'
import { resolveColumns } from '@/lib/reports/columns'
import { buildNarrative, computeHeadline } from '@/lib/reports/headline'
import { previousPeriodLabel } from '@/lib/reports/periods'
import type { ReportSpec } from '@/hooks/queries/useReports'
import type { ReportRunResponse } from '@/hooks/queries/useReportRun'

/**
 * What a result says, as the report page and board tiles show it: the
 * columns' display settings, the headline numbers with their changes, the
 * sentence that reads them, and how the previous period is named.
 */
export function useReportHeadline(
  result: ReportRunResponse | undefined,
  spec: Pick<ReportSpec, 'columns' | 'headline'>,
) {
  const views = useMemo(
    () => (result ? resolveColumns(result.columns, spec.columns) : []),
    [result, spec.columns],
  )
  const previousRows = result?.previous?.rows ?? null
  const previousLabel = result?.previous
    ? previousPeriodLabel(result.previous.from, result.previous.to)
    : undefined
  const tiles = useMemo(
    () =>
      result
        ? computeHeadline(spec.headline, views, result.columns, result.rows, previousRows)
        : [],
    [result, spec.headline, views, previousRows],
  )
  const narrative = useMemo(
    () =>
      result ? buildNarrative(tiles, views, result.columns, result.rows, { previousLabel }) : '',
    [tiles, views, result, previousLabel],
  )
  return { views, previousRows, previousLabel, tiles, narrative }
}
