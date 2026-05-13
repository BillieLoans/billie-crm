'use client'

import Link from 'next/link'
import { useEventProcessingStatus } from '@/hooks/queries/useEventProcessingStatus'
import styles from './SystemHealthStrip.module.css'

/**
 * Surfaces only event-processor degradation. Ledger health is intentionally
 * NOT shown here: the /api/ledger/health probe occasionally exceeds its 5s
 * timeout in normal operation and falls through to 'offline' even when the
 * ledger itself is serving traffic. A dashboard-level red strip for that
 * cries wolf. Staff who need nuanced ledger health can drill into
 * /admin/system-status.
 */
export function SystemHealthStrip() {
  const { overallStatus, totalPending } = useEventProcessingStatus()

  const isProcessorBad = overallStatus !== 'healthy' && overallStatus !== 'unknown'
  if (!isProcessorBad) {
    return null
  }

  const severity = overallStatus === 'critical' ? 'critical' : 'degraded'

  return (
    <div
      className={styles.strip}
      data-severity={severity}
      role="status"
      data-testid="system-health-strip"
    >
      <span className={styles.dot} aria-hidden="true">
        ●
      </span>
      <span className={styles.text}>
        Event processor {overallStatus} · {totalPending} msgs pending
      </span>
      <Link href="/admin/system-status" className={styles.link}>
        View details →
      </Link>
    </div>
  )
}
