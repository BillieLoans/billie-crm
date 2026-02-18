'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useUIStore } from '@/stores/ui'
import { useOptimisticStore } from '@/stores/optimistic'
import styles from './styles.module.css'

export interface ActionsTabProps {
  account: LoanAccountData
  onRecordRepayment: () => void
  onWaiveFee: () => void
  onTriggerDisbursement?: () => void
  onRequestWriteOff?: () => void
  hasPendingWriteOff?: boolean
  hasPendingDisbursement?: boolean
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
  onTriggerDisbursement,
  onRequestWriteOff,
  hasPendingWriteOff = false,
  hasPendingDisbursement = false,
}) => {
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)
  const hasPendingAction = useOptimisticStore((state) => state.hasPendingAction)
  const hasPendingWaive = hasPendingAction(account.loanAccountId, 'waive-fee')
  const hasPendingRepayment = hasPendingAction(account.loanAccountId, 'record-repayment')
  const isDisbursementPending = hasPendingDisbursement || hasPendingAction(account.loanAccountId, 'trigger-disbursement')

  // GAP-06: Determine if account is awaiting disbursement
  const isAwaitingDisbursement = account.status === 'AWAITING_DISBURSEMENT'
  const isAlreadyDisbursed = !isAwaitingDisbursement

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

      {/* GAP-07: Trigger Disbursement Action (only shown when awaiting disbursement) */}
      {isAwaitingDisbursement && onTriggerDisbursement && (
        <div className={styles.actionCard}>
          <div className={styles.actionCardHeader}>
            <span className={styles.actionCardIcon}>&#x1F4B8;</span>
            <span className={styles.actionCardTitle}>Trigger Disbursement</span>
          </div>
          <p className={styles.actionCardDescription}>
            Record the actual disbursement of funds to the customer. This will start
            revenue accrual and ECL calculation. Ensure funds have been sent before
            confirming.
          </p>
          <div className={styles.actionCardFooter}>
            <span className={styles.actionCardMeta}>
              Amount: {currencyFormatter.format(
                (account.loanAmount ?? 0) + (account.loanFee ?? 0)
              )}
            </span>
            <button
              type="button"
              className={`${styles.actionCardBtn} ${styles.actionCardBtnPrimary}`}
              onClick={onTriggerDisbursement}
              disabled={readOnlyMode || isDisbursementPending}
              data-testid="action-trigger-disbursement"
            >
              {isDisbursementPending ? 'Processing...' : 'Trigger Disbursement'}
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
