'use client'

/**
 * EnhancedScheduleList
 *
 * E2-S8: Enhanced repayment schedule with live status from Ledger API.
 * Uses GetScheduleWithStatus to show PENDING/PARTIAL/PAID/OVERDUE status per instalment.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useScheduleWithStatus } from '@/hooks/queries'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

// =============================================================================
// Types
// =============================================================================

export interface EnhancedScheduleListProps {
  /** The loan account ID to fetch schedule for */
  accountId: string
  /** Callback to switch to transactions tab (optional - enables linking) */
  onNavigateToTransaction?: (transactionId: string) => void
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
})

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  try {
    return dateFormatter.format(new Date(dateString))
  } catch {
    return '—'
  }
}

function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const num = typeof value === 'string' ? parseFloat(value) : value
  return isNaN(num) ? '—' : currencyFormatter.format(num)
}

// =============================================================================
// Status Configuration
// =============================================================================

type InstalmentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'

function getStatusConfig(status: InstalmentStatus, isNext: boolean) {
  if (isNext && status === 'PENDING') {
    return {
      icon: '●',
      label: 'Due (next)',
      className: styles.paymentStatusNext,
    }
  }

  switch (status) {
    case 'PAID':
      return {
        icon: '✓',
        label: 'Paid',
        className: styles.paymentStatusPaid,
      }
    case 'PARTIAL':
      return {
        icon: '◐',
        label: 'Partial',
        className: styles.paymentStatusPartial,
      }
    case 'OVERDUE':
      return {
        icon: '!',
        label: 'Overdue',
        className: styles.paymentStatusOverdue,
      }
    case 'PENDING':
    default:
      return {
        icon: '',
        label: 'Pending',
        className: styles.paymentStatusScheduled,
      }
  }
}

// =============================================================================
// Component
// =============================================================================

export const EnhancedScheduleList: React.FC<EnhancedScheduleListProps> = ({
  accountId,
  onNavigateToTransaction,
}) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedPayment, setExpandedPayment] = useState<number | null>(null)

  // Fetch schedule with status from Ledger API
  const { instalments, summary, isLoading, isError, isFallback, refetch } = useScheduleWithStatus(accountId)

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
      setExpandedPaymentNumber(null)
    }
  }, [expandedPaymentNumber, setExpandedPaymentNumber])

  const handleTransactionClick = useCallback(
    (transactionId: string, paymentNumber: number) => {
      setHighlightedTransactionId(transactionId)
      setTransactionNavigationSource({ paymentNumber, transactionId })
      onNavigateToTransaction?.(transactionId)
    },
    [setHighlightedTransactionId, setTransactionNavigationSource, onNavigateToTransaction],
  )

  // Find next due instalment
  const nextDueIndex = useMemo(() => {
    return instalments.findIndex((inst) => inst.status === 'PENDING')
  }, [instalments])

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

  const hasInstalments = instalments.length > 0

  // Loading state
  if (isLoading) {
    return (
      <div className={styles.scheduleSection} data-testid="enhanced-schedule-list">
        <div className={styles.overviewGrid}>
          <div className={styles.overviewItem}>
            <span className={styles.overviewLabel}>Status</span>
            <span className={styles.overviewValue}>Loading...</span>
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (isError) {
    return (
      <div className={styles.scheduleSection} data-testid="enhanced-schedule-list">
        <div className={styles.modalError}>
          <span>Failed to load schedule</span>
          <button type="button" onClick={() => refetch()} className={styles.retryBtn}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Fallback - service unavailable
  if (isFallback) {
    return (
      <div className={styles.scheduleSection} data-testid="enhanced-schedule-list">
        <div className={styles.modalFallback}>
          <span>⚠</span>
          Schedule status unavailable
        </div>
      </div>
    )
  }

  return (
    <div className={styles.scheduleSection} data-testid="enhanced-schedule-list">
      {/* Summary from API */}
      {summary && (
        <>
          <div className={styles.overviewGrid}>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>Instalments</span>
              <span className={styles.overviewValue}>{summary.totalInstalments}</span>
            </div>
            {summary.nextDueDate && (
              <div className={styles.overviewItem}>
                <span className={styles.overviewLabel}>Next Due</span>
                <span className={styles.overviewValue}>
                  {formatDate(summary.nextDueDate)} • {formatCurrency(summary.nextDueAmount)}
                </span>
              </div>
            )}
          </div>

          {/* Status summary badges */}
          <div className={styles.paymentSummary} data-testid="schedule-summary">
            {summary.paidCount > 0 && (
              <span className={`${styles.summaryBadge} ${styles.summaryBadgeComplete}`}>
                ✓ {summary.paidCount} Paid
              </span>
            )}
            {summary.partialCount > 0 && (
              <span className={`${styles.summaryBadge} ${styles.summaryBadgePartial}`}>
                ◐ {summary.partialCount} Partial
              </span>
            )}
            {summary.overdueCount > 0 && (
              <span className={`${styles.summaryBadge} ${styles.summaryBadgeOverdue}`}>
                ! {summary.overdueCount} Overdue
              </span>
            )}
            {summary.pendingCount > 0 && (
              <span className={`${styles.summaryBadge} ${styles.summaryBadgeOutstanding}`}>
                {summary.pendingCount} Pending
              </span>
            )}
          </div>

          {/* Totals row */}
          <div className={styles.overviewGrid} style={{ marginTop: '12px' }}>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>Total Paid</span>
              <span className={styles.overviewValue}>{formatCurrency(summary.totalPaid)}</span>
            </div>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>Total Remaining</span>
              <span className={styles.overviewValue}>{formatCurrency(summary.totalRemaining)}</span>
            </div>
          </div>
        </>
      )}

      {/* Expand/collapse toggle */}
      {hasInstalments && (
        <>
          <button
            type="button"
            className={styles.scheduleToggle}
            onClick={handleToggle}
            onKeyDown={handleKeyDown}
            aria-expanded={isExpanded}
            aria-controls="enhanced-payment-list"
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
            <span>
              {isExpanded ? 'Hide instalments' : `View all ${instalments.length} instalments`}
            </span>
          </button>

          {/* Instalment list */}
          {isExpanded && (
            <div
              id="enhanced-payment-list"
              className={styles.paymentList}
              role="list"
              data-testid="payment-list"
            >
              {instalments.map((instalment, index) => {
                const isNext = index === nextDueIndex
                const statusConfig = getStatusConfig(instalment.status as InstalmentStatus, isNext)
                const isPaymentExpanded = expandedPayment === instalment.paymentNumber
                const hasDetails =
                  instalment.linkedTransactionIds?.length > 0 ||
                  instalment.paidDate ||
                  parseFloat(instalment.amountPaid) > 0

                return (
                  <div
                    key={instalment.paymentNumber}
                    className={`${styles.paymentCard} ${statusConfig.className}`}
                    data-testid={`instalment-row-${instalment.paymentNumber}`}
                  >
                    {/* Main row */}
                    <div
                      className={styles.paymentRow}
                      role="listitem"
                      onClick={() => hasDetails && handlePaymentClick(instalment.paymentNumber)}
                      style={{ cursor: hasDetails ? 'pointer' : 'default' }}
                    >
                      <span className={styles.paymentIcon} aria-hidden="true">
                        {statusConfig.icon}
                      </span>
                      <span className={styles.paymentNumber}>#{instalment.paymentNumber}</span>
                      <span className={styles.paymentDate}>{formatDate(instalment.dueDate)}</span>
                      <span className={styles.paymentAmountGroup}>
                        {instalment.status === 'PARTIAL' ? (
                          <>
                            <span className={styles.paymentAmount}>
                              {formatCurrency(instalment.amountPaid)} paid
                            </span>
                            {parseFloat(instalment.amountRemaining) > 0 && (
                              <span className={styles.paymentAmountRemaining}>
                                {formatCurrency(instalment.amountRemaining)} remaining
                              </span>
                            )}
                          </>
                        ) : instalment.status === 'PAID' ? (
                          <>
                            <span className={styles.paymentAmount}>
                              {formatCurrency(instalment.amountPaid)}
                            </span>
                            {instalment.paidDate && (
                              <span className={styles.paymentAmountSecondary}>
                                Paid {formatDate(instalment.paidDate)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className={styles.paymentAmount}>
                            {formatCurrency(instalment.scheduledAmount)}
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
                          <div className={styles.paymentDetailItem}>
                            <span className={styles.paymentDetailLabel}>Scheduled</span>
                            <span className={styles.paymentDetailValue}>
                              {formatCurrency(instalment.scheduledAmount)}
                            </span>
                          </div>
                          {parseFloat(instalment.amountPaid) > 0 && (
                            <div className={styles.paymentDetailItem}>
                              <span className={styles.paymentDetailLabel}>Paid</span>
                              <span className={styles.paymentDetailValue}>
                                {formatCurrency(instalment.amountPaid)}
                              </span>
                            </div>
                          )}
                          {parseFloat(instalment.amountRemaining) > 0 && (
                            <div className={styles.paymentDetailItem}>
                              <span className={styles.paymentDetailLabel}>Remaining</span>
                              <span
                                className={`${styles.paymentDetailValue} ${styles.paymentDetailRemaining}`}
                              >
                                {formatCurrency(instalment.amountRemaining)}
                              </span>
                            </div>
                          )}
                          {instalment.paidDate && (
                            <div className={styles.paymentDetailItem}>
                              <span className={styles.paymentDetailLabel}>Paid On</span>
                              <span className={styles.paymentDetailValue}>
                                {formatDate(instalment.paidDate)}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Linked transactions */}
                        {instalment.linkedTransactionIds?.length > 0 && (
                          <div className={styles.paymentTransactions}>
                            <span className={styles.paymentTransactionsLabel}>
                              Linked Transactions ({instalment.linkedTransactionIds.length})
                            </span>
                            <div className={styles.paymentTransactionsList}>
                              {instalment.linkedTransactionIds.map((txnId) => (
                                <button
                                  key={txnId}
                                  type="button"
                                  className={`${styles.paymentTransactionId} ${
                                    onNavigateToTransaction ? styles.paymentTransactionIdClickable : ''
                                  }`}
                                  onClick={() =>
                                    onNavigateToTransaction &&
                                    handleTransactionClick(txnId, instalment.paymentNumber)
                                  }
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

export default EnhancedScheduleList
