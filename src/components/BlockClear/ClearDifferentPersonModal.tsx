'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'
import { useClearDifferentPerson } from '@/hooks/mutations/useClearDifferentPerson'
import { useUndoDifferentPersonClear } from '@/hooks/mutations/useUndoDifferentPersonClear'
import { Modal } from '@/components/ui/Modal'
import styles from './BlockClear.module.css'

export interface ClearDifferentPersonModalProps {
  /**
   * "clear" (default) clears the contact match as a different person. "undo"
   * takes that clear back: same person after all.
   */
  mode?: 'clear' | 'undo'
  onClose: () => void
  /** Called with the request id once the clear (or its undo) has been sent. */
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
 * In "undo" mode the same form takes the clear back ("Undo: same person after
 * all"), with the same justification minimum.
 *
 * Mounted only while open, so it starts empty every time.
 */
export function ClearDifferentPersonModal({
  mode = 'clear',
  onClose,
  onRequested,
  conversationId,
  matchedCustomerId,
  contactLabel,
}: ClearDifferentPersonModalProps) {
  const clear = useClearDifferentPerson()
  const undoClear = useUndoDifferentPersonClear()
  const undo = mode === 'undo'
  const isPending = undo ? undoClear.isPending : clear.isPending
  const submitAsync = undo ? undoClear.undoAsync : clear.clearAsync
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
        const result = await submitAsync({ conversationId, justification: justification.trim() })
        onRequested(result.requestId)
      } catch {
        // Error is surfaced by the mutation hook's onError handler; keep modal open.
      }
    },
    [isValid, submitAsync, conversationId, justification, onRequested],
  )

  return (
    <Modal
      title={undo ? 'Undo: same person after all' : 'Clear: different person'}
      onClose={onClose}
      dismissOnBackdropClick={!isPending}
      dismissOnEscape={!isPending}
      closeDisabled={isPending}
      testId={undo ? 'undo-different-person-clear-modal' : 'clear-different-person-modal'}
      maxWidth="520px"
    >
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <div className={styles.approvalNotice} data-testid="different-person-notice">
            {undo ? (
              <>
                Use this only when the applicant turned out to be customer {matchedCustomerId} after
                all, so the earlier clear was wrong.
              </>
            ) : (
              <>
                Use this only when the applicant is a different person who shares the {contactLabel}{' '}
                with customer {matchedCustomerId}.
              </>
            )}
          </div>

          <div className={styles.fieldGroup}>
            {/* Caption for a read-only display, not a control (see ClearBlockModal). */}
            <span className={styles.fieldLabel}>{undo ? 'This will undo' : 'This will clear'}</span>
            <div className={styles.checkboxList} data-testid="match-to-clear">
              <span>
                <strong>
                  {undo ? 'The clear of the' : 'The'} {contactLabel} match with customer{' '}
                  {matchedCustomerId}
                </strong>
              </span>
              {undo ? (
                <span>
                  The {contactLabel} will stop applications again. Customer {matchedCustomerId}{' '}
                  stays blocked, as they were throughout. The match can be cleared again later.
                </span>
              ) : (
                <span>
                  Customer {matchedCustomerId} stays blocked. This application stays declined; the
                  applicant can apply again and will not be stopped by this match.
                </span>
              )}
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
              placeholder={
                undo
                  ? 'How you established this is the same person...'
                  : 'How you established this is a different person...'
              }
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
            {isPending ? 'Submitting...' : undo ? 'Undo clear' : 'Clear match'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
