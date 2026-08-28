'use client'

import { formatCurrency } from '@/lib/formatters'
import type { DailyLimitUsage } from '@/lib/disbursement-payments'
import styles from './DailyLimitIndicator.module.css'

interface Props {
  usage: DailyLimitUsage | null
}

const STATUS_COPY = {
  ok: { icon: '●', label: 'Within daily limit' },
  warn: { icon: '⚠', label: 'Approaching daily limit' },
  exceeded: { icon: '🛑', label: 'Over daily limit' },
} as const

/**
 * Today's disbursement total measured against the ANZ daily transfer limit.
 *
 * Shows the PROJECTED total — already paid plus everything still actionable in
 * today's queue — because the useful moment to learn the ceiling is reached is
 * before a payment run starts, not when payment 38 of 50 is rejected.
 *
 * Status carries an icon and a word as well as colour (ux-standards §1.2, SC 1.4.1).
 */
export function DailyLimitIndicator({ usage }: Props) {
  if (!usage) return null

  const { icon, label } = STATUS_COPY[usage.status]
  const percent = Math.round(usage.ratio * 100)

  return (
    <div
      className={`${styles.wrap} ${styles[usage.status]}`}
      data-testid="daily-limit-indicator"
      // Only announce when it actually matters — an "ok" bar re-reading itself on
      // every refresh is noise that trains people to ignore the assertive lane.
      role={usage.status === 'ok' ? undefined : 'status'}
    >
      <div className={styles.head}>
        <span className={styles.label}>
          <span aria-hidden="true">{icon}</span> {label}
        </span>
        <span className={styles.percent}>{percent}%</span>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={Math.min(percent, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Daily disbursement limit used"
      >
        <div className={styles.fill} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <div className={styles.detail}>
        {formatCurrency(usage.projectedTotal)} of {formatCurrency(usage.limit)} · paid{' '}
        {formatCurrency(usage.disbursedToday)} + queued {formatCurrency(usage.pendingToday)}
      </div>
    </div>
  )
}
