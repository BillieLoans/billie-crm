'use client'

import React, { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import styles from './styles.module.css'

interface AdjustmentModalProps {
  loanAccountId: string
  onClose: () => void
  onSuccess: () => void
}

export const AdjustmentModal: React.FC<AdjustmentModalProps> = ({
  loanAccountId,
  onClose,
  onSuccess,
}) => {
  const [adjustmentType, setAdjustmentType] = useState<'principal' | 'fee'>('principal')
  const [amount, setAmount] = useState('')
  const [isCredit, setIsCredit] = useState(false)
  const [reason, setReason] = useState('')
  const [authorizedBy, setAuthorizedBy] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Calculate the delta based on type and direction
      const adjustedAmount = isCredit ? `-${amount}` : amount
      const principalDelta = adjustmentType === 'principal' ? adjustedAmount : '0'
      const feeDelta = adjustmentType === 'fee' ? adjustedAmount : '0'
      
      const res = await fetch('/api/ledger/adjustment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanAccountId,
          principalDelta,
          feeDelta,
          reason,
          approvedBy: authorizedBy || 'System',
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to apply adjustment')
      }

      setSuccess(true)
      setTimeout(() => {
        onSuccess()
      }, 1500)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Manual Adjustment"
      icon="⚖️"
      onClose={onClose}
      dismissOnBackdropClick={!loading}
    >

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {error && (
              <div className={styles.errorMessage}>{error}</div>
            )}

            {success ? (
              <div className={styles.successMessage}>
                Adjustment applied successfully!
              </div>
            ) : (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="adjustment-type">
                    Adjustment Type *
                  </label>
                  <select
                    id="adjustment-type"
                    className={styles.formSelect}
                    value={adjustmentType}
                    onChange={(e) => setAdjustmentType(e.target.value as 'principal' | 'fee')}
                    required
                  >
                    <option value="principal">Principal Adjustment</option>
                    <option value="fee">Fee Adjustment</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  {/* A group of radios has no single control to label, so the caption is
                      a span and the group carries the accessible name (ARIA APG radiogroup). */}
                  <span className={styles.formLabel} id="adjustment-direction-label">
                    Direction *
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="adjustment-direction-label"
                    style={{ display: 'flex', gap: '1rem' }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="direction"
                        checked={!isCredit}
                        onChange={() => setIsCredit(false)}
                      />
                      <span>Debit (increase balance)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="direction"
                        checked={isCredit}
                        onChange={() => setIsCredit(true)}
                      />
                      <span>Credit (reduce balance)</span>
                    </label>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="adjustment-amount">
                    Amount *
                  </label>
                  <input
                    id="adjustment-amount"
                    type="number"
                    className={styles.formInput}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="adjustment-reason">
                    Reason *
                  </label>
                  <textarea
                    id="adjustment-reason"
                    className={styles.formInput}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain the reason for this adjustment..."
                    rows={3}
                    required
                    style={{ resize: 'vertical', minHeight: '80px' }}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="adjustment-authorized-by">
                    Authorized By
                  </label>
                  <input
                    id="adjustment-authorized-by"
                    type="text"
                    className={styles.formInput}
                    value={authorizedBy}
                    onChange={(e) => setAuthorizedBy(e.target.value)}
                    placeholder="Manager name or ID"
                  />
                </div>

                <div className={styles.warningBox}>
                  ⚠️ Manual adjustments are audited and require proper documentation.
                </div>
              </>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              {success ? 'Close' : 'Cancel'}
            </button>
            {!success && (
              <button 
                type="submit" 
                className={styles.btnSubmit}
                disabled={loading || !amount || !reason}
              >
                {loading ? 'Processing...' : 'Apply Adjustment'}
              </button>
            )}
          </div>
      </form>
    </Modal>
  )
}

