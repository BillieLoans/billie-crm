'use client'

import React, { useState } from 'react'
import { useCreateBatch } from '@/hooks/mutations/useMarketingCommands'
import { useEscapeClose } from '@/hooks/useModalA11y'
import styles from './styles.module.css'

interface NewBatchModalProps {
  /**
   * Segment snapshot the batch is being built from — the grid's active
   * filters. Stored verbatim as the batch's `criteria` so the batch records
   * what defined its membership at creation time.
   */
  criteria: Record<string, string>
  onClose: () => void
  onSuccess: (batchId: string) => void
}

/**
 * Staff-initiated batch creation (spec §5.4). Posts to
 * MarketingService.CreateBatch via /api/marketing/batches — the batch is
 * created in the marketing system of record and projects back into the batch
 * pickers. Reached from the assign bar's "＋ New batch…" option, so on success
 * the caller pre-selects the new batch as the assign target.
 */
export const NewBatchModal: React.FC<NewBatchModalProps> = ({ criteria, onClose, onSuccess }) => {
  const [name, setName] = useState('')

  const create = useCreateBatch()
  const canSubmit = !!name.trim() && !create.isPending
  const criteriaEntries = Object.entries(criteria)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    create.mutate({ name: name.trim(), criteria }, { onSuccess: (res) => onSuccess(res.batchId) })
  }

  useEscapeClose(onClose)

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>New batch</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {create.isError && (
              <div className={styles.errorMessage}>
                {create.error instanceof Error ? create.error.message : 'Failed to create batch'}
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-batch-name">
                Batch name
              </label>
              <input
                id="new-batch-name"
                autoFocus
                type="text"
                className={styles.formInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Campus wave 2"
              />
            </div>

            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Criteria snapshot</span>
              {criteriaEntries.length === 0 ? (
                <p className={styles.formHint}>None — no grid filters are active.</p>
              ) : (
                <ul className={styles.criteriaList}>
                  {criteriaEntries.map(([key, value]) => (
                    <li key={key} className={styles.formHint}>
                      {key}: {value}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnSubmit} disabled={!canSubmit}>
              {create.isPending ? 'Creating…' : 'Create batch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NewBatchModal
