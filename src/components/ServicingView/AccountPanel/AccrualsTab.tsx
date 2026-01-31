'use client'

import React, { useState } from 'react'
import { useAccruedYield, useAccrualHistory } from '@/hooks/queries/useAccruedYield'
import { useCarryingAmountBreakdown } from '@/hooks/queries/useCarryingAmountBreakdown'
import { AccrualHistoryModal } from './AccrualHistoryModal'
import styles from './accruals-tab.module.css'

export interface AccrualsTabProps {
  /** Loan account ID to fetch accruals for */
  loanAccountId: string
  /** Account number for display */
  accountNumber?: string
}

/**
 * Format currency for display
 */
function formatCurrency(amount: string | undefined | null): string {
  if (amount === undefined || amount === null || amount === '') {
    return '—'
  }
  const num = parseFloat(amount)
  if (isNaN(num)) {
    return '—'
  }
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(num)
}

/**
 * Format date for display
 */
function formatDate(dateString: string | undefined): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * AccrualsTab - Displays accrued yield (revenue recognition) information.
 *
 * Shows:
 * - Cumulative accrued amount and remaining
 * - Progress bar (days accrued / term days)
 * - Calculation breakdown (fee, term, daily rate)
 * - Recent accrual events table
 *
 * Story E2-S5: Implement Accruals Tab Component
 */
export const AccrualsTab: React.FC<AccrualsTabProps> = ({ loanAccountId, accountNumber }) => {
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

  const {
    accruedAmount,
    totalFeeAmount,
    termDays,
    daysAccrued,
    dailyRate,
    progress,
    accrualStartDate,
    accrualEndDate,
    isFallback,
    isLoading,
    error,
  } = useAccruedYield({ accountId: loanAccountId })

  const {
    events,
    isLoading: historyLoading,
  } = useAccrualHistory({ accountId: loanAccountId, limit: 5 })

  const {
    breakdown: carryingAmountBreakdown,
  } = useCarryingAmountBreakdown(loanAccountId)

  // Use the latest event from history as fallback if main endpoint returns 0
  // This ensures we show the correct cumulative amount and days accrued
  const latestEvent = events.length > 0 ? events[events.length - 1] : null
  const effectiveAccruedAmount = 
    (accruedAmount === '0' || accruedAmount === '0.00') && latestEvent?.cumulativeAmount
      ? latestEvent.cumulativeAmount
      : accruedAmount
  const effectiveDaysAccrued = 
    daysAccrued === 0 && latestEvent?.dayNumber
      ? latestEvent.dayNumber
      : daysAccrued
  const effectiveProgress = termDays > 0 
    ? Math.min((effectiveDaysAccrued / termDays) * 100, 100)
    : 0

  // Calculate effective remaining amount based on effectiveAccruedAmount
  const effectiveRemainingAmount = (() => {
    const totalFee = parseFloat(totalFeeAmount) || 0
    const accrued = parseFloat(effectiveAccruedAmount) || 0
    const remaining = totalFee - accrued
    return remaining >= 0 ? remaining.toFixed(2) : '0'
  })()

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Loading accrual data...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <span className={styles.errorIcon}>⚠️</span>
          <span className={styles.errorText}>Failed to load accrual data</span>
        </div>
      </div>
    )
  }

  if (isFallback) {
    return (
      <div className={styles.container}>
        <div className={styles.fallback}>
          <span className={styles.fallbackIcon}>⚠️</span>
          <span className={styles.fallbackText}>
            Ledger service unavailable. Accrual data cannot be displayed.
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Accrued Yield</h3>

      {/* Summary Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Cumulative Accrued</span>
          <span className={styles.summaryValue}>{formatCurrency(effectiveAccruedAmount)}</span>
          <span className={styles.summaryMeta}>of {formatCurrency(totalFeeAmount)} total fee</span>
        </div>

        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Accrual Progress</span>
          <span className={styles.summaryValue}>
            Day {effectiveDaysAccrued} of {termDays}
          </span>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${effectiveProgress}%` }} />
          </div>
          <span className={styles.summaryMeta}>
            Est. completion: {formatDate(accrualEndDate)}
          </span>
        </div>
      </div>

      {/* Calculation Breakdown */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Calculation Breakdown</h4>
        <div className={styles.breakdownGrid}>
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>Fee Amount</span>
            <span className={styles.breakdownValue}>{formatCurrency(totalFeeAmount)}</span>
          </div>
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>Term Days</span>
            <span className={styles.breakdownValue}>{termDays}</span>
          </div>
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>Daily Rate</span>
            <span className={styles.breakdownValue}>{formatCurrency(dailyRate)}</span>
          </div>
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>Disbursement</span>
            <span className={styles.breakdownValue}>
              {carryingAmountBreakdown?.disbursedPrincipal
                ? formatCurrency(carryingAmountBreakdown.disbursedPrincipal)
                : '—'}
            </span>
          </div>
        </div>
        <div className={styles.formula}>
          <span className={styles.formulaLabel}>Formula:</span>
          <code className={styles.formulaCode}>
            {formatCurrency(totalFeeAmount)} ÷ {termDays} days = {formatCurrency(dailyRate)}/day
          </code>
        </div>
      </div>

      {/* Remaining Amount */}
      <div className={styles.remainingCard}>
        <span className={styles.remainingLabel}>Remaining to Recognize</span>
        <span className={styles.remainingValue}>{formatCurrency(effectiveRemainingAmount)}</span>
      </div>

      {/* Recent Accrual Events */}
      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Recent Accrual Events</h4>
        {historyLoading ? (
          <div className={styles.tableLoading}>Loading events...</div>
        ) : events.length === 0 ? (
          <div className={styles.tableEmpty}>No accrual events recorded yet.</div>
        ) : (
          <table className={styles.eventsTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Daily</th>
                <th>Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.eventId}>
                  <td>{formatDate(event.accrualDate || event.timestamp)}</td>
                  <td className={styles.amountCell}>{formatCurrency(event.amount)}</td>
                  <td className={styles.amountCell}>{formatCurrency(event.cumulativeAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {events.length > 0 && (
          <button 
            type="button" 
            className={styles.viewHistoryLink}
            onClick={() => setIsHistoryModalOpen(true)}
          >
            View Full History →
          </button>
        )}
      </div>

      {/* Accrual History Modal */}
      <AccrualHistoryModal
        accountId={loanAccountId}
        accountNumber={accountNumber}
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
      />
    </div>
  )
}
