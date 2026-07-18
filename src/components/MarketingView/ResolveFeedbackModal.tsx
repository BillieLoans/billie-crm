'use client'

import React, { useState } from 'react'
import { useSetFeedbackStatus } from '@/hooks/mutations/useMarketingCommands'
import type { FeedbackWithContact } from '@/hooks/queries/useFeedbackQueue'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface ResolveFeedbackModalProps {
  feedback: FeedbackWithContact
  onClose: () => void
}

/**
 * Resolution-note capture for the feedback queue. Resolving is an action taken
 * on behalf of a contact, so — like the approval flows' comments — it must say
 * what was done. The note travels on SetFeedbackStatus →
 * feedback.status.changed.v1 → the projection's statusNote, and shows in the
 * queue's Resolution column.
 */
export const ResolveFeedbackModal: React.FC<ResolveFeedbackModalProps> = ({
  feedback,
  onClose,
}) => {
  const [note, setNote] = useState('')
  const setStatusMutation = useSetFeedbackStatus()
  const canSubmit = !!note.trim() && !setStatusMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !feedback.feedbackId) return
    setStatusMutation.mutate(
      { feedbackId: feedback.feedbackId, status: 'resolved', note: note.trim() },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Modal title="Resolve feedback" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
            {setStatusMutation.isError && (
              <div className={styles.errorMessage}>
                {setStatusMutation.error instanceof Error
                  ? setStatusMutation.error.message
                  : 'Failed to resolve feedback'}
              </div>
            )}

            <blockquote className={styles.feedbackQuote}>{feedback.body ?? '—'}</blockquote>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="resolve-feedback-note">
                What was done?
              </label>
              <textarea
                id="resolve-feedback-note"
                autoFocus
                className={styles.noteTextarea}
                rows={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Called the contact, issue fixed in release 1.4"
                maxLength={2000}
              />
              <p className={styles.formHint}>Required — recorded against the feedback item.</p>
            </div>
          </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.btnSubmit} disabled={!canSubmit}>
            {setStatusMutation.isPending ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default ResolveFeedbackModal
