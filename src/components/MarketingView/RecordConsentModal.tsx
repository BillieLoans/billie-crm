'use client'

import React, { useState } from 'react'
import { useRecordConsent } from '@/hooks/mutations/useMarketingCommands'
import { useEscapeClose } from '@/hooks/useModalA11y'
import styles from './styles.module.css'

interface RecordConsentModalProps {
  contactId: string
  contactName: string
  onClose: () => void
}

const CHANNELS: Array<'sms' | 'whatsapp' | 'email'> = ['sms', 'whatsapp', 'email']

/**
 * Staff consent capture — the follow-up step for offline-created contacts
 * (campus stalls, referrals taken verbally) and for recording verbal
 * opt-outs. Posts SetConsent with method + evidence so the consent trail
 * satisfies the Spam Act record-keeping posture; the dispatcher's fail-closed
 * opt-in gate reads the result.
 */
export const RecordConsentModal: React.FC<RecordConsentModalProps> = ({
  contactId,
  contactName,
  onClose,
}) => {
  const [granted, setGranted] = useState(true)
  const [channels, setChannels] = useState<Array<'sms' | 'whatsapp' | 'email'>>(['sms'])
  const [method, setMethod] = useState('')
  const [evidence, setEvidence] = useState('')

  const consent = useRecordConsent()
  useEscapeClose(onClose)
  const canSubmit = !!method.trim() && (granted ? channels.length > 0 : true) && !consent.isPending

  const toggleChannel = (channel: 'sms' | 'whatsapp' | 'email') =>
    setChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    )

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    consent.mutate(
      {
        contactId,
        granted,
        channels: granted ? channels : CHANNELS,
        method: method.trim(),
        evidence: evidence.trim() || undefined,
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Record consent — {contactName}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {consent.isError && (
              <div className={styles.errorMessage}>
                {consent.error instanceof Error
                  ? consent.error.message
                  : 'Failed to record consent'}
              </div>
            )}

            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Decision</span>
              <div className={styles.panelButtonRow}>
                <label className={styles.formHint}>
                  <input
                    type="radio"
                    name="consent-decision"
                    checked={granted}
                    onChange={() => setGranted(true)}
                  />{' '}
                  Granted
                </label>
                <label className={styles.formHint}>
                  <input
                    type="radio"
                    name="consent-decision"
                    checked={!granted}
                    onChange={() => setGranted(false)}
                  />{' '}
                  Withdrawn
                </label>
              </div>
            </div>

            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Channels</span>
              <div className={styles.panelButtonRow}>
                {CHANNELS.map((channel) => (
                  <label key={channel} className={styles.formHint}>
                    <input
                      type="checkbox"
                      checked={granted ? channels.includes(channel) : true}
                      disabled={!granted}
                      onChange={() => toggleChannel(channel)}
                    />{' '}
                    {channel}
                  </label>
                ))}
              </div>
              {!granted && (
                <p className={styles.formHint}>Withdrawal always applies to every channel.</p>
              )}
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="consent-method">
                How was it captured?
              </label>
              <input
                id="consent-method"
                autoFocus
                type="text"
                className={styles.formInput}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder="e.g. campus stall form, phone call, email request"
                maxLength={50}
              />
              <p className={styles.formHint}>Required — recorded on the consent trail.</p>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="consent-evidence">
                Evidence (optional)
              </label>
              <textarea
                id="consent-evidence"
                className={styles.noteTextarea}
                rows={2}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="e.g. paper form ref, quote of the request"
                maxLength={500}
              />
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.btnSubmit}
              disabled={!canSubmit}
              title={!method.trim() ? 'Describe how consent was captured' : undefined}
            >
              {consent.isPending ? 'Saving…' : granted ? 'Record consent' : 'Record withdrawal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default RecordConsentModal
