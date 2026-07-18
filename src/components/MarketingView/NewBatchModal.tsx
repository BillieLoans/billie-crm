'use client'

import React, { useState } from 'react'
import { useCreateBatch } from '@/hooks/mutations/useMarketingCommands'
import { describeCriteria } from '@/lib/marketing-labels'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface NewBatchModalProps {
  /**
   * Segment snapshot the campaign is being built from — the grid's active
   * filters. Stored verbatim as the batch's `criteria` so the campaign
   * records what defined its membership at creation time.
   */
  criteria: Record<string, string>
  onClose: () => void
  onSuccess: (batchId: string) => void
}

/**
 * Staff-initiated campaign creation (spec §5.4 — "batch" in the platform
 * vocabulary). Posts to MarketingService.CreateBatch via
 * /api/marketing/batches — the campaign is created in the marketing system of
 * record and projects back into the pickers. Reached from the bulk bar's
 * "＋ New campaign…" option and the Campaigns page.
 */
export const NewBatchModal: React.FC<NewBatchModalProps> = ({ criteria, onClose, onSuccess }) => {
  const [name, setName] = useState('')

  const create = useCreateBatch()
  const canSubmit = !!name.trim() && !create.isPending
  const criteriaEntries = describeCriteria(criteria)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    create.mutate({ name: name.trim(), criteria }, { onSuccess: (res) => onSuccess(res.batchId) })
  }

  return (
    <Modal title="New campaign" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {create.isError && (
            <div className={styles.errorMessage}>
              {create.error instanceof Error ? create.error.message : 'Failed to create campaign'}
            </div>
          )}

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="new-batch-name">
              Campaign name
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
            <span className={styles.formLabel}>Built from</span>
            {criteriaEntries.length === 0 ? (
              <p className={styles.formHint}>
                No grid filters are active — the campaign starts empty and records no segment
                criteria.
              </p>
            ) : (
              <ul className={styles.criteriaList}>
                {criteriaEntries.map((entry) => (
                  <li key={entry.label} className={styles.formHint}>
                    {entry.label}: {entry.value}
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
            {create.isPending ? 'Creating…' : 'Create campaign'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default NewBatchModal
