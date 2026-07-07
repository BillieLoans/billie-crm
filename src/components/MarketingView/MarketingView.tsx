'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMarketingContacts } from '@/hooks/queries/useMarketingContacts'
import type { MarketingContactsFilters } from '@/hooks/queries/useMarketingContacts'
import { useBatches } from '@/hooks/queries/useBatches'
import { useAssignBatch } from '@/hooks/mutations/useMarketingCommands'
import type { Contact } from '@/payload-types'
import { formatDateShort } from '@/lib/formatters'
import { getMarketingConsentGranted } from '@/lib/marketing'
import { ContactDetail } from './ContactDetail'
import { FeedbackQueueView } from './FeedbackQueueView'
import { NewContactModal } from './NewContactModal'
import styles from './styles.module.css'

export interface MarketingViewProps {
  contactId: string
  feedback?: boolean
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
export const MarketingView: React.FC<MarketingViewProps> = ({ contactId, feedback }) => {
  if (feedback) {
    return <FeedbackQueueView />
  }
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
  const [batch, setBatch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTarget, setAssignTarget] = useState('')
  const [showNewContact, setShowNewContact] = useState(false)

  const filters = useMemo<MarketingContactsFilters>(
    () => ({
      q: q || undefined,
      stage: stage || undefined,
      source: source || undefined,
      city: city || undefined,
      batch: batch || undefined,
      page,
    }),
    [q, stage, source, city, batch, page],
  )

  const { data, isLoading, isError } = useMarketingContacts(filters)
  const { data: batchesData } = useBatches()
  const assign = useAssignBatch()
  const docs = data?.docs ?? []
  const batchOptions = batchesData?.docs ?? []
  const batchNameFor = (id?: string | null) =>
    id ? (batchOptions.find((b) => b.batchId === id)?.name ?? id) : '—'

  const onFilter =
    (setter: (v: string) => void) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setter(e.target.value)
      setPage(1)
    }

  const toggleOne = (contactId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })

  const pageContactIds = docs.map((d) => d.contactId).filter((v): v is string => !!v)
  const allOnPageSelected =
    pageContactIds.length > 0 && pageContactIds.every((id) => selected.has(id))
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) pageContactIds.forEach((id) => next.delete(id))
      else pageContactIds.forEach((id) => next.add(id))
      return next
    })

  const canAssign = selected.size > 0 && !!assignTarget && !assign.isPending
  const handleAssign = () => {
    if (!canAssign) return
    assign.mutate(
      { batchId: assignTarget, contactIds: Array.from(selected) },
      {
        onSuccess: () => {
          setSelected(new Set())
          setAssignTarget('')
        },
      },
    )
  }

  const contactHref = (contact: Contact) => `/admin/marketing/contacts/${contact.contactId}`

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Marketing</h1>
        <button type="button" className={styles.pageButton} onClick={() => setShowNewContact(true)}>
          + New contact
        </button>
        <Link href="/admin/marketing/feedback" className={styles.backLink}>
          Feedback queue →
        </Link>
      </div>

      <div className={styles.filters}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search name, email, mobile"
          value={q}
          onChange={onFilter(setQ)}
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
            onChange={onFilter(setStage)}
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
            onChange={onFilter(setSource)}
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
            onChange={onFilter(setCity)}
          >
            <option value="">All cities</option>
            {CITY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-batch-filter">
            Batch
          </label>
          <select
            id="marketing-batch-filter"
            className={styles.filterSelect}
            value={batch}
            onChange={onFilter(setBatch)}
          >
            <option value="">All batches</option>
            {batchOptions.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {b.name ?? b.batchId}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Assign-to-batch bar — always present (fixed layout); controls disable
          until a selection + target batch exist. */}
      <div className={styles.filters}>
        <span className={styles.pageStatus}>{selected.size} selected</span>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-assign-batch">
            Assign to batch
          </label>
          <select
            id="marketing-assign-batch"
            className={styles.filterSelect}
            value={assignTarget}
            onChange={(e) => setAssignTarget(e.target.value)}
            disabled={selected.size === 0}
          >
            <option value="">Choose a batch…</option>
            {batchOptions.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {b.name ?? b.batchId}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={styles.pageButton}
          onClick={handleAssign}
          disabled={!canAssign}
        >
          {assign.isPending ? 'Assigning…' : 'Assign'}
        </button>
      </div>

      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load contacts. Please retry.</div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      aria-label="Select all on page"
                    />
                  </th>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Stage</th>
                  <th>Source</th>
                  <th>Batch</th>
                  <th>Consent</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      Loading contacts…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
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
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={contact.contactId ? selected.has(contact.contactId) : false}
                          onChange={() => contact.contactId && toggleOne(contact.contactId)}
                          aria-label={`Select ${contact.firstName ?? contact.contactId}`}
                        />
                      </td>
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
                      <td>{batchNameFor(contact.batchId)}</td>
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
                Page {data?.page ?? page} of {data?.totalPages ?? 1} · {data?.totalDocs ?? 0}{' '}
                contacts
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

      {showNewContact && (
        <NewContactModal
          onClose={() => setShowNewContact(false)}
          onSuccess={() => setShowNewContact(false)}
        />
      )}
    </div>
  )
}

// Default export for Payload import map
export default MarketingView
