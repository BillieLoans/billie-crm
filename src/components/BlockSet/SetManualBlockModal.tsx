'use client'

import React, { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useSetManualBlock } from '@/hooks/mutations/useSetManualBlock'
import {
  MANUAL_BLOCK_REASON_CODES,
  MANUAL_BLOCK_REASON_LABELS,
  type ManualBlockReasonCode,
} from '@/lib/reapplicationBlock'
import { sydneyDateString } from '@/lib/disbursement-cutoff'
import styles from './BlockSet.module.css'

export interface SetManualBlockModalProps {
  onClose: () => void
  /** Called with billieChat's request id once the request is sent (202). */
  onRequested: (requestId: string) => void
  canonicalCustomerId: string
  customerName?: string
  /** The reason the form starts on. */
  defaultReasonCode?: ManualBlockReasonCode
}

/**
 * "Set manual block" (BTB-517): ask billieChat to put a MANUAL_ADMIN
 * re-application block on the customer. Supervisor/admin only: it opens only
 * from the Cancel loan drawer, whose action needs approval authority, and the
 * route checks it again.
 *
 * Sending the request is all this does. The block reaches the customer record
 * later, so the caller is handed the request id and watches for it. Mount it
 * only while open: each open is a fresh form.
 */
export function SetManualBlockModal({
  onClose,
  onRequested,
  canonicalCustomerId,
  customerName,
  defaultReasonCode = 'cancelled_pre_disbursement',
}: SetManualBlockModalProps) {
  const { mutateAsync, isPending, error } = useSetManualBlock()
  const [reasonCode, setReasonCode] = useState<ManualBlockReasonCode>(defaultReasonCode)
  const [note, setNote] = useState('')
  const [blockUntil, setBlockUntil] = useState('')

  const isValid = note.trim().length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return
    try {
      const { requestId } = await mutateAsync({
        canonicalCustomerId,
        reasonCode,
        note: note.trim(),
        blockUntil: blockUntil || null,
      })
      onRequested(requestId)
    } catch {
      // Shown below from the mutation's error; the modal stays open to retry.
    }
  }

  return (
    <Modal
      title="Set manual block"
      onClose={onClose}
      dismissOnBackdropClick={!isPending}
      dismissOnEscape={!isPending}
      closeDisabled={isPending}
      testId="set-manual-block-modal"
      maxWidth="520px"
    >
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <p className={styles.intro}>
            Stops {customerName || 'this customer'} from starting a new application until a
            supervisor clears the block.
          </p>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="manual-block-reason">
              Reason
            </label>
            <select
              id="manual-block-reason"
              className={styles.input}
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as ManualBlockReasonCode)}
              disabled={isPending}
            >
              {MANUAL_BLOCK_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {MANUAL_BLOCK_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="manual-block-note">
              Note
            </label>
            <textarea
              id="manual-block-note"
              className={styles.textarea}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              required
              aria-describedby="manual-block-note-hint"
              disabled={isPending}
            />
            <p id="manual-block-note-hint" className={styles.hint}>
              Kept with the block, for whoever reviews it.
            </p>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="manual-block-until">
              Block until (optional)
            </label>
            <input
              id="manual-block-until"
              type="date"
              className={styles.input}
              value={blockUntil}
              min={sydneyDateString(new Date())}
              onChange={(e) => setBlockUntil(e.target.value)}
              aria-describedby="manual-block-until-hint"
              disabled={isPending}
            />
            <p id="manual-block-until-hint" className={styles.hint}>
              The block ends after this day. Leave it empty to keep the block until it is cleared.
            </p>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error instanceof Error
                ? error.message
                : 'The block request was not sent. Try again.'}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={isPending}
          >
            Back
          </button>
          <button type="submit" className={styles.primaryBtn} disabled={!isValid || isPending}>
            {isPending ? 'Sending…' : 'Set manual block'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
