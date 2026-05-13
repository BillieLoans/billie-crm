'use client'

import Link from 'next/link'
import { useEventProcessingStatus } from '@/hooks/queries/useEventProcessingStatus'
import { useDashboard } from '@/hooks/queries/useDashboard'
import styles from './SystemHealthStrip.module.css'

export function SystemHealthStrip() {
  const { overallStatus, totalPending } = useEventProcessingStatus()
  const { data } = useDashboard()
  const ledgerStatus = data?.systemStatus?.ledger ?? 'online'

  const isProcessorBad = overallStatus !== 'healthy' && overallStatus !== 'unknown'
  const isLedgerBad = ledgerStatus !== 'online'

  if (!isProcessorBad && !isLedgerBad) {
    return null
  }

  const severity =
    overallStatus === 'critical' || ledgerStatus === 'offline' ? 'critical' : 'degraded'

  const issues: string[] = []
  if (isProcessorBad) {
    issues.push(`Event processor ${overallStatus} · ${totalPending} msgs pending`)
  }
  if (isLedgerBad) {
    issues.push(`Ledger ${ledgerStatus}`)
  }

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
      <span className={styles.text}>{issues.join(' · ')}</span>
      <Link href="/admin/system-status" className={styles.link}>
        View details →
      </Link>
    </div>
  )
}
