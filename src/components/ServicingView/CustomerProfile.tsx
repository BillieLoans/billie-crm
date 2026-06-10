'use client'

import type { CustomerData } from '@/hooks/queries/useCustomer'
import { getAddressForMapLink, getGoogleMapsUrl } from '@/lib/utils'
import { CopyButton } from '@/components/ui'
import styles from './styles.module.css'

export interface CustomerProfileProps {
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
  
  // Try full address first
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
 * CustomerProfile component - displays customer details and identity badges.
 * Part of the ServicingView sidebar.
 */
export const CustomerProfile: React.FC<CustomerProfileProps> = ({ customer }) => {
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

  return (
    <div className={styles.profileCard} data-testid="customer-profile">
      <div className={styles.profileHeader}>
        <div className={styles.profileAvatar}>{initials}</div>
        <div className={styles.profileHeaderText}>
          <h2 className={styles.profileName}>{customer.fullName || 'Unknown'}</h2>
          <span className={styles.profileCopyable}>
            <span className={styles.profileCustomerId}>{customer.customerId}</span>
            <CopyButton value={customer.customerId} label="Copy customer ID" />
          </span>
        </div>
      </div>

      <div className={styles.profileDetails}>
        <div className={styles.profileRow}>
          <span className={styles.profileLabel}>Email</span>
          {customer.emailAddress ? (
            <span className={styles.profileCopyable}>
              <span className={styles.profileValue}>{customer.emailAddress}</span>
              <CopyButton value={customer.emailAddress} label="Copy email address" />
            </span>
          ) : (
            <span className={styles.profileValue}>—</span>
          )}
        </div>
        <div className={styles.profileRow}>
          <span className={styles.profileLabel}>Phone</span>
          {customer.mobilePhoneNumber ? (
            <span className={styles.profileCopyable}>
              <span className={styles.profileValue}>{customer.mobilePhoneNumber}</span>
              <CopyButton value={customer.mobilePhoneNumber} label="Copy phone number" />
            </span>
          ) : (
            <span className={styles.profileValue}>—</span>
          )}
        </div>
        <div className={styles.profileRow}>
          <span className={styles.profileLabel}>DOB</span>
          <span className={styles.profileValue}>{formatDateOfBirth(customer.dateOfBirth)}</span>
        </div>
        <div className={styles.profileRow}>
          <span className={styles.profileLabel}>Address</span>
          <span className={styles.profileCopyable}>
            <span className={styles.profileValue}>{formatAddress(customer.residentialAddress)}</span>
            {(() => {
              const mapAddress = getAddressForMapLink(customer.residentialAddress)
              const mapUrl = mapAddress ? getGoogleMapsUrl(mapAddress) : ''
              return mapUrl ? (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.profileIconLink}
                  title="View on Google Maps"
                  aria-label="View address on Google Maps"
                >
                  <svg className={styles.profileIconLinkSvg} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ) : null
            })()}
          </span>
        </div>
      </div>

      {/* Identity badges */}
      {hasFlags && (
        <div className={styles.profileBadges}>
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
            <span 
              className={`${styles.badge} ${styles.badgeVulnerable}`}
              data-testid="vulnerable-badge"
            >
              ⚠ Vulnerable
            </span>
          )}
        </div>
      )}
    </div>
  )
}
