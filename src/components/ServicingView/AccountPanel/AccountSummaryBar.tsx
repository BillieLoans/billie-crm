'use client'

import { useState } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useAccountAging } from '@/hooks/queries/useAccountAging'
import { useUIStore } from '@/stores/ui'
import { useOptimisticStore } from '@/stores/optimistic'
import { CopyButton } from '@/components/ui'
import { getStatusConfig } from '../account-status'
import { getAccountActions, type AccountAction } from '@/lib/getAccountActions'
import { getAccountSignal } from '@/lib/accountTriage'
import styles from './AccountSummaryBar.module.css'

export interface AccountSummaryBarProps {
  account: LoanAccountData
  hasPendingWriteOff: boolean
  onRecordRepayment: () => void
  onWaiveFee: () => void
  onApplyLateFee: () => void
  onApplyDishonourFee: () => void
  onRequestWriteOff: () => void
  onDisburseLoan: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
  onClose?: () => void
  showClose?: boolean
}

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)

export const AccountSummaryBar: React.FC<AccountSummaryBarProps> = (props) => {
  const { account, hasPendingWriteOff } = props
  const readOnly = useUIStore((s) => s.readOnlyMode)
  const hasPendingAction = useOptimisticStore((s) => s.hasPendingAction)
  const status = getStatusConfig(account.accountStatus)
  const signal = getAccountSignal(account)
  const [moreOpen, setMoreOpen] = useState(false)

  const isTerminal = account.accountStatus === 'paid_off' || account.accountStatus === 'written_off'
  const { isInArrears, bucket, isFallback } = useAccountAging({ accountId: account.loanAccountId, enabled: !isTerminal })
  const showAging = !isTerminal && !isFallback && (isInArrears || bucket !== 'current')

  const totalOutstanding = account.liveBalance?.totalOutstanding ?? account.balances?.totalOutstanding ?? 0
  const live = account.liveBalance !== null

  const actions = getAccountActions(account, {
    readOnly,
    hasPendingWriteOff,
    pendingRepayment: hasPendingAction(account.loanAccountId, 'record-repayment'),
    pendingWaive: hasPendingAction(account.loanAccountId, 'waive-fee'),
  })

  const handler: Record<AccountAction['id'], () => void> = {
    disburse: props.onDisburseLoan,
    'record-payment': props.onRecordRepayment,
    'waive-fee': props.onWaiveFee,
    'apply-late-fee': props.onApplyLateFee,
    'apply-dishonour-fee': props.onApplyDishonourFee,
    'request-write-off': props.onRequestWriteOff,
  }

  const visible = actions.filter((a) => a.visible)
  const primary = visible.find((a) => a.primary) ?? null
  const inline = visible.find((a) => a.id === 'waive-fee') ?? null
  const menu = visible.filter((a) => a !== primary && a !== inline)

  const Btn = (a: AccountAction, variant: 'primary' | 'secondary') => (
    <button
      key={a.id}
      type="button"
      className={`${styles.btn} ${variant === 'primary' ? styles.btnPrimary : styles.btnSecondary} ${a.danger ? styles.btnDanger : ''}`}
      onClick={handler[a.id]}
      disabled={!a.enabled}
      title={a.disabledReason ?? undefined}
      data-testid={`summary-action-${a.id}`}
    >
      {a.label}
    </button>
  )

  return (
    <div className={styles.bar} data-testid="account-summary-bar">
      <div className={styles.left}>
        <div className={styles.idRow}>
          <span className={styles.accountNumber}>{account.accountNumber}</span>
          <CopyButton value={account.accountNumber} label="Copy account number" />
          <span className={`${styles.status} ${styles[status.colorClass] ?? ''}`}>{status.label}</span>
          {showAging && <span className={styles.aging}>{signal.daysOverdue > 0 ? `${signal.daysOverdue}d overdue` : 'In arrears'}</span>}
          <span className={live ? styles.live : styles.cached}>{live ? 'Live' : 'Cached'}</span>
        </div>
        <div className={styles.subId}>
          ID {shortId(account.loanAccountId)} <CopyButton value={account.loanAccountId} label="Copy loan account ID" />
        </div>
        <div className={styles.figures}>
          <div>
            <div className={styles.figLabel}>Total outstanding</div>
            <div className={styles.figValue}>{currency.format(totalOutstanding)}</div>
          </div>
          {signal.nextDueDate && (
            <div>
              <div className={styles.figLabel}>Next payment</div>
              <div className={`${styles.figValue} ${signal.isOverdue ? styles.figOverdue : ''}`}>{currency.format(signal.nextDueAmount ?? 0)}</div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.actions}>
          {primary && Btn(primary, 'primary')}
          {inline && Btn(inline, 'secondary')}
          {menu.length > 0 && (
            <div className={styles.menuWrap}>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setMoreOpen((v) => !v)} data-testid="summary-action-more" aria-expanded={moreOpen}>
                More ▾
              </button>
              {moreOpen && (
                <div className={styles.menu} role="menu">
                  {menu.map((a) => (
                    <button key={a.id} type="button" role="menuitem" className={styles.menuItem} onClick={() => { setMoreOpen(false); handler[a.id]() }} disabled={!a.enabled} title={a.disabledReason ?? undefined} data-testid={`summary-action-${a.id}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {props.onRefresh && (
          <button type="button" className={styles.refresh} onClick={props.onRefresh} disabled={props.isRefreshing} aria-label="Refresh data" data-testid="refresh-account-data">⟳</button>
        )}
        {props.showClose && props.onClose && (
          <button type="button" className={styles.close} onClick={props.onClose} aria-label="Close account panel" data-testid="close-account-panel">✕</button>
        )}
      </div>
    </div>
  )
}
