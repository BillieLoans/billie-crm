'use client'

import React, { useState } from 'react'
import { useMergeContact } from '@/hooks/mutations/useMarketingCommands'
import type { IdentitySibling } from '@/hooks/queries/useContactIdentity'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface MergeContactsModalProps {
  survivorContactId: string
  survivorName: string
  sibling: IdentitySibling
  onClose: () => void
}

/**
 * Merge a duplicate record into the contact being viewed (the survivor).
 * Irreversible: the duplicate's interactions/feedback re-attach here and the
 * duplicate is tombstoned. Consent resolves conservatively platform-side —
 * an opt-out on either record wins. Requires typing MERGE.
 */
export const MergeContactsModal: React.FC<MergeContactsModalProps> = ({
  survivorContactId,
  survivorName,
  sibling,
  onClose,
}) => {
  const [confirmation, setConfirmation] = useState('')
  const merge = useMergeContact()

  const canSubmit = confirmation.trim() === 'MERGE' && !merge.isPending
  const siblingName = sibling.firstName ?? sibling.mobileE164 ?? sibling.email ?? 'this record'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    merge.mutate(
      { survivorContactId, mergedContactId: sibling.contactId },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Modal title="Merge contacts — irreversible" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {merge.isError && (
            <div className={styles.errorMessage}>
              {merge.error instanceof Error ? merge.error.message : 'Merge failed'}
            </div>
          )}

          <div className={styles.panelRow}>
            <span className={styles.panelRowLabel}>Keep</span>
            <span className={styles.panelRowValue}>{survivorName}</span>
          </div>
          <div className={styles.panelRow}>
            <span className={styles.panelRowLabel}>Absorb</span>
            <span className={styles.panelRowValue}>
              {siblingName}
              {sibling.mobileE164 ? ` · ${sibling.mobileE164}` : ''}
              {sibling.email ? ` · ${sibling.email}` : ''}
            </span>
          </div>

          <div className={styles.warningMessage}>
            The absorbed record&apos;s messages, feedback and history move onto this contact,
            and the absorbed record disappears from the grid. Consent resolves conservatively:
            an opt-out on <strong>either</strong> record wins. <strong>This cannot be undone.</strong>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="merge-confirmation">
              Type <strong>MERGE</strong> to confirm
            </label>
            <input
              id="merge-confirmation"
              autoFocus
              type="text"
              className={styles.formInput}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="MERGE"
              autoComplete="off"
            />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.btnDanger}
            disabled={!canSubmit}
            title={!canSubmit ? 'Type MERGE exactly to enable' : undefined}
          >
            {merge.isPending ? 'Merging…' : 'Merge permanently'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default MergeContactsModal
