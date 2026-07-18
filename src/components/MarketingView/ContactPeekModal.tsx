'use client'

import React from 'react'
import Link from 'next/link'
import { useMarketingContact } from '@/hooks/queries/useMarketingContact'
import { formatDateMedium } from '@/lib/formatters'
import { CHANNEL_LABELS, sourceLabel, stageLabel, summariseConsent } from '@/lib/marketing-labels'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface ContactPeekModalProps {
  contactId: string
  onClose: () => void
}

/**
 * Compact contact card opened from the feedback queue and the contacts grid —
 * enough context to triage without leaving the list (and losing your place),
 * with a link out to the full profile. Fixed-layout rows: every field is
 * always present, empty values render as an em dash.
 */
export const ContactPeekModal: React.FC<ContactPeekModalProps> = ({ contactId, onClose }) => {
  const { data, isLoading, isError } = useMarketingContact(contactId)
  const contact = data?.contact

  const consent = contact ? summariseConsent(contact.consent) : null
  const consentLabel =
    consent?.granted === true
      ? consent.channels
        ? `Granted — ${consent.channels.map((c) => CHANNEL_LABELS[c]).join(', ')}`
        : 'Granted'
      : consent?.granted === false
        ? 'Declined'
        : '—'

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Mobile', value: contact?.mobileE164 ?? '—' },
    { label: 'Email', value: contact?.email ?? '—' },
    {
      label: 'Stage',
      value: contact?.derivedStage ? (
        <span className={styles.badge}>{stageLabel(contact.derivedStage)}</span>
      ) : (
        '—'
      ),
    },
    { label: 'Source', value: contact?.source ? sourceLabel(contact.source) : '—' },
    { label: 'City', value: contact?.city ?? '—' },
    { label: 'Consent', value: consentLabel },
    { label: 'Customer', value: contact?.customerId ? 'Linked' : 'Not linked' },
    { label: 'Referral code', value: contact?.referralCode ?? '—' },
    { label: 'Updated', value: contact?.updatedAt ? formatDateMedium(contact.updatedAt) : '—' },
  ]

  return (
    <Modal
      title={isLoading ? 'Loading contact…' : (contact?.firstName ?? 'Unnamed contact')}
      onClose={onClose}
      footer={
        <>
          <Link
            href={`/admin/marketing/contacts/${encodeURIComponent(contactId)}`}
            className={styles.btnSubmit}
          >
            Open full profile →
          </Link>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
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
    </Modal>
  )
}

export default ContactPeekModal
