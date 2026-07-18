'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import {
  checkContactMatch,
  useCreateContact,
  type ContactMatch,
  type CreateContactVars,
} from '@/hooks/mutations/useMarketingCommands'
import { normaliseAuMobile } from '@/lib/marketing'
import { Modal } from './Modal'
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
  { value: 'word_of_mouth', label: 'Word of mouth' },
  { value: 'organic', label: 'Organic' },
  { value: 'other', label: 'Other' },
]

/**
 * Staff-initiated contact creation. Posts to MarketingService.UpsertContact via
 * /api/marketing/contacts (waitlist:false) — the contact is created in the
 * marketing system of record and projects back into the grid. Mobile or email
 * is required (the natural key); everything else is optional.
 *
 * Warn-and-confirm: UpsertContact resolves identity by natural key, so a
 * mobile/email that matches an existing contact would silently UPDATE that
 * record (including renaming it). Submit therefore pre-checks the natural
 * keys and, on a match, requires a second, explicit "Update existing
 * contact" submission. Editing either key clears the pending confirmation.
 */
export const NewContactModal: React.FC<NewContactModalProps> = ({ onClose, onSuccess }) => {
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [source, setSource] = useState('other')
  const [channelPreference, setChannelPreference] = useState('')
  const [city, setCity] = useState('')
  const [postcode, setPostcode] = useState('')

  const [match, setMatch] = useState<ContactMatch | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  const create = useCreateContact()
  const canSubmit = (!!mobile.trim() || !!email.trim()) && !create.isPending && !checking

  // Live E.164 preview — the same normalisation the platform applies, so what
  // the staff member sees is exactly what will be stored.
  const normalisedMobile = mobile.trim() ? normaliseAuMobile(mobile) : null
  const mobileLooksInvalid = !!mobile.trim() && !normalisedMobile

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    // First pass: duplicate pre-check. A match switches the modal into
    // confirm mode; only the second submit actually posts. Fail closed —
    // if we can't verify, we must not risk silently renaming someone.
    if (!match) {
      setChecking(true)
      setCheckError(null)
      let found: ContactMatch | null = null
      try {
        found = await checkContactMatch({
          mobile: mobile.trim() || undefined,
          email: email.trim() || undefined,
        })
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : 'Duplicate check failed. Please retry.')
        return
      } finally {
        setChecking(false)
      }
      if (found) {
        setMatch(found)
        return
      }
    }

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

  // Editing a natural key invalidates a pending confirmation.
  const handleMobileChange = (value: string) => {
    setMobile(value)
    setMatch(null)
  }
  const handleEmailChange = (value: string) => {
    setEmail(value)
    setMatch(null)
  }

  return (
    <Modal title="New contact" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {create.isError && (
            <div className={styles.errorMessage}>
              {create.error instanceof Error ? create.error.message : 'Failed to create contact'}
            </div>
          )}
          {checkError && <div className={styles.errorMessage}>{checkError}</div>}
          {match && (
            <div className={styles.warningMessage} data-testid="duplicate-warning">
              This {match.matchedOn} already belongs to{' '}
              <strong>{match.firstName ?? 'an unnamed contact'}</strong>
              {match.derivedStage ? ` (${match.derivedStage})` : ''}. Saving will{' '}
              <strong>update that contact</strong> — it will not create a new person.{' '}
              <Link
                href={`/admin/marketing/contacts/${match.contactId}`}
                className={styles.nameLink}
              >
                View contact
              </Link>
            </div>
          )}

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="new-contact-first-name">
              First name
            </label>
            <input
              id="new-contact-first-name"
              autoFocus
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
              onChange={(e) => handleMobileChange(e.target.value)}
              placeholder="04xx xxx xxx or +614xx xxx xxx"
            />
            {mobileLooksInvalid ? (
              <p className={styles.formHint} style={{ color: 'var(--theme-error-600, #dc2626)' }}>
                That doesn&apos;t look like an Australian mobile — double-check the number.
              </p>
            ) : normalisedMobile && normalisedMobile !== mobile.trim() ? (
              <p className={styles.formHint}>Will be saved as {normalisedMobile}.</p>
            ) : (
              <p className={styles.formHint}>Mobile or email is required.</p>
            )}
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
              onChange={(e) => handleEmailChange(e.target.value)}
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
              Preferred message channel
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
            <p className={styles.formHint}>
              Which channel outbound messages should use. Email consent is a separate,
              per-channel record — capture it via “Record consent” on the contact.
            </p>
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
            {checking
              ? 'Checking…'
              : create.isPending
                ? 'Saving…'
                : match
                  ? 'Update existing contact'
                  : 'Create contact'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default NewContactModal
