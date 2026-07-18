'use client'

import React from 'react'
import Link from 'next/link'
import { useMarketingOverview } from '@/hooks/queries/useMarketingOverview'
import { stageLabel } from '@/lib/marketing-labels'
import styles from './styles.module.css'

/**
 * Compact overview strip above the contacts grid: the acquisition funnel plus
 * the numbers a marketer checks first thing (consented reach, open feedback,
 * overdue complaints). Quietly renders nothing while loading or on error —
 * the strip is orientation, not a blocker.
 */
export const MarketingStats: React.FC = () => {
  const { data } = useMarketingOverview()
  if (!data) return null

  const consentRate =
    data.totalContacts > 0 ? Math.round((data.consented / data.totalContacts) * 100) : 0

  return (
    <div className={styles.statsStrip} data-testid="marketing-stats">
      {data.funnel.map((step) => (
        <div key={step.stage} className={styles.statChip}>
          <span className={styles.statValue}>{step.count.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>{stageLabel(step.stage)}</span>
        </div>
      ))}
      <div className={styles.statDivider} aria-hidden="true" />
      <div className={styles.statChip} title={`${data.consented.toLocaleString('en-AU')} contacts with marketing consent`}>
        <span className={styles.statValue}>{consentRate}%</span>
        <span className={styles.statLabel}>Consented</span>
      </div>
      <Link href="/admin/marketing/feedback" className={styles.statChip}>
        <span className={styles.statValue}>{data.openFeedback.toLocaleString('en-AU')}</span>
        <span className={styles.statLabel}>Open feedback</span>
      </Link>
      {data.overdueComplaints > 0 && (
        <Link
          href="/admin/marketing/feedback?overdue=true"
          className={`${styles.statChip} ${styles.statChipUrgent}`}
        >
          <span className={styles.statValue}>{data.overdueComplaints.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Overdue complaints</span>
        </Link>
      )}
    </div>
  )
}

export default MarketingStats
