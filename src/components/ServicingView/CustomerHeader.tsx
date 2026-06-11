'use client'

import { useState } from 'react'
import type { CustomerData } from '@/hooks/queries/useCustomer'
import { getAddressForMapLink, getGoogleMapsUrl } from '@/lib/utils'
import { formatDateMedium } from '@/lib/formatters'
import { CopyButton } from '@/components/ui'
import { NotificationStatusPill } from './NotificationControls/NotificationStatusPill'
import styles from './CustomerHeader.module.css'

export interface CustomerHeaderProps {
  customer: CustomerData
}

/**
 * Format date of birth for display (Australian format: DD MMM YYYY)
 */
function formatDateOfBirth(dateString: string | null): string {
  if (!dateString) return '—'
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return '—'
  }
}

/**
 * Format address for display
 */
function formatAddress(address: CustomerData['residentialAddress']): string {
  if (!address) return '—'
  
  // Use full address if available
  if (address.fullAddress) return address.fullAddress
  
  // Build from parts
  const parts: string[] = []
  if (address.street) parts.push(address.street)
  if (address.suburb) parts.push(address.suburb)
  if (address.state && address.postcode) {
    parts.push(`${address.state} ${address.postcode}`)
  } else if (address.state) {
    parts.push(address.state)
  } else if (address.postcode) {
    parts.push(address.postcode)
  }
  
  return parts.length > 0 ? parts.join(', ') : '—'
}

/**
 * CustomerHeader - Compact horizontal display of customer info.
 * Shows key details in a single row with expandable full details.
 */
export const CustomerHeader: React.FC<CustomerHeaderProps> = ({ customer }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const initials = customer.fullName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  // Check for any identity flags
  const hasFlags =
    customer.identityVerified ||
    customer.staffFlag ||
    customer.investorFlag ||
    customer.founderFlag ||
    customer.vulnerableFlag

  // LAB EVS identity verification (PR #67). Rows render in fixed positions in
  // the expanded details; '—' until the verification events flow, and the
  // report links only appear once the archive event lands (reportArchived).
  const verification = customer.identityVerification
  const overallResult = verification?.overallResult ?? null
  const verificationPassed = overallResult ? /pass/i.test(overallResult) : null
  const reportBase = `/api/customer/${encodeURIComponent(customer.customerId)}/identity-report`

  return (
    <div className={styles.headerCard} data-testid="customer-header">
      {/* Main compact row */}
      <div className={styles.mainRow}>
        <div className={styles.identity}>
          <div className={styles.avatar}>{initials}</div>
          <div className={styles.nameBlock}>
            <h2 className={styles.name}>{customer.fullName || 'Unknown'}</h2>
            <span className={styles.customerId}>
              {customer.customerId}
              <CopyButton value={customer.customerId} label="Copy customer ID" />
            </span>
          </div>
        </div>

        <div className={styles.contactInfo}>
          {customer.emailAddress && (
            <div className={styles.contactItem}>
              <span className={styles.contactIcon}>📧</span>
              <span className={styles.contactValue}>{customer.emailAddress}</span>
              <CopyButton value={customer.emailAddress} label="Copy email" />
            </div>
          )}
          {customer.mobilePhoneNumber && (
            <div className={styles.contactItem}>
              <span className={styles.contactIcon}>📱</span>
              <span className={styles.contactValue}>{customer.mobilePhoneNumber}</span>
              <CopyButton value={customer.mobilePhoneNumber} label="Copy phone" />
            </div>
          )}
        </div>

        <div className={styles.actions}>
          {/* Per-customer notification kill switch */}
          <NotificationStatusPill
            customerId={customer.customerId}
            customerName={customer.fullName ?? undefined}
          />

          {/* Identity badges - show inline when not expanded */}
          {hasFlags && !isExpanded && (
            <div className={styles.badgesInline}>
              {customer.vulnerableFlag && (
                <span className={`${styles.badge} ${styles.badgeVulnerable}`}>⚠ Vulnerable</span>
              )}
              {customer.identityVerified && (
                <span className={`${styles.badge} ${styles.badgeVerified}`}>✓ Verified</span>
              )}
              {customer.staffFlag && (
                <span className={`${styles.badge} ${styles.badgeStaff}`}>Staff</span>
              )}
            </div>
          )}
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Less ▲' : 'More ▼'}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className={styles.expandedRow}>
          <div className={styles.detailsGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Date of Birth</span>
              <span className={styles.detailValue}>{formatDateOfBirth(customer.dateOfBirth)}</span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Address</span>
              <span className={styles.detailValueWithIcon}>
                <span>{formatAddress(customer.residentialAddress)}</span>
                {(() => {
                  const mapAddress = getAddressForMapLink(customer.residentialAddress)
                  const mapUrl = mapAddress ? getGoogleMapsUrl(mapAddress) : ''
                  return mapUrl ? (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.detailIconLink}
                      title="View on Google Maps"
                      aria-label="View address on Google Maps"
                    >
                      <svg className={styles.detailIconLinkSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  ) : null
                })()}
              </span>
            </div>

            {/* Identity verification (LAB EVS, PR #67) */}
            <div className={styles.detailItem} data-testid="identity-verification">
              <span className={styles.detailLabel}>Identity check</span>
              <span
                className={`${styles.detailValue} ${
                  verificationPassed == null
                    ? ''
                    : verificationPassed
                      ? styles.idvPass
                      : styles.idvFail
                }`}
              >
                {overallResult
                  ? `${verificationPassed ? '✓' : '✗'} ${overallResult}${
                      verification?.provider ? ` · ${verification.provider}` : ''
                    }`
                  : '—'}
              </span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Checked</span>
              <span className={styles.detailValue}>
                {verification?.checkedAt ? formatDateMedium(verification.checkedAt) : '—'}
              </span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Reference</span>
              <span className={styles.detailValueWithIcon}>
                <span>{verification?.providerReference ?? '—'}</span>
                {verification?.providerReference && (
                  <CopyButton
                    value={verification.providerReference}
                    label="Copy provider reference"
                  />
                )}
              </span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Report</span>
              {verification?.reportArchived ? (
                <span className={styles.reportLinks}>
                  <a
                    href={`${reportBase}?artifact=report`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.reportLink}
                    data-testid="view-identity-report"
                  >
                    View report ⤢
                  </a>
                  <span aria-hidden> · </span>
                  <a
                    href={`${reportBase}?artifact=raw&disposition=attachment`}
                    className={styles.reportLink}
                    data-testid="download-identity-raw"
                  >
                    Raw JSON ⤓
                  </a>
                </span>
              ) : (
                <span className={styles.detailValue}>—</span>
              )}
            </div>
          </div>

          {/* All badges shown when expanded */}
          {hasFlags && (
            <div className={styles.badgesExpanded}>
              {customer.identityVerified && (
                <span className={`${styles.badge} ${styles.badgeVerified}`}>✓ Verified</span>
              )}
              {customer.staffFlag && (
                <span className={`${styles.badge} ${styles.badgeStaff}`}>Staff</span>
              )}
              {customer.investorFlag && (
                <span className={`${styles.badge} ${styles.badgeInvestor}`}>Investor</span>
              )}
              {customer.founderFlag && (
                <span className={`${styles.badge} ${styles.badgeFounder}`}>Founder</span>
              )}
              {customer.vulnerableFlag && (
                <span className={`${styles.badge} ${styles.badgeVulnerable}`}>⚠ Vulnerable</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
