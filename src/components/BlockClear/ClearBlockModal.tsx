'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'
import { CLEARABLE_REASONS, REASONS_REQUIRING_APPROVAL } from '@/lib/events/config'
import type { ClearableReason } from '@/lib/events/config'
import { formatBlockReason } from '@/lib/reapplicationBlock'
import { useRequestBlockClear } from '@/hooks/mutations/useRequestBlockClear'
import styles from './BlockClear.module.css'

export interface ClearBlockModalProps {
  isOpen: boolean
  onClose: () => void
  canonicalCustomerId: string
  currentReason?: string | null
  conversationId?: string
  customerName?: string
}

/**
 * Modal for submitting a reapplication block-clear request.
 *
 * The reason to clear is NOT a choice: the system already knows what is
 * blocking the customer (`currentReason`), so the modal states it read-only
 * and submits exactly that reason. (The wire protocol still accepts multiple
 * reasons — that flexibility is for API callers, not operators; a picker here
 * caused wrong-reason clears in testing.)
 *
 * When the reason is in REASONS_REQUIRING_APPROVAL the modal shows an approval
 * notice and labels the submit button "Request approval" (maker-checker path).
 * Otherwise it goes direct (single-operator path).
 */
export function ClearBlockModal({
  isOpen,
  onClose,
  canonicalCustomerId,
  currentReason,
  conversationId,
  customerName,
}: ClearBlockModalProps) {
  const { requestAsync, isPending } = useRequestBlockClear()
  const modalRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [justification, setJustification] = useState('')

  // Reset form state when the modal opens.
  useEffect(() => {
    if (isOpen) {
      setJustification('')
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Keyboard handler: Escape closes the modal (unless a submission is in-flight).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) {
        onClose()
      }
    },
    [isPending, onClose],
  )

  // The button only mounts this modal for a clearable reason; guard defensively anyway.
  const reasonToClear =
    currentReason != null && CLEARABLE_REASONS.includes(currentReason as ClearableReason)
      ? currentReason
      : null

  const requiresApproval =
    reasonToClear != null &&
    REASONS_REQUIRING_APPROVAL.includes(
      reasonToClear as (typeof REASONS_REQUIRING_APPROVAL)[number],
    )

  const charCount = justification.trim().length
  const isValid = reasonToClear != null && charCount >= MIN_APPROVAL_COMMENT_LENGTH

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!isValid || reasonToClear == null) return

      try {
        await requestAsync({
          canonicalCustomerId,
          reasons: [reasonToClear],
          justification: justification.trim(),
          conversationId,
          customerName,
        })
        onClose()
      } catch {
        // Error is surfaced by the mutation hook's onError handler; keep modal open.
      }
    },
    [
      isValid,
      requestAsync,
      canonicalCustomerId,
      reasonToClear,
      justification,
      conversationId,
      customerName,
      onClose,
    ],
  )

  if (!isOpen || reasonToClear == null) return null

  return (
    <div
      className={styles.modalOverlay}
      onClick={isPending ? undefined : onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-block-modal-title"
      data-testid="clear-block-modal"
    >
      <div
        ref={modalRef}
        className={styles.modalContent}
        onClick={(e) => e.stopPropagation()}
        role="document"
      >
        <div className={styles.modalHeader}>
          <h2 id="clear-block-modal-title" className={styles.modalTitle}>
            Clear Re-application Block
          </h2>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            disabled={isPending}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {requiresApproval && (
              <div className={styles.approvalNotice} data-testid="approval-notice">
                Approval required — this clear will be sent for supervisor approval before taking
                effect.
              </div>
            )}

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel}>This will clear</label>
              <div className={styles.checkboxList} data-testid="reason-to-clear">
                <span>
                  <strong>{formatBlockReason(reasonToClear)}</strong>
                  {requiresApproval && (
                    <span className={styles.approvalBadge}>Approval required</span>
                  )}
                </span>
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="block-clear-justification">
                Justification *
              </label>
              <textarea
                ref={textareaRef}
                id="block-clear-justification"
                className={styles.textarea}
                placeholder="Enter your justification for clearing this block..."
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={4}
                disabled={isPending}
                data-testid="justification-input"
              />
              <div className={styles.charCount}>
                {charCount}/{MIN_APPROVAL_COMMENT_LENGTH} characters minimum
                {charCount >= MIN_APPROVAL_COMMENT_LENGTH && ' ✓'}
              </div>
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={!isValid || isPending}
              data-testid="submit-button"
            >
              {isPending ? 'Submitting...' : requiresApproval ? 'Request approval' : 'Clear block'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
