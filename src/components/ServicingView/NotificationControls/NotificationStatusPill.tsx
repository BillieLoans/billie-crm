'use client'

import React, { useState, useCallback } from 'react'
import { useNotificationSuppression } from '@/hooks/queries/useNotificationSuppression'
import { NotificationControlsDrawer } from './NotificationControlsDrawer'
import styles from './styles.module.css'

export interface NotificationStatusPillProps {
  /** Platform business-key customer ID (e.g. "cust_abc"). */
  customerId: string
  customerName?: string
}

export const NotificationStatusPill: React.FC<NotificationStatusPillProps> = ({
  customerId,
  customerName,
}) => {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { suppression, isLoading, isActive, isExpired } =
    useNotificationSuppression(customerId)

  const handleOpen = useCallback(() => setDrawerOpen(true), [])
  const handleClose = useCallback(() => setDrawerOpen(false), [])

  // Pick label + tone from suppression state.
  let label = '🔔 Notifications: ON'
  let toneClass = styles.pillOn
  if (isActive && suppression) {
    if (suppression.mode === 'all') {
      label = '🔕 All notifications paused'
      toneClass = styles.pillRed
    } else if (suppression.mode === 'non_essential') {
      label = '🔕 Paused — non-essential'
      toneClass = styles.pillAmber
    } else if (suppression.mode === 'marketing_only') {
      label = '🔕 Marketing paused'
      toneClass = styles.pillAmber
    }
  } else if (isExpired) {
    label = '🔔 Suppression recently expired'
    toneClass = styles.pillExpired
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.pill} ${toneClass} ${isLoading ? styles.pillLoading : ''}`}
        onClick={handleOpen}
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
        data-testid="notification-status-pill"
        disabled={isLoading}
      >
        <span>{label}</span>
        <span className={styles.pillCaret} aria-hidden>
          ▾
        </span>
      </button>

      <NotificationControlsDrawer
        isOpen={drawerOpen}
        onClose={handleClose}
        customerId={customerId}
        customerName={customerName}
      />
    </>
  )
}
