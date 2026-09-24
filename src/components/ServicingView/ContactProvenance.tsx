'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { formatDateOnly } from '@/lib/formatters'
import {
  alternateContacts,
  isContactTier,
  provenanceSummary,
  sourceSentence,
  statusLabel,
  tierDescription,
  tierLabel,
  type ContactRecord,
  type ContactType,
} from '@/lib/contact-provenance'
import styles from './styles.module.css'

/**
 * Contact provenance for the servicing view (BTB-392).
 *
 * - `TierBadge`: "Login" / "Verified" / "Unverified" beside a contact value,
 *   with its source and verification date available to hover and to screen
 *   readers (meaning never carried by colour alone).
 * - `AlsoSeen`: a disclosure listing the other values of that type the
 *   survivorship policy declined to promote.
 * - `IdStatusChip`: Provisional / Admitted / Linked → canonical.
 *
 * Legacy rows (no tier, no contacts) render nothing — the view looks exactly
 * as it did before the platform spoke for the customer.
 */

function safeDate(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return formatDateOnly(value)
  } catch {
    return null
  }
}

export interface TierBadgeProps {
  tier?: string | null
  source?: string | null
  verifiedAt?: string | null
  /** Which contact the badge describes, for the accessible name. */
  contactLabel: 'Email' | 'Mobile'
}

export function TierBadge({ tier, source, verifiedAt, contactLabel }: TierBadgeProps) {
  if (!tier) return null
  const label = tierLabel(tier)
  const summary = provenanceSummary({ tier, source, verifiedAtFormatted: safeDate(verifiedAt) })
  const meaning = tierDescription(tier)
  const toneClass = isContactTier(tier)
    ? styles[`tier${tier.charAt(0)}${tier.slice(1).toLowerCase()}`]
    : ''
  return (
    <span
      className={`${styles.tierBadge} ${toneClass ?? ''}`}
      title={meaning ? `${summary} — ${meaning}` : summary}
      data-testid={`tier-badge-${contactLabel.toLowerCase()}`}
    >
      {label}
      <span className={styles.srOnly}>
        {` (${contactLabel} ${summary}${meaning ? `: ${meaning}` : ''})`}
      </span>
    </span>
  )
}

export interface AlsoSeenProps {
  contacts?: ContactRecord[] | null
  type: ContactType
  /** The customer whose page this is — alternates from other ids say so. */
  customerId: string
}

export function AlsoSeen({ contacts, type, customerId }: AlsoSeenProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const alternates = alternateContacts(contacts, type)
  if (alternates.length === 0) return null
  const noun = type === 'EMAIL' ? 'email address' : 'mobile number'
  return (
    <div className={styles.alsoSeen} data-testid={`also-seen-${type.toLowerCase()}`}>
      <button
        type="button"
        className={styles.alsoSeenToggle}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        Also seen ({alternates.length})
        <span className={styles.srOnly}>
          {` other ${noun}${alternates.length === 1 ? '' : 'es'} for this customer`}
        </span>
      </button>
      {open && (
        <ul id={panelId} className={styles.alsoSeenList}>
          {alternates.map((c) => {
            const seen = safeDate(c.last_seen_at)
            const meta = [
              tierLabel(c.tier),
              sourceSentence(c.source),
              seen ? `last seen ${seen}` : null,
              c.origin_customer_id && c.origin_customer_id !== customerId
                ? `under ${c.origin_customer_id}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <li key={`${c.value}-${c.origin_customer_id ?? ''}`} className={styles.alsoSeenItem}>
                <span>{c.value}</span>
                {meta && <span className={styles.alsoSeenMeta}> — {meta}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export interface IdStatusChipProps {
  customerId: string
  customerIdStatus?: string | null
  canonicalId?: string | null
}

export function IdStatusChip({ customerId, customerIdStatus, canonicalId }: IdStatusChipProps) {
  if (!customerIdStatus) return null
  const label = statusLabel(customerIdStatus)
  const linkedElsewhere = Boolean(canonicalId) && canonicalId !== customerId
  return (
    <span className={styles.statusChip} data-testid="customer-id-status">
      {label}
      {linkedElsewhere && (
        <>
          {' → '}
          <Link href={`/admin/servicing/${encodeURIComponent(canonicalId as string)}`}>
            {canonicalId}
          </Link>
        </>
      )}
    </span>
  )
}

export interface ProvenanceFooterProps {
  changedBy?: string | null
  changedAt?: string | null
}

export function ProvenanceFooter({ changedBy, changedAt }: ProvenanceFooterProps) {
  if (!changedBy && !changedAt) return null
  const when = safeDate(changedAt)
  return (
    <p className={styles.provenanceFooter} data-testid="provenance-footer">
      Contact details updated{changedBy ? ` by ${changedBy}` : ''}
      {when ? ` on ${when}` : ''}.
    </p>
  )
}
