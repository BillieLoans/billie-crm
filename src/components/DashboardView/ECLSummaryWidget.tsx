'use client'

import React from 'react'
import { usePortfolioECL } from '@/hooks/queries/usePortfolioECL'
import styles from './widgets.module.css'

/**
 * Format currency for display
 */
function formatCurrency(amount: string): string {
  const num = parseFloat(amount)
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

/**
 * Calculate ECL percentage of carrying amount
 */
function calculateECLPercent(ecl: string, carrying: string): string {
  const eclNum = parseFloat(ecl)
  const carryingNum = parseFloat(carrying)
  if (carryingNum === 0) return '0.0'
  return ((eclNum / carryingNum) * 100).toFixed(1)
}

/**
 * ECL Summary Widget
 *
 * Displays portfolio-wide ECL metrics:
 * - Total ECL allowance
 * - ECL as percentage of carrying amount
 * - Bucket distribution preview
 *
 * Story E1-S8: Add ECL Summary Widget to Dashboard
 */
export function ECLSummaryWidget() {
  const { totalEcl, totalCarryingAmount, totalAccounts, buckets, isFallback, isLoading } =
    usePortfolioECL()

  if (isLoading) {
    return (
      <div className={styles.widget}>
        <div className={styles.widgetHeader}>
          <span className={styles.widgetIcon}>📉</span>
          <h3 className={styles.widgetTitle}>ECL Summary</h3>
        </div>
        <div className={styles.widgetSkeleton} />
      </div>
    )
  }

  const eclPercent = calculateECLPercent(totalEcl, totalCarryingAmount)

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeader}>
        <span className={styles.widgetIcon}>📉</span>
        <h3 className={styles.widgetTitle}>ECL Summary</h3>
      </div>
      <div className={styles.widgetContent}>
        {isFallback ? (
          <div className={styles.widgetFallback}>
            <span>⚠️</span>
            <span>Data unavailable</span>
          </div>
        ) : (
          <>
            <div className={styles.eclMain}>
              <span className={styles.eclAmount}>{formatCurrency(totalEcl)}</span>
              <span className={styles.eclPercent}>{eclPercent}% of portfolio</span>
            </div>
            <div className={styles.eclMeta}>
              <span>{totalAccounts} accounts</span>
              <span>•</span>
              <span>{buckets.length} buckets</span>
            </div>
            {/* Mini bucket distribution */}
            <div className={styles.bucketBar}>
              {buckets.map((bucket, index) => {
                const width = totalAccounts > 0
                  ? (bucket.accountCount / totalAccounts) * 100
                  : 0
                // Map bucket names to CSS classes
                const getBucketClass = (bucketName: string): string => {
                  switch (bucketName) {
                    case 'current':
                      return styles.bucketCurrent
                    case 'early_arrears':
                      return styles.bucketEarlyArrears
                    case 'late_arrears':
                      return styles.bucketLateArrears
                    case 'default':
                      return styles.bucketDefault
                    default:
                      return ''
                  }
                }
                return (
                  <div
                    key={`${bucket.bucket}-${index}`}
                    className={`${styles.bucketSegment} ${getBucketClass(bucket.bucket)}`}
                    style={{ width: `${Math.max(width, 2)}%` }}
                    title={`${bucket.bucket}: ${bucket.accountCount} accounts`}
                  />
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
