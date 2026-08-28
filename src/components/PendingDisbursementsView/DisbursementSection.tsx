'use client'

import { Fragment, useState } from 'react'
import { formatDateOnly } from '@/lib/formatters'
import { DisbursementPaymentPanel } from './DisbursementPaymentPanel'
import styles from './DisbursementSection.module.css'

export interface DisbursementAccountView {
  holder: string | null
  bsb: string | null
  bsbFormatted: string | null
  number: string | null
  isComplete: boolean
  missing: string[]
}

export interface QueueItem {
  loanAccountId: string
  accountNumber: string
  applicationNumber: string | null
  customerId: string
  customerName: string
  ekycVerifiedName: string | null
  identityVerified: boolean
  loanAmount: number
  loanAmountFormatted: string
  commencementDate: string | null
  firstDueDate: string | null
  bucket: 'overdue' | 'today' | 'scheduled'
  signedLoanAgreementUrl?: string | null
  disbursementAccount: DisbursementAccountView | null
  oskoMessage: string
}

interface Props {
  bucket: 'overdue' | 'today' | 'scheduled'
  items: QueueItem[]
  totalFormatted: string
  defaultCollapsed?: boolean
  /**
   * Loan whose payment panel is open, or null. Owned by the parent so opening a
   * scheduled loan's panel can be gated behind the early-disburse warning — the
   * operator must be warned BEFORE they copy details and pay, not after.
   */
  expandedId: string | null
  onToggleRow: (item: QueueItem) => void
  onDisburse: (item: QueueItem) => void
  onView: (item: QueueItem) => void
}

const META = {
  overdue: {
    title: '⚠ MISSED — past start date, schedule at risk',
    cls: 'overdue',
    dateHead: 'Should have disbursed',
  },
  today: {
    title: '⏳ DISBURSE TODAY — before 3:00pm',
    cls: 'today',
    dateHead: 'Must disburse by',
  },
  scheduled: {
    title: '→ SCHEDULED — future start dates (not yet actionable)',
    cls: 'scheduled',
    dateHead: 'Disburses on',
  },
} as const

export function DisbursementSection({
  bucket,
  items,
  totalFormatted,
  defaultCollapsed,
  expandedId,
  onToggleRow,
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
              <th scope="col">Reference</th>
              <th scope="col">Customer</th>
              <th scope="col">Loan amount</th>
              <th scope="col">{m.dateHead}</th>
              <th scope="col">Payout account</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const isOpen = expandedId === it.loanAccountId
              const panelId = `payment-panel-${it.loanAccountId}`
              const account = it.disbursementAccount
              return (
                <Fragment key={it.loanAccountId}>
                  <tr className={isOpen ? styles.rowOpen : undefined}>
                    <td className={styles.mono}>{it.applicationNumber || it.accountNumber}</td>
                    <td>{it.customerName}</td>
                    <td>{it.loanAmountFormatted}</td>
                    <td>
                      {bucket === 'today'
                        ? '3:00pm today'
                        : it.commencementDate
                          ? formatDateOnly(it.commencementDate)
                          : '—'}
                    </td>
                    <td>
                      {/* Never the full number in the list — ux-standards §4. A
                          branch-level BSB plus a tail is enough to tell rows apart. */}
                      {account ? (
                        account.isComplete ? (
                          <span className={styles.mono}>
                            {account.bsbFormatted} ···{account.number?.slice(-3)}
                          </span>
                        ) : (
                          <span className={styles.rowWarn}>⚠ incomplete</span>
                        )
                      ) : (
                        <span className={styles.rowWarn}>⚠ not on file</span>
                      )}
                    </td>
                    <td className={styles.actions}>
                      <button
                        type="button"
                        className={bucket === 'scheduled' ? styles.earlyBtn : styles.disburseBtn}
                        onClick={() => onToggleRow(it)}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        data-testid={`toggle-payment-${it.loanAccountId}`}
                      >
                        {isOpen ? 'Close' : bucket === 'scheduled' ? '⚠ Pay early' : 'Pay'}
                      </button>
                      <button type="button" className={styles.viewBtn} onClick={() => onView(it)}>
                        View
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className={styles.panelCell} id={panelId}>
                        <DisbursementPaymentPanel item={it} onDisburse={onDisburse} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.empty}>
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
