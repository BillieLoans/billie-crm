'use client'

import Link from 'next/link'
import { useDashboard } from '@/hooks/queries/useDashboard'
import { CutoffCountdown } from './CutoffCountdown'
import styles from './DisbursementTriagePanel.module.css'

const QUEUE = '/admin/pending-disbursements'

/**
 * Dashboard disbursement triage band (Direction A).
 * Three fixed-position buckets keyed on the loan commencement date, plus a live
 * 3pm cut-off countdown. "Disburse today" shows REMAINING work + progress.
 */
export function DisbursementTriagePanel() {
  const { data, isLoading } = useDashboard()
  const b = data?.disbursementBuckets

  if (isLoading) {
    return (
      <div className={styles.panel} data-testid="triage-loading">
        <div className={styles.skeleton} />
      </div>
    )
  }

  const overdue = b?.overdue.count ?? 0
  const todayDone = b?.todayDoneCount ?? 0
  const todayTotal = b?.todayTotalCount ?? 0
  const todayRemaining = b?.today.count ?? 0
  const scheduled = b?.scheduled.count ?? 0
  const tomorrow = b?.scheduledTomorrowCount ?? 0
  const pct = todayTotal > 0 ? Math.round((todayDone / todayTotal) * 100) : 0

  return (
    <div className={styles.panel} data-testid="disbursement-triage-panel">
      <div className={styles.strip}>
        <span className={styles.title}>⏳ Disbursements</span>
        <CutoffCountdown className={styles.countdown} />
      </div>
      <div className={styles.buckets}>
        <Link
          href={`${QUEUE}?bucket=overdue`}
          className={`${styles.cell} ${styles.overdue}`}
          data-testid="bucket-overdue"
        >
          <span className={styles.cellLabel}>⚠ OVERDUE</span>
          <span className={styles.cellValue}>{overdue}</span>
          <span className={styles.cellSub}>
            {overdue === 0 ? 'none ✓' : `${b?.overdue.totalAmountFormatted} · schedule at risk`}
          </span>
        </Link>

        <Link
          href={`${QUEUE}?bucket=today`}
          className={`${styles.cell} ${styles.today}`}
          data-testid="bucket-today"
        >
          <span className={styles.cellLabel}>⏳ DISBURSE TODAY — before 3pm</span>
          <span className={styles.cellValue}>
            {todayRemaining}
            <span className={styles.cellValueUnit}>
              {' '}
              remaining · {b?.today.totalAmountFormatted}
            </span>
          </span>
          <span className={styles.cellSub}>
            {todayRemaining === 0 && todayTotal > 0
              ? 'All disbursed ✓'
              : `${todayDone} of ${todayTotal} done`}
          </span>
          <span className={styles.progress}>
            <span className={styles.progressFill} style={{ width: `${pct}%` }} />
          </span>
        </Link>

        <Link
          href={`${QUEUE}?bucket=scheduled`}
          className={`${styles.cell} ${styles.scheduled}`}
          data-testid="bucket-scheduled"
        >
          <span className={styles.cellLabel}>→ SCHEDULED</span>
          <span className={styles.cellValue}>{scheduled}</span>
          <span className={styles.cellSub}>
            Tomorrow {tomorrow} · later {Math.max(0, scheduled - tomorrow)}
          </span>
        </Link>
      </div>
    </div>
  )
}
