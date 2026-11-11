'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'
import { useClearDifferentPerson } from '@/hooks/mutations/useClearDifferentPerson'
import { Modal } from '@/components/ui/Modal'
import styles from './BlockClear.module.css'

export interface ClearDifferentPersonModalProps {
  onClose: () => void
  /** Called with the request id once the clear has been sent. */
  onRequested: (requestId: string) => void
  /** The conversation the contact match stopped. */
  conversationId: string
  /** The earlier customer the contact matched. */
  matchedCustomerId: string
  /** "mobile", "email" or "mobile and email". */
  contactLabel: string
}

/**
 * Modal for the "Clear: different person" action on a verified-contact stop
 * (BTB-569). Same shape as ClearBlockModal: what will be cleared is stated,
 * not chosen, and a justification is required. No approval step.
 *
 * Mounted only while open, so it starts empty every time.
 */
export function ClearDifferentPersonModal({
  onClose,
  onRequested,
  conversationId,
  matchedCustomerId,
  contactLabel,
}: ClearDifferentPersonModalProps) {
  const { clearAsync, isPending } = useClearDifferentPerson()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [justification, setJustification] = useState('')

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const charCount = justification.trim().length
  const isValid = charCount >= MIN_APPROVAL_COMMENT_LENGTH

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!isValid) return

      try {
        const result = await clearAsync({ conversationId, justification: justification.trim() })
        onRequested(result.requestId)
      } catch {
        // Error is surfaced by the mutation hook's onError handler; keep modal open.
      }
    },
    [isValid, clearAsync, conversationId, justification, onRequested],
  )

  return (
    <Modal
      title="Clear: different person"
      onClose={onClose}
      dismissOnBackdropClick={!isPending}
      dismissOnEscape={!isPending}
      closeDisabled={isPending}
      testId="clear-different-person-modal"
      maxWidth="520px"
    >
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <div className={styles.approvalNotice} data-testid="different-person-notice">
            Use this only when the applicant is a different person who shares the {contactLabel}{' '}
            with customer {matchedCustomerId}.
          </div>

          <div className={styles.fieldGroup}>
            {/* Caption for a read-only display, not a control (see ClearBlockModal). */}
            <span className={styles.fieldLabel}>This will clear</span>
            <div className={styles.checkboxList} data-testid="match-to-clear">
              <span>
                <strong>
                  The {contactLabel} match with customer {matchedCustomerId}
                </strong>
              </span>
              <span>
                Customer {matchedCustomerId} stays blocked. This application stays declined; the
                applicant can apply again and will not be stopped by this match.
              </span>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="different-person-justification">
              Justification *
            </label>
            <textarea
              ref={textareaRef}
              id="different-person-justification"
              className={styles.textarea}
              placeholder="How you established this is a different person..."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={4}
              maxLength={1000}
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
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!isValid || isPending}
            data-testid="submit-button"
          >
            {isPending ? 'Submitting...' : 'Clear match'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
