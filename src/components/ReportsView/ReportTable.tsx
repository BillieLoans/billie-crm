'use client'

import React, { useMemo } from 'react'
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { formatNumber } from '@/lib/formatters'
import {
  computeChange,
  formatValue,
  isGapLabel,
  isSmallSample,
  type ColumnView,
} from '@/lib/reports/columns'
import styles from './styles.module.css'

type Row = Record<string, unknown>

const PAGE_SIZE = 100

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
})

const helper = createColumnHelper<typeof features, Row>()

export interface ReportTableProps {
  caption: string
  columns: ColumnView[]
  /** Ordinary rows, in the order to show them before any sort. */
  rows: Row[]
  /** All/Total rows: pinned under the others whatever the sort. */
  totals?: Row[]
  /** The same row in the previous period, when comparing. */
  previousFor?: (row: Row) => Row | undefined
}

const SMALL_MARK = '†'

/** One cell: the value, a small-sample mark, and the change when comparing. */
function Cell({
  row,
  column,
  previous,
}: {
  row: Row
  column: ColumnView
  previous: Row | undefined
}) {
  const text = formatValue(row[column.name], column.format, column.kind)
  const small = isSmallSample(row, column)
  const change =
    previous && column.kind === 'number'
      ? computeChange(row[column.name], previous[column.name], column.format, column.better)
      : null
  return (
    <>
      <span className={small ? styles.smallSample : undefined}>
        {text}
        {small && (
          <sup aria-hidden="true" className={styles.smallMark}>
            {SMALL_MARK}
          </sup>
        )}
        {small && <span className={styles.visuallyHidden}> (small sample)</span>}
      </span>
      {change && change.direction !== 'flat' && (
        <span className={`${styles.cellChange} ${styles[`tone_${change.tone}`]}`}>
          <span aria-hidden="true">{change.direction === 'up' ? '▲' : '▼'}</span>{' '}
          <span className={styles.visuallyHidden}>{change.text} on the previous period</span>
          <span aria-hidden="true">
            {change.unit === 'pts'
              ? `${Math.abs(change.delta)} pts`
              : change.unit === 'pct'
                ? `${Math.abs(change.delta)}%`
                : change.text.replace(/^(up|down) /, '')}
          </span>
        </span>
      )}
    </>
  )
}

/**
 * The result table: formatted values, sortable headers (APG sortable table:
 * the sort control is a button inside the header, and `aria-sort` names the
 * order), a sticky header and first column, total rows pinned in the
 * footer, small samples marked, and client-side pages of 100 rows.
 */
export function ReportTable({
  caption,
  columns,
  rows,
  totals = [],
  previousFor,
}: ReportTableProps) {
  const columnDefs = useMemo(
    () =>
      helper.columns(
        columns.map((col) =>
          // SQL NULL arrives as null; undefined lets `sortUndefined` place it last.
          helper.accessor((row: Row): unknown => row[col.name] ?? undefined, {
            id: col.name,
            header: col.label,
            sortFn: col.kind === 'number' ? 'basic' : 'alphanumeric',
            sortUndefined: 'last',
          }),
        ),
      ),
    [columns],
  )

  const table = useTable({
    features,
    columns: columnDefs,
    data: rows,
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
  })

  const pageIndex = table.state.pagination.pageIndex
  const pageCount = Math.max(1, table.getPageCount())
  const first = rows.length === 0 ? 0 : pageIndex * PAGE_SIZE + 1
  const last = Math.min(rows.length, (pageIndex + 1) * PAGE_SIZE)
  const byName = new Map(columns.map((c) => [c.name, c]))
  const firstColumn = columns[0]?.name

  // Which small-sample rules the visible rows trip, for the footnote.
  const smallRules = new Map<string, ColumnView>()
  for (const row of [...rows, ...totals]) {
    for (const col of columns) {
      if (isSmallSample(row, col)) smallRules.set(`${col.base}:${col.minBase}`, col)
    }
  }

  const cellClass = (col: ColumnView, extra?: string) =>
    [
      col.kind === 'number' ? styles.numeric : undefined,
      col.name === firstColumn ? styles.stickyColumn : undefined,
      extra,
    ]
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <div className={styles.tableBlock}>
      {/* A scrollable region must be reachable by keyboard to scroll it
          (WCAG 2.1.1; axe scrollable-region-focusable). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={caption}>
        <table className={styles.table} data-testid="report-table">
          <caption className={styles.visuallyHidden}>{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const col = byName.get(header.column.id) as ColumnView
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cellClass(col)}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                    >
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={header.column.getToggleSortingHandler()}
                        title={col.description}
                      >
                        <table.FlexRender header={header} />
                        <span aria-hidden="true" className={styles.sortMark}>
                          {sorted === 'asc' ? '▲' : sorted === 'desc' ? '▼' : '↕'}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const previous = previousFor?.(row.original)
              return (
                <tr key={row.id}>
                  {columns.map((col) => (
                    <td
                      key={col.name}
                      className={cellClass(
                        col,
                        col.name === firstColumn && isGapLabel(row.original[col.name])
                          ? styles.gapLabel
                          : undefined,
                      )}
                    >
                      <Cell row={row.original} column={col} previous={previous} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          {totals.length > 0 && (
            <tfoot>
              {totals.map((row, i) => (
                <tr key={i} className={styles.totalRow}>
                  {columns.map((col, c) =>
                    c === 0 ? (
                      <th key={col.name} scope="row" className={cellClass(col)}>
                        <Cell row={row} column={col} previous={undefined} />
                      </th>
                    ) : (
                      <td key={col.name} className={cellClass(col)}>
                        <Cell row={row} column={col} previous={previousFor?.(row)} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>

      {smallRules.size > 0 && (
        <p className={styles.footnote} data-testid="small-sample-note">
          {[...smallRules.values()].map((col) => (
            <span key={`${col.base}:${col.minBase}`}>
              {SMALL_MARK} Based on fewer than {formatNumber(col.minBase)}{' '}
              {(byName.get(col.base as string)?.label ?? 'cases').toLowerCase()}: read with
              care.{' '}
            </span>
          ))}
        </p>
      )}

      {rows.length > PAGE_SIZE && (
        <nav className={styles.pager} aria-label="Result pages">
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </button>
          <span className={styles.pagerText}>
            Rows {formatNumber(first)}–{formatNumber(last)} of {formatNumber(rows.length)} · page{' '}
            {formatNumber(pageIndex + 1)} of {formatNumber(pageCount)}
          </span>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  )
}
