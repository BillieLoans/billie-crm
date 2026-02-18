'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { useRecordDisbursement } from '@/hooks/mutations/useRecordDisbursement'
import styles from './styles.module.css'

export interface RecordDisbursementDrawerProps {
  isOpen: boolean
  onClose: () => void
  loanAccountId: string
  disbursementAmount: number
}

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer (OSKO)' },
  { value: 'bank_transfer_standard', label: 'Bank Transfer (Standard)' },
] as const

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/**
 * RecordDisbursementDrawer - Form for recording actual fund disbursement.
 *
 * GAP-07: This triggers the transition from AWAITING_DISBURSEMENT → ACTIVE
 * and starts the accounting clock (accrual + ECL).
 */
export const RecordDisbursementDrawer: React.FC<RecordDisbursementDrawerProps> = ({
  isOpen,
  onClose,
  loanAccountId,
  disbursementAmount,
}) => {
  const [bankReference, setBankReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [notes, setNotes] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showConfirmation, setShowConfirmation] = useState(false)

  const { triggerDisbursement, isPending, isReadOnlyMode, hasPendingDisbursement } =
    useRecordDisbursement(loanAccountId)

  useEffect(() => {
    if (isOpen) {
      setBankReference('')
      setPaymentMethod('bank_transfer')
      setNotes('')
      setValidationError(null)
      setShowConfirmation(false)
    }
  }, [isOpen])

  const formattedAmount = useMemo(
    () => currencyFormatter.format(disbursementAmount),
    [disbursementAmount]
  )

  const handleBankRefChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setBankReference(e.target.value)
    setValidationError(null)
    setShowConfirmation(false)
  }, [])

  const handleMethodChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setPaymentMethod(e.target.value)
  }, [])

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value)
  }, [])

  const submitDisbursement = useCallback(() => {
    triggerDisbursement({
      loanAccountId,
      disbursementAmount: disbursementAmount.toFixed(2),
      bankReference: bankReference.trim(),
      paymentMethod,
      notes: notes.trim() || undefined,
    })
    onClose()
  }, [loanAccountId, disbursementAmount, bankReference, paymentMethod, notes, triggerDisbursement, onClose])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()

      if (!bankReference.trim()) {
        setValidationError('Bank reference is required for audit trail')
        return
      }

      if (!showConfirmation) {
        setShowConfirmation(true)
        return
      }

      submitDisbursement()
    },
    [bankReference, showConfirmation, submitDisbursement]
  )

  const handleConfirm = useCallback(() => {
    submitDisbursement()
  }, [submitDisbursement])

  const handleCancelConfirm = useCallback(() => {
    setShowConfirmation(false)
  }, [])

  const isFormValid = bankReference.trim() && !validationError
  const isDisabled = isPending || isReadOnlyMode || hasPendingDisbursement

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title="Trigger Disbursement">
      <form onSubmit={handleSubmit} className={styles.repaymentForm}>
        {isReadOnlyMode && (
          <div className={styles.readOnlyWarning} role="alert">
            <span className={styles.readOnlyIcon}>&#128274;</span>
            <span>System is in read-only mode. Actions are disabled.</span>
          </div>
        )}

        {hasPendingDisbursement && !isReadOnlyMode && (
          <div className={styles.pendingWarning} role="alert">
            <span className={styles.pendingIcon}>&#9203;</span>
            <span>Disbursement in progress. Please wait.</span>
          </div>
        )}

        <div className={styles.repaymentBalance}>
          <span className={styles.repaymentBalanceLabel}>Disbursement Amount</span>
          <span className={styles.repaymentBalanceValue}>{formattedAmount}</span>
        </div>

        <div
          style={{
            padding: '12px',
            background: 'var(--color-warning-bg, #FFF7E6)',
            border: '1px solid var(--color-warning-border, #FFD666)',
            borderRadius: '6px',
            fontSize: '13px',
            lineHeight: '1.4',
            marginBottom: '16px',
          }}
        >
          This action records the actual fund transfer and activates the loan account.
          Accrual and ECL calculations will begin from this moment. This action cannot
          be undone.
        </div>

        {validationError && (
          <div className={styles.repaymentError} role="alert">
            {validationError}
          </div>
        )}

        {showConfirmation && (
          <div className={styles.overpaymentConfirm} role="alert">
            <div className={styles.overpaymentConfirmContent}>
              <p className={styles.overpaymentConfirmTitle}>Confirm Disbursement</p>
              <p className={styles.overpaymentConfirmText}>
                You are about to disburse {formattedAmount} to the customer. The loan
                account will become ACTIVE and interest accrual will begin immediately.
              </p>
              <div className={styles.overpaymentConfirmActions}>
                <button
                  type="button"
                  className={styles.overpaymentCancelBtn}
                  onClick={handleCancelConfirm}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.overpaymentConfirmBtn}
                  onClick={handleConfirm}
                >
                  Confirm Disbursement
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={styles.repaymentField}>
          <label htmlFor="bank-reference" className={styles.repaymentLabel}>
            Bank Reference / OSKO Receipt <span className={styles.required}>*</span>
          </label>
          <input
            id="bank-reference"
            type="text"
            className={styles.repaymentTextInput}
            value={bankReference}
            onChange={handleBankRefChange}
            placeholder="e.g., OSKO-20260206-12345"
            disabled={isDisabled}
            required
          />
        </div>

        <div className={styles.repaymentField}>
          <label htmlFor="disbursement-method" className={styles.repaymentLabel}>
            Payment Method
          </label>
          <select
            id="disbursement-method"
            className={styles.repaymentSelect}
            value={paymentMethod}
            onChange={handleMethodChange}
            disabled={isDisabled}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.repaymentField}>
          <label htmlFor="disbursement-notes" className={styles.repaymentLabel}>
            Notes
          </label>
          <textarea
            id="disbursement-notes"
            className={styles.repaymentTextarea}
            value={notes}
            onChange={handleNotesChange}
            placeholder="Optional notes about this disbursement..."
            rows={2}
            disabled={isDisabled}
          />
        </div>

        <div className={styles.repaymentActions}>
          <button type="button" className={styles.repaymentCancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.repaymentSubmitBtn}
            disabled={!isFormValid || isDisabled || showConfirmation}
          >
            {isPending || hasPendingDisbursement ? 'Processing...' : 'Record Disbursement'}
          </button>
        </div>
      </form>
    </ContextDrawer>
  )
}
