'use client'

import React from 'react'
import Link from 'next/link'
import { useOverdueAccounts } from '@/hooks/queries/useOverdueAccounts'
import { SectionCard } from './primitives/SectionCard'
import styles from './widgets.module.css'

/**
 * Portfolio Health Widget
 *
 * Displays key portfolio metrics:
 * - Overdue accounts count
 * - Link to Collections Queue
 *
 * Story E1-S7: Add Portfolio Health Widget to Dashboard
 */
export function PortfolioHealthWidget() {
  const { totalCount, isFallback, isLoading } = useOverdueAccounts({ pageSize: 1 })

  const title = (
    <>
      <span className={styles.widgetIcon} aria-hidden="true">
        📊
      </span>{' '}
      Portfolio Health
    </>
  )

  if (isLoading) {
    return (
      <SectionCard density="compact" title={title} testId="portfolio-health-widget">
        <div className={styles.widgetSkeleton} />
      </SectionCard>
    )
  }

  return (
    <SectionCard density="compact" title={title} testId="portfolio-health-widget">
      <div className={styles.widgetContent}>
        <div className={styles.metricRow}>
          <span className={styles.metricLabel}>Overdue Accounts</span>
          <span className={`${styles.metricValue} ${totalCount > 0 ? styles.metricWarning : ''}`}>
            {totalCount}
          </span>
        </div>
        {totalCount > 0 && (
          <Link href="/admin/collections" className={styles.widgetLink}>
            View Collections Queue →
          </Link>
        )}
        {totalCount === 0 && !isFallback && (
          <div className={styles.widgetSuccess}>
            <span>✅</span>
            <span>All accounts current</span>
          </div>
        )}
        {isFallback && (
          <div className={styles.widgetFallback}>
            <span>⚠️</span>
            <span>Data unavailable</span>
          </div>
        )}
      </div>
    </SectionCard>
  )
}
