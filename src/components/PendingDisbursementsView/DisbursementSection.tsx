'use client'

import { useState } from 'react'
import { formatDateOnly } from '@/lib/formatters'
import styles from './DisbursementSection.module.css'

export interface QueueItem {
  loanAccountId: string
  accountNumber: string
  customerId: string
  customerName: string
  loanAmount: number
  loanAmountFormatted: string
  commencementDate: string | null
  bucket: 'overdue' | 'today' | 'scheduled'
  signedLoanAgreementUrl?: string | null
}

interface Props {
  bucket: 'overdue' | 'today' | 'scheduled'
  items: QueueItem[]
  totalFormatted: string
  defaultCollapsed?: boolean
  onDisburse: (item: QueueItem) => void
  onView: (item: QueueItem) => void
}

const META = {
  overdue: {
    title: '⚠ OVERDUE — schedule already at risk',
    cls: 'overdue',
    dateHead: 'Should have disbursed',
    cta: 'Disburse now',
  },
  today: {
    title: '⏳ DISBURSE TODAY — before 3:00pm',
    cls: 'today',
    dateHead: 'Must disburse by',
    cta: 'Disburse',
  },
  scheduled: {
    title: '→ SCHEDULED — future start dates (not yet actionable)',
    cls: 'scheduled',
    dateHead: 'Disburses on',
    cta: '⚠ Disburse early',
  },
} as const

export function DisbursementSection({
  bucket,
  items,
  totalFormatted,
  defaultCollapsed,
  onDisburse,
  onView,
}: Props) {
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed)
  const m = META[bucket]

  return (
    <div
      className={`${styles.section} ${styles[m.cls]}`}
      id={`section-${bucket}`}
      data-testid={`section-${bucket}`}
    >
      <button type="button" className={styles.head} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.headTitle}>
          {collapsed ? '▸' : '▾'} {m.title}
        </span>
        <span className={styles.headCount}>
          {items.length} loans · {totalFormatted}
        </span>
      </button>
      {!collapsed && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Account</th>
              <th>Customer</th>
              <th>Loan amount</th>
              <th>{m.dateHead}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.loanAccountId}>
                <td>{it.accountNumber}</td>
                <td>{it.customerName}</td>
                <td>{it.loanAmountFormatted}</td>
                <td>
                  {bucket === 'today'
                    ? '3:00pm today'
                    : it.commencementDate
                      ? formatDateOnly(it.commencementDate)
                      : '—'}
                </td>
                <td className={styles.actions}>
                  <button
                    type="button"
                    className={bucket === 'scheduled' ? styles.earlyBtn : styles.disburseBtn}
                    onClick={() => onDisburse(it)}
                  >
                    {m.cta}
                  </button>
                  <button type="button" className={styles.viewBtn} onClick={() => onView(it)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  None
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
