'use client'

import React from 'react'
import Link from 'next/link'
import { StatusBadge } from '../StatusBadge'
import { formatRelativeTime, formatCurrency } from '@/lib/formatters'
import type { ConversationSummary } from '@/lib/schemas/conversations'
import styles from './styles.module.css'

interface ConversationCardProps {
  conversation: ConversationSummary
}

/**
 * ConversationCard renders a single conversation as a monitoring grid card.
 *
 * Features:
 * - Status badge with 7 states
 * - Customer name, application number, loan amount/purpose
 * - Last message preview (truncated, hidden on mobile)
 * - Message count + relative time indicator
 * - Amber left border accent for paused > 5 minutes
 * - Full card as tap target (min 44px)
 * - Keyboard accessible
 *
 * Story 2.2: ConversationCard & StatusBadge Components (FR1, FR2)
 */
export function ConversationCard({ conversation }: ConversationCardProps) {
  const {
    conversationId,
    customer,
    applicationNumber,
    status,
    application,
    messageCount,
    lastMessageAt,
    updatedAt,
  } = conversation

  // Amber accent: paused and last activity > 5 minutes ago
  const isPausedAlert =
    status === 'paused' &&
    updatedAt != null &&
    Date.now() - new Date(updatedAt).getTime() > 5 * 60 * 1000

  const loanAmountFormatted =
    application?.loanAmount != null ? formatCurrency(application.loanAmount) : null

  const timeDisplay = lastMessageAt ?? updatedAt

  return (
    <Link
      href={`/admin/applications/${conversationId}`}
      className={`${styles.card} ${isPausedAlert ? styles.pausedAlert : ''}`}
      tabIndex={0}
      aria-label={`Conversation ${applicationNumber ?? conversationId}: ${customer?.fullName ?? 'Unknown customer'}, status ${status ?? 'unknown'}`}
    >
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.customerName}>{customer?.fullName ?? 'Unknown customer'}</p>
          {applicationNumber && (
            <p className={styles.appNumber}>{applicationNumber}</p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {(loanAmountFormatted || application?.purpose) && (
        <div className={styles.meta}>
          {loanAmountFormatted && (
            <span className={styles.loanAmount}>{loanAmountFormatted}</span>
          )}
          {application?.purpose && (
            <span className={styles.purpose}>{application.purpose}</span>
          )}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.messageCount}>
          {messageCount} {messageCount === 1 ? 'message' : 'messages'}
        </span>
        {timeDisplay && (
          <span className={styles.timeAgo}>{formatRelativeTime(timeDisplay)}</span>
        )}
      </div>
    </Link>
  )
}
