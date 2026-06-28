'use client'

import React, { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'
import { ApprovalsList } from './ApprovalsList'
import { BlockClearList } from './BlockClearList'
import { HistoryTab } from './HistoryTab'
import { Breadcrumb } from '@/components/Breadcrumb'
import styles from './styles.module.css'

export type ApprovalTab = 'pending' | 'history'

export interface ApprovalsViewProps {
  /** Current user's role (for access control) */
  userRole?: 'admin' | 'supervisor' | 'operations' | 'readonly'
  /** Current user's ID (for segregation of duties) */
  userId?: string
  /** Current user's display name (for audit trail) */
  userName?: string
  /** Initial tab to display */
  initialTab?: ApprovalTab
}

/**
 * Main view for the approvals queue.
 * Displays pending write-off requests and approval history.
 *
 * Access Control:
 * - Allowed: admin, supervisor
 * - Denied: operations, readonly
 */
export const ApprovalsView: React.FC<ApprovalsViewProps> = ({
  userRole,
  userId,
  userName,
  initialTab = 'pending',
}) => {
  const [activeTab, setActiveTab] = useState<ApprovalTab>(initialTab)

  const handleTabChange = useCallback((tab: ApprovalTab) => {
    setActiveTab(tab)
  }, [])
  // Check access - only admin and supervisor can access
  const allowedRoles = ['admin', 'supervisor']
  const hasAccess = userRole && allowedRoles.includes(userRole)

  // Get pending count for header - use qs-esm for consistent query format
  const { data: pendingCount } = useQuery({
    queryKey: ['write-off-requests', 'pending', 'count'],
    queryFn: async () => {
      const queryString = stringify(
        { where: { status: { equals: 'pending' } }, limit: 0 },
        { addQueryPrefix: true },
      )
      const res = await fetch(`/api/write-off-requests${queryString}`)
      if (!res.ok) return 0
      const data = await res.json()
      return data.totalDocs ?? 0
    },
    staleTime: 30_000,
  })

  // Access denied
  if (!hasAccess) {
    return (
      <div className={styles.approvalsContainer}>
        <div className={styles.accessDenied} data-testid="access-denied">
          <span className={styles.accessDeniedIcon}>🔒</span>
          <h2 className={styles.accessDeniedTitle}>Access Denied</h2>
          <p className={styles.accessDeniedText}>
            You don&apos;t have permission to view the approvals queue. This area is restricted to
            supervisors and administrators.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.approvalsContainer} data-testid="approvals-view">
      {/* Breadcrumb navigation (Story 6.3) */}
      <Breadcrumb items={[{ label: 'Approvals' }]} />

      {/* Header */}
      <div className={styles.approvalsHeader}>
        <h1 className={styles.approvalsTitle}>Write-Off Approvals</h1>
      </div>

      {/* Tab Navigation */}
      <div className={styles.tabNav} role="tablist" aria-label="Approval views">
        <button
          type="button"
          role="tab"
          id="tab-pending"
          className={styles.tabButton}
          data-active={activeTab === 'pending'}
          aria-selected={activeTab === 'pending'}
          aria-controls="panel-pending"
          onClick={() => handleTabChange('pending')}
          data-testid="tab-pending"
        >
          Pending
          {typeof pendingCount === 'number' && pendingCount > 0 && (
            <span className={styles.tabBadge}>{pendingCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-history"
          className={styles.tabButton}
          data-active={activeTab === 'history'}
          aria-selected={activeTab === 'history'}
          aria-controls="panel-history"
          onClick={() => handleTabChange('history')}
          data-testid="tab-history"
        >
          History
        </button>
      </div>

      {/* Tab Content Panels */}
      {activeTab === 'pending' && (
        <div role="tabpanel" id="panel-pending" aria-labelledby="tab-pending">
          <ApprovalsList currentUserId={userId} currentUserName={userName} />

          {/* Block-clear requests queue — additive section, parallel to write-offs */}
          <div
            style={{
              marginTop: '2.5rem',
              borderTop: '1px solid var(--border)',
              paddingTop: '1.5rem',
            }}
            data-testid="block-clears-section"
          >
            <h2
              style={{
                fontSize: '1.125rem',
                fontWeight: 600,
                margin: '0 0 1rem 0',
                color: 'inherit',
              }}
            >
              Block Clear Requests
            </h2>
            <BlockClearList currentUserId={userId} currentUserName={userName} />
          </div>
        </div>
      )}
      {activeTab === 'history' && (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
          <HistoryTab />
        </div>
      )}
    </div>
  )
}

export default ApprovalsView
