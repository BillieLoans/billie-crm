'use client'

import React from 'react'
import { Modal } from '@/components/ui/Modal'
import type { ScreeningListing } from '@/lib/identityVerification'
import styles from './IdentityVerificationDetail.module.css'

export interface ScreeningListingModalProps {
  /** "PEP" or "Sanctions" — prefixes the dialog title. */
  category: string
  /** The attribute the provider matched on, e.g. "name". */
  matchedOn?: string | null
  /** The customer-side term that produced the match, e.g. "SMITH JOHN". */
  matchedTerm?: string | null
  listing: ScreeningListing
  onClose: () => void
}

/** `otherInformation` → "Other information", `originalID` → "Original ID". */
export function humaniseKey(key: string): string {
  const words = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    // Keep acronyms (ID, DOB) as sent; everything else reads as prose.
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
  const joined = words.join(' ')
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className={styles.listingLabel}>{label}</dt>
      <dd className={styles.listingValue}>{value}</dd>
    </>
  )
}

/**
 * Full detail for one watchlist listing behind a PEP / sanctions hit. The
 * inline panel is ~400px wide, which is where the seven-column table and the
 * nested attribute map used to collapse into one-character-per-line columns.
 * Everything long-form lives here in a label / value list that wraps.
 */
export const ScreeningListingModal: React.FC<ScreeningListingModalProps> = ({
  category,
  matchedOn,
  matchedTerm,
  listing,
  onClose,
}) => {
  const attributes = Object.entries(listing.attributes ?? {})
  const refVersion = listing.reference
    ? `${listing.reference}${listing.version ? ` / ${listing.version}` : ''}`
    : (listing.version ?? '—')

  return (
    <Modal
      title={`${category} match: ${listing.name ?? 'Unnamed listing'}`}
      onClose={onClose}
      maxWidth="720px"
      testId="screening-listing-modal"
    >
      <div className={styles.listingBody}>
        <p className={styles.listingMatchedOn}>
          Matched on {matchedOn ?? '—'}:{' '}
          <span className={styles.matchTerm}>{matchedTerm ?? '—'}</span>
        </p>

        <dl className={styles.listingList}>
          <Row label="Listed name" value={listing.name ?? '—'} />
          <Row label="Title" value={listing.title ?? '—'} />
          <Row label="List" value={listing.source ?? '—'} />
          <Row label="Country" value={listing.countryName ?? listing.country ?? '—'} />
          <Row label="Listed" value={listing.listedDate ?? '—'} />
          <Row label="Updated" value={listing.lastUpdated ?? '—'} />
          <Row label="Ref / version" value={refVersion} />
        </dl>

        {attributes.length > 0 && (
          <section aria-labelledby="screening-listing-attributes">
            <h3 id="screening-listing-attributes" className={styles.subTitle}>
              Attributes
            </h3>
            <dl className={styles.listingList}>
              {attributes.map(([key, value]) => (
                <Row
                  key={key}
                  label={humaniseKey(key)}
                  value={typeof value === 'string' ? value : JSON.stringify(value)}
                />
              ))}
            </dl>
          </section>
        )}
      </div>
    </Modal>
  )
}
