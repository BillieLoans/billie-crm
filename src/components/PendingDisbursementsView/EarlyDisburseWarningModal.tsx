'use client'

import { formatDateOnly } from '@/lib/formatters'
import styles from './EarlyDisburseWarningModal.module.css'

interface Props {
  isOpen: boolean
  accountNumber: string
  customerName: string
  loanAmountFormatted: string
  commencementDate: string | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirmation shown before disbursing a loan whose scheduled start date is in
 * the future. Disbursing early resets the loan start date to today and
 * recalculates the schedule — which can breach the 62-day maximum term.
 */
export function EarlyDisburseWarningModal(props: Props) {
  if (!props.isOpen) return null

  const today = formatDateOnly(new Date())
  const scheduled = props.commencementDate ? formatDateOnly(props.commencementDate) : '—'

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.header}>⚠ Disburse before the scheduled start date?</div>
        <div className={styles.body}>
          <strong>
            {props.accountNumber} · {props.customerName} · {props.loanAmountFormatted}
          </strong>
          <p>
            This loan is scheduled to start on <strong className={styles.blue}>{scheduled}</strong>.
            Disbursing today will set the loan start date to{' '}
            <strong className={styles.amber}>{today}</strong> and recalculate the repayment
            schedule.
          </p>
          <div className={styles.deltaRow}>
            <div className={styles.delta}>
              <span className={styles.deltaLabel}>Scheduled start</span>
              <span className={styles.blue}>{scheduled}</span>
            </div>
            <span className={styles.arrow}>→</span>
            <div className={`${styles.delta} ${styles.deltaNew}`}>
              <span className={styles.deltaLabel}>New start (today)</span>
              <span className={styles.amber}>{today}</span>
            </div>
          </div>
          <div className={styles.warn}>
            May push the loan beyond the <strong>62-day maximum term</strong>. Only proceed if
            you&apos;re certain.
          </div>
        </div>
        <div className={styles.footer}>
          <button type="button" className={styles.cancel} onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.danger} onClick={props.onConfirm}>
            Disburse today anyway
          </button>
        </div>
      </div>
    </div>
  )
}
