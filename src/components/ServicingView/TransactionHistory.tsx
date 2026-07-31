'use client'

import { useState, useCallback, useMemo } from 'react'
import { useTransactions, TRANSACTION_TYPES, type Transaction } from '@/hooks/queries/useTransactions'
import { CopyButton } from '@/components/ui'
import { formatCurrency } from '@/lib/formatters'
import styles from './styles.module.css'

export interface TransactionHistoryProps {
  loanAccountId: string | null
  /** Transaction ID to highlight (e.g., when linked from payment details) */
  highlightedTransactionId?: string | null
  /** Transaction ID that was linked from payment (for showing back button) */
  linkedTransactionId?: string | null
  /** Callback to navigate back to payment (shown inline on linked row) */
  onBackToPayment?: () => void
  /** Payment number to show in back button tooltip */
  backToPaymentNumber?: number
}

// Hoisted for performance

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatDate(dateString: string): string {
  if (!dateString) return '—'
  try {
    // Handle both ISO strings and timestamp objects
    const date = typeof dateString === 'object' 
      ? new Date(parseInt((dateString as { seconds: string }).seconds) * 1000)
      : new Date(dateString)
    return dateFormatter.format(date)
  } catch {
    return '—'
  }
}

const TYPE_COLORS: Record<string, string> = {
  DISBURSEMENT: 'txTypeDisbursement',
  ESTABLISHMENT_FEE: 'txTypeEstablishmentFee',
  REPAYMENT: 'txTypeRepayment',
  LATE_FEE: 'txTypeLateFee',
  DISHONOUR_FEE: 'txTypeLateFee',
  FEE_WAIVER: 'txTypeFeeWaiver',
  ADJUSTMENT: 'txTypeAdjustment',
  WRITE_OFF: 'txTypeWriteOff',
}

export interface TransactionRowProps {
  transaction: Transaction
  /** Whether this transaction is highlighted (e.g., from payment link) */
  isHighlighted?: boolean
  /** Callback to navigate back to payment (shown on highlighted row) */
  onBackToPayment?: () => void
  /** Payment number for tooltip */
  backToPaymentNumber?: number
}

/**
 * Single transaction row for desktop table
 */
const TransactionRow: React.FC<TransactionRowProps> = ({ 
  transaction, 
  isHighlighted,
  onBackToPayment,
  backToPaymentNumber,
}) => {
  const totalDelta = parseFloat(transaction.principalDelta || '0') + parseFloat(transaction.feeDelta || '0')
  const isCredit = totalDelta < 0
  const typeColor = TYPE_COLORS[transaction.type] || 'txTypeAdjustment'

  return (
    <tr 
      className={`${styles.txRow} ${isHighlighted ? styles.txRowHighlighted : ''}`}
      data-transaction-id={transaction.transactionId}
    >
      <td className={`${styles.txCell} ${styles.txCellBack}`}>
        {onBackToPayment && (
          <button
            type="button"
            className={styles.txBackButton}
            onClick={onBackToPayment}
            data-tooltip={`Back to Payment #${backToPaymentNumber}`}
            aria-label={`Back to Payment #${backToPaymentNumber}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </td>
      <td className={styles.txCell}>
        <span className={styles.txIdMono}>{transaction.transactionId}</span>
      </td>
      <td className={styles.txCell}>{formatDate(transaction.transactionDate)}</td>
      <td className={styles.txCell}>
        <span className={`${styles.txTypeBadge} ${styles[typeColor]}`}>
          {transaction.typeLabel || transaction.type}
        </span>
      </td>
      <td className={styles.txCell}>
        <span className={isCredit ? styles.txAmountNegative : styles.txAmountPositive}>
          {formatCurrency(totalDelta.toString())}
        </span>
      </td>
      <td className={styles.txCell}>
        {transaction.referenceId ? (
          <span className={styles.txCopyable}>
            <span>{transaction.referenceId}</span>
            <CopyButton value={transaction.referenceId} label="Copy reference ID" />
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className={`${styles.txCell} ${styles.txCellRight}`}>
        {formatCurrency(transaction.totalAfter)}
      </td>
    </tr>
  )
}

export interface TransactionCardProps {
  transaction: Transaction
  /** Whether this transaction is highlighted (e.g., from payment link) */
  isHighlighted?: boolean
  /** Callback to navigate back to payment (shown on highlighted card) */
  onBackToPayment?: () => void
  /** Payment number for tooltip */
  backToPaymentNumber?: number
}

/**
 * Single transaction card for mobile
 */
const TransactionCard: React.FC<TransactionCardProps> = ({ 
  transaction, 
  isHighlighted,
  onBackToPayment,
  backToPaymentNumber,
}) => {
  const totalDelta = parseFloat(transaction.principalDelta || '0') + parseFloat(transaction.feeDelta || '0')
  const isCredit = totalDelta < 0
  const typeColor = TYPE_COLORS[transaction.type] || 'txTypeAdjustment'

  return (
    <div 
      className={`${styles.txCard} ${isHighlighted ? styles.txCardHighlighted : ''}`} 
      data-testid="transaction-card"
      data-transaction-id={transaction.transactionId}
    >
      <div className={styles.txCardHeader}>
        <span className={`${styles.txTypeBadge} ${styles[typeColor]}`}>
          {transaction.typeLabel || transaction.type}
        </span>
        <span className={styles.txCardDate}>{formatDate(transaction.transactionDate)}</span>
      </div>
      {onBackToPayment && (
        <div className={styles.txCardBackRow}>
          <button
            type="button"
            className={styles.txBackButtonCard}
            onClick={onBackToPayment}
            aria-label={`Back to Payment #${backToPaymentNumber}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Payment #{backToPaymentNumber}
          </button>
        </div>
      )}
      <div className={styles.txCardBody}>
        <div className={styles.txCardRow}>
          <span className={styles.txCardLabel}>Transaction ID</span>
          <span className={styles.txIdMono}>{transaction.transactionId}</span>
        </div>
        <div className={styles.txCardRow}>
          <span className={styles.txCardLabel}>Amount</span>
          <span className={isCredit ? styles.txAmountNegative : styles.txAmountPositive}>
            {formatCurrency(totalDelta.toString())}
          </span>
        </div>
        <div className={styles.txCardRow}>
          <span className={styles.txCardLabel}>Balance After</span>
          <span className={styles.txCardValue}>{formatCurrency(transaction.totalAfter)}</span>
        </div>
        {transaction.referenceId && (
          <div className={styles.txCardRow}>
            <span className={styles.txCardLabel}>Reference</span>
            <span className={styles.txCopyable}>
              <span className={styles.txCardValue}>{transaction.referenceId}</span>
              <CopyButton value={transaction.referenceId} label="Copy reference ID" />
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * TransactionHistory - Displays transaction history with filters.
 * Responsive: table on desktop, cards on mobile.
 */
export const TransactionHistory: React.FC<TransactionHistoryProps> = ({ 
  loanAccountId,
  highlightedTransactionId,
  linkedTransactionId,
  onBackToPayment,
  backToPaymentNumber,
}) => {
  const [typeFilter, setTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [limit, setLimit] = useState(20)

  const filters = useMemo(() => ({
    type: typeFilter || undefined,
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    limit,
  }), [typeFilter, fromDate, toDate, limit])

  const { data, isLoading, isError, isFetching } = useTransactions(loanAccountId, filters)

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTypeFilter(e.target.value)
  }, [])

  const handleFromDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFromDate(e.target.value)
  }, [])

  const handleToDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setToDate(e.target.value)
  }, [])

  const handleLoadMore = useCallback(() => {
    setLimit((prev) => prev + 20)
  }, [])

  const handleClearFilters = useCallback(() => {
    setTypeFilter('')
    setFromDate('')
    setToDate('')
  }, [])

  // No account selected
  if (!loanAccountId) {
    return (
      <div className={styles.transactionsSection}>
        <h3 className={styles.sectionTitle}>Transaction History</h3>
        <p className={styles.placeholderText}>Select a loan account to view transactions</p>
      </div>
    )
  }

  const transactions = data?.transactions ?? []
  const totalCount = data?.totalCount ?? 0
  const isFallback = data?._fallback ?? false
  const hasFilters = typeFilter || fromDate || toDate
  const hasMore = transactions.length < totalCount

  return (
    <div className={styles.transactionsSection} data-testid="transaction-history">
      <div className={styles.txHeader}>
        <h3 className={styles.sectionTitle}>
          Transaction History
          {!isLoading && ` (${totalCount})`}
        </h3>
      </div>

      {/* Filters */}
      <div className={styles.txFilters}>
        <select
          className={styles.txFilterSelect}
          value={typeFilter}
          onChange={handleTypeChange}
          aria-label="Filter by transaction type"
        >
          {TRANSACTION_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          className={styles.txFilterDate}
          value={fromDate}
          onChange={handleFromDateChange}
          aria-label="From date"
          placeholder="From"
        />

        <input
          type="date"
          className={styles.txFilterDate}
          value={toDate}
          onChange={handleToDateChange}
          aria-label="To date"
          placeholder="To"
        />

        {hasFilters && (
          <button
            type="button"
            className={styles.txFilterClear}
            onClick={handleClearFilters}
          >
            Clear
          </button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className={styles.txLoading}>Loading transactions...</div>
      )}

      {/* Error/Fallback state */}
      {!isLoading && (isError || isFallback) && (
        <div className={styles.txFallback}>
          <span className={styles.txFallbackIcon}>⚠️</span>
          <span>{data?._message || 'Unable to load transactions'}</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && !isFallback && transactions.length === 0 && (
        <div className={styles.txEmpty}>
          No transactions found
          {hasFilters && ' matching your filters'}
        </div>
      )}

      {/* Desktop table */}
      {!isLoading && !isError && !isFallback && transactions.length > 0 && (
        <>
          <div className={styles.txTableWrapper}>
            <table className={styles.txTable}>
              <thead>
                <tr>
                  <th className={`${styles.txHeaderCell} ${styles.txCellBack}`}></th>
                  <th className={styles.txHeaderCell}>Transaction ID</th>
                  <th className={styles.txHeaderCell}>Date</th>
                  <th className={styles.txHeaderCell}>Type</th>
                  <th className={styles.txHeaderCell}>Amount</th>
                  <th className={styles.txHeaderCell}>Reference</th>
                  <th className={`${styles.txHeaderCell} ${styles.txCellRight}`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const isHighlighted = highlightedTransactionId === tx.transactionId
                  const isLinked = linkedTransactionId === tx.transactionId
                  return (
                    <TransactionRow 
                      key={tx.transactionId} 
                      transaction={tx}
                      isHighlighted={isHighlighted}
                      onBackToPayment={isLinked ? onBackToPayment : undefined}
                      backToPaymentNumber={backToPaymentNumber}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className={styles.txCardList}>
            {transactions.map((tx) => {
              const isHighlighted = highlightedTransactionId === tx.transactionId
              const isLinked = linkedTransactionId === tx.transactionId
              return (
                <TransactionCard 
                  key={tx.transactionId} 
                  transaction={tx}
                  isHighlighted={isHighlighted}
                  onBackToPayment={isLinked ? onBackToPayment : undefined}
                  backToPaymentNumber={backToPaymentNumber}
                />
              )
            })}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className={styles.txLoadMore}>
              <button
                type="button"
                className={styles.txLoadMoreBtn}
                onClick={handleLoadMore}
                disabled={isFetching}
              >
                {isFetching ? 'Loading...' : `Load more (${transactions.length} of ${totalCount})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

