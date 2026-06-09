'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { getAccountSignal, type AccountSignal } from '@/lib/accountTriage'
import styles from './LoanAccountCard.module.css'

export interface LoanAccountCardProps {
  account: LoanAccountData
  isSelected?: boolean
  onSelect: (account: LoanAccountData) => void
  /** Injectable for deterministic tests; defaults to now. */
  today?: Date
}

const currencyFormatter = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const dateFormatter = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short' })

const DOT_CLASS: Record<AccountSignal['tier'], string> = {
  overdue: styles.dotOverdue,
  pending: styles.dotPending,
  active: styles.dotActive,
  closed: styles.dotClosed,
}

function statusLine(account: LoanAccountData, signal: AccountSignal): string {
  switch (signal.tier) {
    case 'overdue':
      return signal.daysOverdue > 0 ? `${signal.daysOverdue} days overdue` : 'In arrears'
    case 'pending':
      return 'Pending disbursement'
    case 'closed':
      return account.accountStatus === 'written_off' ? 'Written off' : 'Paid off'
    case 'active':
    default:
      return signal.nextDueDate ? `On track · next ${dateFormatter.format(new Date(signal.nextDueDate))}` : 'On track'
  }
}

/**
 * Compact account row for the triaged rail. One line of status, one balance.
 */
export const LoanAccountCard: React.FC<LoanAccountCardProps> = ({ account, isSelected = false, onSelect, today }) => {
  const signal = getAccountSignal(account, today)
  const outstanding = account.liveBalance?.totalOutstanding ?? account.balances?.totalOutstanding ?? 0

  return (
    <button
      type="button"
      className={`${styles.row} ${isSelected ? styles.rowSelected : ''} ${signal.tier === 'closed' ? styles.rowClosed : ''}`}
      onClick={() => onSelect(account)}
      aria-pressed={isSelected}
      data-testid={`loan-account-card-${account.loanAccountId}`}
    >
      <div className={styles.rowTop}>
        <span className={`${styles.dot} ${DOT_CLASS[signal.tier]}`} aria-hidden />
        <span className={styles.accountNumber}>{account.accountNumber}</span>
      </div>
      <div className={styles.rowBottom}>
        <span className={`${styles.statusLine} ${styles[`status_${signal.tier}`] ?? ''}`}>
          {statusLine(account, signal)}
        </span>
        <span className={styles.balance}>{currencyFormatter.format(outstanding)}</span>
      </div>
    </button>
  )
}
