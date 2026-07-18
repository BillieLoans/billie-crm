'use client'

import { Command } from 'cmdk'
import type { MarketingContactHit } from '@/hooks/queries/useMarketingContactSearch'
import styles from './styles.module.css'

export interface ContactSearchResultProps {
  contact: MarketingContactHit
  onSelect: () => void
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  waitlist: 'Waitlist',
  invited: 'Invited',
  applicant: 'Applicant',
  customer: 'Customer',
  former_customer: 'Former customer',
}

/**
 * Marketing-contact search result item for the command palette — leads and
 * waitlisted people, distinct from (and listed after) full customers.
 */
export const ContactSearchResult: React.FC<ContactSearchResultProps> = ({ contact, onSelect }) => {
  return (
    <Command.Item
      className={styles.resultItem}
      value={`contact-${contact.contactId}`}
      onSelect={onSelect}
      data-testid={`contact-result-${contact.contactId}`}
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
          <path d="M3 11l18-8-8 18-2-8-8-2z" />
        </svg>
      </div>
      <div className={styles.resultContent}>
        <div className={styles.resultMain}>
          <span className={styles.resultName}>{contact.firstName || 'Unnamed contact'}</span>
          {contact.derivedStage && (
            <span className={styles.resultId}>
              {STAGE_LABELS[contact.derivedStage] ?? contact.derivedStage}
            </span>
          )}
        </div>
        <div className={styles.resultMeta}>
          <span className={styles.resultEmail}>
            {[contact.mobileE164, contact.email].filter(Boolean).join(' · ') || 'No contact details'}
          </span>
        </div>
      </div>
    </Command.Item>
  )
}
