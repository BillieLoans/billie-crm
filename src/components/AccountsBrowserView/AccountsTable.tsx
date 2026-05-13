'use client'

import React from 'react'
import type { LoanAccount } from '@/payload-types'
import { formatCurrency, formatRelativeTime } from '@/lib/formatters'
import type { AccountStatus } from '@/lib/account-filters'
import { deriveLastPayment } from './lastPayment'
import styles from './styles.module.css'

const STATUS_CONFIG: Record<AccountStatus, { label: string; className: string }> = {
  pending_disbursement: { label: 'Pending', className: styles.statusPending },
  active: { label: 'Active', className: styles.statusActive },
  in_arrears: { label: 'Arrears', className: styles.statusArrears },
  paid_off: { label: 'Paid off', className: styles.statusPaidOff },
  written_off: { label: 'Written off', className: styles.statusWrittenOff },
}

export interface AccountsTableColumn {
  key: string
  label: string
  sortKey?: string
}

const DEFAULT_COLUMNS: AccountsTableColumn[] = [
  { key: 'accountNumber', label: 'Account', sortKey: 'accountNumber' },
  { key: 'customer', label: 'Customer' },
  { key: 'status', label: 'Status', sortKey: 'accountStatus' },
  { key: 'aging', label: 'Aging', sortKey: 'aging.currentDPD' },
  { key: 'balance', label: 'Balance', sortKey: 'balances.totalOutstanding' },
  { key: 'lastPayment', label: 'Last payment', sortKey: 'lastPayment.date' },
  { key: 'opened', label: 'Opened', sortKey: 'loanTerms.openedDate' },
]

const BUCKET_LABEL: Record<string, string> = {
  current: 'Current',
  early_arrears: 'Early',
  late_arrears: 'Late',
  default: 'Default',
  closed: 'Closed',
}

const BUCKET_CLASS: Record<string, string> = {
  current: styles.bucketCurrent,
  early_arrears: styles.bucketEarly,
  late_arrears: styles.bucketLate,
  default: styles.bucketDefault,
  closed: styles.bucketClosed,
}

export interface AccountsTableProps {
  accounts: LoanAccount[]
  isLoading: boolean
  sort: string | undefined
  /** Currently focused row (-1 for none). Used to draw the keyboard cursor. */
  focusedIndex: number
  onRowClick: (account: LoanAccount, index: number) => void
  onRowDoubleClick: (account: LoanAccount, index: number) => void
  onSortChange: (sort: string) => void
  /** Per-row action — shows a small Disburse button when the account is pending_disbursement. */
  onDisburse?: (account: LoanAccount) => void
  columns?: AccountsTableColumn[]
}

export const AccountsTable: React.FC<AccountsTableProps> = ({
  accounts,
  isLoading,
  sort,
  focusedIndex,
  onRowClick,
  onRowDoubleClick,
  onSortChange,
  onDisburse,
  columns = DEFAULT_COLUMNS,
}) => {
  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} aria-hidden="true" />
        <span className={styles.muted}>Loading accounts…</span>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon} aria-hidden="true">
          📭
        </span>
        <h3 className={styles.emptyTitle}>No accounts match</h3>
        <p className={styles.emptyText}>
          Try widening your filters or picking a different Smart View.
        </p>
      </div>
    )
  }

  const sortKey = sort?.startsWith('-') ? sort.slice(1) : sort
  const sortDesc = sort?.startsWith('-') ?? false

  const handleHeaderClick = (col: AccountsTableColumn) => {
    if (!col.sortKey) return
    const isCurrent = sortKey === col.sortKey
    // Cycle: asc → desc → asc when re-clicking the same column.
    const nextSort = isCurrent ? (sortDesc ? col.sortKey : `-${col.sortKey}`) : `-${col.sortKey}`
    onSortChange(nextSort)
  }

  return (
    <table className={styles.table} data-testid="accounts-table">
      <thead>
        <tr>
          {columns.map((col) => {
            const isSorted = col.sortKey && sortKey === col.sortKey
            return (
              <th
                key={col.key}
                className={col.sortKey ? styles.sortableHeader : undefined}
                onClick={col.sortKey ? () => handleHeaderClick(col) : undefined}
                scope="col"
              >
                {col.label}
                {isSorted && (
                  <span className={styles.sortIndicator} aria-hidden="true">
                    {sortDesc ? '↓' : '↑'}
                  </span>
                )}
              </th>
            )
          })}
          {onDisburse && <th aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {accounts.map((account, idx) => {
          const status = (account.accountStatus as AccountStatus) ?? 'active'
          const statusInfo = STATUS_CONFIG[status] ?? STATUS_CONFIG.active
          const balance = account.balances?.totalOutstanding ?? 0
          const lastPmt = deriveLastPayment(account)
          const openedDate = account.loanTerms?.openedDate
          const focused = idx === focusedIndex
          const aging = account.aging
          const bucketKey = aging?.bucket ?? null
          const dpd = aging?.currentDPD
          const inArrears = aging?.isInArrears === true

          return (
            <tr
              key={account.id}
              className={focused ? styles.focused : undefined}
              onClick={() => onRowClick(account, idx)}
              onDoubleClick={() => onRowDoubleClick(account, idx)}
              data-testid={`account-row-${idx}`}
              aria-selected={focused}
            >
              <td>
                <span className={styles.accountNumber}>{account.accountNumber}</span>
              </td>
              <td>{account.customerName ?? <span className={styles.muted}>—</span>}</td>
              <td>
                <span className={`${styles.statusBadge} ${statusInfo.className}`}>
                  {statusInfo.label}
                </span>
              </td>
              <td>
                {bucketKey ? (
                  <span
                    className={`${styles.bucketBadge} ${BUCKET_CLASS[bucketKey] ?? ''} ${inArrears ? styles.bucketInArrears : ''}`}
                    title={
                      inArrears
                        ? `In arrears · ${BUCKET_LABEL[bucketKey] ?? bucketKey}${
                            typeof dpd === 'number' ? ` · ${dpd} DPD` : ''
                          }`
                        : `${BUCKET_LABEL[bucketKey] ?? bucketKey}${
                            typeof dpd === 'number' ? ` · ${dpd} DPD` : ''
                          }`
                    }
                  >
                    {BUCKET_LABEL[bucketKey] ?? bucketKey}
                    {typeof dpd === 'number' && dpd > 0 && ` · ${dpd}`}
                  </span>
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </td>
              <td className={styles.balance}>{formatCurrency(balance)}</td>
              <td>
                {lastPmt ? (
                  formatRelativeTime(lastPmt.date)
                ) : (
                  <span className={styles.muted}>never</span>
                )}
              </td>
              <td>
                {openedDate ? (
                  formatRelativeTime(openedDate)
                ) : (
                  <span className={styles.muted}>—</span>
                )}
              </td>
              {onDisburse && (
                <td>
                  {status === 'pending_disbursement' ? (
                    <button
                      type="button"
                      className={styles.disburseIconButton}
                      title="Disburse this loan"
                      aria-label={`Disburse loan ${account.accountNumber}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDisburse(account)
                      }}
                      data-testid={`disburse-row-${idx}`}
                    >
                      🏦
                    </button>
                  ) : null}
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
