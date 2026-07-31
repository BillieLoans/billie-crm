'use client'

import React, { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import styles from './styles.module.css'

interface ApplyLateFeeModalProps {
  loanAccountId: string
  onClose: () => void
  onSuccess: () => void
}

export const ApplyLateFeeModal: React.FC<ApplyLateFeeModalProps> = ({
  loanAccountId,
  onClose,
  onSuccess,
}) => {
  const [feeAmount, setFeeAmount] = useState('10.00')
  const [daysPastDue, setDaysPastDue] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/ledger/late-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanAccountId,
          feeAmount: parseFloat(feeAmount),
          daysPastDue: parseInt(daysPastDue),
          reason: reason || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to apply late fee')
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
    <Modal title="Apply Late Fee" icon="⚠️" onClose={onClose} dismissOnBackdropClick={!loading}>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {error && <div className={styles.errorMessage}>{error}</div>}
            {success && (
              <div className={styles.successMessage}>
                Late fee applied successfully!
              </div>
            )}

            {!success && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="late-fee-amount">
                    Fee Amount *
                  </label>
                  <input
                    id="late-fee-amount"
                    type="number"
                    className={styles.formInput}
                    value={feeAmount}
                    onChange={(e) => setFeeAmount(e.target.value)}
                    placeholder="10.00"
                    step="0.01"
                    min="0.01"
                    required
                  />
                  <p className={styles.formHint}>
                    Standard late fee is $10.00
                  </p>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="late-fee-days-past-due">
                    Days Past Due *
                  </label>
                  <input
                    id="late-fee-days-past-due"
                    type="number"
                    className={styles.formInput}
                    value={daysPastDue}
                    onChange={(e) => setDaysPastDue(e.target.value)}
                    placeholder="e.g., 7"
                    min="1"
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="late-fee-reason">
                    Reason (Optional)
                  </label>
                  <textarea
                    id="late-fee-reason"
                    className={styles.formTextarea}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g., Missed scheduled payment on 15/02/2024"
                  />
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
                className={`${styles.btnSubmit}`}
                style={{ background: '#f59e0b' }}
                disabled={loading || !feeAmount || !daysPastDue}
              >
                {loading ? 'Applying...' : 'Apply Late Fee'}
              </button>
            )}
          </div>
      </form>
    </Modal>
  )
}


