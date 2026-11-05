'use client'

import React, { useId, useMemo, useState } from 'react'
import { useStatementFile } from '@/hooks/queries/useStatementFile'
import { formatCurrency, formatDateOnly } from '@/lib/formatters'
import {
  breakdownByCategory,
  categoryName,
  rebuildRatio,
  toDrillTransactions,
  type CategoryBreakdown,
  type ConductDrillSpec,
  type DrillTransaction,
} from './conductDrill'
import styles from './styles.module.css'

interface ConductDrillPanelProps {
  conversationId: string
  spec: ConductDrillSpec
  /** DOM id the rule row's toggle points at with aria-controls. */
  id: string
}

/** Disclosure chevron: points right when closed, down when open. */
export function DrillChevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`${styles.drillChevron} ${open ? styles.drillChevronOpen : ''}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.5 1.5 7 5l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The categories behind one account conduct rule, each expandable to its
 * transactions. Reads the categorised-transactions CSV the Statements panel
 * already serves; React Query shares the one fetch across every open rule.
 */
export function ConductDrillPanel({ conversationId, spec, id }: ConductDrillPanelProps) {
  const { data, isLoading, error } = useStatementFile(conversationId, 'categorizedTransactions')

  const csv = data?.kind === 'csv' ? data.data : null
  const parsed = useMemo(() => (csv ? toDrillTransactions(csv) : null), [csv])
  const breakdown = useMemo(
    () => (parsed ? breakdownByCategory(parsed.rows, spec.rows) : []),
    [parsed, spec],
  )
  const ratio = useMemo(
    () => (parsed && spec.ratio ? rebuildRatio(parsed.rows, spec.ratio) : null),
    [parsed, spec],
  )

  return (
    <section className={styles.drill} id={id} aria-label="Breakdown" data-testid="conduct-drill">
      <header className={styles.drillHeader}>
        <span className={styles.drillEyebrow}>Breakdown</span>
        <p className={styles.drillNote}>{spec.note}</p>
      </header>

      {isLoading && <div className={styles.skeleton} aria-hidden="true" />}

      {!isLoading && !parsed && (
        <p className={styles.drillEmpty} role="status">
          {error instanceof Error
            ? error.message
            : 'The categorised transactions file is not available for this application.'}
        </p>
      )}

      {parsed && csv && (
        <>
          {ratio && (
            <p className={styles.drillRatio}>
              <span>
                {formatCurrency(ratio.numerator)} ÷ {formatCurrency(ratio.denominator)} ={' '}
                <strong>{ratio.percent == null ? '—' : `${ratio.percent.toFixed(2)}%`}</strong>
              </span>
              <span className={styles.drillRatioNote}>
                rebuilt from the categorised transactions
              </span>
            </p>
          )}

          {csv.truncated && (
            <p className={styles.drillNotice}>
              Only the first {csv.rows.length.toLocaleString('en-AU')} of{' '}
              {csv.totalRows.toLocaleString('en-AU')} transactions are loaded, so these totals may
              be short. Download the raw file from the Statements panel for the full list.
            </p>
          )}

          {parsed.outOfScope > 0 && (
            <p className={styles.drillNotice}>
              {parsed.outOfScope.toLocaleString('en-AU')} transaction
              {parsed.outOfScope === 1 ? ' is' : 's are'} from accounts outside the assessment and
              left out, as the engine did.
            </p>
          )}

          {breakdown.length === 0 ? (
            <p className={styles.drillEmpty}>No matching transactions.</p>
          ) : (
            <table className={styles.drillCatTable}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className={styles.drillNumber}>Transactions</th>
                  <th className={styles.drillNumber}>Total</th>
                </tr>
              </thead>
              {breakdown.map((b) => (
                <CategoryGroup key={b.category} breakdown={b} />
              ))}
            </table>
          )}
        </>
      )}
    </section>
  )
}

/** One category: its summary row and, when open, its transactions. */
function CategoryGroup({ breakdown }: { breakdown: CategoryBreakdown }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const count = breakdown.transactions.length
  const label = (
    <>
      <span className={styles.drillCode}>{breakdown.category}</span>
      <span>{categoryName(breakdown.category)}</span>
    </>
  )

  return (
    <tbody
      className={`${styles.drillCatGroup} ${open ? styles.drillCatGroupOpen : ''} ${
        count === 0 ? styles.drillCatGroupEmpty : ''
      }`}
    >
      <tr>
        <td>
          {count > 0 ? (
            <button
              type="button"
              className={styles.drillCategoryToggle}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen((o) => !o)}
            >
              <span className={styles.drillChevronBox}>
                <DrillChevron open={open} />
              </span>
              {label}
            </button>
          ) : (
            <span className={styles.drillCategoryStatic}>
              <span className={`${styles.drillChevronBox} ${styles.drillChevronBoxEmpty}`} />
              {label}
            </span>
          )}
        </td>
        <td className={styles.drillNumber}>{count}</td>
        <td className={`${styles.drillNumber} ${amountClass(breakdown.total)}`}>
          {count > 0 ? formatCurrency(breakdown.total) : '—'}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3} className={styles.drillTxnCell} id={panelId}>
            <TransactionsTable transactions={breakdown.transactions} />
          </td>
        </tr>
      )}
    </tbody>
  )
}

function TransactionsTable({ transactions }: { transactions: DrillTransaction[] }) {
  return (
    <div className={styles.drillTxnScroll}>
      <table className={styles.drillTxnTable}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th className={styles.drillNumber}>Amount</th>
            <th>Account</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx, i) => (
            <tr key={`${tx.date}-${i}`}>
              <td className={styles.drillDate}>{formatTxnDate(tx.date)}</td>
              <td>{tx.description || '—'}</td>
              <td className={`${styles.drillNumber} ${amountClass(tx.amount)}`}>
                {formatCurrency(tx.amount)}
              </td>
              <td className={styles.drillAccount} title={tx.account || undefined}>
                {tx.account || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function amountClass(amount: number): string {
  if (amount < 0) return styles.drillDebit
  if (amount > 0) return styles.drillCredit
  return ''
}

function formatTxnDate(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : formatDateOnly(d)
}
