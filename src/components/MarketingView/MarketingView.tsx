'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMarketingContacts } from '@/hooks/queries/useMarketingContacts'
import type { MarketingContactsFilters } from '@/hooks/queries/useMarketingContacts'
import type { Contact } from '@/payload-types'
import { formatDateShort } from '@/lib/formatters'
import { getMarketingConsentGranted } from '@/lib/marketing'
import { ContactDetail } from './ContactDetail'
import styles from './styles.module.css'

export interface MarketingViewProps {
  contactId: string
}

const STAGE_OPTIONS: Array<{ value: Contact['derivedStage'] & string; label: string }> = [
  { value: 'lead', label: 'Lead' },
  { value: 'waitlist', label: 'Waitlist' },
  { value: 'invited', label: 'Invited' },
  { value: 'applicant', label: 'Applicant' },
  { value: 'customer', label: 'Customer' },
  { value: 'former_customer', label: 'Former customer' },
]

const SOURCE_OPTIONS: Array<{ value: Contact['source'] & string; label: string }> = [
  { value: 'meta', label: 'Meta' },
  { value: 'google', label: 'Google' },
  { value: 'campus', label: 'Campus' },
  { value: 'referral', label: 'Referral' },
  { value: 'social_dm', label: 'Social DM' },
  { value: 'ai_search', label: 'AI search' },
  { value: 'organic', label: 'Organic' },
  { value: 'other', label: 'Other' },
]

// Free-text on the backend (a `like` filter) — this is a curated shortlist of
// the cities marketing campaigns currently target, not an exhaustive enum.
const CITY_OPTIONS = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra']

function stageLabel(stage: Contact['derivedStage']): string {
  return STAGE_OPTIONS.find((o) => o.value === stage)?.label ?? stage ?? '—'
}

function sourceLabel(source: Contact['source']): string {
  return SOURCE_OPTIONS.find((o) => o.value === source)?.label ?? source ?? '—'
}

function ConsentBadge({ consent }: { consent: Contact['consent'] }) {
  const granted = getMarketingConsentGranted(consent)
  if (granted === true) {
    return <span className={`${styles.badge} ${styles.badgeConsentGranted}`}>Granted</span>
  }
  if (granted === false) {
    return <span className={`${styles.badge} ${styles.badgeConsentDeclined}`}>Declined</span>
  }
  return <span className={styles.placeholder}>—</span>
}

/**
 * MarketingView — Task C6 admin view.
 *
 * Renders the contact grid at `/admin/marketing`, or the contact-detail
 * timeline at `/admin/marketing/contacts/<contactId>` when a contactId is
 * supplied by the WithTemplate wrapper.
 */
export const MarketingView: React.FC<MarketingViewProps> = ({ contactId }) => {
  if (contactId) {
    return <ContactDetail contactId={contactId} />
  }
  return <MarketingContactsGrid />
}

const MarketingContactsGrid: React.FC = () => {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('')
  const [source, setSource] = useState('')
  const [city, setCity] = useState('')
  const [page, setPage] = useState(1)

  const filters = useMemo<MarketingContactsFilters>(
    () => ({
      q: q || undefined,
      stage: stage || undefined,
      source: source || undefined,
      city: city || undefined,
      page,
    }),
    [q, stage, source, city, page],
  )

  const { data, isLoading, isError } = useMarketingContacts(filters)
  const docs = data?.docs ?? []

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQ(e.target.value)
    setPage(1)
  }

  const handleStageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStage(e.target.value)
    setPage(1)
  }

  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSource(e.target.value)
    setPage(1)
  }

  const handleCityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCity(e.target.value)
    setPage(1)
  }

  const contactHref = (contact: Contact) => `/admin/marketing/contacts/${contact.contactId}`

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Marketing</h1>
      </div>

      <div className={styles.filters}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search name, email, mobile"
          value={q}
          onChange={handleSearchChange}
          aria-label="Search contacts"
        />

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-stage-filter">
            Stage
          </label>
          <select
            id="marketing-stage-filter"
            className={styles.filterSelect}
            value={stage}
            onChange={handleStageChange}
          >
            <option value="">All stages</option>
            {STAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-source-filter">
            Source
          </label>
          <select
            id="marketing-source-filter"
            className={styles.filterSelect}
            value={source}
            onChange={handleSourceChange}
          >
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-city-filter">
            City
          </label>
          <select
            id="marketing-city-filter"
            className={styles.filterSelect}
            value={city}
            onChange={handleCityChange}
          >
            <option value="">All cities</option>
            {CITY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load contacts. Please retry.</div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Stage</th>
                  <th>Source</th>
                  <th>Consent</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      Loading contacts…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      No contacts match the current filters.
                    </td>
                  </tr>
                ) : (
                  docs.map((contact) => (
                    <tr
                      key={contact.id}
                      className={styles.row}
                      onClick={() => router.push(contactHref(contact))}
                    >
                      <td>
                        <Link
                          href={contactHref(contact)}
                          className={styles.nameLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {contact.firstName ?? '—'}
                        </Link>
                      </td>
                      <td>{contact.mobileE164 ?? '—'}</td>
                      <td>
                        {contact.derivedStage ? (
                          <span className={styles.badge}>{stageLabel(contact.derivedStage)}</span>
                        ) : (
                          <span className={styles.placeholder}>—</span>
                        )}
                      </td>
                      <td>{contact.source ? sourceLabel(contact.source) : '—'}</td>
                      <td>
                        <ConsentBadge consent={contact.consent} />
                      </td>
                      <td>{contact.updatedAt ? formatDateShort(contact.updatedAt) : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!data || !data.hasPrevPage}
              >
                ← Previous
              </button>
              <span className={styles.pageStatus}>
                Page {data?.page ?? page} of {data?.totalPages ?? 1} · {data?.totalDocs ?? 0} contacts
              </span>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => p + 1)}
                disabled={!data || !data.hasNextPage}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Default export for Payload import map
export default MarketingView
