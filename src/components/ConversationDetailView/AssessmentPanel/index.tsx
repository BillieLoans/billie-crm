'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatRelativeTime, formatCurrency } from '@/lib/formatters'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import styles from './styles.module.css'

interface AssessmentSectionProps {
  title: string
  summary: string
  children: React.ReactNode
  defaultOpen?: boolean
}

function AssessmentSection({ title, summary, children, defaultOpen = false }: AssessmentSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = `section-${title.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
      >
        <span className={styles.sectionTitle}>{title}</span>
        <span className={styles.sectionSummary}>{summary}</span>
        <span className={`${styles.chevron} ${open ? styles.open : ''}`} aria-hidden="true">
          ▶
        </span>
      </button>
      {open && (
        <div id={id} className={styles.sectionContent}>
          {children}
        </div>
      )}
    </div>
  )
}

interface AssessmentPanelProps {
  conversation: ConversationDetail
  conversationId: string
}

/**
 * AssessmentPanel renders collapsible assessment sections in the right panel.
 *
 * Sections (all collapsed by default — FR13):
 * - Application Details
 * - Identity (identityRisk)
 * - Credit: Account Conduct (with "View full details" link — FR19)
 * - Credit: Serviceability (with "View full details" link — FR19)
 * - Statements (statementCapture)
 * - Noticeboard (with version history — FR14)
 *
 * Keyboard: [ = collapse all, ] = expand all
 *
 * Story 3.3: Assessment Panel & Noticeboard (FR12-FR14)
 */
export function AssessmentPanel({ conversation, conversationId }: AssessmentPanelProps) {
  const { assessments, statementCapture, noticeboard, application } = conversation

  // Global keyboard [ / ] shortcuts for collapse/expand
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '[') {
        document.querySelectorAll<HTMLButtonElement>('[aria-expanded="true"]').forEach((btn) => btn.click())
      } else if (e.key === ']') {
        document.querySelectorAll<HTMLButtonElement>('[aria-expanded="false"]').forEach((btn) => btn.click())
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Application Details summary
  const appSummary = [
    application?.loanAmount != null ? formatCurrency(application.loanAmount) : null,
    application?.term != null ? `${application.term}d` : null,
    application?.purpose,
  ]
    .filter(Boolean)
    .join(' · ')

  // Identity summary
  const identity = assessments?.identityRisk as Record<string, unknown> | undefined
  const identityDecision = identity?.decision as string | undefined
  const identitySummary = identityDecision
    ? ['PASS', 'APPROVED'].includes(identityDecision.toUpperCase())
      ? '✓ Verified'
      : '⚠ Refer'
    : 'No data'

  // Account Conduct
  const accountConduct = assessments?.accountConduct as Record<string, unknown> | undefined
  const acDecision = accountConduct?.decision as string | undefined

  // Serviceability
  const serviceability = assessments?.serviceability as Record<string, unknown> | undefined
  const svcDecision = serviceability?.decision as string | undefined

  // Statements summary
  const sc = statementCapture as Record<string, unknown> | undefined
  const consentStatus = sc?.consentStatus as string | undefined
  const retrievalComplete = sc?.retrievalComplete as boolean | undefined
  const statementSummary = consentStatus
    ? `Consent: ${consentStatus}${retrievalComplete ? ' · Retrieved' : ''}`
    : 'No data'

  // Noticeboard: most recent post
  const latestPost = noticeboard?.[noticeboard.length - 1]
  const noticeboardSummary = latestPost
    ? (latestPost.content ?? '').slice(0, 40) + (((latestPost.content ?? '').length > 40) ? '…' : '')
    : 'No posts'

  return (
    <div className={styles.panel}>
      {/* Application Details */}
      <AssessmentSection title="Application" summary={appSummary || 'No data'}>
        {application ? (
          <div>
            {application.loanAmount != null && (
              <div className={styles.statementRow}>
                <span className={styles.statementLabel}>Loan amount</span>
                <span className={styles.statementValue}>{formatCurrency(application.loanAmount)}</span>
              </div>
            )}
            {application.purpose && (
              <div className={styles.statementRow}>
                <span className={styles.statementLabel}>Purpose</span>
                <span className={styles.statementValue}>{application.purpose}</span>
              </div>
            )}
            {application.term != null && (
              <div className={styles.statementRow}>
                <span className={styles.statementLabel}>Term</span>
                <span className={styles.statementValue}>{application.term} days</span>
              </div>
            )}
          </div>
        ) : (
          <p>No application data available.</p>
        )}
      </AssessmentSection>

      {/* Identity */}
      <AssessmentSection title="Identity" summary={identitySummary}>
        {identity ? (
          <pre className={styles.jsonPreview}>{JSON.stringify(identity, null, 2)}</pre>
        ) : (
          <p>No identity assessment data.</p>
        )}
      </AssessmentSection>

      {/* Credit: Account Conduct */}
      <AssessmentSection
        title="Credit: Account Conduct"
        summary={acDecision ? acDecision.toUpperCase() : 'No data'}
      >
        <div>
          {acDecision && (
            <p className={acDecision.toUpperCase() === 'PASS' ? styles.pass : styles.fail}>
              {acDecision.toUpperCase()}
            </p>
          )}
          <Link
            href={`/admin/applications/${conversationId}/assessment/account-conduct`}
            className={styles.detailLink}
          >
            View full details →
          </Link>
          {accountConduct ? (
            <pre className={styles.jsonPreview}>{JSON.stringify(accountConduct, null, 2)}</pre>
          ) : (
            <p>No account conduct data.</p>
          )}
        </div>
      </AssessmentSection>

      {/* Credit: Serviceability */}
      <AssessmentSection
        title="Credit: Serviceability"
        summary={svcDecision ? svcDecision.toUpperCase() : 'No data'}
      >
        <div>
          {svcDecision && (
            <p className={svcDecision.toUpperCase() === 'PASS' ? styles.pass : styles.fail}>
              {svcDecision.toUpperCase()}
            </p>
          )}
          <Link
            href={`/admin/applications/${conversationId}/assessment/serviceability`}
            className={styles.detailLink}
          >
            View full details →
          </Link>
          {serviceability ? (
            <pre className={styles.jsonPreview}>{JSON.stringify(serviceability, null, 2)}</pre>
          ) : (
            <p>No serviceability data.</p>
          )}
        </div>
      </AssessmentSection>

      {/* Statements */}
      <AssessmentSection title="Statements" summary={statementSummary}>
        {sc ? (
          <div>
            <div className={styles.statementRow}>
              <span className={styles.statementLabel}>Consent</span>
              <span className={styles.statementValue}>{consentStatus ?? '—'}</span>
            </div>
            <div className={styles.statementRow}>
              <span className={styles.statementLabel}>Retrieval</span>
              <span className={styles.statementValue}>{retrievalComplete ? 'Complete' : 'Pending'}</span>
            </div>
            <div className={styles.statementRow}>
              <span className={styles.statementLabel}>Checks</span>
              <span className={styles.statementValue}>
                {(sc.checksComplete as boolean) ? 'Complete' : 'Pending'}
              </span>
            </div>
          </div>
        ) : (
          <p>No statement capture data.</p>
        )}
      </AssessmentSection>

      {/* Noticeboard */}
      <AssessmentSection title="Noticeboard" summary={noticeboardSummary}>
        {noticeboard && noticeboard.length > 0 ? (
          <div>
            {[...noticeboard].reverse().map((entry, i) => (
              <div key={i} className={styles.noticeboardEntry}>
                <p className={styles.noticeboardAgent}>{entry.agentName ?? 'Unknown agent'}</p>
                <p className={styles.noticeboardContent}>{entry.content}</p>
                {entry.timestamp && (
                  <p className={styles.noticeboardTime}>
                    {formatRelativeTime(entry.timestamp as string)}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p>No noticeboard posts.</p>
        )}
      </AssessmentSection>
    </div>
  )
}
