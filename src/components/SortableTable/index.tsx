'use client'

import React, { useState, useMemo, useCallback } from 'react'
import styles from './styles.module.css'

/**
 * Sort direction type.
 */
export type SortDirection = 'asc' | 'desc'

/**
 * Column definition for SortableTable.
 */
export interface ColumnDef<T> {
  /** Unique key for the column */
  key: string
  /** Header label displayed in the table */
  label: string
  /** Whether this column is sortable (default: true) */
  sortable?: boolean
  /** Custom render function for cell content */
  render?: (row: T, index: number) => React.ReactNode
  /** Accessor function to get the sortable value */
  accessor?: (row: T) => string | number | Date | null | undefined
  /** CSS class for the column */
  className?: string
  /** Width hint (e.g., '200px', '2fr') */
  width?: string
}

/**
 * Props for SortableTable component.
 */
export interface SortableTableProps<T> {
  /** Data rows to display */
  data: T[]
  /** Column definitions */
  columns: ColumnDef<T>[]
  /** Default sort column key */
  defaultSortKey?: string
  /** Default sort direction */
  defaultSortDirection?: SortDirection
  /** Callback when a row is clicked */
  onRowClick?: (row: T, index: number) => void
  /** Function to get a unique key for each row */
  getRowKey: (row: T, index: number) => string | number
  /** Empty state message */
  emptyMessage?: string
  /** Additional class name for the table container */
  className?: string
  /** Test ID for the table */
  testId?: string
}

/**
 * Reusable sortable table component.
 *
 * Features:
 * - Click column headers to sort (toggle asc/desc)
 * - Visual sort indicators (▲/▼)
 * - Custom cell rendering
 * - Row click handlers
 * - Empty state support
 *
 * @example
 * ```tsx
 * <SortableTable
 *   data={accounts}
 *   columns={[
 *     { key: 'accountNumber', label: 'Account', accessor: (r) => r.accountNumber },
 *     { key: 'balance', label: 'Balance', render: (r) => formatCurrency(r.balance) },
 *   ]}
 *   defaultSortKey="createdAt"
 *   defaultSortDirection="desc"
 *   getRowKey={(row) => row.id}
 *   onRowClick={(row) => navigate(`/account/${row.id}`)}
 * />
 * ```
 */
export function SortableTable<T>({
  data,
  columns,
  defaultSortKey,
  defaultSortDirection = 'asc',
  onRowClick,
  getRowKey,
  emptyMessage = 'No data available',
  className,
  testId = 'sortable-table',
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(defaultSortDirection)

  // Handle column header click
  const handleHeaderClick = useCallback(
    (columnKey: string, sortable: boolean) => {
      if (!sortable) return

      if (sortKey === columnKey) {
        // Toggle direction
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      } else {
        // New column, default to asc
        setSortKey(columnKey)
        setSortDirection('asc')
      }
    },
    [sortKey],
  )

  // Sort the data
  const sortedData = useMemo(() => {
    if (!sortKey) return data

    const column = columns.find((c) => c.key === sortKey)
    if (!column?.accessor) return data

    return [...data].sort((a, b) => {
      const aVal = column.accessor!(a)
      const bVal = column.accessor!(b)

      // Handle nulls
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return sortDirection === 'asc' ? 1 : -1
      if (bVal == null) return sortDirection === 'asc' ? -1 : 1

      // Compare
      let comparison = 0
      if (aVal instanceof Date && bVal instanceof Date) {
        comparison = aVal.getTime() - bVal.getTime()
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal
      } else {
        comparison = String(aVal).localeCompare(String(bVal))
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [data, columns, sortKey, sortDirection])

  // Build grid template from column widths
  const gridTemplateColumns = columns.map((c) => c.width ?? '1fr').join(' ')

  if (data.length === 0) {
    return (
      <div className={`${styles.container} ${className ?? ''}`} data-testid={testId}>
        <div className={styles.emptyState}>{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className={`${styles.container} ${className ?? ''}`} data-testid={testId}>
      {/* Header */}
      <div
        className={styles.header}
        style={{ gridTemplateColumns }}
        role="row"
      >
        {columns.map((column) => {
          const isSortable = column.sortable !== false
          const isActive = sortKey === column.key
          const ariaSort = isActive
            ? sortDirection === 'asc'
              ? 'ascending'
              : 'descending'
            : undefined

          return (
            <div
              key={column.key}
              role="columnheader"
              aria-sort={ariaSort}
            >
              <button
                type="button"
                className={`${styles.headerCell} ${isSortable ? styles.sortable : ''} ${isActive ? styles.active : ''} ${column.className ?? ''}`}
                onClick={() => handleHeaderClick(column.key, isSortable)}
                disabled={!isSortable}
                data-testid={`header-${column.key}`}
              >
                <span className={styles.headerLabel}>{column.label}</span>
                {isSortable && (
                  <span className={styles.sortIndicator} aria-hidden="true">
                    {isActive ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Rows */}
      <div className={styles.body} role="rowgroup">
        {sortedData.map((row, index) => (
          <div
            key={getRowKey(row, index)}
            className={`${styles.row} ${onRowClick ? styles.clickable : ''}`}
            style={{ gridTemplateColumns }}
            role="row"
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowClick(row, index)
                    }
                  }
                : undefined
            }
            tabIndex={onRowClick ? 0 : undefined}
            data-testid={`row-${getRowKey(row, index)}`}
          >
            {columns.map((column) => (
              <div
                key={column.key}
                className={`${styles.cell} ${column.className ?? ''}`}
                role="cell"
              >
                {column.render
                  ? column.render(row, index)
                  : column.accessor
                    ? String(column.accessor(row) ?? '')
                    : ''}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default SortableTable

