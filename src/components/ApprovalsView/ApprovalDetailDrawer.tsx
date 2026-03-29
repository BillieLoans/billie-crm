'use client'

import React, { useState, useCallback } from 'react'
import { ContextDrawer, CopyButton } from '@/components/ui'
import type { WriteOffApproval } from '@/hooks/queries/usePendingApprovals'
import { useApproveWriteOff } from '@/hooks/mutations/useApproveWriteOff'
import { useRejectWriteOff } from '@/hooks/mutations/useRejectWriteOff'
import { useCancelWriteOff } from '@/hooks/mutations/useCancelWriteOff'
import { SENIOR_APPROVAL_THRESHOLD } from '@/hooks/mutations/useWriteOffRequest'
import { formatCurrency, formatDateMedium } from '@/lib/formatters'
import { ApprovalActionModal, type ActionType } from './ApprovalActionModal'
import styles from './styles.module.css'

export interface ApprovalDetailDrawerProps {
  approval: WriteOffApproval | null
  isOpen: boolean
  onClose: () => void
  /** Current user's ID for segregation of duties check */
  currentUserId?: string
  /** Current user's name for audit trail */
  currentUserName?: string
}

/**
 * Drawer showing detailed information about a write-off approval request.
 * Includes approve/reject actions with segregation of duties.
 */
export const ApprovalDetailDrawer: React.FC<ApprovalDetailDrawerProps> = ({
  approval,
  isOpen,
  onClose,
  currentUserId,
  currentUserName: _currentUserName,
}) => {
  const [modalOpen, setModalOpen] = useState(false)
  const [modalAction, setModalAction] = useState<ActionType>('approve')

  const { approveRequestAsync, isPending: isApproving } = useApproveWriteOff()
  const { rejectRequestAsync, isPending: isRejecting } = useRejectWriteOff()
  const { cancelRequestAsync, isPending: isCancelling } = useCancelWriteOff()

  const isPending = isApproving || isRejecting || isCancelling

  // Segregation of duties: cannot approve own request, but CAN cancel own request
  // Handle requestedBy being either a string ID or a populated user object
  const getRequestedById = (): string | undefined => {
    if (!approval?.requestedBy) return undefined
    // If it's a populated user object, get the id
    if (typeof approval.requestedBy === 'object' && approval.requestedBy !== null) {
      return String((approval.requestedBy as { id?: string | number }).id)
    }
    // Otherwise it's a string ID
    return String(approval.requestedBy)
  }
  
  const requestedById = getRequestedById()
  const isOwnRequest = Boolean(
    currentUserId && 
    requestedById && 
    String(currentUserId) === requestedById
  )
  
  // Debug log to help troubleshoot
  if (approval && process.env.NODE_ENV === 'development') {
    console.log('[ApprovalDetailDrawer] isOwnRequest check:', {
      currentUserId,
      requestedBy: approval.requestedBy,
      requestedById,
      isOwnRequest,
    })
  }

  const handleApproveClick = useCallback(() => {
    setModalAction('approve')
    setModalOpen(true)
  }, [])

  const handleRejectClick = useCallback(() => {
    setModalAction('reject')
    setModalOpen(true)
  }, [])

  const handleCancelClick = useCallback(async () => {
    if (!approval) return

    // Confirm before cancelling
    const confirmed = window.confirm(
      `Are you sure you want to cancel write-off request ${approval.requestNumber}?\n\nThis action cannot be undone.`
    )
    if (!confirmed) return

    const requestId = approval.requestId || approval.id
    await cancelRequestAsync({
      requestId,
      requestNumber: approval.requestNumber,
    })
    onClose()
  }, [approval, cancelRequestAsync, onClose])

  const handleModalClose = useCallback(() => {
    setModalOpen(false)
  }, [])

  const handleModalConfirm = useCallback(
    async (comment: string) => {
      if (!approval) return

      // Use requestId for event correlation, fallback to id for older records
      const requestId = approval.requestId || approval.id

      if (modalAction === 'approve') {
        await approveRequestAsync({
          requestId,
          requestNumber: approval.requestNumber,
          comment,
        })
      } else {
        await rejectRequestAsync({
          requestId,
          requestNumber: approval.requestNumber,
          reason: comment,
        })
      }

      // Close modal and drawer after successful action
      setModalOpen(false)
      onClose()
    },
    [approval, modalAction, approveRequestAsync, rejectRequestAsync, onClose]
  )

  if (!approval) return null

  const requestDate = new Date(approval.requestedAt || approval.createdAt)

  return (
    <ContextDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Write-Off Request Details"
    >
      {/* Request Number Header */}
      <div className={styles.detailHeader}>
        <span className={styles.detailRequestNumber}>{approval.requestNumber}</span>
        <span className={styles.reasonBadge}>{approval.reason}</span>
      </div>

      {/* Senior Approval Warning */}
      {approval.requiresSeniorApproval && (
        <div className={styles.seniorApprovalFlag}>
          <span className={styles.seniorApprovalIcon}>⚠️</span>
          <span>This request requires senior approval (amount ≥ {formatCurrency(SENIOR_APPROVAL_THRESHOLD)})</span>
        </div>
      )}

      {/* Amount Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Amount</h4>
        <div className={styles.detailAmount}>
          {formatCurrency(approval.amount)}
        </div>
        <div className={styles.detailLabel}>
          Original Balance: {formatCurrency(approval.originalBalance)}
        </div>
      </div>

      {/* Customer & Account Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Customer & Account</h4>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Customer</span>
            <span className={styles.detailValue}>
              {approval.customerName || 'Unknown'}
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Customer ID</span>
            <span className={`${styles.detailValue} ${styles.detailValueMono}`}>
              {approval.customerId}
              <CopyButton value={approval.customerId} label="Copy customer ID" />
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Account Number</span>
            <span className={`${styles.detailValue} ${styles.detailValueMono}`}>
              {approval.accountNumber || '—'}
              {approval.accountNumber && (
                <CopyButton value={approval.accountNumber} label="Copy account number" />
              )}
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Loan Account ID</span>
            <span className={`${styles.detailValue} ${styles.detailValueMono}`}>
              {approval.loanAccountId}
              <CopyButton value={approval.loanAccountId} label="Copy loan account ID" />
            </span>
          </div>
        </div>
      </div>

      {/* Request Details Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Request Details</h4>
        <div className={styles.detailGrid}>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Requested By</span>
            <span className={styles.detailValue}>
              {approval.requestedByName || 'Unknown User'}
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Requested At</span>
            <span className={styles.detailValue}>
              {formatDateMedium(requestDate)}
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Reason</span>
            <span className={styles.detailValue} style={{ textTransform: 'capitalize' }}>
              {approval.reason.replace(/-/g, ' ')}
            </span>
          </div>
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>Status</span>
            <span className={styles.detailValue} style={{ textTransform: 'capitalize' }}>
              {approval.status}
            </span>
          </div>
        </div>
      </div>

      {/* Notes Section */}
      <div className={styles.detailSection}>
        <h4 className={styles.detailSectionTitle}>Supporting Notes</h4>
        {approval.notes ? (
          <div className={styles.detailNotes}>{approval.notes}</div>
        ) : (
          <div className={`${styles.detailNotes} ${styles.detailNoNotes}`}>
            No supporting notes provided.
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {approval.status === 'pending' && (
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
              <span className={styles.actionBtnDisabledReason}>
                Cannot approve own request
              </span>
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
          {/* Cancel button - only shown to original requester */}
          {isOwnRequest && (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnCancel}`}
              onClick={handleCancelClick}
              disabled={isPending}
              title="Cancel your own request"
              data-testid="cancel-button"
            >
              Cancel Request
            </button>
          )}
        </div>
      )}

      {/* Approval Action Modal */}
      <ApprovalActionModal
        isOpen={modalOpen}
        onClose={handleModalClose}
        onConfirm={handleModalConfirm}
        actionType={modalAction}
        requestNumber={approval.requestNumber}
        isPending={isPending}
      />
    </ContextDrawer>
  )
}

export default ApprovalDetailDrawer
