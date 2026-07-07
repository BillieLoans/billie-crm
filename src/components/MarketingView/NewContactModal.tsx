'use client'

import React, { useState } from 'react'
import { useCreateContact, type CreateContactVars } from '@/hooks/mutations/useMarketingCommands'
import styles from './styles.module.css'

interface NewContactModalProps {
  onClose: () => void
  onSuccess: () => void
}

const SOURCE_OPTIONS = [
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' },
  { value: 'campus', label: 'Campus' },
  { value: 'referral', label: 'Referral' },
  { value: 'social_dm', label: 'Social DM' },
  { value: 'ai_search', label: 'AI search' },
  { value: 'organic', label: 'Organic' },
  { value: 'other', label: 'Other' },
]

/**
 * Staff-initiated contact creation. Posts to MarketingService.UpsertContact via
 * /api/marketing/contacts (waitlist:false) — the contact is created in the
 * marketing system of record and projects back into the grid. Mobile or email
 * is required (the natural key); everything else is optional.
 */
export const NewContactModal: React.FC<NewContactModalProps> = ({ onClose, onSuccess }) => {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [source, setSource] = useState('other')
  const [channelPreference, setChannelPreference] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')

  const create = useCreateContact()
  const canSubmit = (!!mobile.trim() || !!email.trim()) && !create.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const vars: CreateContactVars = { source }
    if (firstName.trim()) vars.first_name = firstName.trim()
    if (email.trim()) vars.email = email.trim()
    if (mobile.trim()) vars.mobile = mobile.trim()
    if (city.trim()) vars.city = city.trim()
    if (postcode.trim()) vars.postcode = postcode.trim()
    if (channelPreference === 'whatsapp' || channelPreference === 'sms') {
      vars.channel_preference = channelPreference
    }

    create.mutate(vars, { onSuccess: () => onSuccess() })
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>New contact</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {create.isError && (
              <div className={styles.errorMessage}>
                {create.error instanceof Error ? create.error.message : 'Failed to create contact'}
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-contact-first-name">
                First name
              </label>
              <input
                id="new-contact-first-name"
                type="text"
                className={styles.formInput}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-contact-mobile">
                Mobile
              </label>
              <input
                id="new-contact-mobile"
                type="tel"
                className={styles.formInput}
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="+61…"
              />
              <p className={styles.formHint}>Mobile or email is required.</p>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-contact-email">
                Email
              </label>
              <input
                id="new-contact-email"
                type="email"
                className={styles.formInput}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-contact-source">
                Source
              </label>
              <select
                id="new-contact-source"
                className={styles.formSelect}
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-contact-channel">
                Channel preference
              </label>
              <select
                id="new-contact-channel"
                className={styles.formSelect}
                value={channelPreference}
                onChange={(e) => setChannelPreference(e.target.value)}
              >
                <option value="">—</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-contact-city">
                City
              </label>
              <input
                id="new-contact-city"
                type="text"
                className={styles.formInput}
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="new-contact-postcode">
                Postcode
              </label>
              <input
                id="new-contact-postcode"
                type="text"
                className={styles.formInput}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnSubmit} disabled={!canSubmit}>
              {create.isPending ? 'Creating…' : 'Create contact'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default NewContactModal
