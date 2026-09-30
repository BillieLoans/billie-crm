'use client'

import { Command } from 'cmdk'
import styles from './styles.module.css'

export interface CustomerSearchResultProps {
  customer: {
    id: string
    customerId: string
    fullName: string | null
    emailAddress: string | null
    identityVerified: boolean
    accountCount: number
    matchedFormerRecord?: string | null
  }
  onSelect: () => void
}

/**
 * Customer search result item for the command palette.
 * Uses cmdk's Command.Item for keyboard navigation support.
 */
export const CustomerSearchResult: React.FC<CustomerSearchResultProps> = ({
  customer,
  onSelect,
}) => {
  return (
    <Command.Item
      className={styles.resultItem}
      value={customer.customerId}
      onSelect={onSelect}
      data-testid={`customer-result-${customer.customerId}`}
    >
      <div className={styles.resultIcon}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div className={styles.resultContent}>
        <div className={styles.resultMain}>
          <span className={styles.resultName}>{customer.fullName || 'Unknown'}</span>
          <span className={styles.resultId}>{customer.customerId}</span>
        </div>
        <div className={styles.resultMeta}>
          <span className={styles.resultEmail}>{customer.emailAddress || 'No email'}</span>
          {customer.identityVerified && <span className={styles.badgeVerified}>Verified</span>}
          <span className={styles.accountCount}>
            {customer.accountCount} account{customer.accountCount !== 1 ? 's' : ''}
          </span>
          {customer.matchedFormerRecord && (
            <span className={styles.formerRecord}>
              matched former record {customer.matchedFormerRecord}
            </span>
          )}
        </div>
      </div>
    </Command.Item>
  )
}
