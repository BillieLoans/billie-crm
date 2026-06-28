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
 * Presents a multi-select of clearable reasons (CLEARABLE_REASONS) and a
 * mandatory justification field. When the operator selects a reason in
 * REASONS_REQUIRING_APPROVAL, the modal shows an approval notice and labels
 * the submit button "Request approval" (maker-checker path). Otherwise it
 * goes direct (single-operator path).
 *
 * Pre-selects the block's current reason when it is clearable.
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

  const [selectedReasons, setSelectedReasons] = useState<string[]>([])
  const [justification, setJustification] = useState('')

  // Reset form state when modal opens; pre-select current reason if clearable.
  useEffect(() => {
    if (isOpen) {
      const isClearable =
        currentReason != null && CLEARABLE_REASONS.includes(currentReason as ClearableReason)
      setSelectedReasons(isClearable ? [currentReason!] : [])
      setJustification('')
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [isOpen, currentReason])

  // Keyboard handler: Escape closes the modal (unless a submission is in-flight).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) {
        onClose()
      }
    },
    [isPending, onClose],
  )

  const toggleReason = useCallback((reason: string) => {
    setSelectedReasons((prev) =>
      prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason],
    )
  }, [])

  const requiresApproval = selectedReasons.some((r) =>
    REASONS_REQUIRING_APPROVAL.includes(r as (typeof REASONS_REQUIRING_APPROVAL)[number]),
  )

  const charCount = justification.trim().length
  const isValid = selectedReasons.length > 0 && charCount >= MIN_APPROVAL_COMMENT_LENGTH

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!isValid) return

      try {
        await requestAsync({
          canonicalCustomerId,
          reasons: selectedReasons,
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
      selectedReasons,
      justification,
      conversationId,
      customerName,
      onClose,
    ],
  )

  if (!isOpen) return null

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
              <label className={styles.fieldLabel}>Reasons for clearing *</label>
              <div className={styles.checkboxList}>
                {CLEARABLE_REASONS.map((reason) => (
                  <label key={reason} className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={selectedReasons.includes(reason)}
                      onChange={() => toggleReason(reason)}
                      disabled={isPending}
                      data-testid={`reason-checkbox-${reason}`}
                    />
                    <span>{formatBlockReason(reason)}</span>
                    {REASONS_REQUIRING_APPROVAL.includes(
                      reason as (typeof REASONS_REQUIRING_APPROVAL)[number],
                    ) && <span className={styles.approvalBadge}>Approval required</span>}
                  </label>
                ))}
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
