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
  sortFn_datetime,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { ReportColumn } from '@/lib/schemas/reports'
import { formatNumber } from '@/lib/formatters'
import { columnLabel, formatCell } from './format'
import styles from './styles.module.css'

type Row = Record<string, unknown>

const PAGE_SIZE = 100

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic, datetime: sortFn_datetime },
})

const helper = createColumnHelper<typeof features, Row>()

export interface ReportTableProps {
  caption: string
  columns: ReportColumn[]
  rows: Row[]
}

/**
 * The result table: sortable headers (APG sortable table: the sort control
 * is a button inside the header, and `aria-sort` names the order) and
 * client-side pages of 100 rows.
 */
export function ReportTable({ caption, columns, rows }: ReportTableProps) {
  const columnDefs = useMemo(
    () =>
      helper.columns(
        columns.map((col) =>
          helper.accessor((row: Row): unknown => row[col.name], {
            id: col.name,
            header: columnLabel(col.name),
            sortFn: col.kind === 'number' ? 'basic' : 'alphanumeric',
            sortUndefined: 'last',
            cell: (info) => formatCell(info.getValue(), col.kind),
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
                  const kind = columns.find((c) => c.name === header.column.id)?.kind
                  const sorted = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={kind === 'number' ? styles.numeric : undefined}
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
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getAllCells().map((cell) => {
                  const kind = columns.find((c) => c.name === cell.column.id)?.kind
                  return (
                    <td key={cell.id} className={kind === 'number' ? styles.numeric : undefined}>
                      <table.FlexRender cell={cell} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
