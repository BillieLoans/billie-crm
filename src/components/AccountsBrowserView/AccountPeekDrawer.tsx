'use client'

import React from 'react'
import { ContextDrawer, CopyButton } from '@/components/ui'
import type { LoanAccount } from '@/payload-types'
import type { AccountStatus } from '@/lib/account-filters'
import {
  formatCurrency,
  formatDateMedium,
  formatDateShort,
  formatRelativeTime,
} from '@/lib/formatters'
import { deriveLastPayment, deriveScheduleProgress } from './lastPayment'
import styles from './styles.module.css'

const STATUS_LABEL: Record<AccountStatus, string> = {
  pending_disbursement: 'Pending disbursement',
  active: 'Active',
  in_arrears: 'In arrears',
  paid_off: 'Paid off',
  written_off: 'Written off',
}

const STATUS_CLASS: Record<AccountStatus, string> = {
  pending_disbursement: styles.statusPending,
  active: styles.statusActive,
  in_arrears: styles.statusArrears,
  paid_off: styles.statusPaidOff,
  written_off: styles.statusWrittenOff,
}

export interface AccountPeekDrawerProps {
  account: LoanAccount | null
  isOpen: boolean
  onClose: () => void
  /** Opens the full servicing view in the current tab. */
  onOpenServicing: (account: LoanAccount) => void
}

/**
 * Right-side drawer with a richer one-glance summary. Wider than the default
 * (560px) so balances, schedule progress, and the customer/account IDs fit
 * without crowding. Uses `ContextDrawer` (the same primitive used by
 * ApprovalDetailDrawer) — just with `maxWidth` overridden.
 */
export const AccountPeekDrawer: React.FC<AccountPeekDrawerProps> = ({
  account,
  isOpen,
  onClose,
  onOpenServicing,
}) => {
  if (!account) return null

  const status = (account.accountStatus as AccountStatus) ?? 'active'
  const balance = account.balances?.totalOutstanding ?? 0
  const totalPaid = account.balances?.totalPaid ?? 0
  const loanAmount = account.loanTerms?.loanAmount ?? 0
  const totalPayable = account.loanTerms?.totalPayable ?? 0
  const openedDate = account.loanTerms?.openedDate
  const frequency = account.repaymentSchedule?.paymentFrequency
  const closure = account.closure
  const lastPmt = deriveLastPayment(account)
  const progress = deriveScheduleProgress(account)

  // Deep-link target — used for both the in-tab and new-tab buttons.
  const servicingHref = account.customerIdString
    ? `/admin/servicing/${account.customerIdString}?accountId=${encodeURIComponent(account.loanAccountId)}`
    : undefined

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title="Account preview" maxWidth="560px">
      {/* === Identity === */}
      <div className={styles.peekSection}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span className={`${styles.statusBadge} ${STATUS_CLASS[status]}`}>
            {STATUS_LABEL[status]}
          </span>
          <span style={{ fontFamily: 'SF Mono, Monaco, monospace', fontSize: 13 }}>
            {account.accountNumber}
          </span>
          <CopyButton value={account.accountNumber} label="Copy account number" />
        </div>
        <div className={styles.peekFieldValue} style={{ fontSize: 14, fontWeight: 500 }}>
          {account.customerName ?? '—'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {account.customerIdString && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span className={styles.peekFieldLabel} style={{ minWidth: 92 }}>
                Customer ID
              </span>
              <span className={styles.peekFieldMono} style={{ fontSize: 12 }}>
                {account.customerIdString}
              </span>
              <CopyButton value={account.customerIdString} label="Copy customer ID" />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span className={styles.peekFieldLabel} style={{ minWidth: 92 }}>
              Loan account ID
            </span>
            <span className={styles.peekFieldMono} style={{ fontSize: 12 }}>
              {account.loanAccountId}
            </span>
            <CopyButton value={account.loanAccountId} label="Copy loan account ID" />
          </div>
        </div>
      </div>

      {/* === Balances === */}
      <div className={styles.peekSection}>
        <h4 className={styles.peekSectionTitle}>Balances</h4>
        <div className={styles.peekGrid}>
          <div className={styles.peekField}>
            <span className={styles.peekFieldLabel}>Outstanding</span>
            <span className={`${styles.peekFieldValue} ${styles.peekFieldMono}`}>
              {formatCurrency(balance)}
            </span>
          </div>
          <div className={styles.peekField}>
            <span className={styles.peekFieldLabel}>Paid to date</span>
            <span className={`${styles.peekFieldValue} ${styles.peekFieldMono}`}>
              {formatCurrency(totalPaid)}
            </span>
          </div>
          <div className={styles.peekField}>
            <span className={styles.peekFieldLabel}>Loan amount</span>
            <span className={`${styles.peekFieldValue} ${styles.peekFieldMono}`}>
              {formatCurrency(loanAmount)}
            </span>
          </div>
          <div className={styles.peekField}>
            <span className={styles.peekFieldLabel}>Total payable</span>
            <span className={`${styles.peekFieldValue} ${styles.peekFieldMono}`}>
              {formatCurrency(totalPayable)}
            </span>
          </div>
        </div>
      </div>

      {/* === Schedule progress === */}
      {progress && progress.total > 0 && (
        <div className={styles.peekSection}>
          <h4 className={styles.peekSectionTitle}>Schedule</h4>
          <div className={styles.peekGrid}>
            <div className={styles.peekField}>
              <span className={styles.peekFieldLabel}>Payments</span>
              <span className={styles.peekFieldValue}>
                {progress.paid} of {progress.total} paid
              </span>
            </div>
            <div className={styles.peekField}>
              <span className={styles.peekFieldLabel}>Frequency</span>
              <span className={styles.peekFieldValue}>{frequency ?? '—'}</span>
            </div>
            {progress.nextDue && (
              <>
                <div className={styles.peekField}>
                  <span className={styles.peekFieldLabel}>Next due</span>
                  <span className={styles.peekFieldValue}>
                    {formatDateShort(progress.nextDue.dueDate)}
                  </span>
                </div>
                <div className={styles.peekField}>
                  <span className={styles.peekFieldLabel}>Next amount</span>
                  <span className={`${styles.peekFieldValue} ${styles.peekFieldMono}`}>
                    {formatCurrency(progress.nextDue.amount)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* === Activity === */}
      <div className={styles.peekSection}>
        <h4 className={styles.peekSectionTitle}>Activity</h4>
        <div className={styles.peekGrid}>
          <div className={styles.peekField}>
            <span className={styles.peekFieldLabel}>Opened</span>
            <span className={styles.peekFieldValue}>
              {openedDate ? formatDateMedium(openedDate) : '—'}
            </span>
          </div>
          <div className={styles.peekField}>
            <span className={styles.peekFieldLabel}>Last payment</span>
            <span className={styles.peekFieldValue}>
              {lastPmt
                ? `${formatRelativeTime(lastPmt.date)} · ${formatCurrency(lastPmt.amount)}`
                : 'Never'}
            </span>
          </div>
        </div>
      </div>

      {/* === Closure (only for closed accounts) === */}
      {closure?.reason && (
        <div className={styles.peekSection}>
          <h4 className={styles.peekSectionTitle}>Closure</h4>
          <div className={styles.peekGrid}>
            <div className={styles.peekField}>
              <span className={styles.peekFieldLabel}>Reason</span>
              <span className={styles.peekFieldValue}>{closure.reason}</span>
            </div>
            {closure.closedDate && (
              <div className={styles.peekField}>
                <span className={styles.peekFieldLabel}>Closed</span>
                <span className={styles.peekFieldValue}>
                  {formatDateMedium(closure.closedDate)}
                </span>
              </div>
            )}
            {typeof closure.finalBalance === 'number' && (
              <div className={styles.peekField}>
                <span className={styles.peekFieldLabel}>Final balance</span>
                <span className={`${styles.peekFieldValue} ${styles.peekFieldMono}`}>
                  {formatCurrency(closure.finalBalance)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === Actions === */}
      <div className={styles.peekActions}>
        <button
          type="button"
          className={`${styles.peekAction} ${styles.peekActionPrimary}`}
          onClick={() => onOpenServicing(account)}
          disabled={!servicingHref}
          data-testid="peek-open-servicing"
        >
          Open in servicing →
        </button>
        {servicingHref && (
          <a
            className={styles.peekAction}
            href={servicingHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="peek-open-servicing-new-tab"
            style={{ textDecoration: 'none', textAlign: 'center' }}
          >
            Open in new tab ↗
          </a>
        )}
      </div>
    </ContextDrawer>
  )
}
