'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useAccountAging } from '@/hooks/queries/useAccountAging'
import { CopyButton } from '@/components/ui'
import { getStatusConfig } from '../account-status'
import styles from './styles.module.css'

export interface AccountHeaderProps {
  account: LoanAccountData
  onClose?: () => void
  showClose?: boolean
  onRefresh?: () => void
  isRefreshing?: boolean
  hasPendingWriteOff?: boolean
}

/**
 * Get bucket badge configuration
 */
function getBucketConfig(bucket: string, dpd: number): { label: string; className: string; tooltip: string } {
  switch (bucket) {
    case 'current':
      return {
        label: 'Current',
        className: styles.bucketCurrent,
        tooltip: 'Account is current - 0 DPD (Stage 1, 3% rate)',
      }
    case 'early_arrears':
      return {
        label: `Early Arrears (${dpd} DPD)`,
        className: styles.bucketEarlyArrears,
        tooltip: `${dpd} days past due - 1-14 DPD (Stage 1, 25% rate)`,
      }
    case 'late_arrears':
      return {
        label: `Late Arrears (${dpd} DPD)`,
        className: styles.bucketLateArrears,
        tooltip: `${dpd} days past due - 15-61 DPD (Stage 2 / SICR, 55% rate)`,
      }
    case 'default':
      return {
        label: `Default (${dpd} DPD)`,
        className: styles.bucketDefault,
        tooltip: `${dpd} days past due - 62+ DPD (Stage 3 / Credit-Impaired, 100% rate)`,
      }
    default:
      return {
        label: bucket,
        className: '',
        tooltip: `${dpd} days past due`,
      }
  }
}

// Hoisted for performance
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/**
 * AccountHeader - Displays account info bar with status and optional close button.
 * Shows account number, status badge, live/cached indicator, and total balance.
 */
export const AccountHeader: React.FC<AccountHeaderProps> = ({
  account,
  onClose,
  showClose = true,
  onRefresh,
  isRefreshing = false,
  hasPendingWriteOff = false,
}) => {
  const statusConfig = getStatusConfig(account.accountStatus)
  const hasLiveBalance = account.liveBalance !== null

  // Fetch aging status from ledger
  const { dpd, bucket, isFallback: agingFallback, isLoading: agingLoading } = useAccountAging({
    accountId: account.loanAccountId,
    enabled: account.accountStatus !== 'paid_off' && account.accountStatus !== 'written_off',
  })

  const bucketConfig = getBucketConfig(bucket, dpd)
  const showAgingBadge = !agingLoading && bucket !== 'current' && !agingFallback

  const totalOutstanding = hasLiveBalance
    ? account.liveBalance!.totalOutstanding
    : account.balances?.totalOutstanding ?? 0

  return (
    <div className={styles.accountHeader} data-testid="account-header">
      <div className={styles.accountHeaderInfo}>
        <span className={styles.accountHeaderIcon}>📍</span>
        <span className={styles.copyable}>
          <span className={styles.accountHeaderNumber}>{account.accountNumber}</span>
          <CopyButton value={account.accountNumber} label="Copy account number" />
        </span>
        <span className={`${styles.accountHeaderStatus} ${styles[statusConfig.colorClass]}`}>
          {statusConfig.label}
        </span>
        {/* Aging Badge - Story E2-S4 */}
        {showAgingBadge && (
          <span
            className={`${styles.agingBadge} ${bucketConfig.className}`}
            title={bucketConfig.tooltip}
            data-testid="aging-badge"
          >
            {bucketConfig.label}
          </span>
        )}
        {hasLiveBalance ? (
          <span className={styles.accountHeaderLive}>
            <span className={styles.accountHeaderLiveDot} />
            Live
          </span>
        ) : (
          <span className={styles.accountHeaderCached}>
            <span className={styles.accountHeaderCachedDot} />
            Cached
          </span>
        )}
        {hasPendingWriteOff && (
          <span
            className={styles.accountHeaderWriteOffBadge}
            title="Write-off request pending approval"
            data-testid="pending-writeoff-badge"
          >
            📝 Write-Off Pending
          </span>
        )}
      </div>
      <div className={styles.accountHeaderRight}>
        {account.signedLoanAgreementUrl && (
          <a
            href={`/api/loan-agreement?accountId=${encodeURIComponent(account.loanAccountId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.accountHeaderContractLink}
            title="View signed loan agreement"
            data-testid="header-view-loan-agreement"
          >
            📄 Contract
          </a>
        )}
        <span className={styles.accountHeaderBalance}>
          {currencyFormatter.format(totalOutstanding)}
        </span>
        {onRefresh && (
          <button
            type="button"
            className={styles.accountHeaderRefresh}
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Refresh data"
            title="Refresh data from ledger"
            data-testid="refresh-account-data"
          >
            <svg
              className={`${styles.accountHeaderRefreshIcon} ${isRefreshing ? styles.accountHeaderRefreshIconSpinning : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 8A6 6 0 1 1 8 2" />
              <path d="M14 2v6h-6" />
            </svg>
          </button>
        )}
        {showClose && onClose && (
          <button
            type="button"
            className={styles.accountHeaderClose}
            onClick={onClose}
            aria-label="Close account panel"
            data-testid="close-account-panel"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}
