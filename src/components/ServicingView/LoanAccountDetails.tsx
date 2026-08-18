'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useUIStore } from '@/stores/ui'
import { useOptimisticStore } from '@/stores/optimistic'
import { getStatusConfig } from './account-status'
import styles from './styles.module.css'

export interface LoanAccountDetailsProps {
  account: LoanAccountData
  onWaiveFee?: () => void
  onRecordRepayment?: () => void
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
 * LoanAccountDetails - Full account details for the context drawer.
 * Shows loan terms, balances, repayment schedule, and last payment info.
 */
export const LoanAccountDetails: React.FC<LoanAccountDetailsProps> = ({
  account,
  onWaiveFee,
  onRecordRepayment,
}) => {
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const hasPendingAction = useOptimisticStore((state) => state.hasPendingAction)
  const hasPendingWaive = hasPendingAction(account.loanAccountId, 'waive-fee')
  const hasPendingRepayment = hasPendingAction(account.loanAccountId, 'record-repayment')
  const statusConfig = getStatusConfig(account.accountStatus)
  const hasLiveBalance = account.liveBalance !== null

  // Use live balance if available
  const principal = hasLiveBalance
    ? account.liveBalance!.principalBalance
    : account.balances?.currentBalance ?? 0
  const fees = hasLiveBalance ? account.liveBalance!.feeBalance : 0
  const totalOutstanding = hasLiveBalance
    ? account.liveBalance!.totalOutstanding
    : account.balances?.totalOutstanding ?? 0

  return (
    <div className={styles.detailsContainer} data-testid="loan-account-details">
      {/* Account Header */}
      <div className={styles.detailsHeader}>
        <div className={styles.detailsAccountInfo}>
          <span className={styles.detailsAccountNumber}>{account.accountNumber}</span>
          <span className={styles.detailsLoanId}>{account.loanAccountId}</span>
        </div>
        <span className={`${styles.detailsStatus} ${styles[statusConfig.colorClass]}`}>
          {statusConfig.label}
        </span>
      </div>

      {/* Balance Section */}
      <div className={styles.detailsSection}>
        <h3 className={styles.detailsSectionTitle}>
          Current Balance
          {hasLiveBalance ? (
            <span className={styles.detailsLiveTag}>Live</span>
          ) : (
            <span className={styles.detailsCachedTag}>Cached</span>
          )}
        </h3>
        <div className={styles.detailsGrid}>
          <div className={styles.detailsItem}>
            <span className={styles.detailsLabel}>Principal</span>
            <span className={styles.detailsValue}>{currencyFormatter.format(principal)}</span>
          </div>
          {hasLiveBalance && (
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Fees</span>
              <span className={styles.detailsValue}>{currencyFormatter.format(fees)}</span>
            </div>
          )}
          <div className={styles.detailsItem}>
            <span className={styles.detailsLabel}>Total Outstanding</span>
            <span className={`${styles.detailsValue} ${styles.detailsValueHighlight}`}>
              {currencyFormatter.format(totalOutstanding)}
            </span>
          </div>
          {account.balances?.totalPaid !== null && account.balances?.totalPaid !== undefined && (
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Total Paid</span>
              <span className={styles.detailsValue}>
                {currencyFormatter.format(account.balances.totalPaid)}
              </span>
            </div>
          )}
        </div>
        {hasLiveBalance && account.liveBalance?.asOf && (
          <p className={styles.detailsTimestamp}>
            Balance as of {formatDate(account.liveBalance.asOf)}
          </p>
        )}
      </div>

      {/* Loan Terms */}
      {account.loanTerms && (
        <div className={styles.detailsSection}>
          <h3 className={styles.detailsSectionTitle}>Loan Terms</h3>
          <div className={styles.detailsGrid}>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Loan Amount</span>
              <span className={styles.detailsValue}>
                {account.loanTerms.loanAmount
                  ? currencyFormatter.format(account.loanTerms.loanAmount)
                  : '—'}
              </span>
            </div>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Loan Fee</span>
              <span className={styles.detailsValue}>
                {account.loanTerms.loanFee
                  ? currencyFormatter.format(account.loanTerms.loanFee)
                  : '—'}
              </span>
            </div>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Total Payable</span>
              <span className={styles.detailsValue}>
                {account.loanTerms.totalPayable
                  ? currencyFormatter.format(account.loanTerms.totalPayable)
                  : '—'}
              </span>
            </div>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Opened</span>
              <span className={styles.detailsValue}>{formatDate(account.loanTerms.openedDate)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Repayment Schedule */}
      {account.repaymentSchedule && (
        <div className={styles.detailsSection}>
          <h3 className={styles.detailsSectionTitle}>Repayment Schedule</h3>
          <div className={styles.detailsGrid}>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Frequency</span>
              <span className={styles.detailsValue}>
                {formatFrequency(account.repaymentSchedule.paymentFrequency)}
              </span>
            </div>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Payments</span>
              <span className={styles.detailsValue}>
                {account.repaymentSchedule.numberOfPayments ?? '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Last Payment */}
      {account.lastPayment && (account.lastPayment.date || account.lastPayment.amount) && (
        <div className={styles.detailsSection}>
          <h3 className={styles.detailsSectionTitle}>Last Payment</h3>
          <div className={styles.detailsGrid}>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Date</span>
              <span className={styles.detailsValue}>{formatDate(account.lastPayment.date)}</span>
            </div>
            <div className={styles.detailsItem}>
              <span className={styles.detailsLabel}>Amount</span>
              <span className={styles.detailsValue}>
                {account.lastPayment.amount
                  ? currencyFormatter.format(account.lastPayment.amount)
                  : '—'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {(onRecordRepayment || onWaiveFee) && (
        <div className={styles.detailsActions}>
          {onRecordRepayment && (
            <button
              type="button"
              className={styles.detailsActionBtn}
              onClick={onRecordRepayment}
              disabled={readOnlyMode || hasPendingRepayment}
              title={
                readOnlyMode
                  ? 'System in read-only mode'
                  : hasPendingRepayment
                    ? 'Action in progress'
                    : 'Record a manual repayment'
              }
              data-testid="record-repayment-button"
            >
              {hasPendingRepayment ? '⏳ Processing...' : '💳 Record Payment'}
            </button>
          )}
          {/* Shown even at $0.00 fee balance — the ledger supports retroactive
              waivers of fees already settled by a repayment */}
          {onWaiveFee && (
            <button
              type="button"
              className={`${styles.detailsActionBtn} ${styles.detailsActionBtnPrimary}`}
              onClick={onWaiveFee}
              disabled={readOnlyMode || hasPendingWaive}
              title={
                readOnlyMode
                  ? 'System in read-only mode'
                  : hasPendingWaive
                    ? 'Action in progress'
                    : 'Waive fees'
              }
              data-testid="waive-fee-button"
            >
              {hasPendingWaive ? '⏳ Waiving...' : '🎁 Waive Fee'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
