'use client'

import { useState, useCallback, useEffect } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { useWaiveFee } from '@/hooks/mutations/useWaiveFee'
import styles from './styles.module.css'

export interface WaiveFeeDrawerProps {
  isOpen: boolean
  onClose: () => void
  loanAccountId: string
  currentFeeBalance: number
}

/**
 * WaiveFeeDrawer - Slide-over form for waiving fees.
 * Uses optimistic UI pattern for immediate feedback.
 */
export const WaiveFeeDrawer: React.FC<WaiveFeeDrawerProps> = ({
  isOpen,
  onClose,
  loanAccountId,
  currentFeeBalance,
}) => {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const { waiveFee, isPending, isReadOnlyMode, hasPendingWaive } = useWaiveFee(loanAccountId)

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      setAmount('')
      setReason('')
      setValidationError(null)
    }
  }, [isOpen])

  const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAmount(e.target.value)
    setValidationError(null)
  }, [])

  const handleReasonChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReason(e.target.value)
  }, [])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()

    const numAmount = parseFloat(amount)

    // Validation
    if (isNaN(numAmount) || numAmount <= 0) {
      setValidationError('Please enter a valid amount')
      return
    }

    // No client-side cap against currentFeeBalance: the ledger accepts waivers
    // above the current fee balance (the already-paid portion is reallocated
    // against principal) and rejects genuinely over-limit waivers with an
    // operator-readable FAILED_PRECONDITION message surfaced via the error toast.
    if (!reason.trim()) {
      setValidationError('Reason is required')
      return
    }

    // Submit with optimistic update
    waiveFee({
      loanAccountId,
      waiverAmount: numAmount,
      reason: reason.trim(),
      approvedBy: 'current-user', // TODO: Get from auth context
    })

    // Close drawer immediately (optimistic)
    onClose()
  }, [amount, reason, loanAccountId, waiveFee, onClose])

  const isFormValid = amount && reason.trim() && !validationError
  const isDisabled = isPending || isReadOnlyMode || hasPendingWaive

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title="Waive Fee">
      <form onSubmit={handleSubmit} className={styles.waiveFeeForm}>
        {/* Read-only mode warning */}
        {isReadOnlyMode && (
          <div className={styles.readOnlyWarning} role="alert">
            <span className={styles.readOnlyIcon}>🔒</span>
            <span>System is in read-only mode. Actions are disabled.</span>
          </div>
        )}

        {/* Pending action warning */}
        {hasPendingWaive && !isReadOnlyMode && (
          <div className={styles.pendingWarning} role="alert">
            <span className={styles.pendingIcon}>⏳</span>
            <span>Action in progress. Please wait for the current request to complete.</span>
          </div>
        )}

        {/* Current fee balance */}
        <div className={styles.waiveFeeBalance}>
          <span className={styles.waiveFeeBalanceLabel}>Current Fee Balance</span>
          <span className={styles.waiveFeeBalanceValue}>
            ${currentFeeBalance.toFixed(2)}
          </span>
        </div>

        {/* Validation error */}
        {validationError && (
          <div className={styles.waiveFeeError} role="alert">
            {validationError}
          </div>
        )}

        {/* Amount field */}
        <div className={styles.waiveFeeField}>
          <label htmlFor="waive-amount" className={styles.waiveFeeLabel}>
            Waiver Amount <span className={styles.required}>*</span>
          </label>
          <div className={styles.waiveFeeInputWrapper}>
            <span className={styles.waiveFeeInputPrefix}>$</span>
            <input
              id="waive-amount"
              type="number"
              className={styles.waiveFeeInput}
              value={amount}
              onChange={handleAmountChange}
              placeholder="0.00"
              step="0.01"
              min="0.01"
              disabled={isDisabled}
              required
            />
          </div>
          <p className={styles.waiveFeeHint}>
            Fees already paid by a repayment can still be waived — the paid amount is re-applied to
            the loan principal
          </p>
        </div>

        {/* Reason field */}
        <div className={styles.waiveFeeField}>
          <label htmlFor="waive-reason" className={styles.waiveFeeLabel}>
            Reason <span className={styles.required}>*</span>
          </label>
          <textarea
            id="waive-reason"
            className={styles.waiveFeeTextarea}
            value={reason}
            onChange={handleReasonChange}
            placeholder="e.g., Customer goodwill - first missed payment"
            rows={3}
            disabled={isDisabled}
            required
          />
        </div>

        {/* Actions */}
        <div className={styles.waiveFeeActions}>
          <button
            type="button"
            className={styles.waiveFeeCancelBtn}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.waiveFeeSubmitBtn}
            disabled={!isFormValid || isDisabled}
            title={
              isReadOnlyMode
                ? 'System in read-only mode'
                : hasPendingWaive
                  ? 'Action in progress'
                  : undefined
            }
          >
            {isPending || hasPendingWaive ? 'Waiving...' : 'Confirm Waive'}
          </button>
        </div>
      </form>
    </ContextDrawer>
  )
}
