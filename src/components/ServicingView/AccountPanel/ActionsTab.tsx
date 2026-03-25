'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useUIStore } from '@/stores/ui'
import { useOptimisticStore } from '@/stores/optimistic'
import styles from './styles.module.css'

export interface ActionsTabProps {
  account: LoanAccountData
  onRecordRepayment: () => void
  onWaiveFee: () => void
  onApplyLateFee: () => void
  onApplyDishonourFee: () => void
  onRequestWriteOff?: () => void
  onDisburseLoan?: () => void
  hasPendingWriteOff?: boolean
}

// Hoisted for performance
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

/**
 * ActionsTab - Displays available actions for the account.
 * Shows Record Payment and Waive Fee with descriptions.
 */
export const ActionsTab: React.FC<ActionsTabProps> = ({
  account,
  onRecordRepayment,
  onWaiveFee,
  onApplyLateFee,
  onApplyDishonourFee,
  onRequestWriteOff,
  onDisburseLoan,
  hasPendingWriteOff = false,
}) => {
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const hasPendingAction = useOptimisticStore((state) => state.hasPendingAction)
  const hasPendingWaive = hasPendingAction(account.loanAccountId, 'waive-fee')
  const hasPendingRepayment = hasPendingAction(account.loanAccountId, 'record-repayment')

  const hasLiveBalance = account.liveBalance !== null
  const fees = hasLiveBalance ? account.liveBalance!.feeBalance : 0
  const totalOutstanding = hasLiveBalance
    ? account.liveBalance!.totalOutstanding
    : account.balances?.totalOutstanding ?? 0

  return (
    <div
      className={styles.actionsTab}
      role="tabpanel"
      id="tabpanel-actions"
      aria-labelledby="tab-actions"
      data-testid="actions-tab"
    >
      <h4 className={styles.actionsTitle}>Available Actions</h4>

      {readOnlyMode && (
        <div className={styles.actionsReadOnlyWarning} role="alert">
          <span className={styles.actionsWarningIcon}>🔒</span>
          <span>System is in read-only mode. Actions are temporarily disabled.</span>
        </div>
      )}

      {/* Disburse Loan Action - only visible for pending disbursement accounts */}
      {onDisburseLoan && account.accountStatus === 'pending_disbursement' && (
        <div className={styles.actionCard}>
          <div className={styles.actionCardHeader}>
            <span className={styles.actionCardIcon}>🏦</span>
            <span className={styles.actionCardTitle}>Disburse Loan</span>
          </div>
          <p className={styles.actionCardDescription}>
            Record disbursement of funds to the customer. This will transition the account to active
            status and begin the repayment schedule.
          </p>
          <div className={styles.actionCardFooter}>
            <span className={styles.actionCardMeta}>
              Loan Amount: {currencyFormatter.format(account.loanTerms?.loanAmount ?? 0)}
            </span>
            <button
              type="button"
              className={`${styles.actionCardBtn} ${styles.actionCardBtnPrimary}`}
              onClick={onDisburseLoan}
              disabled={readOnlyMode}
              data-testid="action-disburse-loan"
            >
              Disburse Loan
            </button>
          </div>
        </div>
      )}

      {/* Record Payment Action */}
      <div className={styles.actionCard}>
        <div className={styles.actionCardHeader}>
          <span className={styles.actionCardIcon}>💳</span>
          <span className={styles.actionCardTitle}>Record Payment</span>
        </div>
        <p className={styles.actionCardDescription}>
          Record a manual repayment for this account. Use this for payments received outside of
          automatic debit.
        </p>
        <div className={styles.actionCardFooter}>
          <span className={styles.actionCardMeta}>
            Outstanding: {currencyFormatter.format(totalOutstanding)}
          </span>
          <button
            type="button"
            className={styles.actionCardBtn}
            onClick={onRecordRepayment}
            disabled={readOnlyMode || hasPendingRepayment}
            data-testid="action-record-repayment"
          >
            {hasPendingRepayment ? '⏳ Processing...' : 'Record Payment'}
          </button>
        </div>
      </div>

      {/* Waive Fee Action */}
      <div className={styles.actionCard}>
        <div className={styles.actionCardHeader}>
          <span className={styles.actionCardIcon}>🎁</span>
          <span className={styles.actionCardTitle}>Waive Fee</span>
        </div>
        <p className={styles.actionCardDescription}>
          Waive outstanding fees for this account as a goodwill gesture or to resolve a dispute.
        </p>
        <div className={styles.actionCardFooter}>
          <span className={styles.actionCardMeta}>
            Current fees: {currencyFormatter.format(fees)}
          </span>
          <button
            type="button"
            className={`${styles.actionCardBtn} ${styles.actionCardBtnPrimary}`}
            onClick={onWaiveFee}
            disabled={readOnlyMode || hasPendingWaive || fees <= 0}
            data-testid="action-waive-fee"
          >
            {hasPendingWaive ? '⏳ Waiving...' : 'Waive Fee'}
          </button>
        </div>
      </div>

      {/* Apply Late Fee Action */}
      <div className={styles.actionCard}>
        <div className={styles.actionCardHeader}>
          <span className={styles.actionCardIcon}>⏰</span>
          <span className={styles.actionCardTitle}>Apply Late Fee</span>
        </div>
        <p className={styles.actionCardDescription}>
          Apply a late fee for missed or overdue payments on this account.
        </p>
        <div className={styles.actionCardFooter}>
          <span className={styles.actionCardMeta}>
            Standard fee: {currencyFormatter.format(10)}
          </span>
          <button
            type="button"
            className={styles.actionCardBtn}
            onClick={onApplyLateFee}
            disabled={readOnlyMode}
            data-testid="action-apply-late-fee"
          >
            Apply Late Fee
          </button>
        </div>
      </div>

      {/* Apply Dishonour Fee Action */}
      <div className={styles.actionCard}>
        <div className={styles.actionCardHeader}>
          <span className={styles.actionCardIcon}>🔄</span>
          <span className={styles.actionCardTitle}>Apply Dishonour Fee</span>
        </div>
        <p className={styles.actionCardDescription}>
          Apply a dishonour fee for a failed direct debit on this account.
        </p>
        <div className={styles.actionCardFooter}>
          <span className={styles.actionCardMeta}>
            Standard fee: {currencyFormatter.format(10)}
          </span>
          <button
            type="button"
            className={styles.actionCardBtn}
            onClick={onApplyDishonourFee}
            disabled={readOnlyMode}
            data-testid="action-apply-dishonour-fee"
          >
            Apply Dishonour Fee
          </button>
        </div>
      </div>

      {/* Request Write-Off Action */}
      {onRequestWriteOff && (
        <div className={styles.actionCard}>
          <div className={styles.actionCardHeader}>
            <span className={styles.actionCardIcon}>📝</span>
            <span className={styles.actionCardTitle}>Request Write-Off</span>
            {hasPendingWriteOff && (
              <span className={styles.actionCardBadge}>Pending</span>
            )}
          </div>
          <p className={styles.actionCardDescription}>
            Submit a write-off request for this account. Requires approval from a supervisor.
          </p>
          <div className={styles.actionCardFooter}>
            <span className={styles.actionCardMeta}>
              Balance: {currencyFormatter.format(totalOutstanding)}
            </span>
            <button
              type="button"
              className={`${styles.actionCardBtn} ${styles.actionCardBtnDanger}`}
              onClick={onRequestWriteOff}
              disabled={readOnlyMode || hasPendingWriteOff}
              data-testid="action-request-writeoff"
            >
              {hasPendingWriteOff ? '⏳ Pending Approval' : 'Request Write-Off'}
            </button>
          </div>
        </div>
      )}

      {/* Future actions placeholder */}
      <div className={styles.actionsFuture}>
        <p className={styles.actionsFutureText}>
          More actions coming soon: Reschedule Payment, Send Statement
        </p>
      </div>
    </div>
  )
}
