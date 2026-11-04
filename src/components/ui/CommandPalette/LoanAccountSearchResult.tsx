'use client'

import { Command } from 'cmdk'
import styles from './styles.module.css'

export interface LoanAccountSearchResultProps {
  account: {
    id: string
    loanAccountId: string
    accountNumber: string
    customerName: string | null
    accountStatus:
      | 'active'
      | 'paid_off'
      | 'in_arrears'
      | 'written_off'
      | 'pending_disbursement'
      | 'cancelled'
    totalOutstanding: number
  }
  onSelect: () => void
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'badgeActive' },
  paid_off: { label: 'Paid Off', className: 'badgePaidOff' },
  in_arrears: { label: 'In Arrears', className: 'badgeArrears' },
  written_off: { label: 'Written Off', className: 'badgeWrittenOff' },
  cancelled: { label: 'Cancelled', className: 'badgeCancelled' },
}

// Hoisted to module scope - reused across all renders (perf optimization)
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/**
 * Loan account search result item for the command palette.
 * Uses cmdk's Command.Item for keyboard navigation support.
 */
export const LoanAccountSearchResult: React.FC<LoanAccountSearchResultProps> = ({
  account,
  onSelect,
}) => {
  const statusInfo = STATUS_LABELS[account.accountStatus] || STATUS_LABELS.active
  const formattedBalance = currencyFormatter.format(account.totalOutstanding)

  return (
    <Command.Item
      className={styles.resultItem}
      value={account.accountNumber}
      onSelect={onSelect}
      data-testid={`account-result-${account.loanAccountId}`}
    >
      <div className={styles.resultIcon}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      </div>
      <div className={styles.resultContent}>
        <div className={styles.resultMain}>
          <span className={styles.resultName}>{account.accountNumber}</span>
          <span className={styles.resultBalance}>{formattedBalance}</span>
        </div>
        <div className={styles.resultMeta}>
          <span className={styles.resultCustomerName}>
            {account.customerName || 'Unknown Customer'}
          </span>
          <span className={styles[statusInfo.className] || styles.badgeActive}>
            {statusInfo.label}
          </span>
        </div>
      </div>
    </Command.Item>
  )
}
