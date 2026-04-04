'use client'

import React from 'react'
import styles from './styles.module.css'

/**
 * STATUS_CONFIG: maps status values to display labels.
 * All 7 states from the UX spec (FR2).
 */
export const STATUS_CONFIG: Record<string, { label: string; cssClass: string }> = {
  active: { label: 'Active', cssClass: 'active' },
  paused: { label: 'Paused', cssClass: 'paused' },
  soft_end: { label: 'Soft End', cssClass: 'soft_end' },
  hard_end: { label: 'Hard End', cssClass: 'hard_end' },
  approved: { label: 'Approved', cssClass: 'approved' },
  declined: { label: 'Declined', cssClass: 'declined' },
  ended: { label: 'Ended', cssClass: 'ended' },
}

interface StatusBadgeProps {
  status: string | null | undefined
}

/**
 * StatusBadge renders a coloured pill for conversation status.
 * Accessible: uses aria-label for screen readers (FR2, WCAG 2.1 AA).
 *
 * Story 2.2: ConversationCard & StatusBadge Components
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  const normalised = (status ?? '').toLowerCase()
  const config = STATUS_CONFIG[normalised] ?? { label: status ?? 'Unknown', cssClass: 'ended' }
  const cssClass = styles[config.cssClass as keyof typeof styles] ?? ''

  return (
    <span
      className={`${styles.badge} ${cssClass}`}
      aria-label={`Status: ${config.label}`}
      role="status"
    >
      <span className={styles.dot} aria-hidden="true" />
      {config.label}
    </span>
  )
}
