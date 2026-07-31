'use client'

import React, { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/formatters'
import styles from './styles.module.css'

interface RecordPaymentModalProps {
  loanAccountId: string
  onClose: () => void
  onSuccess: () => void
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  loanAccountId,
  onClose,
  onSuccess,
}) => {
  const [amount, setAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [result, setResult] = useState<any>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Generate a unique payment ID
      const paymentId = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      const res = await fetch('/api/ledger/repayment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanAccountId,
          amount: amount,
          paymentId,
          paymentReference,
          paymentMethod,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to record payment')
      }

      setResult(data)
      setSuccess(true)
      setTimeout(() => {
        onSuccess()
      }, 2000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Record Payment" icon="💳" onClose={onClose} dismissOnBackdropClick={!loading}>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {error && (
              <div className={styles.errorMessage}>{error}</div>
            )}

            {success && result && (
              <div className={styles.successMessage}>
                Payment recorded successfully!
                <div className={styles.allocationPreview}>
                  <div className={styles.allocationRow}>
                    <span>Applied to Fees:</span>
                    <span>{formatCurrency(result.allocatedToFees || '0')}</span>
                  </div>
                  <div className={styles.allocationRow}>
                    <span>Applied to Principal:</span>
                    <span>{formatCurrency(result.allocatedToPrincipal || '0')}</span>
                  </div>
                  {parseFloat(result.overpayment || '0') > 0 && (
                    <div className={styles.allocationRow}>
                      <span>Overpayment:</span>
                      <span>{formatCurrency(result.overpayment)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!success && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="record-payment-amount">
                    Payment Amount *
                  </label>
                  <input
                    id="record-payment-amount"
                    type="number"
                    className={styles.formInput}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                    required
                  />
                  <p className={styles.formHint}>
                    Payments are allocated to fees first, then principal
                  </p>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="record-payment-reference">
                    Payment Reference *
                  </label>
                  <input
                    id="record-payment-reference"
                    type="text"
                    className={styles.formInput}
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="e.g., DD-20240215-001"
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="record-payment-method">
                    Payment Method
                  </label>
                  <select
                    id="record-payment-method"
                    className={styles.formSelect}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="direct_debit">Direct Debit</option>
                    <option value="card">Card Payment</option>
                    <option value="bpay">BPAY</option>
                    <option value="cash">Cash</option>
                  </select>
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
                disabled={loading || !amount || !paymentReference}
              >
                {loading ? 'Processing...' : 'Record Payment'}
              </button>
            )}
          </div>
      </form>
    </Modal>
  )
}


