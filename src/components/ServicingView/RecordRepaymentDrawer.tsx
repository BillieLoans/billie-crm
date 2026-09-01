'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { useRecordRepayment } from '@/hooks/mutations/useRecordRepayment'
import styles from './styles.module.css'

export interface RecordRepaymentDrawerProps {
  isOpen: boolean
  onClose: () => void
  loanAccountId: string
  totalOutstanding: number
}

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'direct_debit', label: 'Direct Debit' },
  { value: 'card', label: 'Card Payment' },
  { value: 'bpay', label: 'BPAY' },
  { value: 'cash', label: 'Cash' },
] as const

// Hoisted for performance
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/**
 * RecordRepaymentDrawer - Slide-over form for recording manual repayments.
 * Uses optimistic UI pattern for immediate feedback.
 * Includes overpayment confirmation dialog.
 */
export const RecordRepaymentDrawer: React.FC<RecordRepaymentDrawerProps> = ({
  isOpen,
  onClose,
  loanAccountId,
  totalOutstanding,
}) => {
  const [amount, setAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [notes, setNotes] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [showOverpaymentConfirm, setShowOverpaymentConfirm] = useState(false)

  const { recordRepayment, isPending, isReadOnlyMode, hasPendingRepayment } = useRecordRepayment(loanAccountId)

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      setAmount('')
      setPaymentReference('')
      setPaymentMethod('bank_transfer')
      setNotes('')
      setValidationError(null)
      setShowOverpaymentConfirm(false)
    }
  }, [isOpen])

  const numAmount = useMemo(() => parseFloat(amount) || 0, [amount])
  const isOverpayment = numAmount > totalOutstanding && totalOutstanding > 0

  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value)
    setValidationError(null)
    setShowOverpaymentConfirm(false)
  }, [])

  const handleReferenceChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPaymentReference(e.target.value)
  }, [])

  const handleMethodChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setPaymentMethod(e.target.value)
  }, [])

  const handleNotesChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNotes(e.target.value)
  }, [])

  const submitRepayment = useCallback(() => {
    recordRepayment({
      loanAccountId,
      amount: numAmount,
      paymentReference: paymentReference.trim(),
      paymentMethod,
      notes: notes.trim() || undefined,
    })

    // Close drawer immediately (optimistic)
    onClose()
  }, [loanAccountId, numAmount, paymentReference, paymentMethod, notes, recordRepayment, onClose])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()

      // Validation
      if (isNaN(numAmount) || numAmount <= 0) {
        setValidationError('Please enter a valid amount')
        return
      }

      if (!paymentReference.trim()) {
        setValidationError('Payment reference is required')
        return
      }

      // Check for overpayment
      if (isOverpayment && !showOverpaymentConfirm) {
        setShowOverpaymentConfirm(true)
        return
      }

      submitRepayment()
    },
    [numAmount, paymentReference, isOverpayment, showOverpaymentConfirm, submitRepayment]
  )

  const handleConfirmOverpayment = useCallback(() => {
    submitRepayment()
  }, [submitRepayment])

  const handleCancelOverpayment = useCallback(() => {
    setShowOverpaymentConfirm(false)
  }, [])

  const isFormValid = amount && paymentReference.trim() && !validationError
  const isDisabled = isPending || isReadOnlyMode || hasPendingRepayment

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title="Record Repayment">
      <form onSubmit={handleSubmit} className={styles.repaymentForm}>
        {/* Read-only mode warning */}
        {isReadOnlyMode && (
          <div className={styles.readOnlyWarning} role="alert">
            <span className={styles.readOnlyIcon}>🔒</span>
            <span>System is in read-only mode. Actions are disabled.</span>
          </div>
        )}

        {/* Pending action warning */}
        {hasPendingRepayment && !isReadOnlyMode && (
          <div className={styles.pendingWarning} role="alert">
            <span className={styles.pendingIcon}>⏳</span>
            <span>Action in progress. Please wait for the current request to complete.</span>
          </div>
        )}

        {/* Outstanding balance */}
        <div className={styles.repaymentBalance}>
          <span className={styles.repaymentBalanceLabel}>Outstanding Balance</span>
          <span className={styles.repaymentBalanceValue}>
            {currencyFormatter.format(totalOutstanding)}
          </span>
        </div>

        {/* Validation error */}
        {validationError && (
          <div className={styles.repaymentError} role="alert">
            {validationError}
          </div>
        )}

        {/* Overpayment confirmation */}
        {showOverpaymentConfirm && (
          <div className={styles.overpaymentConfirm} role="alert">
            <div className={styles.overpaymentConfirmIcon}>⚠️</div>
            <div className={styles.overpaymentConfirmContent}>
              <p className={styles.overpaymentConfirmTitle}>Overpayment Detected</p>
              <p className={styles.overpaymentConfirmText}>
                The amount ({currencyFormatter.format(numAmount)}) exceeds the outstanding balance (
                {currencyFormatter.format(totalOutstanding)}).
              </p>
              <div className={styles.overpaymentConfirmActions}>
                <button
                  type="button"
                  className={styles.overpaymentCancelBtn}
                  onClick={handleCancelOverpayment}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.overpaymentConfirmBtn}
                  onClick={handleConfirmOverpayment}
                >
                  Continue Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Amount field */}
        <div className={styles.repaymentField}>
          <label htmlFor="repayment-amount" className={styles.repaymentLabel}>
            Payment Amount <span className={styles.required}>*</span>
          </label>
          <div className={styles.repaymentInputWrapper}>
            <span className={styles.repaymentInputPrefix}>$</span>
            <input
              id="repayment-amount"
              type="number"
              className={styles.repaymentInput}
              value={amount}
              onChange={handleAmountChange}
              placeholder="0.00"
              step="0.01"
              min="0.01"
              disabled={isDisabled}
              required
            />
          </div>
          <p className={styles.repaymentHint}>
            Payments are allocated to fees first, then principal
          </p>
        </div>

        {/* Payment Reference field */}
        <div className={styles.repaymentField}>
          <label htmlFor="payment-reference" className={styles.repaymentLabel}>
            Payment Reference <span className={styles.required}>*</span>
          </label>
          <input
            id="payment-reference"
            type="text"
            className={styles.repaymentTextInput}
            value={paymentReference}
            onChange={handleReferenceChange}
            placeholder="e.g., DD-20240215-001"
            disabled={isDisabled}
            required
          />
        </div>

        {/* Payment Method dropdown */}
        <div className={styles.repaymentField}>
          <label htmlFor="payment-method" className={styles.repaymentLabel}>
            Payment Method
          </label>
          <select
            id="payment-method"
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

        {/* Notes field */}
        <div className={styles.repaymentField}>
          <label htmlFor="payment-notes" className={styles.repaymentLabel}>
            Notes
          </label>
          <textarea
            id="payment-notes"
            className={styles.repaymentTextarea}
            value={notes}
            onChange={handleNotesChange}
            placeholder="Optional notes about this payment..."
            rows={2}
            maxLength={1000}
            disabled={isDisabled}
          />
        </div>

        {/* Actions */}
        <div className={styles.repaymentActions}>
          <button type="button" className={styles.repaymentCancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.repaymentSubmitBtn}
            disabled={!isFormValid || isDisabled || showOverpaymentConfirm}
            title={
              isReadOnlyMode
                ? 'System in read-only mode'
                : hasPendingRepayment
                  ? 'Action in progress'
                  : undefined
            }
          >
            {isPending || hasPendingRepayment ? 'Processing...' : 'Record Payment'}
          </button>
        </div>
      </form>
    </ContextDrawer>
  )
}
