'use client'

import { useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { transactionsQueryKey } from '@/hooks/queries/useTransactions'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

export type FeeType = 'late-fee' | 'dishonour-fee'

export interface ApplyFeeDrawerProps {
  isOpen: boolean
  onClose: () => void
  loanAccountId: string
  feeType: FeeType
}

const FEE_CONFIG = {
  'late-fee': {
    title: 'Apply Late Fee',
    apiPath: '/api/ledger/late-fee',
    defaultAmount: '10.00',
    amountHint: 'Standard late fee is $10.00',
    reasonPlaceholder: 'e.g., Missed scheduled payment on 15/02/2026',
  },
  'dishonour-fee': {
    title: 'Apply Dishonour Fee',
    apiPath: '/api/ledger/dishonour-fee',
    defaultAmount: '10.00',
    amountHint: 'Standard dishonour fee is $10.00',
    reasonPlaceholder: 'e.g., Direct debit returned - insufficient funds',
  },
} as const

export const ApplyFeeDrawer: React.FC<ApplyFeeDrawerProps> = ({
  isOpen,
  onClose,
  loanAccountId,
  feeType,
}) => {
  const [feeAmount, setFeeAmount] = useState('')
  const [daysPastDue, setDaysPastDue] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [reason, setReason] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const queryClient = useQueryClient()
  const config = FEE_CONFIG[feeType]

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      setFeeAmount(config.defaultAmount)
      setDaysPastDue('')
      setReferenceId('')
      setReason('')
      setValidationError(null)
      setError(null)
    }
  }, [isOpen, config.defaultAmount])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()

    const numAmount = parseFloat(feeAmount)
    if (isNaN(numAmount) || numAmount <= 0) {
      setValidationError('Please enter a valid amount')
      return
    }

    if (feeType === 'late-fee' && (!daysPastDue || parseInt(daysPastDue) < 1)) {
      setValidationError('Days past due is required and must be at least 1')
      return
    }

    setIsPending(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        loanAccountId,
        feeAmount: numAmount.toFixed(2),
        reason: reason.trim() || undefined,
      }

      if (feeType === 'late-fee') {
        body.daysPastDue = parseInt(daysPastDue)
      } else {
        body.referenceId = referenceId.trim() || undefined
      }

      const res = await fetch(config.apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()

      if (!res.ok) {
        const detail = data.details ? `: ${data.details}` : ''
        throw new Error((data.error || `Failed to apply ${feeType.replace('-', ' ')}`) + detail)
      }

      // Invalidate transactions to show the new fee
      await queryClient.invalidateQueries({
        queryKey: transactionsQueryKey(loanAccountId, {}),
        exact: false,
      })

      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsPending(false)
    }
  }, [feeAmount, daysPastDue, referenceId, reason, feeType, loanAccountId, config.apiPath, queryClient, onClose])

  const isFormValid = feeAmount && !validationError && (feeType !== 'late-fee' || daysPastDue)
  const isDisabled = isPending || readOnlyMode

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title={config.title}>
      <form onSubmit={handleSubmit} className={styles.waiveFeeForm}>
        {readOnlyMode && (
          <div className={styles.readOnlyWarning} role="alert">
            <span className={styles.readOnlyIcon}>🔒</span>
            <span>System is in read-only mode. Actions are disabled.</span>
          </div>
        )}

        {validationError && (
          <div className={styles.waiveFeeError} role="alert">
            {validationError}
          </div>
        )}

        {error && (
          <div className={styles.waiveFeeError} role="alert">
            {error}
          </div>
        )}

        {/* Fee Amount */}
        <div className={styles.waiveFeeField}>
          <label htmlFor="fee-amount" className={styles.waiveFeeLabel}>
            Fee Amount <span className={styles.required}>*</span>
          </label>
          <div className={styles.waiveFeeInputWrapper}>
            <span className={styles.waiveFeeInputPrefix}>$</span>
            <input
              id="fee-amount"
              type="number"
              className={styles.waiveFeeInput}
              value={feeAmount}
              onChange={(e) => { setFeeAmount(e.target.value); setValidationError(null) }}
              placeholder="0.00"
              step="0.01"
              min="0.01"
              disabled={isDisabled}
              required
            />
          </div>
          <p className={styles.waiveFeeHint}>{config.amountHint}</p>
        </div>

        {/* Days Past Due (late fee only) */}
        {feeType === 'late-fee' && (
          <div className={styles.waiveFeeField}>
            <label htmlFor="days-past-due" className={styles.waiveFeeLabel}>
              Days Past Due <span className={styles.required}>*</span>
            </label>
            <input
              id="days-past-due"
              type="number"
              className={styles.waiveFeeInput}
              style={{ border: '1px solid var(--theme-elevation-200, #ddd)', borderRadius: '6px' }}
              value={daysPastDue}
              onChange={(e) => { setDaysPastDue(e.target.value); setValidationError(null) }}
              placeholder="e.g., 7"
              min="1"
              disabled={isDisabled}
              required
            />
          </div>
        )}

        {/* Reference ID (dishonour fee only) */}
        {feeType === 'dishonour-fee' && (
          <div className={styles.waiveFeeField}>
            <label htmlFor="reference-id" className={styles.waiveFeeLabel}>
              Payment Reference
            </label>
            <input
              id="reference-id"
              type="text"
              className={styles.waiveFeeInput}
              style={{ border: '1px solid var(--theme-elevation-200, #ddd)', borderRadius: '6px' }}
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              placeholder="e.g., DD-20260324-001"
              disabled={isDisabled}
            />
            <p className={styles.waiveFeeHint}>External payment reference that was dishonoured</p>
          </div>
        )}

        {/* Reason */}
        <div className={styles.waiveFeeField}>
          <label htmlFor="fee-reason" className={styles.waiveFeeLabel}>
            Reason
          </label>
          <textarea
            id="fee-reason"
            className={styles.waiveFeeTextarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={config.reasonPlaceholder}
            rows={3}
            disabled={isDisabled}
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
            style={{ background: isPending ? '#fde68a' : '#f59e0b' }}
            disabled={!isFormValid || isDisabled}
            title={readOnlyMode ? 'System in read-only mode' : undefined}
          >
            {isPending ? 'Applying...' : config.title}
          </button>
        </div>
      </form>
    </ContextDrawer>
  )
}
