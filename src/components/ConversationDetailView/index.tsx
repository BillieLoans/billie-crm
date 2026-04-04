'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useConversation } from '@/hooks/queries/useConversation'
import { MessagePanel } from './MessagePanel'
import { AssessmentPanel } from './AssessmentPanel'
import { StatusBadge } from '../ApplicationsView/StatusBadge'
import { formatCurrency } from '@/lib/formatters'
import styles from './styles.module.css'

interface ConversationDetailViewProps {
  conversationId: string
  /** Entry point — 'servicing' when navigated from ServicingView ApplicationsPanel */
  referrer?: 'servicing' | null
}

/**
 * ConversationDetailView renders the 60/40 split-panel layout.
 *
 * Left panel (60%): chat transcript
 * Right panel (40%): assessments
 *
 * Features:
 * - Polls every 3 seconds (FR15)
 * - Breadcrumb navigation (FR36)
 * - "View profile →" link to customer ServicingView (FR20)
 * - Skeleton loaders
 * - Escape to navigate back
 * - Responsive: stacked on tablet, transcript-only on mobile
 *
 * Story 3.1: ConversationDetailView with Split-Panel Layout
 */
export function ConversationDetailView({ conversationId, referrer }: ConversationDetailViewProps) {
  const router = useRouter()
  const { data: conversation, isLoading, error } = useConversation(conversationId)
  const [showAssessmentsMobile, setShowAssessmentsMobile] = useState(false)

  const fromServicing = referrer === 'servicing'

  // Escape: go back to entry point
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (fromServicing) {
          router.back()
        } else {
          router.push('/admin/applications')
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [router, fromServicing])

  if (error instanceof Error && error.message === 'NOT_FOUND') {
    return (
      <div className={styles.notFound}>
        <p>Conversation not found.</p>
        <Link href="/admin/applications" className={styles.backLink}>
          ← Back to Applications
        </Link>
      </div>
    )
  }

  const customerFullName = conversation?.customer?.fullName ?? 'Loading…'
  const customerId = conversation?.customer?.customerId
  const appNumber = conversation?.applicationNumber
  const loanAmount = conversation?.application?.loanAmount
  const purpose = conversation?.application?.purpose

  const loanMeta = [
    loanAmount != null ? formatCurrency(loanAmount) : null,
    purpose,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          {fromServicing ? (
            customerId ? (
              <Link href={`/admin/servicing/${customerId}`} className={styles.breadcrumbLink}>
                Servicing
              </Link>
            ) : (
              <span>Servicing</span>
            )
          ) : (
            <Link href="/admin/applications" className={styles.breadcrumbLink}>
              Applications
            </Link>
          )}
          <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
          <span>{customerFullName}</span>
          {appNumber && (
            <>
              <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
              <span>{appNumber}</span>
            </>
          )}
        </nav>

        <div className={styles.headerRow}>
          <div className={styles.headerLeft}>
            {appNumber && <span className={styles.appNumber}>{appNumber}</span>}
            <StatusBadge status={conversation?.status} />
            {loanMeta && <span className={styles.loanMeta}>{loanMeta}</span>}
          </div>
          {customerId && (
            <Link
              href={`/admin/servicing/${customerId}`}
              className={styles.viewProfileLink}
            >
              View profile →
            </Link>
          )}
        </div>
      </div>

      {/* Split panel */}
      <div className={styles.splitPanel}>
        <div className={styles.leftPanel}>
          <MessagePanel
            utterances={conversation?.utterances ?? []}
            isLoading={isLoading && !conversation}
          />
        </div>

        <div className={`${styles.rightPanel} ${showAssessmentsMobile ? styles.mobileVisible : ''}`}>
          {conversation ? (
            <AssessmentPanel
              conversation={conversation}
              conversationId={conversationId}
            />
          ) : isLoading ? (
            <div style={{ padding: 16 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    height: 48,
                    borderRadius: 8,
                    background: 'var(--theme-elevation-50, #f5f5f5)',
                    marginBottom: 8,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile: toggle assessments */}
      <button
        type="button"
        className={styles.mobileToggle}
        onClick={() => setShowAssessmentsMobile((v) => !v)}
        aria-expanded={showAssessmentsMobile}
        aria-label="Toggle assessments panel"
      >
        {showAssessmentsMobile ? 'Hide Assessments ↑' : 'Assessments ↓'}
      </button>
    </div>
  )
}
