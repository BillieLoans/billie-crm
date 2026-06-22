'use client'

import React from 'react'
import Link from 'next/link'
import { StatusBadge } from '../StatusBadge'
import { formatRelativeTime, formatCurrency, formatDateOnly } from '@/lib/formatters'
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
    startedAt,
  } = conversation

  // Heading is always the customer's name (or a generic fallback) so cards don't
  // reshuffle between named and unnamed customers — the customer ID keeps a fixed
  // spot as a subline below, regardless of whether a name is on file.
  const heading = customer?.fullName ?? 'Unknown customer'
  const customerId = customer?.customerId ?? null

  // Amber accent: paused and last activity > 5 minutes ago
  const isPausedAlert =
    status === 'paused' &&
    updatedAt != null &&
    // Display-only staleness heuristic; the intentional Date.now() in render is
    // re-evaluated on each render, which is acceptable for a styling accent.
    // eslint-disable-next-line react-hooks/purity
    Date.now() - new Date(updatedAt).getTime() > 5 * 60 * 1000

  const loanAmountFormatted =
    application?.loanAmount != null ? formatCurrency(application.loanAmount) : null

  const timeDisplay = lastMessageAt ?? updatedAt

  return (
    <Link
      href={`/admin/applications/${conversationId}`}
      className={`${styles.card} ${isPausedAlert ? styles.pausedAlert : ''}`}
      tabIndex={0}
      aria-label={`Conversation ${applicationNumber ?? conversationId}: ${heading}, status ${status ?? 'unknown'}`}
    >
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.customerName}>{heading}</p>
          {applicationNumber && (
            <p className={styles.appNumber}>Application {applicationNumber}</p>
          )}
          {customerId && (
            <p className={styles.customerId}>Customer {customerId}</p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {(loanAmountFormatted || application?.purpose || startedAt) && (
        <div className={styles.meta}>
          {loanAmountFormatted && (
            <span className={styles.loanAmount}>{loanAmountFormatted}</span>
          )}
          {application?.purpose && (
            <span className={styles.purpose}>{application.purpose}</span>
          )}
          {startedAt && (
            <span className={styles.started}>Started {formatDateOnly(startedAt)}</span>
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
