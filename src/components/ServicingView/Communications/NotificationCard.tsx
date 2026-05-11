'use client'

import React, { useCallback, useState } from 'react'
import type { NotificationData } from '@/hooks/queries/useNotifications'
import {
  getTemplateLabel,
  getFailureLabel,
  isLegallyImportant,
} from '@/lib/notifications/templateLabels'
import { NotificationBodyModal } from './NotificationBodyModal'
import styles from './styles.module.css'

export interface NotificationCardProps {
  notification: NotificationData
}

const CHANNEL_ICON: Record<string, string> = {
  email: '📧',
  sms: '💬',
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toLocaleString('en-AU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export const NotificationCard: React.FC<NotificationCardProps> = ({ notification }) => {
  const [bodyOpen, setBodyOpen] = useState(false)

  const handleOpenBody = useCallback(() => setBodyOpen(true), [])
  const handleCloseBody = useCallback(() => setBodyOpen(false), [])

  const isReenabled =
    notification.status === 'suppression_change' &&
    (notification.suppression?.mode ?? '') === 'off'
  const statusClass =
    notification.status === 'sent'
      ? styles.notificationCardSent
      : notification.status === 'failed'
        ? styles.notificationCardFailed
        : notification.status === 'blocked'
          ? styles.notificationCardBlocked
          : notification.status === 'suppression_change'
            ? isReenabled
              ? styles.notificationCardSent
              : styles.notificationCardBlocked
            : styles.notificationCardStatement

  const legallyImportant = isLegallyImportant(notification.templateName)
  const cardClasses = [
    styles.notificationCard,
    statusClass,
    legallyImportant ? styles.notificationCardLegal : '',
  ]
    .filter(Boolean)
    .join(' ')

  const channelKey = notification.channel ?? ''
  const channelIcon =
    notification.status === 'statement'
      ? '📄'
      : notification.status === 'suppression_change'
        ? isReenabled
          ? '🔔'
          : '🔕'
        : (CHANNEL_ICON[channelKey] ?? '🔔')

  const suppressionModeLabels: Record<string, string> = {
    all: 'All notifications paused',
    non_essential: 'Non-essential notifications paused',
    marketing_only: 'Marketing notifications paused',
    off: 'Notifications re-enabled',
  }

  const label =
    notification.status === 'statement'
      ? 'Monthly statement'
      : notification.status === 'suppression_change'
        ? (suppressionModeLabels[notification.suppression?.mode ?? ''] ??
          'Suppression updated')
        : getTemplateLabel(notification.templateName, notification.tags ?? undefined)

  const statusBadge = (() => {
    switch (notification.status) {
      case 'sent':
        return <span className={`${styles.badge} ${styles.badgeSent}`}>Sent</span>
      case 'failed':
        return (
          <span className={`${styles.badge} ${styles.badgeFailed}`}>
            {getFailureLabel(notification.failure?.errorType ?? null)}
          </span>
        )
      case 'blocked':
        return (
          <span className={`${styles.badge} ${styles.badgeBlocked}`}>
            Blocked — notification suppression active
          </span>
        )
      case 'statement':
        return <span className={`${styles.badge} ${styles.badgeStatement}`}>Statement issued</span>
      case 'suppression_change':
        return isReenabled ? (
          <span className={`${styles.badge} ${styles.badgeSent}`}>Notifications re-enabled</span>
        ) : (
          <span className={`${styles.badge} ${styles.badgeBlocked}`}>Notifications paused</span>
        )
      default:
        return null
    }
  })()

  const isSuppressionChange = notification.status === 'suppression_change'

  const channelSecondary =
    !isSuppressionChange && notification.channel ? notification.channel.toUpperCase() : ''
  const stepSecondary =
    !isSuppressionChange && typeof notification.tags?.step === 'number'
      ? ` · step ${notification.tags.step}`
      : ''
  const contentHashShort = notification.templateContentHash
    ? notification.templateContentHash.slice(0, 7)
    : ''

  const showViewBody =
    notification.status === 'sent' ||
    notification.status === 'failed' ||
    notification.status === 'statement'

  const suppressionExpires =
    isSuppressionChange && notification.suppression?.expiresAt
      ? formatTimestamp(notification.suppression.expiresAt)
      : null

  return (
    <article className={cardClasses} data-testid={`notification-card-${notification.id}`}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderLeft}>
          <span className={styles.cardIcon} aria-hidden>
            {channelIcon}
          </span>
          <span className={styles.cardLabel}>{label}</span>
          {channelSecondary && (
            <span className={styles.cardSecondary}>
              · {channelSecondary}
              {stepSecondary}
            </span>
          )}
        </div>
        <span className={styles.cardTimestamp}>{formatTimestamp(notification.eventAt)}</span>
      </div>

      <div className={styles.cardMeta}>
        {statusBadge}
        {legallyImportant && (
          <span className={`${styles.badge} ${styles.badgeLegal}`}>Legally important</span>
        )}
        {notification.failure?.attempt && notification.failure.attempt > 1 && (
          <span className={`${styles.badge} ${styles.badgeMeta}`}>
            Attempt {notification.failure.attempt}
          </span>
        )}
        {notification.failure?.fallbackSuggested && (
          <span className={`${styles.badge} ${styles.badgeMeta}`}>
            Fallback: {notification.failure.fallbackSuggested}
          </span>
        )}
        {notification.status === 'statement' && notification.statement?.periodStart && (
          <span className={`${styles.badge} ${styles.badgeMeta}`}>
            Period {notification.statement.periodStart} → {notification.statement.periodEnd}
          </span>
        )}
        {isSuppressionChange && suppressionExpires && (
          <span className={`${styles.badge} ${styles.badgeMeta}`}>
            Expires {suppressionExpires}
          </span>
        )}
        {isSuppressionChange &&
          !suppressionExpires &&
          notification.suppression?.mode &&
          notification.suppression.mode !== 'off' && (
            <span className={`${styles.badge} ${styles.badgeMeta}`}>Indefinite</span>
          )}
      </div>

      {notification.failure?.errorMessage && notification.status === 'failed' && (
        <div className={styles.errorMessage}>{notification.failure.errorMessage}</div>
      )}

      {isSuppressionChange && notification.suppression?.reason && (
        <div className={styles.cardSecondary}>
          Reason: {notification.suppression.reason}
        </div>
      )}

      <div className={styles.cardFooter}>
        <span className={styles.cardTemplateInfo}>
          {isSuppressionChange
            ? `Set by ${notification.suppression?.setBy ?? 'unknown'}`
            : `${notification.templateName ?? ''}${contentHashShort ? ` · ${contentHashShort}` : ''}`}
        </span>
        {showViewBody && (
          <button
            type="button"
            className={styles.viewBodyBtn}
            onClick={handleOpenBody}
            data-testid={`notification-view-body-${notification.id}`}
          >
            View body
          </button>
        )}
      </div>

      {bodyOpen && (
        <NotificationBodyModal
          notificationId={notification.notificationId}
          onClose={handleCloseBody}
        />
      )}
    </article>
  )
}
