'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import type { ScheduledPayment } from '@/hooks/queries/useCustomer'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

export interface RepaymentScheduleListProps {
  payments: ScheduledPayment[] | null
  numberOfPayments: number | null
  paymentFrequency: 'weekly' | 'fortnightly' | 'monthly' | null
  /** Callback to switch to transactions tab (optional - enables linking) */
  onNavigateToTransaction?: (transactionId: string) => void
}

// Hoisted for performance
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDate(dateString: string | null): string {
  if (!dateString) return '—'
  try {
    return dateFormatter.format(new Date(dateString))
  } catch {
    return '—'
  }
}

function formatFrequency(freq: string | null): string {
  if (!freq) return '—'
  const map: Record<string, string> = {
    weekly: 'Weekly',
    fortnightly: 'Fortnightly',
    monthly: 'Monthly',
  }
  return map[freq] || freq
}

/**
 * Check if a due date is in the past (overdue)
 */
function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false
  try {
    const due = new Date(dueDate)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return due < today
  } catch {
    return false
  }
}

/**
 * Derive the effective status considering overdue logic
 */
type EffectiveStatus = 'complete' | 'partial' | 'overdue' | 'due-next' | 'outstanding' | 'void'

function getEffectiveStatus(
  payment: ScheduledPayment,
  isNextDue: boolean
): EffectiveStatus {
  const { status, dueDate } = payment

  // Void: an instalment of a loan cancelled before disbursement (BTB-517).
  // Never owed, so never due, next, overdue or outstanding.
  if (status === 'void') {
    return 'void'
  }

  // Paid in full = complete
  if (status === 'paid') {
    return 'complete'
  }

  // Partially paid
  if (status === 'partial') {
    return 'partial'
  }

  // Missed = overdue
  if (status === 'missed') {
    return 'overdue'
  }

  // Scheduled but past due date = overdue
  if (status === 'scheduled' && isOverdue(dueDate)) {
    return 'overdue'
  }

  // Next due payment
  if (isNextDue) {
    return 'due-next'
  }

  // Future scheduled = outstanding
  return 'outstanding'
}

/**
 * Get status configuration for visual display
 */
function getPaymentStatusConfig(effectiveStatus: EffectiveStatus) {
  switch (effectiveStatus) {
    case 'complete':
      return {
        icon: '✓',
        label: 'Complete',
        className: styles.paymentStatusPaid,
      }
    case 'partial':
      return {
        icon: '◐',
        label: 'Partial',
        className: styles.paymentStatusPartial,
      }
    case 'overdue':
      return {
        icon: '!',
        label: 'Overdue',
        className: styles.paymentStatusOverdue,
      }
    case 'due-next':
      return {
        icon: '●',
        label: 'Due (next)',
        className: styles.paymentStatusNext,
      }
    case 'void':
      return {
        icon: '–',
        label: 'Void',
        className: styles.paymentStatusVoid,
      }
    case 'outstanding':
    default:
      return {
        icon: '',
        label: 'Outstanding',
        className: styles.paymentStatusScheduled,
      }
  }
}

/**
 * RepaymentScheduleList - Expandable list of scheduled payments.
 * Shows summary by default with option to view all payments.
 * Displays complete, partial, overdue, and outstanding status.
 */
export const RepaymentScheduleList: React.FC<RepaymentScheduleListProps> = ({
  payments,
  numberOfPayments,
  paymentFrequency,
  onNavigateToTransaction,
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedPayment, setExpandedPayment] = useState<number | null>(null)
  
  // UI store for transaction navigation
  const setHighlightedTransactionId = useUIStore((s) => s.setHighlightedTransactionId)
  const setTransactionNavigationSource = useUIStore((s) => s.setTransactionNavigationSource)
  const expandedPaymentNumber = useUIStore((s) => s.expandedPaymentNumber)
  const setExpandedPaymentNumber = useUIStore((s) => s.setExpandedPaymentNumber)

  // Auto-expand payment when returning from Transactions tab
  useEffect(() => {
    if (expandedPaymentNumber !== null) {
      setIsExpanded(true)
      setExpandedPayment(expandedPaymentNumber)
      // Clear the store after applying
      setExpandedPaymentNumber(null)
    }
  }, [expandedPaymentNumber, setExpandedPaymentNumber])

  const handleTransactionClick = useCallback((transactionId: string, paymentNumber: number) => {
    // Set the highlighted transaction in the UI store
    setHighlightedTransactionId(transactionId)
    // Store the source payment and transaction for back navigation
    setTransactionNavigationSource({ paymentNumber, transactionId })
    // Navigate to the transactions tab
    onNavigateToTransaction?.(transactionId)
  }, [setHighlightedTransactionId, setTransactionNavigationSource, onNavigateToTransaction])

  // Calculate payment statistics
  const stats = useMemo(() => {
    if (!payments || payments.length === 0) {
      return {
        complete: 0,
        partial: 0,
        overdue: 0,
        outstanding: 0,
        void: 0,
        total: numberOfPayments ?? 0,
        nextPaymentIndex: -1,
        totalPaid: 0,
        totalRemaining: 0,
      }
    }

    let complete = 0
    let partial = 0
    let overdue = 0
    let outstanding = 0
    let voided = 0
    let nextPaymentIndex = -1
    let totalPaid = 0
    let totalRemaining = 0

    payments.forEach((p, index) => {
      // A void instalment counts towards nothing owed or paid.
      if (p.status === 'void') {
        voided++
        return
      }

      // Accumulate totals
      if (p.amountPaid != null) totalPaid += p.amountPaid
      if (p.amountRemaining != null) totalRemaining += p.amountRemaining

      if (p.status === 'paid') {
        complete++
      } else if (p.status === 'partial') {
        partial++
      } else if (p.status === 'missed' || (p.status === 'scheduled' && isOverdue(p.dueDate))) {
        overdue++
      } else {
        outstanding++
        // First outstanding/scheduled payment is the next due
        if (nextPaymentIndex === -1) {
          nextPaymentIndex = index
        }
      }
    })

    return {
      complete,
      partial,
      overdue,
      outstanding,
      void: voided,
      total: payments.length,
      nextPaymentIndex,
      totalPaid,
      totalRemaining,
    }
  }, [payments, numberOfPayments])

  const hasPayments = payments && payments.length > 0

  const handleToggle = () => {
    setIsExpanded(!isExpanded)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleToggle()
    }
  }

  const handlePaymentClick = (paymentNumber: number) => {
    setExpandedPayment(expandedPayment === paymentNumber ? null : paymentNumber)
  }

  return (
    <div className={styles.scheduleSection} data-testid="repayment-schedule-list">
      {/* Summary grid */}
      <div className={styles.overviewGrid}>
        <div className={styles.overviewItem}>
          <span className={styles.overviewLabel}>Frequency</span>
          <span className={styles.overviewValue}>{formatFrequency(paymentFrequency)}</span>
        </div>
        <div className={styles.overviewItem}>
          <span className={styles.overviewLabel}>Payments</span>
          <span className={styles.overviewValue}>{stats.total}</span>
        </div>
      </div>

      {/* Status summary badges */}
      {hasPayments && (
        <div className={styles.paymentSummary} data-testid="payment-summary">
          {stats.complete > 0 && (
            <span className={`${styles.summaryBadge} ${styles.summaryBadgeComplete}`}>
              ✓ {stats.complete} Complete
            </span>
          )}
          {stats.partial > 0 && (
            <span className={`${styles.summaryBadge} ${styles.summaryBadgePartial}`}>
              ◐ {stats.partial} Partial
            </span>
          )}
          {stats.overdue > 0 && (
            <span className={`${styles.summaryBadge} ${styles.summaryBadgeOverdue}`}>
              ! {stats.overdue} Overdue
            </span>
          )}
          {stats.outstanding > 0 && (
            <span className={`${styles.summaryBadge} ${styles.summaryBadgeOutstanding}`}>
              {stats.outstanding} Outstanding
            </span>
          )}
          {stats.void > 0 && (
            <span className={`${styles.summaryBadge} ${styles.summaryBadgeVoid}`}>
              {stats.void} Void
            </span>
          )}
        </div>
      )}

      {/* Expand/collapse toggle */}
      {hasPayments && (
        <>
          <button
            type="button"
            className={styles.scheduleToggle}
            onClick={handleToggle}
            onKeyDown={handleKeyDown}
            aria-expanded={isExpanded}
            aria-controls="payment-list"
            data-testid="schedule-toggle"
          >
            <svg
              className={`${styles.scheduleToggleIcon} ${isExpanded ? styles.scheduleToggleIconExpanded : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 5l7 7-7 7" />
            </svg>
            <span>{isExpanded ? 'Hide payments' : `View all ${stats.total} payments`}</span>
          </button>

          {/* Payment list */}
          {isExpanded && (
            <div
              id="payment-list"
              className={styles.paymentList}
              role="list"
              data-testid="payment-list"
            >
              {payments.map((payment, index) => {
                const isNext = index === stats.nextPaymentIndex
                const effectiveStatus = getEffectiveStatus(payment, isNext)
                const statusConfig = getPaymentStatusConfig(effectiveStatus)
                const isPaymentExpanded = expandedPayment === payment.paymentNumber
                const hasDetails = payment.linkedTransactionIds?.length || payment.paidDate || payment.amountPaid != null

                return (
                  <div
                    key={payment.id ?? payment.paymentNumber}
                    className={`${styles.paymentCard} ${statusConfig.className}`}
                    data-testid={`payment-row-${payment.paymentNumber}`}
                  >
                    {/* Main row - clickable for details */}
                    <div
                      className={styles.paymentRow}
                      role="listitem"
                      onClick={() => hasDetails && handlePaymentClick(payment.paymentNumber)}
                      style={{ cursor: hasDetails ? 'pointer' : 'default' }}
                    >
                      <span className={styles.paymentIcon} aria-hidden="true">
                        {statusConfig.icon}
                      </span>
                      <span className={styles.paymentNumber}>#{payment.paymentNumber}</span>
                      <span className={styles.paymentDate}>{formatDate(payment.dueDate)}</span>
                      <span className={styles.paymentAmountGroup}>
                        {/* Show paid/remaining for partial, or just amount */}
                        {effectiveStatus === 'partial' && payment.amountPaid != null ? (
                          <>
                            <span className={styles.paymentAmount}>
                              {currencyFormatter.format(payment.amountPaid)} paid
                            </span>
                            {payment.amountRemaining != null && payment.amountRemaining > 0 && (
                              <span className={styles.paymentAmountRemaining}>
                                {currencyFormatter.format(payment.amountRemaining)} remaining
                              </span>
                            )}
                          </>
                        ) : effectiveStatus === 'complete' && payment.amountPaid != null ? (
                          <>
                            <span className={styles.paymentAmount}>
                              {currencyFormatter.format(payment.amountPaid)}
                            </span>
                            {payment.paidDate && (
                              <span className={styles.paymentAmountSecondary}>
                                Paid {formatDate(payment.paidDate)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className={styles.paymentAmount}>
                            {currencyFormatter.format(payment.amount)}
                          </span>
                        )}
                      </span>
                      <span className={styles.paymentStatus}>
                        {statusConfig.label}
                        {hasDetails && (
                          <span className={styles.paymentExpandIcon} aria-hidden="true">
                            {isPaymentExpanded ? '▼' : '▶'}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Expanded details */}
                    {isPaymentExpanded && hasDetails && (
                      <div className={styles.paymentDetails}>
                        <div className={styles.paymentDetailsGrid}>
                          {/* Scheduled amount */}
                          <div className={styles.paymentDetailItem}>
                            <span className={styles.paymentDetailLabel}>Scheduled</span>
                            <span className={styles.paymentDetailValue}>
                              {currencyFormatter.format(payment.amount)}
                            </span>
                          </div>

                          {/* Amount paid */}
                          {payment.amountPaid != null && (
                            <div className={styles.paymentDetailItem}>
                              <span className={styles.paymentDetailLabel}>Paid</span>
                              <span className={styles.paymentDetailValue}>
                                {currencyFormatter.format(payment.amountPaid)}
                              </span>
                            </div>
                          )}

                          {/* Amount remaining */}
                          {payment.amountRemaining != null && payment.amountRemaining > 0 && (
                            <div className={styles.paymentDetailItem}>
                              <span className={styles.paymentDetailLabel}>Remaining</span>
                              <span className={`${styles.paymentDetailValue} ${styles.paymentDetailRemaining}`}>
                                {currencyFormatter.format(payment.amountRemaining)}
                              </span>
                            </div>
                          )}

                          {/* Paid date */}
                          {payment.paidDate && (
                            <div className={styles.paymentDetailItem}>
                              <span className={styles.paymentDetailLabel}>Paid On</span>
                              <span className={styles.paymentDetailValue}>
                                {formatDate(payment.paidDate)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Linked transactions */}
                        {payment.linkedTransactionIds && payment.linkedTransactionIds.length > 0 && (
                          <div className={styles.paymentTransactions}>
                            <span className={styles.paymentTransactionsLabel}>
                              Linked Transactions ({payment.linkedTransactionIds.length})
                            </span>
                            <div className={styles.paymentTransactionsList}>
                              {payment.linkedTransactionIds.map((txnId) => (
                                <button
                                  key={txnId}
                                  type="button"
                                  className={`${styles.paymentTransactionId} ${onNavigateToTransaction ? styles.paymentTransactionIdClickable : ''}`}
                                  onClick={() => onNavigateToTransaction && handleTransactionClick(txnId, payment.paymentNumber)}
                                  disabled={!onNavigateToTransaction}
                                  title={onNavigateToTransaction ? 'View in Transactions tab' : undefined}
                                >
                                  {txnId}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
