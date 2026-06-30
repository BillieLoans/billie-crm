'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  usePendingBlockClears,
  type BlockClearRequest,
  type PendingBlockClearsOptions,
} from '@/hooks/queries/usePendingBlockClears'
import { formatDateShort } from '@/lib/formatters'
import { BlockClearDetailDrawer } from './BlockClearDetailDrawer'
import styles from './styles.module.css'

export interface BlockClearListProps {
  /** Initial sort option */
  initialSort?: PendingBlockClearsOptions['sort']
  /** Current user's ID for segregation of duties */
  currentUserId?: string
  /** Current user's name for audit trail */
  currentUserName?: string
}

/**
 * Table component displaying the queue of pending reapplication block-clear requests.
 * Supports sorting, pagination, and row click to view details.
 *
 * Parallel to ApprovalsList — does not modify the write-off approval path.
 */
export const BlockClearList: React.FC<BlockClearListProps> = ({
  initialSort = 'oldest',
  currentUserId,
  currentUserName,
}) => {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<PendingBlockClearsOptions['sort']>(initialSort)
  const [selectedRequest, setSelectedRequest] = useState<BlockClearRequest | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  // Capture "now" once at mount (lazy initializer) rather than calling the impure
  // Date.now() during render — row ages are relative to this reference. Day-grain
  // ageing doesn't need to tick live; a remount/refetch re-reads it.
  const [nowMs] = useState(() => Date.now())

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  const { data, isLoading, isError, error, refetch, isFetching } = usePendingBlockClears({
    page,
    limit: 20,
    sort,
  })

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSort(e.target.value as PendingBlockClearsOptions['sort'])
    setPage(1)
  }, [])

  const handleRowClick = useCallback((request: BlockClearRequest) => {
    setSelectedRequest(request)
    setDrawerOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
    }
    closeTimeoutRef.current = setTimeout(() => {
      setSelectedRequest(null)
      closeTimeoutRef.current = null
    }, 300)
  }, [])

  const handleRefresh = useCallback(() => {
    refetch()
  }, [refetch])

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.loadingState} data-testid="block-clears-loading">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.loadingRow} />
        ))}
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className={styles.errorState} data-testid="block-clears-error">
        <span className={styles.errorStateIcon}>⚠️</span>
        <p className={styles.errorStateText}>
          {error instanceof Error ? error.message : 'Failed to load block-clear requests'}
        </p>
        <button type="button" className={styles.retryBtn} onClick={() => refetch()}>
          Retry
        </button>
      </div>
    )
  }

  // Empty state
  if (!data?.docs.length) {
    return (
      <div className={styles.emptyState} data-testid="block-clears-empty">
        <span className={styles.emptyStateIcon}>✅</span>
        <h3 className={styles.emptyStateTitle}>No pending block-clear requests</h3>
        <p className={styles.emptyStateText}>
          All block-clear requests have been processed. Check back later.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Controls */}
      <div className={styles.approvalsControls}>
        <select
          className={styles.sortSelect}
          value={sort}
          onChange={handleSortChange}
          data-testid="block-clears-sort"
        >
          <option value="oldest">Oldest First</option>
          <option value="newest">Newest First</option>
        </select>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={isFetching}
          data-testid="block-clears-refresh"
        >
          <svg
            className={`${styles.refreshIcon} ${isFetching ? styles.refreshIconSpinning : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 8A6 6 0 1 1 8 2" />
            <path d="M14 2v6h-6" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Table */}
      <table
        className={styles.queueTable}
        data-testid="block-clears-table"
        aria-label="Pending block-clear requests"
      >
        <thead className={styles.queueTableHeader}>
          <tr>
            <th>Request #</th>
            <th>Customer</th>
            <th>Reasons</th>
            <th>Requestor</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          {data.docs.map((request) => {
            const requestDate = new Date(request.requestedAt || request.createdAt)
            const isSelected = selectedRequest?.id === request.id && drawerOpen
            const ageDays = Math.floor((nowMs - requestDate.getTime()) / (1000 * 60 * 60 * 24))

            return (
              <tr
                key={request.id}
                className={`${styles.queueTableRow} ${isSelected ? styles.queueTableRowSelected : ''}`}
                onClick={() => handleRowClick(request)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleRowClick(request)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`View block-clear request ${request.requestNumber} for ${request.customerName || 'unknown customer'}`}
                data-testid={`block-clear-row-${request.id}`}
              >
                <td className={styles.cellDate}>{request.requestNumber}</td>
                <td className={styles.cellCustomer}>
                  {request.customerName || 'Unknown Customer'}
                </td>
                <td className={styles.cellRequestor}>{(request.reasons ?? []).join(', ') || '—'}</td>
                <td className={styles.cellRequestor}>{request.requestedByName || 'Unknown'}</td>
                <td className={styles.cellDate}>
                  {ageDays === 0 ? formatDateShort(requestDate) : `${ageDays}d`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Pagination */}
      {data.totalPages > 1 && (
        <div className={styles.pagination}>
          <span className={styles.paginationInfo}>
            Page {data.page} of {data.totalPages} ({data.totalDocs} total requests)
          </span>
          <div className={styles.paginationButtons}>
            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage((p) => p - 1)}
              disabled={!data.hasPrevPage}
            >
              Previous
            </button>
            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage((p) => p + 1)}
              disabled={!data.hasNextPage}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail Drawer */}
      <BlockClearDetailDrawer
        request={selectedRequest}
        isOpen={drawerOpen}
        onClose={handleCloseDrawer}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
      />
    </>
  )
}

export default BlockClearList
