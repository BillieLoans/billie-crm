'use client'

import React from 'react'
import Link from 'next/link'
import { useCustomerConversations } from '@/hooks/queries/useConversations'
import { StatusBadge } from '../../ApplicationsView/StatusBadge'
import { formatCurrency, formatRelativeTime } from '@/lib/formatters'
import styles from './styles.module.css'

interface ApplicationsPanelProps {
  /** Business-key customer ID (e.g. CUS-xxxxx), not the Payload document ID */
  customerIdString: string | undefined
}

/**
 * ApplicationsPanel shows a customer's loan applications in ServicingView.
 *
 * - Active applications shown first with pulsing "Live" dot (FR24)
 * - Historical applications sorted by date (newest first)
 * - Navigates to ConversationDetailView on click (FR21)
 * - 30-second polling in background (FR22)
 * - Graceful error handling — does not block rest of ServicingView (NFR18)
 * - Skeleton loaders while loading
 * - Empty state when no applications
 *
 * Story 4.1: ApplicationsPanel in ServicingView
 */
export function ApplicationsPanel({ customerIdString }: ApplicationsPanelProps) {
  const { data, isLoading, error } = useCustomerConversations(customerIdString)

  const conversations = data?.conversations ?? []

  // Sort: active first, then by updatedAt desc
  const sorted = [...conversations].sort((a, b) => {
    const aActive = a.status === 'active' ? 1 : 0
    const bActive = b.status === 'active' ? 1 : 0
    if (bActive !== aActive) return bActive - aActive
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
    return bTime - aTime
  })

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>
          Applications
          {!isLoading && (
            <span className={styles.count}> ({sorted.length})</span>
          )}
        </h3>
      </div>

      {/* Error: non-blocking (NFR18) */}
      {error && (
        <p className={styles.errorMessage}>
          Unable to load applications. Please try again later.
        </p>
      )}

      {/* Loading skeletons */}
      {isLoading && !error && (
        <>
          <div className={styles.skeletonCard} aria-hidden="true" />
          <div className={styles.skeletonCard} aria-hidden="true" />
        </>
      )}

      {/* Empty state */}
      {!isLoading && !error && sorted.length === 0 && (
        <p className={styles.emptyState}>No applications found for this customer.</p>
      )}

      {/* Application cards */}
      {!isLoading &&
        sorted.map((conv) => {
          const isActive = conv.status === 'active'
          const loanAmount = conv.application?.loanAmount
          const details = [
            loanAmount != null ? formatCurrency(loanAmount) : null,
            conv.application?.purpose,
          ]
            .filter(Boolean)
            .join(' · ')

          const isApproved = conv.decisionStatus === 'approved'
          const customerIdForLink = conv.customer?.customerId

          return (
            <div key={conv.conversationId} className={styles.cardRow}>
              <Link
                href={`/admin/applications/${conv.conversationId}?from=servicing`}
                className={styles.appCard}
                aria-label={`Application ${conv.applicationNumber ?? conv.conversationId}${isActive ? ' (live)' : ''}`}
              >
                <div className={styles.cardLeft}>
                  {isActive && (
                    <span
                      className={styles.liveIndicator}
                      aria-label="Live application"
                      title="Active"
                    />
                  )}
                  <div className={styles.cardMeta}>
                    {conv.applicationNumber && (
                      <span className={styles.appNumber}>{conv.applicationNumber}</span>
                    )}
                    {details && <span className={styles.appDetails}>{details}</span>}
                  </div>
                </div>
                <StatusBadge status={conv.status} />
                {conv.updatedAt && (
                  <span className={styles.appDate}>{formatRelativeTime(conv.updatedAt)}</span>
                )}
              </Link>
              {isApproved && customerIdForLink && (
                <Link
                  href={`/admin/servicing/${customerIdForLink}`}
                  className={styles.accountLink}
                  aria-label={`View loan account for ${conv.applicationNumber ?? conv.conversationId}`}
                  title="View loan account in Servicing"
                  onClick={(e) => e.stopPropagation()}
                >
                  →
                </Link>
              )}
            </div>
          )
        })}
    </div>
  )
}
