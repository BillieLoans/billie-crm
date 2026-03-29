'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stringify } from 'qs-esm'
import Link from 'next/link'
import { Breadcrumb } from '@/components/Breadcrumb'
import { formatCurrency, formatDateShort } from '@/lib/formatters'
import { useCancelWriteOff } from '@/hooks/mutations/useCancelWriteOff'
import styles from './styles.module.css'

export interface MyActivityViewProps {
  /** Current user's ID */
  userId?: string
}

/** Activity item representing a write-off request action */
interface ActivityItem {
  id: string
  requestId: string // For cancel action
  requestNumber: string
  customerId: string
  customerName?: string
  amount: number
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  actionType: 'submitted' | 'approved' | 'rejected'
  actionDate: string
  createdAt: string
  updatedAt: string
}

/**
 * My Activity View - Shows write-off requests submitted or decided by current user.
 *
 * Story 6.6: User Menu Enhancements
 */
export const MyActivityView: React.FC<MyActivityViewProps> = ({
  userId,
}) => {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'submitted' | 'decided'>('all')

  // Fetch ALL requests first, then filter client-side by requestedBy
  // This works around the event processor storing requestedBy as string
  // while Payload expects a relationship reference
  const submittedQuery = useQuery({
    queryKey: ['my-activity', 'submitted', userId, page, filter],
    queryFn: async () => {
      if (!userId) return { docs: [], totalDocs: 0 }
      // Fetch all, we'll filter client-side since requestedBy is stored as string
      const queryString = stringify(
        {
          limit: 100,
          sort: '-createdAt',
        },
        { addQueryPrefix: true }
      )
      const res = await fetch(`/api/write-off-requests${queryString}`)
      if (!res.ok) throw new Error('Failed to fetch submitted requests')
      const data = await res.json()
      
      // Filter client-side to match userId
      // requestedBy could be string ID, number, or object with id
      const filteredDocs = (data.docs || []).filter((doc: Record<string, unknown>) => {
        const reqBy = doc.requestedBy
        if (!reqBy) return false
        if (typeof reqBy === 'string') return reqBy === userId
        if (typeof reqBy === 'number') return String(reqBy) === userId
        if (typeof reqBy === 'object' && reqBy !== null && 'id' in reqBy) {
          return String((reqBy as { id: unknown }).id) === userId
        }
        return false
      })
      
      return { docs: filteredDocs, totalDocs: filteredDocs.length }
    },
    enabled: !!userId && (filter === 'all' || filter === 'submitted'),
    staleTime: 30_000,
  })

  // Fetch requests decided by me
  // Fetches approved/rejected requests and filters client-side by approver/rejecter
  const decidedQuery = useQuery({
    queryKey: ['my-activity', 'decided', userId, page, filter],
    queryFn: async () => {
      if (!userId) return { docs: [], totalDocs: 0 }
      // Fetch approved/rejected requests, filter client-side
      const queryString = stringify(
        {
          where: { status: { in: ['approved', 'rejected'] } },
          limit: 100,
          sort: '-updatedAt',
        },
        { addQueryPrefix: true }
      )
      const res = await fetch(`/api/write-off-requests${queryString}`)
      if (!res.ok) throw new Error('Failed to fetch decided requests')
      const data = await res.json()
      
      // Filter to requests decided by this user
      const filteredDocs = (data.docs || []).filter((doc: Record<string, unknown>) => {
        const details = doc.approvalDetails as Record<string, unknown> | undefined
        if (!details) return false
        
        // Check approvedBy (text field from event processor)
        const approvedBy = details.approvedBy
        if (approvedBy && String(approvedBy) === userId) return true
        
        // Check rejectedBy (text field from event processor)  
        const rejectedBy = details.rejectedBy
        if (rejectedBy && String(rejectedBy) === userId) return true
        
        // Check decidedBy (relationship field, legacy)
        const decidedBy = details.decidedBy
        if (decidedBy) {
          if (typeof decidedBy === 'string' && decidedBy === userId) return true
          if (typeof decidedBy === 'number' && String(decidedBy) === userId) return true
          if (typeof decidedBy === 'object' && decidedBy !== null && 'id' in decidedBy) {
            return String((decidedBy as { id: unknown }).id) === userId
          }
        }
        
        return false
      })
      
      return { docs: filteredDocs, totalDocs: filteredDocs.length }
    },
    enabled: !!userId && (filter === 'all' || filter === 'decided'),
    staleTime: 30_000,
  })

  // Combine and transform data
  const activities = useMemo(() => {
    const items: ActivityItem[] = []

    // Add submitted requests
    if (filter === 'all' || filter === 'submitted') {
      for (const doc of submittedQuery.data?.docs ?? []) {
        items.push({
          id: `submitted-${doc.id}`,
          requestId: doc.requestId,
          requestNumber: doc.requestNumber,
          customerId: doc.customerId,
          customerName: doc.customerName,
          amount: doc.amount,
          reason: doc.reason,
          status: doc.status,
          actionType: 'submitted',
          actionDate: doc.createdAt,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        })
      }
    }

    // Add decided requests
    if (filter === 'all' || filter === 'decided') {
      for (const doc of decidedQuery.data?.docs ?? []) {
        items.push({
          id: `decided-${doc.id}`,
          requestId: doc.requestId,
          requestNumber: doc.requestNumber,
          customerId: doc.customerId,
          customerName: doc.customerName,
          amount: doc.amount,
          reason: doc.reason,
          status: doc.status,
          actionType: doc.status === 'approved' ? 'approved' : 'rejected',
          actionDate: doc.approvalDetails?.decidedAt || doc.updatedAt,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        })
      }
    }

    // Sort by action date, newest first
    items.sort((a, b) => new Date(b.actionDate).getTime() - new Date(a.actionDate).getTime())

    return items
  }, [filter, submittedQuery.data, decidedQuery.data])

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilter(e.target.value as 'all' | 'submitted' | 'decided')
    setPage(1)
  }, [])

  // Cancel mutation
  const queryClient = useQueryClient()
  const { cancelRequest, isPending: isCancelling } = useCancelWriteOff()
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const handleCancel = useCallback((item: ActivityItem) => {
    if (!item.requestId || !item.requestNumber) return
    
    setCancellingId(item.id)
    cancelRequest(
      { requestId: item.requestId, requestNumber: item.requestNumber },
      {
        onSettled: () => {
          setCancellingId(null)
          // Refetch the activity list
          submittedQuery.refetch()
          queryClient.invalidateQueries({ queryKey: ['my-activity'] })
        },
      }
    )
  }, [cancelRequest, submittedQuery, queryClient])

  const isLoading = submittedQuery.isLoading || decidedQuery.isLoading
  const isError = submittedQuery.isError || decidedQuery.isError

  // Not logged in
  if (!userId) {
    return (
      <div className={styles.container}>
        <Breadcrumb items={[{ label: 'My Activity' }]} />
        <div className={styles.accessDenied} data-testid="not-logged-in">
          <span className={styles.accessDeniedIcon}>🔒</span>
          <h2 className={styles.accessDeniedTitle}>Not Logged In</h2>
          <p className={styles.accessDeniedText}>
            Please log in to view your activity.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid="my-activity-view">
      <Breadcrumb items={[{ label: 'My Activity' }]} />

      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.title}>My Activity</h1>
        <p className={styles.subtitle}>
          Write-off requests you&apos;ve submitted or reviewed
        </p>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.filterGroup}>
          <label htmlFor="activity-filter" className={styles.filterLabel}>
            Show
          </label>
          <select
            id="activity-filter"
            className={styles.filterSelect}
            value={filter}
            onChange={handleFilterChange}
            data-testid="activity-filter"
          >
            <option value="all">All Activity</option>
            <option value="submitted">Requests I Submitted</option>
            <option value="decided">Requests I Reviewed</option>
          </select>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className={styles.loadingState} data-testid="activity-loading">
          <div className={styles.loadingSpinner} />
          <p>Loading your activity...</p>
        </div>
      )}

      {/* Error State */}
      {isError && !isLoading && (
        <div className={styles.errorState} data-testid="activity-error">
          <p>Failed to load activity.</p>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              submittedQuery.refetch()
              decidedQuery.refetch()
            }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && activities.length === 0 && (
        <div className={styles.emptyState} data-testid="activity-empty">
          <div className={styles.emptyIcon}>📋</div>
          <h3 className={styles.emptyTitle}>No Activity Yet</h3>
          <p className={styles.emptyText}>
            {filter === 'submitted'
              ? "You haven't submitted any write-off requests yet."
              : filter === 'decided'
                ? "You haven't reviewed any write-off requests yet."
                : "You don't have any write-off activity yet."}
          </p>
        </div>
      )}

      {/* Activity List */}
      {!isLoading && !isError && activities.length > 0 && (
        <div className={styles.activityList} data-testid="activity-list">
          {activities.map((item) => (
            <div
              key={item.id}
              className={styles.activityCard}
              data-testid={`activity-item-${item.id}`}
            >
              <div className={styles.activityHeader}>
                <span className={styles.requestNumber}>{item.requestNumber}</span>
                <span
                  className={`${styles.actionBadge} ${
                    item.actionType === 'submitted'
                      ? styles.actionSubmitted
                      : item.actionType === 'approved'
                        ? styles.actionApproved
                        : styles.actionRejected
                  }`}
                >
                  {item.actionType === 'submitted'
                    ? '📤 Submitted'
                    : item.actionType === 'approved'
                      ? '✓ Approved'
                      : '✕ Rejected'}
                </span>
              </div>
              <div className={styles.activityBody}>
                <div className={styles.activityDetail}>
                  <span className={styles.detailLabel}>Customer</span>
                  <Link
                    href={`/admin/servicing/${item.customerId}`}
                    className={styles.customerLink}
                  >
                    {item.customerName || item.customerId}
                  </Link>
                </div>
                <div className={styles.activityDetail}>
                  <span className={styles.detailLabel}>Amount</span>
                  <span className={styles.amount}>{formatCurrency(item.amount)}</span>
                </div>
                <div className={styles.activityDetail}>
                  <span className={styles.detailLabel}>Reason</span>
                  <span className={styles.reason}>{item.reason}</span>
                </div>
              </div>
              <div className={styles.activityFooter}>
                <span className={styles.actionDate}>
                  {formatDateShort(item.actionDate)}
                </span>
                <div className={styles.footerActions}>
                  {item.status === 'pending' && (
                    <span className={styles.pendingBadge}>⏳ Pending</span>
                  )}
                  {/* Cancel button for pending requests I submitted */}
                  {item.status === 'pending' && item.actionType === 'submitted' && (
                    <button
                      type="button"
                      className={styles.cancelBtn}
                      onClick={() => handleCancel(item)}
                      disabled={isCancelling && cancellingId === item.id}
                      data-testid={`cancel-${item.id}`}
                    >
                      {isCancelling && cancellingId === item.id ? 'Cancelling...' : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MyActivityView
