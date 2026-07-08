'use client'

import React, { useState, useCallback, useEffect } from 'react'
import { useApprovalNotifications } from '@/hooks/queries/useApprovalNotifications'
import { useLendingAccess } from '@/hooks/useLendingAccess'
import { NotificationPanel } from './NotificationPanel'
import styles from './styles.module.css'

export interface NotificationBadgeProps {
  /** Whether to show the badge (for role-based visibility) */
  visible?: boolean
}

/**
 * Notification badge for the admin header.
 * Shows count of pending approvals and opens notification panel on click.
 */
export const NotificationBadge: React.FC<NotificationBadgeProps> = ({
  visible = true,
}) => {
  const [panelOpen, setPanelOpen] = useState(false)

  // write_off_requests is behind the lending wall (hasAnyRole) — polling it
  // as a marketing/service user just 403s on every cycle and floods the logs.
  const hasLendingAccess = useLendingAccess()
  const canSee = visible && hasLendingAccess

  const {
    notifications,
    totalPending,
    unreadCount,
    isLoading,
    markAllAsRead,
    markAsRead,
  } = useApprovalNotifications({ enabled: canSee })

  const handleTogglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev)
  }, [])

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false)
  }, [])

  // Close panel on Escape key
  useEffect(() => {
    if (!panelOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [panelOpen])

  if (!canSee) return null

  // Format count for display
  const displayCount = totalPending > 99 ? '99+' : totalPending.toString()
  const isLargeCount = totalPending > 9

  return (
    <>
      <div className={styles.badgeContainer}>
        <button
          type="button"
          className={styles.badgeButton}
          onClick={handleTogglePanel}
          aria-label={`${totalPending} pending approvals`}
          aria-expanded={panelOpen}
          data-active={panelOpen}
          data-testid="notification-badge-button"
        >
          🔔
        </button>
        {totalPending > 0 && (
          <span
            className={`${styles.badgeCount} ${isLargeCount ? styles.badgeCountLarge : ''}`}
            data-testid="notification-badge-count"
          >
            {displayCount}
          </span>
        )}
      </div>

      <NotificationPanel
        isOpen={panelOpen}
        onClose={handleClosePanel}
        notifications={notifications}
        unreadCount={unreadCount}
        isLoading={isLoading}
        onMarkAllAsRead={markAllAsRead}
        onMarkAsRead={markAsRead}
      />
    </>
  )
}

export default NotificationBadge
