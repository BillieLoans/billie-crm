'use client'

import { useCallback, useState } from 'react'
import { useAnnouncerStore } from '@/stores/announcer'
import {
  maskAccountNumber,
  recordDisbursementAccess,
  type DisbursementAccessField,
} from '@/lib/disbursement-access-log'
import styles from './PayoutField.module.css'

interface Props {
  label: string
  /** The real value. Copied in full even while visually masked. */
  value: string | null
  /** Which identifier this is, for the audit trail. */
  field: DisbursementAccessField
  loanAccountId: string
  accountNumber: string
  /**
   * Hide the value behind a reveal control (ux-standards §4 — full identifiers
   * are not rendered by default).
   */
  sensitive?: boolean
  /** Rendered in a monospace face so digits are easy to check against the bank. */
  mono?: boolean
}

/**
 * One labelled payout value with a copy control, and a reveal control when the
 * value is a full identifier.
 *
 * Copy works whether or not the value is revealed. That is the point: an operator
 * clearing a 50-loan day never needs to expose an account number on screen to pay
 * it, which is both faster and less exposed than reading digits across.
 */
export function PayoutField({
  label,
  value,
  field,
  loanAccountId,
  accountNumber,
  sensitive = false,
  mono = false,
}: Props) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const announce = useAnnouncerStore((s) => s.announce)

  const handleReveal = useCallback(() => {
    setRevealed(true)
    recordDisbursementAccess({ loanAccountId, accountNumber, action: 'reveal', field })
    announce(`${label} revealed`, 'polite')
  }, [announce, label, loanAccountId, accountNumber, field])

  const handleCopy = useCallback(async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      recordDisbursementAccess({ loanAccountId, accountNumber, action: 'copy', field })
      announce(`${label} copied`, 'polite')
    } catch (err) {
      console.error('Failed to copy:', err)
      // Errors that revert state use the assertive lane (ux-standards §1.2, SC 4.1.3).
      announce(`${label} could not be copied — copy it manually`, 'assertive')
    }
  }, [announce, label, value, loanAccountId, accountNumber, field])

  const isHidden = sensitive && !revealed
  const shown = value ? (isHidden ? maskAccountNumber(value) : value) : '—'

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <span className={styles.valueRow}>
        <span
          className={`${styles.value} ${mono ? styles.mono : ''} ${value ? '' : styles.missing}`}
          data-testid={`payout-value-${field}`}
        >
          {shown}
        </span>
        {value && isHidden && (
          <button type="button" className={styles.smallBtn} onClick={handleReveal}>
            Reveal
          </button>
        )}
        {value && (
          <button
            type="button"
            className={styles.smallBtn}
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
            data-testid={`payout-copy-${field}`}
          >
            {/* Non-colour cue for state (ux-standards §1.2, SC 1.4.1) */}
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        )}
      </span>
    </div>
  )
}
