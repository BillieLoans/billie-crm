'use client'

import React, { useId, useMemo, useState } from 'react'
import type { ChartSpec, ColumnSpec, ReportColumn } from '@/lib/schemas/reports'
import { formatNumber } from '@/lib/formatters'
import { drillHref } from '@/lib/reports/chart-data'
import { comparisonKey, resolveColumns, splitRows, toTsv } from '@/lib/reports/columns'
import { ReportChart } from './ReportChart'
import { ReportTable } from './ReportTable'
import styles from './styles.module.css'

type Row = Record<string, unknown>

export interface ReportResultsProps {
  title: string
  charts: ChartSpec[]
  columnSpecs?: ColumnSpec[]
  columns: ReportColumn[]
  rows: Row[]
  /** The same report on the previous period, when comparing. */
  previousRows?: Row[] | null
  /** Show the table straight away even when there is a chart. */
  tableOpen?: boolean
  /** Parameter values a drill-down carries into the next report. */
  carryParameters?: Record<string, string>
  /** The first day of this period and of the previous one, to line days up. */
  periodStarts?: { current: string; previous: string }
}

const NO_SPECS: ColumnSpec[] = []

/**
 * The charts and table for one result. With a chart, the table sits behind
 * "Show data" so the page leads with the picture; the table is still one
 * click away, and it is the chart's text alternative.
 */
export function ReportResults({
  title,
  charts,
  columnSpecs = NO_SPECS,
  columns,
  rows,
  previousRows,
  tableOpen,
  carryParameters,
  periodStarts,
}: ReportResultsProps) {
  const tableId = useId().replace(/:/g, '')
  const [showTable, setShowTable] = useState(tableOpen ?? charts.length === 0)
  const [copied, setCopied] = useState('')
  const views = useMemo(() => resolveColumns(columns, columnSpecs), [columns, columnSpecs])
  const { body, totals } = useMemo(() => splitRows(columns, rows), [columns, rows])

  const currentStart = periodStarts?.current
  const previousStart = periodStarts?.previous
  const previousFor = useMemo(() => {
    if (!previousRows) return undefined
    const keyOf = comparisonKey(columns)
    const current = keyOf(rows, currentStart)
    const byKey = new Map<string, Row>()
    keyOf(previousRows, previousStart).forEach((key, row) => byKey.set(key, row))
    return (row: Row) => {
      const key = current.get(row)
      return key === undefined ? undefined : byKey.get(key)
    }
  }, [previousRows, rows, columns, currentStart, previousStart])

  // The table carries the chart's drill-down too, so it works by keyboard.
  const drill = charts.find((c) => c.drill)
  const drillLink = drill
    ? { column: drill.x, href: (row: Row) => drillHref(drill, row, carryParameters) }
    : undefined

  const copyTable = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(views, [...body, ...totals]))
      setCopied('Table copied. Paste it into a sheet or a message.')
    } catch {
      setCopied('Copying is blocked in this browser. Download the CSV instead.')
    }
  }

  return (
    <div className={styles.resultsBody}>
      {charts.map((chart, i) => (
        <ReportChart
          key={i}
          title={charts.length > 1 ? `${title} (chart ${i + 1} of ${charts.length})` : title}
          spec={chart}
          columns={columns}
          columnViews={views}
          rows={rows}
          previousRows={previousRows ?? undefined}
          carryParameters={carryParameters}
        />
      ))}

      <div className={styles.resultsToolbar}>
        {charts.length > 0 && (
          <button
            type="button"
            className={styles.secondaryButton}
            aria-expanded={showTable}
            aria-controls={tableId}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Hide data' : `Show data (${formatNumber(rows.length)} rows)`}
          </button>
        )}
        <button type="button" className={styles.secondaryButton} onClick={copyTable}>
          Copy table
        </button>
        <span className={styles.hint} aria-live="polite">
          {copied}
        </span>
      </div>

      <div id={tableId} hidden={!showTable}>
        <ReportTable
          caption={title}
          columns={views}
          rows={body}
          totals={totals}
          previousFor={previousFor}
          link={drillLink}
        />
      </div>
    </div>
  )
}
