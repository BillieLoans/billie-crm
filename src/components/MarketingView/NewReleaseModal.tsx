'use client'

import React, { useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { useCreateRelease, useReleasePreflight } from '@/hooks'
import type { CreateReleaseCommand } from '@/lib/schemas/releases'
import type { ReleasePreflightResult } from '@/hooks'
import { Modal } from './Modal'
import styles from './styles.module.css'

interface NewReleaseModalProps {
  onClose: () => void
  onSuccess: (releaseId: string) => void
}

type ReleaseTypeChoice = 'waitlist' | 'phone_list' | 'open_quota'

/**
 * Two-step release flow: define the audience, then confirm the exact
 * partition before anything is published. "The numbers ARE the decision" —
 * if the preflight partition might be an incomplete slice of the population
 * (`truncated`), staff must not release from it: the warning below is not
 * decorative, and the release button is disabled until a fresh, complete
 * preflight is available.
 */
export const NewReleaseModal: React.FC<NewReleaseModalProps> = ({ onClose, onSuccess }) => {
  const releaseId = useMemo(() => `rel_${nanoid(12)}`, [])
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [type, setType] = useState<ReleaseTypeChoice>('waitlist')
  const [count, setCount] = useState('')
  const [mobilesRaw, setMobilesRaw] = useState('')
  const [expiryDays, setExpiryDays] = useState('14')
  const [sendInviteSms, setSendInviteSms] = useState(false)
  const [partition, setPartition] = useState<ReleasePreflightResult | null>(null)

  const preflight = useReleasePreflight()
  const create = useCreateRelease()

  const command = (): CreateReleaseCommand => ({
    releaseId,
    name: name.trim(),
    type,
    count: type === 'phone_list' ? undefined : Number(count),
    mobiles:
      type === 'phone_list'
        ? mobilesRaw
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
        : undefined,
    expiryDays: Number(expiryDays) || 14,
    sendInviteSms: type === 'open_quota' ? false : sendInviteSms,
  })

  const canContinue =
    !!name.trim() &&
    (type === 'phone_list' ? mobilesRaw.trim().length > 0 : Number(count) >= 1) &&
    !preflight.isPending

  const handleContinue = () => {
    if (!canContinue) return
    preflight.mutate(command(), {
      onSuccess: (data) => {
        setPartition(data)
        setStep(2)
      },
    })
  }

  const grantedTotal = partition
    ? partition.counts.granted_sms + partition.counts.granted_no_sms
    : 0
  const isTruncated = !!partition?.truncated

  const handleRelease = () => {
    if (create.isPending || isTruncated) return
    create.mutate(command(), { onSuccess: (res) => onSuccess(res.releaseId) })
  }

  return (
    <Modal
      title={step === 1 ? 'New release — define' : 'New release — preflight & confirm'}
      onClose={onClose}
      wide
    >
      {step === 1 ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleContinue()
          }}
        >
          <div className={styles.modalBody}>
            {preflight.isError && (
              <div className={styles.errorMessage}>Could not compute the preflight. Try again.</div>
            )}
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="rel-name">
                Name
              </label>
              <input
                id="rel-name"
                autoFocus
                className={styles.formInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. August wave 3"
              />
            </div>
            <div className={styles.formGroup}>
              <span className={styles.formLabel}>Type</span>
              <div role="radiogroup" style={{ display: 'flex', gap: '0.5rem' }}>
                {(
                  [
                    ['waitlist', 'Waitlist'],
                    ['phone_list', 'Phone list'],
                    ['open_quota', 'Open quota'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={type === value}
                    className={type === value ? styles.btnSubmit : styles.btnCancel}
                    onClick={() => setType(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {type === 'phone_list' ? (
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="rel-mobiles">
                  Mobile numbers (one per line)
                </label>
                <textarea
                  id="rel-mobiles"
                  className={styles.formInput}
                  rows={6}
                  value={mobilesRaw}
                  onChange={(e) => setMobilesRaw(e.target.value)}
                  placeholder={'0400 000 001\n0400 000 002'}
                />
              </div>
            ) : (
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="rel-count">
                  Count
                </label>
                <input
                  id="rel-count"
                  type="number"
                  min={1}
                  className={styles.formInput}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </div>
            )}
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="rel-expiry">
                Grant validity (days)
              </label>
              <input
                id="rel-expiry"
                type="number"
                min={1}
                max={90}
                className={styles.formInput}
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="rel-sms">
                <input
                  id="rel-sms"
                  type="checkbox"
                  checked={type !== 'open_quota' && sendInviteSms}
                  disabled={type === 'open_quota'}
                  onChange={(e) => setSendInviteSms(e.target.checked)}
                />{' '}
                Send invite SMS
              </label>
              <p className={styles.formHint}>
                Only contacts with marketing consent receive the SMS — the preflight shows who is
                excluded. Not available for open quota (no known recipients).
              </p>
            </div>
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnSubmit} disabled={!canContinue}>
              {preflight.isPending ? 'Checking…' : 'Continue → preflight'}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div className={styles.modalBody}>
            {partition && (
              <>
                <div className={styles.preflightRow}>
                  <span>Will be granted and receive the invite SMS</span>
                  <span className={`${styles.preflightValue} ${styles.preflightHighlight}`}>
                    {partition.counts.granted_sms.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Granted, no SMS (no marketing consent)</span>
                  <span className={styles.preflightValue}>
                    {partition.counts.granted_no_sms.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — already a customer</span>
                  <span className={styles.preflightValue}>
                    {partition.counts.skipped_already_customer.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — already in an active release</span>
                  <span className={styles.preflightValue}>
                    {partition.counts.skipped_already_released.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — needs review</span>
                  <span className={styles.preflightValue}>
                    {partition.counts.skipped_needs_review.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — invalid number</span>
                  <span className={styles.preflightValue}>
                    {partition.counts.skipped_invalid_number.toLocaleString('en-AU')}
                  </span>
                </div>
                {grantedTotal === 0 && (
                  <div className={styles.warningMessage} style={{ marginTop: '0.75rem' }}>
                    Nobody would be granted by this release.
                  </div>
                )}
                {isTruncated && (
                  <div className={styles.warningMessage} style={{ marginTop: '0.75rem' }}>
                    Numbers may be incomplete — audience data was truncated; do not release from
                    this preflight.
                  </div>
                )}
                <p className={styles.formHint}>
                  Ready to publish {grantedTotal.toLocaleString('en-AU')} grants?
                  {command().sendInviteSms
                    ? ` This sends ${partition.counts.granted_sms.toLocaleString('en-AU')} SMS immediately.`
                    : ' No SMS will be sent.'}
                </p>
              </>
            )}
            {create.isError && (
              <div className={styles.errorMessage}>
                {create.error instanceof Error ? create.error.message : 'Failed to publish release'}
              </div>
            )}
          </div>
          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={() => setStep(1)}>
              ← Back
            </button>
            <button
              type="button"
              className={styles.btnSubmit}
              onClick={handleRelease}
              disabled={
                create.isPending || (grantedTotal === 0 && type !== 'open_quota') || isTruncated
              }
            >
              {create.isPending
                ? 'Releasing…'
                : `Release ${grantedTotal ? `${grantedTotal} grants` : 'now'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default NewReleaseModal
