'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  usePendingApprovals,
  type WriteOffApproval,
  type PendingApprovalsOptions,
} from '@/hooks/queries/usePendingApprovals'
import { SENIOR_APPROVAL_THRESHOLD } from '@/hooks/mutations/useWriteOffRequest'
import { formatCurrency, formatDateShort } from '@/lib/formatters'
import { ApprovalDetailDrawer } from './ApprovalDetailDrawer'
import styles from './styles.module.css'

export interface ApprovalsListProps {
  /** Initial sort option */
  initialSort?: PendingApprovalsOptions['sort']
  /** Current user's ID for segregation of duties */
  currentUserId?: string
  /** Current user's name for audit trail */
  currentUserName?: string
}

/**
 * Table component displaying the queue of pending write-off approvals.
 * Supports sorting, pagination, and row click to view details.
 */
export const ApprovalsList: React.FC<ApprovalsListProps> = ({
  initialSort = 'oldest',
  currentUserId,
  currentUserName,
}) => {
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<PendingApprovalsOptions['sort']>(initialSort)
  const [selectedApproval, setSelectedApproval] = useState<WriteOffApproval | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  const { data, isLoading, isError, error, refetch, isFetching } = usePendingApprovals({
    page,
    limit: 20,
    sort,
  })

  const handleSortChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSort(e.target.value as PendingApprovalsOptions['sort'])
    setPage(1) // Reset to first page on sort change
  }, [])

  const handleRowClick = useCallback((approval: WriteOffApproval) => {
    setSelectedApproval(approval)
    setDrawerOpen(true)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    // Keep selectedApproval for animation, clear after drawer closes
    // Clear any existing timeout first
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
    }
    closeTimeoutRef.current = setTimeout(() => {
      setSelectedApproval(null)
      closeTimeoutRef.current = null
    }, 300)
  }, [])

  const handleRefresh = useCallback(() => {
    refetch()
  }, [refetch])

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.loadingState} data-testid="approvals-loading">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={styles.loadingRow} />
        ))}
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className={styles.errorState} data-testid="approvals-error">
        <span className={styles.errorStateIcon}>⚠️</span>
        <p className={styles.errorStateText}>
          {error instanceof Error ? error.message : 'Failed to load approvals'}
        </p>
        <button
          type="button"
          className={styles.retryBtn}
          onClick={() => refetch()}
        >
          Retry
        </button>
      </div>
    )
  }

  // Empty state
  if (!data?.docs.length) {
    return (
      <div className={styles.emptyState} data-testid="approvals-empty">
        <span className={styles.emptyStateIcon}>✅</span>
        <h3 className={styles.emptyStateTitle}>No pending approvals</h3>
        <p className={styles.emptyStateText}>
          All write-off requests have been processed. Check back later.
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
          aria-label="Sort approvals"
          data-testid="approvals-sort"
        >
          <option value="oldest">Oldest First</option>
          <option value="newest">Newest First</option>
          <option value="amount-high">Highest Amount</option>
          <option value="amount-low">Lowest Amount</option>
        </select>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={isFetching}
          data-testid="approvals-refresh"
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
        data-testid="approvals-table"
        aria-label="Pending write-off approval requests"
      >
        <thead className={styles.queueTableHeader}>
          <tr>
            <th>Date</th>
            <th>Customer</th>
            <th>Account</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
            <th>Requestor</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {data.docs.map((approval) => {
            const requestDate = new Date(approval.requestedAt || approval.createdAt)
            const isHighAmount = approval.amount >= SENIOR_APPROVAL_THRESHOLD
            const isSelected = selectedApproval?.id === approval.id && drawerOpen

            return (
              <tr
                key={approval.id}
                className={`${styles.queueTableRow} ${isSelected ? styles.queueTableRowSelected : ''}`}
                onClick={() => handleRowClick(approval)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleRowClick(approval)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`View write-off request ${approval.requestNumber} for ${approval.customerName || 'unknown customer'}, amount ${formatCurrency(approval.amount)}`}
                data-testid={`approval-row-${approval.id}`}
              >
                <td className={styles.cellDate}>{formatDateShort(requestDate)}</td>
                <td className={styles.cellCustomer}>
                  {approval.customerName || 'Unknown Customer'}
                </td>
                <td className={styles.cellAccount}>
                  {approval.accountNumber || approval.loanAccountId.slice(0, 12)}
                </td>
                <td className={`${styles.cellAmount} ${isHighAmount ? styles.cellAmountHigh : ''}`}>
                  {formatCurrency(approval.amount)}
                </td>
                <td className={styles.cellRequestor}>
                  {approval.requestedByName || 'Unknown'}
                </td>
                <td>
                  {approval.requiresSeniorApproval ? (
                    <span className={`${styles.priorityBadge} ${styles.prioritySenior}`}>
                      ⚠️ Senior
                    </span>
                  ) : approval.priority === 'urgent' ? (
                    <span className={`${styles.priorityBadge} ${styles.priorityUrgent}`}>
                      🔴 Urgent
                    </span>
                  ) : (
                    <span className={`${styles.priorityBadge} ${styles.priorityNormal}`}>
                      Normal
                    </span>
                  )}
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
      <ApprovalDetailDrawer
        approval={selectedApproval}
        isOpen={drawerOpen}
        onClose={handleCloseDrawer}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
      />
    </>
  )
}

export default ApprovalsList
