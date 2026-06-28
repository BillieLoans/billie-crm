'use client'

import React, { useState, useCallback } from 'react'
import { ContextDrawer, CopyButton } from '@/components/ui'
import type { BlockClearRequest } from '@/hooks/queries/usePendingBlockClears'
import { useApproveBlockClear } from '@/hooks/mutations/useApproveBlockClear'
import { useRejectBlockClear } from '@/hooks/mutations/useRejectBlockClear'
import { formatDateMedium } from '@/lib/formatters'
import { ApprovalActionModal, type ActionType } from './ApprovalActionModal'
import styles from './styles.module.css'

export interface BlockClearDetailDrawerProps {
  request: BlockClearRequest | null
  isOpen: boolean
  onClose: () => void
  /** Current user's ID for segregation of duties check */
  currentUserId?: string
  /** Current user's name for audit trail */
  currentUserName?: string
}

/**
 * Drawer showing detailed information about a reapplication block-clear request.
 * Includes approve/reject actions with segregation of duties (self-approval disabled).
 *
 * Parallel to ApprovalDetailDrawer — does not modify the write-off approval path.
 */
export const BlockClearDetailDrawer: React.FC<BlockClearDetailDrawerProps> = ({
  request,
  isOpen,
  onClose,
  currentUserId,
  currentUserName: _currentUserName,
}) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalAction, setModalAction] = useState<ActionType>('approve')

  const { approveAsync, isPending: isApproving } = useApproveBlockClear()
  const { rejectAsync, isPending: isRejecting } = useRejectBlockClear()

  const isPending = isApproving || isRejecting

  // Segregation of duties: cannot approve own request.
  // Handle requestedBy being either a string ID or a populated user object.
  // Mirrors ApprovalDetailDrawer.getRequestedById exactly.
  const getRequestedById = (): string | undefined => {
    if (!request?.requestedBy) return undefined
    if (typeof request.requestedBy === 'object' && request.requestedBy !== null) {
      return String((request.requestedBy as { id?: string | number }).id)
    }
    return String(request.requestedBy)
  }

  const requestedById = getRequestedById()
  const isOwnRequest = Boolean(
    currentUserId && requestedById && String(currentUserId) === requestedById,
  )

  const handleApproveClick = useCallback(() => {
    setModalAction('approve')
    setModalOpen(true)
  }, [])

  const handleRejectClick = useCallback(() => {
    setModalAction('reject')
    setModalOpen(true)
  }, [])

  const handleModalClose = useCallback(() => {
    setModalOpen(false)
  }, [])

  const handleModalConfirm = useCallback(
    async (comment: string) => {
      if (!request) return

      // Use requestId for event correlation, fallback to id for older records
      const requestId = request.requestId || request.id

      if (modalAction === 'approve') {
        await approveAsync({
          requestId,
          requestNumber: request.requestNumber,
          comment,
        })
      } else {
        await rejectAsync({
          requestId,
          requestNumber: request.requestNumber,
          reason: comment,
        })
      }

      setModalOpen(false)
      onClose()
    },
    [request, modalAction, approveAsync, rejectAsync, onClose],
  )

  if (!request) return null

  const requestDate = new Date(request.requestedAt || request.createdAt)

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title="Block-Clear Request Details">
      {/* Request Number Header */}
      <div className={styles.detailHeader}>
        <span className={styles.detailRequestNumber}>{request.requestNumber}</span>
      </div>

      {/* Customer Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Customer</h4>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Customer Name</span>
            <span className={styles.detailValue}>{request.customerName || 'Unknown Customer'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Canonical Customer ID</span>
            <span className={`${styles.detailValue} ${styles.detailValueMono}`}>
              {request.canonicalCustomerId}
              <CopyButton value={request.canonicalCustomerId} label="Copy canonical customer ID" />
            </span>
          </div>
        </div>
      </div>

      {/* Block Reasons Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Block Reasons</h4>
        <ul data-testid="block-reasons-list" style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {request.reasons.map((reason) => (
            <li key={reason} style={{ textTransform: 'capitalize', marginBottom: '0.25rem' }}>
              {reason.replace(/_/g, ' ')}
            </li>
          ))}
        </ul>
      </div>

      {/* Justification Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Justification</h4>
        {request.justification ? (
          <div className={styles.detailNotes}>{request.justification}</div>
        ) : (
          <div className={`${styles.detailNotes} ${styles.detailNoNotes}`}>
            No justification provided.
          </div>
        )}
      </div>

      {/* Request Details Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Request Details</h4>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Requested By</span>
            <span className={styles.detailValue}>{request.requestedByName || 'Unknown User'}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Requested At</span>
            <span className={styles.detailValue}>{formatDateMedium(requestDate)}</span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Status</span>
            <span className={styles.detailValue} style={{ textTransform: 'capitalize' }}>
              {request.status}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {request.status === 'pending' && (
        <div className={styles.actionButtons}>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnApprove}`}
            onClick={handleApproveClick}
            disabled={isPending || isOwnRequest}
            title={isOwnRequest ? 'Cannot approve your own request' : 'Approve this request'}
            data-testid="approve-button"
          >
            ✓ Approve
            {isOwnRequest && (
              <span className={styles.actionBtnDisabledReason}>Cannot approve own request</span>
            )}
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnReject}`}
            onClick={handleRejectClick}
            disabled={isPending}
            data-testid="reject-button"
          >
            ✕ Reject
          </button>
        </div>
      )}

      {/* Approval Action Modal */}
      <ApprovalActionModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        onConfirm={handleModalConfirm}
        actionType={modalAction}
        requestNumber={request.requestNumber}
        isPending={isPending}
      />
    </ContextDrawer>
  )
}

export default BlockClearDetailDrawer
