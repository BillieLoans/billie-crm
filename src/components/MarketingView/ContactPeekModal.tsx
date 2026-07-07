'use client'

import React from 'react'
import Link from 'next/link'
import { useMarketingContact } from '@/hooks/queries/useMarketingContact'
import { formatDateMedium } from '@/lib/formatters'
import { getMarketingConsentGranted } from '@/lib/marketing'
import styles from './styles.module.css'

interface ContactPeekModalProps {
  contactId: string
  onClose: () => void
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
 * Compact contact card opened from the feedback queue's Contact column —
 * enough context to triage without leaving the queue (and losing your place),
 * with a link out to the full profile. Fixed-layout rows: every field is
 * always present, empty values render as an em dash.
 */
export const ContactPeekModal: React.FC<ContactPeekModalProps> = ({ contactId, onClose }) => {
  const { data, isLoading, isError } = useMarketingContact(contactId)
  const contact = data?.contact

  const consentGranted = contact ? getMarketingConsentGranted(contact.consent) : null
  const consentLabel =
    consentGranted === true ? 'Granted' : consentGranted === false ? 'Declined' : '—'

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Mobile', value: contact?.mobileE164 ?? '—' },
    { label: 'Email', value: contact?.email ?? '—' },
    {
      label: 'Stage',
      value: contact?.derivedStage ? (
        <span className={styles.badge}>
          {STAGE_LABELS[contact.derivedStage] ?? contact.derivedStage}
        </span>
      ) : (
        '—'
      ),
    },
    { label: 'Source', value: contact?.source ?? '—' },
    { label: 'City', value: contact?.city ?? '—' },
    { label: 'Consent', value: consentLabel },
    { label: 'Customer', value: contact?.customerId ? 'Linked' : 'Not linked' },
    { label: 'Referral code', value: contact?.referralCode ?? '—' },
    { label: 'Updated', value: contact?.updatedAt ? formatDateMedium(contact.updatedAt) : '—' },
  ]

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {isLoading ? 'Loading contact…' : (contact?.firstName ?? 'Unnamed contact')}
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {isError ? (
            <div className={styles.errorMessage}>Failed to load the contact. Please retry.</div>
          ) : (
            <div className={styles.panelBody}>
              {rows.map((row) => (
                <div key={row.label} className={styles.panelRow}>
                  <span className={styles.panelRowLabel}>{row.label}</span>
                  <span className={styles.panelRowValue}>{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <Link
            href={`/admin/marketing/contacts/${encodeURIComponent(contactId)}`}
            className={styles.btnSubmit}
          >
            Open full profile →
          </Link>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default ContactPeekModal
