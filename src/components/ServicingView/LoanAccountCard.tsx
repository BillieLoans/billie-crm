'use client'

import Link from 'next/link'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import type { CollectionsCaseRow } from '@/types/collections'
import { getAccountSignal, type AccountSignal } from '@/lib/accountTriage'
import styles from './LoanAccountCard.module.css'

export interface LoanAccountCardProps {
  account: LoanAccountData
  isSelected?: boolean
  onSelect: (account: LoanAccountData) => void
  /** Injectable for deterministic tests; defaults to now. */
  today?: Date
  /**
   * The account's collections case (BTB-197 WS4), if any. The badge + deep
   * link only render when a non-cured case is passed — cured cases carry no
   * signal here (mirrors the attention-strip nuance in accountTriage.ts).
   */
  collectionsCase?: CollectionsCaseRow | null
}

const COLLECTIONS_STATE_LABEL: Record<'open' | 'awaiting_human', string> = {
  open: 'Open',
  awaiting_human: 'Awaiting human',
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
export const LoanAccountCard: React.FC<LoanAccountCardProps> = ({
  account,
  isSelected = false,
  onSelect,
  today,
  collectionsCase = null,
}) => {
  const signal = getAccountSignal(account, today)
  const outstanding = account.liveBalance?.totalOutstanding ?? account.balances?.totalOutstanding ?? 0
  const showCollections = !!collectionsCase && collectionsCase.state !== 'cured'

  return (
    <div className={styles.cardWrap}>
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

        {showCollections && collectionsCase && (
          <div className={styles.collectionsBadge} data-testid={`collections-badge-${account.loanAccountId}`}>
            <span className={styles.collectionsBadgeText}>
              Collections · Step {collectionsCase.rung ?? '?'}/5 ·{' '}
              {(collectionsCase.state && COLLECTIONS_STATE_LABEL[collectionsCase.state as 'open' | 'awaiting_human']) ?? 'Unknown'}
            </span>
            {(collectionsCase.hardshipPaused || collectionsCase.stoppedContact) && (
              <span className={styles.collectionsFlags}>
                {collectionsCase.hardshipPaused && (
                  <span className={styles.flagChip}>Hardship</span>
                )}
                {collectionsCase.stoppedContact && (
                  <span className={`${styles.flagChip} ${styles.flagChipStop}`}>Stop contact</span>
                )}
              </span>
            )}
          </div>
        )}
      </button>

      {showCollections && (
        <Link
          href={`/admin/collections-queue/${account.loanAccountId}`}
          className={styles.collectionsLink}
          onClick={(e) => e.stopPropagation()}
          data-testid={`collections-link-${account.loanAccountId}`}
        >
          View collections case →
        </Link>
      )}
    </div>
  )
}
