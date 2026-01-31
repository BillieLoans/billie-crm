'use client'

import React, { useState, useCallback } from 'react'
import { useAccrualHistory, type AccrualEvent } from '@/hooks/queries/useAccruedYield'
import styles from './styles.module.css'

// =============================================================================
// Types
// =============================================================================

export interface AccrualHistoryModalProps {
  /** Loan account ID */
  accountId: string
  /** Account number for display */
  accountNumber?: string
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal is closed */
  onClose: () => void
}

// =============================================================================
// Formatters
// =============================================================================

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

function formatCurrency(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—'
  const num = parseFloat(value)
  return isNaN(num) ? '—' : currencyFormatter.format(num)
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return '—'
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

// =============================================================================
// Copy Helper
// =============================================================================

function formatEventsForCopy(events: AccrualEvent[], accountNumber?: string): string {
  const header = `Accrual History${accountNumber ? ` - Account ${accountNumber}` : ''}\n`
  const columns = 'Day\tDate\tDaily Amount\tCumulative\n'
  const rows = events
    .map(
      (e) =>
        `${e.dayNumber}\t${formatDate(e.accrualDate || e.timestamp)}\t${formatCurrency(e.amount)}\t${formatCurrency(e.cumulativeAmount)}`
    )
    .join('\n')

  return header + columns + rows
}

function formatEventsForCSV(events: AccrualEvent[]): string {
  const header = 'Day,Date,Daily Amount,Cumulative\n'
  const rows = events
    .map((e) => {
      const date = e.accrualDate || e.timestamp || ''
      const daily = e.amount || ''
      const cumulative = e.cumulativeAmount || ''
      return `${e.dayNumber},"${date}","${daily}","${cumulative}"`
    })
    .join('\n')

  return header + rows
}

// =============================================================================
// Component
// =============================================================================

export const AccrualHistoryModal: React.FC<AccrualHistoryModalProps> = ({
  accountId,
  accountNumber,
  isOpen,
  onClose,
}) => {
  const [copySuccess, setCopySuccess] = useState(false)

  // Fetch all events (no limit)
  const { events, totalEvents, missingDates, hasGaps, isLoading, isError, isFallback, refetch } = useAccrualHistory({
    accountId,
    enabled: isOpen,
  })

  const handleCopy = useCallback(async () => {
    if (!events.length) return

    try {
      await navigator.clipboard.writeText(formatEventsForCopy(events, accountNumber))
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [events, accountNumber])

  const handleExportCSV = useCallback(() => {
    if (!events.length) return

    const csv = formatEventsForCSV(events)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `accrual-history-${accountNumber || accountId}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [events, accountId, accountNumber])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  if (!isOpen) return null

  return (
    <div
      className={styles.modalOverlay}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="accrual-history-title"
      tabIndex={-1}
    >
      <div
        className={styles.accrualHistoryModalContent}
        onClick={(e) => e.stopPropagation()}
        data-testid="accrual-history-modal"
      >
        {/* Header */}
        <div className={styles.modalHeader}>
          <div>
            <h2 id="accrual-history-title" className={styles.modalTitle}>
              Accrual History
            </h2>
            {accountNumber && (
              <p className={styles.accrualHistorySubtitle}>Account {accountNumber}</p>
            )}
          </div>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>
          {isLoading && (
            <div className={styles.modalLoading}>
              <span className={styles.loadingSpinner} aria-hidden="true" />
              Loading accrual history...
            </div>
          )}

          {isError && (
            <div className={styles.modalError}>
              <span>Failed to load accrual history</span>
              <button type="button" onClick={() => refetch()} className={styles.retryBtn}>
                Retry
              </button>
            </div>
          )}

          {isFallback && !isLoading && (
            <div className={styles.modalFallback}>
              <span>⚠</span>
              Ledger service unavailable. Accrual history not accessible.
            </div>
          )}

          {!isLoading && !isError && !isFallback && events.length === 0 && (
            <div className={styles.accrualHistoryEmpty}>
              No accrual events recorded yet.
            </div>
          )}

          {events.length > 0 && (
            <>
              <div className={styles.accrualHistorySummary}>
                <span className={styles.accrualHistoryCount}>
                  {totalEvents} accrual event{totalEvents !== 1 ? 's' : ''}
                </span>
              </div>

              {hasGaps && missingDates.length > 0 && (
                <div className={styles.accrualHistoryGapWarning}>
                  <span className={styles.accrualHistoryGapIcon}>⚠</span>
                  <div>
                    <strong>Missing accruals detected</strong>
                    <p>
                      {missingDates.length} date{missingDates.length !== 1 ? 's' : ''} missing:{' '}
                      {missingDates.slice(0, 3).map(d => formatDate(d)).join(', ')}
                      {missingDates.length > 3 && ` and ${missingDates.length - 3} more`}
                    </p>
                  </div>
                </div>
              )}

              <div className={styles.accrualHistoryTableWrapper}>
                <table className={styles.accrualHistoryTable}>
                  <thead>
                    <tr>
                      <th className={styles.accrualHistoryColDay}>Day</th>
                      <th className={styles.accrualHistoryColDate}>Date</th>
                      <th className={styles.accrualHistoryColAmount}>Daily</th>
                      <th className={styles.accrualHistoryColAmount}>Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.eventId}>
                        <td className={styles.accrualHistoryColDay}>{event.dayNumber}</td>
                        <td className={styles.accrualHistoryColDate}>
                          {formatDate(event.accrualDate || event.timestamp)}
                        </td>
                        <td className={styles.accrualHistoryColAmount}>
                          {formatCurrency(event.amount)}
                        </td>
                        <td className={styles.accrualHistoryColAmount}>
                          {formatCurrency(event.cumulativeAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {events.length > 0 && (
          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={handleCopy}
              disabled={copySuccess}
            >
              {copySuccess ? '✓ Copied!' : 'Copy'}
            </button>
            <button type="button" className={styles.exportBtn} onClick={handleExportCSV}>
              Export CSV
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AccrualHistoryModal
