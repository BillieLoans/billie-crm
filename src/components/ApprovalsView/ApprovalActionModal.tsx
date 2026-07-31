'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'
import { Modal } from '@/components/ui/Modal'
import styles from './styles.module.css'

export type ActionType = 'approve' | 'reject'

export interface ApprovalActionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (comment: string) => Promise<void>
  actionType: ActionType
  requestNumber: string
  isPending: boolean
}

/**
 * Modal for approving or rejecting a write-off request.
 * Requires a mandatory comment (minimum 10 characters).
 */
export const ApprovalActionModal: React.FC<ApprovalActionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  actionType,
  requestNumber,
  isPending,
}) => {
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Reset state and focus when modal opens
  useEffect(() => {
    if (isOpen) {
      setComment('')
      setError(null)
      // Focus textarea on open
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Focus trap: keep focus within modal
  useEffect(() => {
    if (!isOpen) return

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault()
        lastElement?.focus()
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault()
        firstElement?.focus()
      }
    }

    document.addEventListener('keydown', handleTabKey)
    return () => document.removeEventListener('keydown', handleTabKey)
  }, [isOpen])

  const isApprove = actionType === 'approve'
  const title = isApprove ? 'Approve Write-Off' : 'Reject Write-Off'
  const confirmLabel = isApprove ? 'Approve' : 'Reject'
  const placeholder = isApprove
    ? 'Enter approval comment explaining your decision...'
    : 'Enter rejection reason explaining why this request was denied...'

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)

      const trimmed = comment.trim()
      if (trimmed.length < MIN_APPROVAL_COMMENT_LENGTH) {
        setError(`Comment must be at least ${MIN_APPROVAL_COMMENT_LENGTH} characters`)
        return
      }

      try {
        await onConfirm(trimmed)
        // Success: parent will close modal via handleModalConfirm
      } catch {
        // Error is handled by the mutation hook, keep modal open
      }
    },
    [comment, onConfirm]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) {
        onClose()
      }
    },
    [isPending, onClose]
  )

  if (!isOpen) return null

  const charCount = comment.trim().length
  const isValid = charCount >= MIN_APPROVAL_COMMENT_LENGTH

  return (
    <Modal
      title={title}
      onClose={onClose}
      dismissOnBackdropClick={!isPending}
      dismissOnEscape={!isPending}
      closeDisabled={isPending}
      testId="approval-action-modal"
      maxWidth="480px"
    >

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            <p className={styles.modalRequestInfo}>
              Request: <strong>{requestNumber}</strong>
            </p>

            <label className={styles.modalLabel} htmlFor="approval-comment">
              {isApprove ? 'Approval Comment' : 'Rejection Reason'} *
            </label>
            <textarea
              ref={textareaRef}
              id="approval-comment"
              className={styles.modalTextarea}
              placeholder={placeholder}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              disabled={isPending}
              data-testid="approval-comment-input"
            />
            <div className={styles.modalCharCount}>
              {charCount}/{MIN_APPROVAL_COMMENT_LENGTH} characters minimum
              {charCount >= MIN_APPROVAL_COMMENT_LENGTH && ' ✓'}
            </div>

            {error && (
              <p className={styles.modalError} role="alert">
                {error}
              </p>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.modalCancelBtn}
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`${styles.modalConfirmBtn} ${isApprove ? styles.modalConfirmApprove : styles.modalConfirmReject}`}
              disabled={!isValid || isPending}
              data-testid="modal-confirm-button"
            >
              {isPending ? 'Processing...' : confirmLabel}
            </button>
          </div>
        </form>
    </Modal>
  )
}

export default ApprovalActionModal
