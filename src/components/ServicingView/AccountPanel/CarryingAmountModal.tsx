'use client'

import { useState, useCallback } from 'react'
import { useCarryingAmountBreakdown, type CarryingAmountBreakdownResponse } from '@/hooks/queries'
import { Modal } from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/formatters'
import styles from './styles.module.css'

// =============================================================================
// Types
// =============================================================================

export interface CarryingAmountModalProps {
  accountId: string
  isOpen: boolean
  onClose: () => void
}

// =============================================================================
// Formatters
// =============================================================================

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDate(dateString: string | undefined): string {
  if (!dateString) return '—'
  try {
    return dateFormatter.format(new Date(dateString))
  } catch {
    return '—'
  }
}

function formatRate(value: string | undefined): string {
  if (!value) return '—'
  const num = parseFloat(value)
  return isNaN(num) ? '—' : `${currencyFormatter.format(num)}/day`
}

// =============================================================================
// Copy Helper
// =============================================================================

function formatBreakdownForCopy(breakdown: CarryingAmountBreakdownResponse): string {
  return `Carrying Amount Breakdown
Account ID: ${breakdown.accountId}
Calculated: ${formatDate(breakdown.calculationTimestamp)}

BALANCES
Principal Balance: ${formatCurrency(breakdown.principalBalance)}
Fee Balance: ${formatCurrency(breakdown.feeBalance)}
Accrued Yield: ${formatCurrency(breakdown.accruedYield)}
CARRYING AMOUNT: ${formatCurrency(breakdown.carryingAmount)}

LOAN DETAILS
Disbursed Principal: ${formatCurrency(breakdown.disbursedPrincipal)}
Establishment Fee: ${formatCurrency(breakdown.establishmentFee)}
Total Paid: ${formatCurrency(breakdown.totalPaid)}

ACCRUAL DETAILS
Days Accrued: ${breakdown.daysAccrued} of ${breakdown.termDays}
Daily Rate: ${formatRate(breakdown.dailyAccrualRate)}
Last Accrual: ${formatDate(breakdown.lastAccrualDate)}
`
}

// =============================================================================
// Component
// =============================================================================

export const CarryingAmountModal: React.FC<CarryingAmountModalProps> = ({
  accountId,
  isOpen,
  onClose,
}) => {
  const [copySuccess, setCopySuccess] = useState(false)

  const { breakdown, isLoading, isError, isFallback, refetch } = useCarryingAmountBreakdown(
    accountId,
    { enabled: isOpen },
  )

  const handleCopy = useCallback(async () => {
    if (!breakdown) return

    try {
      await navigator.clipboard.writeText(formatBreakdownForCopy(breakdown))
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [breakdown])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose],
  )

  if (!isOpen) return null

  return (
    <Modal
      title="Carrying Amount Breakdown"
      onClose={onClose}
      testId="carrying-amount-modal"
      maxWidth="560px"
    >

        {/* Body */}
        <div className={styles.modalBody}>
          {isLoading && (
            <div className={styles.modalLoading}>
              <span className={styles.loadingSpinner} aria-hidden="true" />
              Loading breakdown...
            </div>
          )}

          {isError && (
            <div className={styles.modalError}>
              <span>Failed to load breakdown</span>
              <button type="button" onClick={() => refetch()} className={styles.retryBtn}>
                Retry
              </button>
            </div>
          )}

          {isFallback && !isLoading && (
            <div className={styles.modalFallback}>
              <span>⚠</span>
              Ledger service unavailable. Breakdown data not accessible.
            </div>
          )}

          {breakdown && (
            <>
              {/* Summary Card */}
              <div className={styles.breakdownSummary}>
                <div className={styles.breakdownSummaryItem}>
                  <span className={styles.breakdownSummaryLabel}>Carrying Amount</span>
                  <span className={styles.breakdownSummaryValue}>
                    {formatCurrency(breakdown.carryingAmount)}
                  </span>
                </div>
                <div className={styles.breakdownSummaryMeta}>
                  <span>Calculated: {formatDate(breakdown.calculationTimestamp)}</span>
                </div>
              </div>

              {/* Balances Section */}
              <div className={styles.breakdownSection}>
                <h3 className={styles.breakdownSectionTitle}>Balance Components</h3>
                <div className={styles.breakdownGrid}>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Principal Balance</span>
                    <span className={styles.breakdownValue}>
                      {formatCurrency(breakdown.principalBalance)}
                    </span>
                  </div>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Fee Balance</span>
                    <span className={styles.breakdownValue}>
                      {formatCurrency(breakdown.feeBalance)}
                    </span>
                  </div>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Accrued Yield</span>
                    <span className={styles.breakdownValue}>
                      {formatCurrency(breakdown.accruedYield)}
                    </span>
                  </div>
                </div>

                {/* Formula */}
                <div className={styles.breakdownFormula}>
                  <code>
                    Carrying Amount = Principal ({formatCurrency(breakdown.principalBalance)}) +
                    Accrued ({formatCurrency(breakdown.accruedYield)})
                  </code>
                </div>
              </div>

              {/* Loan Details Section */}
              <div className={styles.breakdownSection}>
                <h3 className={styles.breakdownSectionTitle}>Loan Details</h3>
                <div className={styles.breakdownGrid}>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Disbursed Principal</span>
                    <span className={styles.breakdownValue}>
                      {formatCurrency(breakdown.disbursedPrincipal)}
                    </span>
                  </div>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Establishment Fee</span>
                    <span className={styles.breakdownValue}>
                      {formatCurrency(breakdown.establishmentFee)}
                    </span>
                  </div>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Total Paid</span>
                    <span className={styles.breakdownValue}>
                      {formatCurrency(breakdown.totalPaid)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Accrual Details Section */}
              <div className={styles.breakdownSection}>
                <h3 className={styles.breakdownSectionTitle}>Accrual Details</h3>
                <div className={styles.breakdownGrid}>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Days Accrued</span>
                    <span className={styles.breakdownValue}>
                      {breakdown.daysAccrued} of {breakdown.termDays}
                    </span>
                  </div>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Daily Accrual Rate</span>
                    <span className={styles.breakdownValue}>
                      {formatRate(breakdown.dailyAccrualRate)}
                    </span>
                  </div>
                  <div className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>Last Accrual Date</span>
                    <span className={styles.breakdownValue}>
                      {formatDate(breakdown.lastAccrualDate)}
                    </span>
                  </div>
                </div>

                {/* Accrual Progress */}
                <div className={styles.breakdownProgress}>
                  <div
                    className={styles.breakdownProgressBar}
                    style={{
                      width: `${Math.min(100, (breakdown.daysAccrued / Math.max(1, breakdown.termDays)) * 100)}%`,
                    }}
                  />
                </div>
                <div className={styles.breakdownProgressLabel}>
                  {Math.round((breakdown.daysAccrued / Math.max(1, breakdown.termDays)) * 100)}%
                  accrued
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {breakdown && (
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopy}
              disabled={copySuccess}
            >
              {copySuccess ? '✓ Copied!' : 'Copy to Clipboard'}
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              Close
            </button>
          </div>
        )}
    </Modal>
  )
}

export default CarryingAmountModal
