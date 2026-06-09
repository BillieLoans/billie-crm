'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useUIStore } from '@/stores/ui'
import { useOptimisticStore } from '@/stores/optimistic'
import { getAccountActions, type AccountActionId } from '@/lib/getAccountActions'
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

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })

const COPY: Record<AccountActionId, { icon: string; description: string }> = {
  disburse: { icon: '🏦', description: 'Record disbursement of funds to the customer. This transitions the account to active and begins the repayment schedule.' },
  'record-payment': { icon: '💳', description: 'Record a manual repayment for this account. Use this for payments received outside of automatic debit.' },
  'waive-fee': { icon: '🎁', description: 'Waive outstanding fees for this account as a goodwill gesture or to resolve a dispute.' },
  'apply-late-fee': { icon: '⏰', description: 'Apply a late fee for missed or overdue payments on this account.' },
  'apply-dishonour-fee': { icon: '🔄', description: 'Apply a dishonour fee for a failed direct debit on this account.' },
  'request-write-off': { icon: '📝', description: 'Submit a write-off request for this account. Requires approval from a supervisor.' },
}

export const ActionsTab: React.FC<ActionsTabProps> = (props) => {
  const { account, hasPendingWriteOff = false } = props
  const readOnly = useUIStore((s) => s.readOnlyMode)
  const hasPendingAction = useOptimisticStore((s) => s.hasPendingAction)

  const handler: Record<AccountActionId, (() => void) | undefined> = {
    disburse: props.onDisburseLoan,
    'record-payment': props.onRecordRepayment,
    'waive-fee': props.onWaiveFee,
    'apply-late-fee': props.onApplyLateFee,
    'apply-dishonour-fee': props.onApplyDishonourFee,
    'request-write-off': props.onRequestWriteOff,
  }
  const testId: Record<AccountActionId, string> = {
    disburse: 'action-disburse-loan',
    'record-payment': 'action-record-repayment',
    'waive-fee': 'action-waive-fee',
    'apply-late-fee': 'action-apply-late-fee',
    'apply-dishonour-fee': 'action-apply-dishonour-fee',
    'request-write-off': 'action-request-writeoff',
  }

  const actions = getAccountActions(account, {
    readOnly,
    hasPendingWriteOff,
    pendingRepayment: hasPendingAction(account.loanAccountId, 'record-repayment'),
    pendingWaive: hasPendingAction(account.loanAccountId, 'waive-fee'),
  }).filter((a) => a.visible && handler[a.id])

  const totalOutstanding = account.liveBalance?.totalOutstanding ?? account.balances?.totalOutstanding ?? 0

  return (
    <div className={styles.actionsTab} role="tabpanel" id="tabpanel-actions" aria-labelledby="tab-actions" data-testid="actions-tab">
      <h4 className={styles.actionsTitle}>Available Actions</h4>
      {readOnly && (
        <div className={styles.actionsReadOnlyWarning} role="alert">
          <span className={styles.actionsWarningIcon}>🔒</span>
          <span>System is in read-only mode. Actions are temporarily disabled.</span>
        </div>
      )}
      {actions.map((a) => (
        <div className={styles.actionCard} key={a.id}>
          <div className={styles.actionCardHeader}>
            <span className={styles.actionCardIcon}>{COPY[a.id].icon}</span>
            <span className={styles.actionCardTitle}>{a.label}</span>
            {a.id === 'request-write-off' && hasPendingWriteOff && <span className={styles.actionCardBadge}>Pending</span>}
          </div>
          <p className={styles.actionCardDescription}>{COPY[a.id].description}</p>
          <div className={styles.actionCardFooter}>
            <span className={styles.actionCardMeta}>{currency.format(totalOutstanding)}</span>
            <button
              type="button"
              className={`${styles.actionCardBtn} ${a.primary ? styles.actionCardBtnPrimary : ''} ${a.danger ? styles.actionCardBtnDanger : ''}`}
              onClick={handler[a.id]}
              disabled={!a.enabled}
              title={a.disabledReason ?? undefined}
              data-testid={testId[a.id]}
            >
              {a.label}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
