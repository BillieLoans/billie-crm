'use client'

import React, { useState } from 'react'
import { useRecordConsent } from '@/hooks/mutations/useMarketingCommands'
import { CHANNEL_LABELS } from '@/lib/marketing-labels'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface RecordConsentModalProps {
  contactId: string
  contactName: string
  onClose: () => void
}

const CHANNELS: Array<'sms' | 'whatsapp' | 'email'> = ['sms', 'whatsapp', 'email']

/**
 * Common capture methods, offered as a picker so the consent trail uses
 * consistent vocabulary in exports; "Other…" reveals a free-text field.
 */
const METHOD_OPTIONS = [
  'Campus stall form',
  'Phone call',
  'Email request',
  'Web form',
  'In-person conversation',
]
const OTHER_METHOD = '__other__'

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
  const [methodChoice, setMethodChoice] = useState('')
  const [methodOther, setMethodOther] = useState('')
  const [evidence, setEvidence] = useState('')

  const consent = useRecordConsent()
  const method = methodChoice === OTHER_METHOD ? methodOther : methodChoice
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
    <Modal title={`Record consent — ${contactName}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {consent.isError && (
            <div className={styles.errorMessage}>
              {consent.error instanceof Error ? consent.error.message : 'Failed to record consent'}
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
                  {CHANNEL_LABELS[channel]}
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
            <select
              id="consent-method"
              autoFocus
              className={styles.formSelect}
              value={methodChoice}
              onChange={(e) => setMethodChoice(e.target.value)}
            >
              <option value="">Choose a method…</option>
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={OTHER_METHOD}>Other…</option>
            </select>
            {methodChoice === OTHER_METHOD && (
              <input
                type="text"
                className={styles.formInput}
                style={{ marginTop: '0.375rem' }}
                value={methodOther}
                onChange={(e) => setMethodOther(e.target.value)}
                placeholder="Describe how consent was captured"
                maxLength={50}
                aria-label="Other capture method"
              />
            )}
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
    </Modal>
  )
}

export default RecordConsentModal
