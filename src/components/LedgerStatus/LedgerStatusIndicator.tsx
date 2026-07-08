'use client'

import React, { useState, useEffect } from 'react'
import { useLedgerHealth } from '@/hooks/queries/useLedgerHealth'
import { useLendingAccess } from '@/hooks/useLendingAccess'
import type { LedgerHealthStatus } from '@/types/ledger-health'
import { LATENCY_DISPLAY_THRESHOLD_MS } from '@/lib/constants'
import styles from './styles.module.css'

export interface LedgerStatusIndicatorProps {
  /** Show in minimized mode when connected (default: true) */
  minimizeWhenConnected?: boolean
  /** Show latency badge (default: true for degraded/offline) */
  showLatency?: boolean
}

/**
 * Get dot style class based on status
 */
function getDotClass(status: LedgerHealthStatus, isLoading: boolean): string {
  if (isLoading) return styles.statusDotLoading

  switch (status) {
    case 'connected':
      return styles.statusDotConnected
    case 'degraded':
      return styles.statusDotDegraded
    case 'offline':
      return styles.statusDotOffline
  }
}

/**
 * Get text style class based on status
 */
function getTextClass(status: LedgerHealthStatus): string {
  switch (status) {
    case 'connected':
      return styles.statusTextConnected
    case 'degraded':
      return styles.statusTextDegraded
    case 'offline':
      return styles.statusTextOffline
  }
}

/**
 * Get status label for display
 */
function getStatusLabel(status: LedgerHealthStatus, isLoading: boolean): string {
  if (isLoading) return 'Checking...'

  switch (status) {
    case 'connected':
      return 'Connected'
    case 'degraded':
      return 'Degraded'
    case 'offline':
      return 'Offline'
  }
}

/**
 * Ledger status indicator component.
 * Shows a colored dot indicating the ledger service health.
 *
 * - Green: Connected (< 1s latency)
 * - Yellow: Degraded (1-5s latency)
 * - Red: Offline (> 5s or error)
 */
export const LedgerStatusIndicator: React.FC<LedgerStatusIndicatorProps> = ({
  minimizeWhenConnected = true,
  showLatency = true,
}) => {
  const [mounted, setMounted] = useState(false)
  // The ledger is lending chrome — marketing/service roles can't call
  // /api/ledger/health (hasAnyRole), so don't poll or render for them.
  const hasLendingAccess = useLendingAccess()
  const { status, latencyMs, message, isLoading, isFetching, refetch } = useLedgerHealth({
    enabled: hasLendingAccess,
  })

  // Only render on client side
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted || !hasLendingAccess) return null

  const isMinimized = minimizeWhenConnected && status === 'connected' && !isLoading
  const shouldShowLatency = showLatency && (status !== 'connected' || latencyMs > LATENCY_DISPLAY_THRESHOLD_MS)

  return (
    <div
      className={`${styles.statusContainer} ${isMinimized ? styles.statusContainerMinimized : ''}`}
      data-testid="ledger-status-indicator"
      data-status={status}
    >
      {/* Status Dot */}
      <div
        className={`${styles.statusDot} ${getDotClass(status, isLoading)}`}
        aria-hidden="true"
      />

      {/* Status Text - aria-live for screen reader announcements */}
      <span 
        className={`${styles.statusText} ${getTextClass(status)}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {getStatusLabel(status, isLoading)}
      </span>

      {/* Latency Badge */}
      {shouldShowLatency && latencyMs > 0 && (
        <span className={styles.latencyBadge}>{latencyMs}ms</span>
      )}

      {/* Refresh Button */}
      <button
        type="button"
        className={`${styles.refreshButton} ${isFetching ? styles.refreshButtonSpinning : ''}`}
        onClick={() => refetch()}
        disabled={isFetching}
        aria-label="Refresh health status"
        title="Refresh"
      >
        ↻
      </button>

      {/* Tooltip */}
      <div className={styles.tooltip} role="tooltip">
        {message}
        {latencyMs > 0 && <span> ({latencyMs}ms)</span>}
      </div>
    </div>
  )
}

export default LedgerStatusIndicator
