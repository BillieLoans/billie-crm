'use client'

import React, { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import styles from './styles.module.css'

interface WaiveFeeModalProps {
  loanAccountId: string
  onClose: () => void
  onSuccess: () => void
}

export const WaiveFeeModal: React.FC<WaiveFeeModalProps> = ({
  loanAccountId,
  onClose,
  onSuccess,
}) => {
  const [waiverAmount, setWaiverAmount] = useState('')
  const [reason, setReason] = useState('')
  const [approvedBy, setApprovedBy] = useState('')
  const [currentFeeBalance, setCurrentFeeBalance] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Fetch current fee balance
  useEffect(() => {
    fetch(`/api/ledger/balance?loanAccountId=${loanAccountId}`)
      .then(res => res.json())
      .then(data => {
        setCurrentFeeBalance(parseFloat(data.feeBalance || '0'))
      })
      .catch(console.error)
  }, [loanAccountId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const amount = parseFloat(waiverAmount)
    if (amount > currentFeeBalance) {
      setError(`Waiver amount cannot exceed current fee balance ($${currentFeeBalance.toFixed(2)})`)
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/ledger/waive-fee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanAccountId,
          waiverAmount: amount,
          reason,
          approvedBy,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to waive fee')
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
    <Modal title="Waive Fee" icon="🎁" onClose={onClose} dismissOnBackdropClick={!loading}>
      <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {error && <div className={styles.errorMessage}>{error}</div>}
            {success && (
              <div className={styles.successMessage}>
                Fee waived successfully!
              </div>
            )}

            {!success && (
              <>
                <div className={styles.allocationPreview}>
                  <div className={styles.allocationRow}>
                    <span>Current Fee Balance:</span>
                    <span>${currentFeeBalance.toFixed(2)}</span>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="waive-fee-amount">
                    Waiver Amount *
                  </label>
                  <input
                    id="waive-fee-amount"
                    type="number"
                    className={styles.formInput}
                    value={waiverAmount}
                    onChange={(e) => setWaiverAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    max={currentFeeBalance}
                    required
                  />
                  <p className={styles.formHint}>
                    Cannot exceed current fee balance
                  </p>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="waive-fee-reason">
                    Reason *
                  </label>
                  <textarea
                    id="waive-fee-reason"
                    className={styles.formTextarea}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g., Customer goodwill - first missed payment"
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="waive-fee-approved-by">
                    Approved By *
                  </label>
                  <input
                    id="waive-fee-approved-by"
                    type="text"
                    className={styles.formInput}
                    value={approvedBy}
                    onChange={(e) => setApprovedBy(e.target.value)}
                    placeholder="e.g., Supervisor Name or ID"
                    required
                  />
                  <p className={styles.formHint}>
                    Waivers over $20 require manager approval
                  </p>
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
                style={{ background: '#10b981' }}
                disabled={loading || !waiverAmount || !reason || !approvedBy}
              >
                {loading ? 'Processing...' : 'Waive Fee'}
              </button>
            )}
          </div>
      </form>
    </Modal>
  )
}


