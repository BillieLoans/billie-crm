'use client'

import React from 'react'
import Link from 'next/link'
import { useGateStatus } from '@/hooks'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

/**
 * Global, always-visible banner shown on every CRM admin page while the
 * applicant gate mode is `closed` (the kill switch — all new applications
 * blocked). `open` and `gated` render nothing here; ReleasesView keeps its
 * own per-mode banners and the admin controls to change the mode.
 *
 * This is an awareness surface, not the authority: it fails quiet (renders
 * null) while loading, on error, or for any mode other than `closed`, so a
 * flaky gate-status fetch never falsely reassures anyone that the gate is
 * open.
 *
 * Mirrors ReadOnlyBanner's fixed, full-width top bar pattern (see
 * src/components/ReadOnlyBanner) so the two read as one family of global
 * alerts. When read-only mode is also active, this banner is offset below
 * ReadOnlyBanner (a fixed pixel offset, not a measured one — consistent
 * with this app's fixed-layout-over-adaptive convention) so the two never
 * paint on top of each other.
 */
export const GateClosedBanner: React.FC = () => {
  const { data } = useGateStatus()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)

  if (data?.mode !== 'closed') return null

  return (
    <div
      className={styles.banner}
      style={readOnlyMode ? { top: 'var(--gate-closed-banner-offset, 56px)' } : undefined}
      role="status"
      aria-live="polite"
      data-testid="gate-closed-banner"
    >
      <span className={styles.bannerIcon} aria-hidden="true">
        🚫
      </span>
      <span className={styles.bannerMessage}>
        Applications are CLOSED — the gate kill switch is on. No new applications can start.
      </span>
      <Link href="/admin/marketing/releases" className={styles.bannerLink}>
        Manage in Releases
      </Link>
    </div>
  )
}

export default GateClosedBanner
