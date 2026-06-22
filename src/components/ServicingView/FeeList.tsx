'use client'

import { useState, useCallback, useMemo } from 'react'
import { useTransactions, type Transaction } from '@/hooks/queries/useTransactions'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

export interface FeeListProps {
  loanAccountId: string | null
  onBulkWaive?: (selectedFees: SelectedFee[]) => void
}

export interface SelectedFee {
  transactionId: string
  amount: number
  type: string
  typeLabel: string
  date: string
}

// Fee types that can be waived
const WAIVABLE_FEE_TYPES = ['LATE_FEE', 'DISHONOUR_FEE'] as const

// Hoisted formatters
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatDate(dateString: string): string {
  if (!dateString) return '—'
  try {
    const date =
      typeof dateString === 'object'
        ? new Date(parseInt((dateString as { seconds: string }).seconds) * 1000)
        : new Date(dateString)
    return dateFormatter.format(date)
  } catch {
    return '—'
  }
}

function isWaivableFee(tx: Transaction): boolean {
  const feeAmount = parseFloat(tx.feeDelta || '0')
  return WAIVABLE_FEE_TYPES.includes(tx.type as (typeof WAIVABLE_FEE_TYPES)[number]) && feeAmount > 0
}

/**
 * Single fee row with optional checkbox
 */
const FeeRow: React.FC<{
  fee: Transaction
  isSelected: boolean
  selectionMode: boolean
  onToggle: (transactionId: string) => void
}> = ({ fee, isSelected, selectionMode, onToggle }) => {
  const amount = parseFloat(fee.feeDelta || '0')

  const handleClick = useCallback(() => {
    if (selectionMode) {
      onToggle(fee.transactionId)
    }
  }, [selectionMode, fee.transactionId, onToggle])

  const handleCheckboxChange = useCallback(() => {
    onToggle(fee.transactionId)
  }, [fee.transactionId, onToggle])

  return (
    <tr
      className={`${styles.feeRow} ${selectionMode ? styles.feeRowClickable : ''} ${isSelected ? styles.feeRowSelected : ''}`}
      onClick={handleClick}
      data-testid={`fee-row-${fee.transactionId}`}
    >
      {selectionMode && (
        <td className={styles.feeCell}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckboxChange}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${fee.typeLabel} fee`}
            className={styles.feeCheckbox}
          />
        </td>
      )}
      <td className={styles.feeCell}>{formatDate(fee.transactionDate)}</td>
      <td className={styles.feeCell}>
        <span className={`${styles.feeTypeBadge} ${styles.feeTypeLateFee}`}>
          {fee.typeLabel || fee.type}
        </span>
      </td>
      <td className={styles.feeCell}>{currencyFormatter.format(amount)}</td>
      <td className={styles.feeCell}>{fee.referenceId || '—'}</td>
    </tr>
  )
}

/**
 * FeeList - Displays waivable fees with selection mode for bulk waiver.
 */
export const FeeList: React.FC<FeeListProps> = ({ loanAccountId, onBulkWaive }) => {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)

  // Fetch all transactions, then filter client-side to fee types
  const { data, isLoading, isError } = useTransactions(loanAccountId, { limit: 100 })

  // Filter to waivable fees
  const transactions = data?.transactions
  const waivableFees = useMemo(() => {
    if (!transactions) return []
    return transactions.filter(isWaivableFee)
  }, [transactions])

  // Calculate selected fees and total
  const selectedFees = useMemo(() => {
    return waivableFees
      .filter((fee) => selectedIds.has(fee.transactionId))
      .map((fee) => ({
        transactionId: fee.transactionId,
        amount: parseFloat(fee.feeDelta || '0'),
        type: fee.type,
        typeLabel: fee.typeLabel,
        date: fee.transactionDate,
      }))
  }, [waivableFees, selectedIds])

  const selectedTotal = useMemo(() => {
    return selectedFees.reduce((sum, fee) => sum + fee.amount, 0)
  }, [selectedFees])

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selections
        setSelectedIds(new Set())
      }
      return !prev
    })
  }, [])

  const handleToggleFee = useCallback((transactionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(transactionId)) {
        next.delete(transactionId)
      } else {
        next.add(transactionId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(waivableFees.map((f) => f.transactionId)))
  }, [waivableFees])

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleWaiveSelected = useCallback(() => {
    if (selectedFees.length > 0 && onBulkWaive) {
      onBulkWaive(selectedFees)
    }
  }, [selectedFees, onBulkWaive])

  // No account selected
  if (!loanAccountId) {
    return (
      <div className={styles.feeListSection}>
        <h3 className={styles.sectionTitle}>Outstanding Fees</h3>
        <p className={styles.placeholderText}>Select a loan account to view fees</p>
      </div>
    )
  }

  return (
    <div className={styles.feeListSection} data-testid="fee-list">
      {/* Header */}
      <div className={styles.feeListHeader}>
        <h3 className={styles.sectionTitle}>
          Outstanding Fees
          {!isLoading && ` (${waivableFees.length})`}
        </h3>
        {waivableFees.length > 0 && !readOnlyMode && (
          <button
            type="button"
            className={`${styles.feeListToggle} ${selectionMode ? styles.feeListToggleActive : ''}`}
            onClick={handleToggleSelectionMode}
            data-testid="selection-mode-toggle"
          >
            {selectionMode ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>

      {/* Selection toolbar */}
      {selectionMode && (
        <div className={styles.feeToolbar}>
          <div className={styles.feeToolbarLeft}>
            <button
              type="button"
              className={styles.feeToolbarBtn}
              onClick={handleSelectAll}
              disabled={selectedIds.size === waivableFees.length}
            >
              Select All
            </button>
            <button
              type="button"
              className={styles.feeToolbarBtn}
              onClick={handleClearSelection}
              disabled={selectedIds.size === 0}
            >
              Clear
            </button>
          </div>
          <div className={styles.feeToolbarRight}>
            <span className={styles.feeToolbarSummary}>
              {selectedFees.length} selected • {currencyFormatter.format(selectedTotal)}
            </span>
            <button
              type="button"
              className={styles.feeToolbarWaiveBtn}
              onClick={handleWaiveSelected}
              disabled={selectedFees.length === 0}
              data-testid="waive-selected-button"
            >
              Waive Selected
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && <div className={styles.feeLoading}>Loading fees...</div>}

      {/* Error state */}
      {!isLoading && isError && (
        <div className={styles.feeError}>Unable to load fees</div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && waivableFees.length === 0 && (
        <div className={styles.feeEmpty}>No outstanding fees</div>
      )}

      {/* Fee table */}
      {!isLoading && !isError && waivableFees.length > 0 && (
        <div className={styles.feeTableWrapper}>
          <table className={styles.feeTable}>
            <thead>
              <tr>
                {selectionMode && <th className={styles.feeHeaderCell}></th>}
                <th className={styles.feeHeaderCell}>Date</th>
                <th className={styles.feeHeaderCell}>Type</th>
                <th className={styles.feeHeaderCell}>Amount</th>
                <th className={styles.feeHeaderCell}>Reference</th>
              </tr>
            </thead>
            <tbody>
              {waivableFees.map((fee) => (
                <FeeRow
                  key={fee.transactionId}
                  fee={fee}
                  isSelected={selectedIds.has(fee.transactionId)}
                  selectionMode={selectionMode}
                  onToggle={handleToggleFee}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
