'use client'

import React, { useState } from 'react'
import { useEraseContact } from '@/hooks/mutations/useMarketingCommands'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface EraseContactModalProps {
  contactId: string
  /** Display name used as the typed confirmation phrase. */
  contactName: string | null
  onClose: () => void
}

/**
 * Privacy erasure (right to be forgotten) — irreversible, admin-only (the
 * route enforces isAdmin; the button is also gated in the UI). Requires
 * typing the confirmation phrase exactly, mirroring the friction of the
 * approval flows: an erase must never be a slip of the mouse.
 */
export const EraseContactModal: React.FC<EraseContactModalProps> = ({
  contactId,
  contactName,
  onClose,
}) => {
  const [confirmation, setConfirmation] = useState('')
  const erase = useEraseContact()

  const phrase = contactName?.trim() || 'ERASE'
  const canSubmit = confirmation.trim() === phrase && !erase.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    erase.mutate(contactId, { onSuccess: () => onClose() })
  }

  return (
    <Modal title="Erase contact — irreversible" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {erase.isError && (
            <div className={styles.errorMessage}>
              {erase.error instanceof Error ? erase.error.message : 'Erasure failed'}
            </div>
          )}

          <div className={styles.errorMessage}>
            This permanently removes the person&apos;s data everywhere: personal details,
            message contents, feedback text, consent evidence, and their entries in the
            underlying event history. A tombstone remains so the record cannot silently
            reappear. <strong>This cannot be undone.</strong>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="erase-confirmation">
              Type <strong>{phrase}</strong> to confirm
            </label>
            <input
              id="erase-confirmation"
              autoFocus
              type="text"
              className={styles.formInput}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={phrase}
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
            title={!canSubmit ? `Type "${phrase}" exactly to enable` : undefined}
          >
            {erase.isPending ? 'Erasing…' : 'Erase permanently'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default EraseContactModal
