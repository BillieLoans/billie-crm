'use client'

import React, { useDeferredValue, useMemo, useState } from 'react'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMarketingContacts } from '@/hooks/queries/useMarketingContacts'
import type { MarketingContactsFilters } from '@/hooks/queries/useMarketingContacts'
import { useBatches } from '@/hooks/queries/useBatches'
import {
  useAssignBatch,
  useMarketingCommandRetryListener,
  useTriggerInvitations,
} from '@/hooks/mutations/useMarketingCommands'
import type { Contact } from '@/payload-types'
import { formatDateShort } from '@/lib/formatters'
import { getMarketingConsentGranted } from '@/lib/marketing'
import { ContactDetail } from './ContactDetail'
import { FeedbackQueueView } from './FeedbackQueueView'
import { NewBatchModal } from './NewBatchModal'
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
  { value: 'word_of_mouth', label: 'Word of mouth' },
  { value: 'organic', label: 'Organic' },
  { value: 'other', label: 'Other' },
]

// Free-text on the backend (a `like` filter) — this is a curated shortlist of
// the cities marketing campaigns currently target, not an exhaustive enum.
const CITY_OPTIONS = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra']

// Sentinel value for the assign dropdown's "＋ New batch…" option — never a
// real batchId (batch ids are UUIDs minted by marketingService).
const NEW_BATCH_SENTINEL = '__new_batch__'

// Bounds for the post-create projection poll (see handleBatchCreated).
const BATCH_POLL_MAX_ATTEMPTS = 8
const BATCH_POLL_INTERVAL_MS = 1500

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
  // Defer the search term so keystrokes don't fire a network request each —
  // same treatment as useCustomerSearch (React prioritises typing).
  const deferredQ = useDeferredValue(q)
  const [stage, setStage] = useState('')
  const [source, setSource] = useState('')
  const [city, setCity] = useState('')
  const [batch, setBatch] = useState('')
  const [needsReview, setNeedsReview] = useState('')
  const [advisoryCouncil, setAdvisoryCouncil] = useState('')
  const [loanStatus, setLoanStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTarget, setAssignTarget] = useState('')
  // Invitations get their OWN target — deliberately decoupled from the grid's
  // Batch filter so a leftover filter can never silently prime a send.
  const [inviteTarget, setInviteTarget] = useState('')
  const [showNewContact, setShowNewContact] = useState(false)
  const [showNewBatch, setShowNewBatch] = useState(false)
  const [showInviteConfirm, setShowInviteConfirm] = useState(false)

  const filters = useMemo<MarketingContactsFilters>(
    () => ({
      q: deferredQ || undefined,
      stage: stage || undefined,
      source: source || undefined,
      city: city || undefined,
      batch: batch || undefined,
      needs_review: needsReview || undefined,
      advisory_council: advisoryCouncil || undefined,
      loan_status: loanStatus || undefined,
      page,
    }),
    [deferredQ, stage, source, city, batch, needsReview, advisoryCouncil, loanStatus, page],
  )

  const { data, isLoading, isError, isFetching } = useMarketingContacts(filters)
  useMarketingCommandRetryListener()
  const { data: batchesData, refetch: refetchBatches } = useBatches()
  const assign = useAssignBatch()
  const invite = useTriggerInvitations()
  const docs = data?.docs ?? []
  const batchOptions = batchesData?.docs ?? []
  const batchNameFor = (id?: string | null) =>
    id ? (batchOptions.find((b) => b.batchId === id)?.name ?? id) : '—'
  const batchLabelWithCount = (b: (typeof batchOptions)[number]) =>
    `${b.name ?? b.batchId}${typeof b.memberCount === 'number' ? ` (${b.memberCount})` : ''}${
      b.invitedAt ? ` · sent ${new Date(b.invitedAt).toLocaleDateString('en-AU')}` : ''
    }`

  // Keyboard navigation (j/k + Enter to open, Space to toggle selection) —
  // same convention as the Accounts browser.
  const { index: focusedIndex, setIndex: setFocusedIndex } = useListKeyboardNav({
    count: docs.length,
    onOpen: (idx) => {
      const contact = docs[idx]
      if (contact) router.push(`/admin/marketing/contacts/${contact.contactId}`)
    },
    onPeek: (idx) => {
      const contact = docs[idx]
      if (contact?.contactId) toggleOne(contact.contactId)
    },
    enabled: !showNewContact && !showNewBatch && !showInviteConfirm,
  })

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
          // The batch just assigned is the natural next invite target.
          setInviteTarget(assignTarget)
        },
      },
    )
  }

  const handleAssignTargetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === NEW_BATCH_SENTINEL) {
      setShowNewBatch(true)
      return // leave the current target untouched while the modal is open
    }
    setAssignTarget(e.target.value)
  }

  // The batch projection lags the CreateBatch 202 (command → event → projection).
  // Poll the batches list until the new id appears, then pre-select it as the
  // assign target so "New batch… → Assign" is a single flow. Bounded: on
  // timeout the batch still lands via the list's regular 30s refetch — the
  // pre-selection is just skipped.
  const handleBatchCreated = async (batchId: string) => {
    setShowNewBatch(false)
    for (let attempt = 0; attempt < BATCH_POLL_MAX_ATTEMPTS; attempt++) {
      const res = await refetchBatches()
      if (res.data?.docs?.some((b) => b.batchId === batchId)) {
        setAssignTarget(batchId)
        setInviteTarget(batchId)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, BATCH_POLL_INTERVAL_MS))
    }
  }

  // Segment snapshot for a new batch: the grid's active filters, verbatim.
  const criteriaSnapshot = useMemo(() => {
    const snapshot: Record<string, string> = {}
    if (q) snapshot.q = q
    if (stage) snapshot.stage = stage
    if (source) snapshot.source = source
    if (city) snapshot.city = city
    if (batch) snapshot.batch = batch
    return snapshot
  }, [q, stage, source, city, batch])

  const canInvite = !!inviteTarget && !invite.isPending
  const handleInviteConfirm = () => {
    if (!canInvite) return
    invite.mutate(inviteTarget, { onSettled: () => setShowInviteConfirm(false) })
  }

  const contactHref = (contact: Contact) => `/admin/marketing/contacts/${contact.contactId}`

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Marketing</h1>
        <button type="button" className={styles.pageButton} onClick={() => setShowNewContact(true)}>
          + New contact
        </button>
        <button
          type="button"
          className={styles.pageButton}
          title="Download the current filter as CSV"
          onClick={() => {
            const params = new URLSearchParams()
            if (deferredQ) params.set('q', deferredQ)
            if (stage) params.set('stage', stage)
            if (source) params.set('source', source)
            if (city) params.set('city', city)
            if (batch) params.set('batch', batch)
            if (needsReview) params.set('needs_review', needsReview)
            if (advisoryCouncil) params.set('advisory_council', advisoryCouncil)
            if (loanStatus) params.set('loan_status', loanStatus)
            window.open(`/api/marketing/contacts/export?${params.toString()}`, '_blank')
          }}
        >
          Export CSV
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

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-loan-outcome-filter">
            Loan outcome
          </label>
          <select
            id="marketing-loan-outcome-filter"
            className={styles.filterSelect}
            value={loanStatus}
            onChange={onFilter(setLoanStatus)}
            title="Win-back segments should target Repaid — written-off customers never re-enter"
          >
            <option value="">Any outcome</option>
            <option value="repaid">Repaid (win-back safe)</option>
            <option value="disbursed">Disbursed (active)</option>
            <option value="approved">Approved</option>
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-review-filter">
            Review
          </label>
          <select
            id="marketing-review-filter"
            className={styles.filterSelect}
            value={needsReview}
            onChange={onFilter(setNeedsReview)}
          >
            <option value="">All contacts</option>
            <option value="true">⚑ Needs review</option>
          </select>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-advisory-filter">
            Advisory council
          </label>
          <select
            id="marketing-advisory-filter"
            className={styles.filterSelect}
            value={advisoryCouncil}
            onChange={onFilter(setAdvisoryCouncil)}
          >
            <option value="">All contacts</option>
            <option value="true">Members only</option>
          </select>
        </div>
      </div>

      {/* Assign-to-batch bar — always present (fixed layout); controls disable
          until a selection + target batch exist. Invitations get their OWN
          batch selector (seeded by assign/create) — deliberately independent
          of the grid filter so a leftover filter never primes a send. */}
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
            onChange={handleAssignTargetChange}
            disabled={selected.size === 0}
          >
            <option value="">Choose a batch…</option>
            {batchOptions.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {batchLabelWithCount(b)}
              </option>
            ))}
            <option value={NEW_BATCH_SENTINEL}>＋ New batch…</option>
          </select>
        </div>
        <button
          type="button"
          className={styles.pageButton}
          onClick={handleAssign}
          disabled={!canAssign}
          title={
            selected.size === 0
              ? 'Select contacts first'
              : !assignTarget
                ? 'Choose a target batch'
                : undefined
          }
        >
          {assign.isPending ? 'Assigning…' : 'Assign'}
        </button>
        <div className={styles.spacer} />
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-invite-batch">
            Send invitations to
          </label>
          <select
            id="marketing-invite-batch"
            className={styles.filterSelect}
            value={inviteTarget}
            onChange={(e) => setInviteTarget(e.target.value)}
          >
            <option value="">Choose a batch…</option>
            {batchOptions.map((b) => (
              <option key={b.batchId} value={b.batchId}>
                {batchLabelWithCount(b)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => setShowInviteConfirm(true)}
          disabled={!canInvite}
          title={!inviteTarget ? 'Choose the batch to invite' : undefined}
        >
          {invite.isPending ? 'Sending…' : 'Send invitations'}
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
                  <th>Flags</th>
                  <th>Consent</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyCell}>
                      Loading contacts…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className={styles.emptyCell}>
                      No contacts match the current filters.
                    </td>
                  </tr>
                ) : (
                  docs.map((contact, idx) => (
                    <tr
                      key={contact.id}
                      className={`${styles.row}${idx === focusedIndex ? ` ${styles.rowFocused}` : ''}`}
                      onClick={() => {
                        setFocusedIndex(idx)
                        router.push(contactHref(contact))
                      }}
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
                      <td onClick={(e) => e.stopPropagation()}>
                        {contact.batchId ? (
                          <button
                            type="button"
                            className={styles.linkButton}
                            title="Filter the grid to this batch"
                            onClick={() => {
                              setBatch(contact.batchId!)
                              setPage(1)
                            }}
                          >
                            {batchNameFor(contact.batchId)}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {contact.needsReview ? (
                          <span
                            className={`${styles.badge} ${styles.badgeConsentDeclined}`}
                            title="Parked for review — excluded from invitation sends"
                          >
                            ⚑ Review
                          </span>
                        ) : (
                          <span className={styles.placeholder}>—</span>
                        )}
                      </td>
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
                contacts{isFetching ? ' · refreshing…' : ''}
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

      {showNewBatch && (
        <NewBatchModal
          criteria={criteriaSnapshot}
          onClose={() => setShowNewBatch(false)}
          onSuccess={handleBatchCreated}
        />
      )}

      {showInviteConfirm && (
        <div className={styles.modalOverlay} onClick={() => setShowInviteConfirm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Send invitations</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowInviteConfirm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>
                Send invitations to all consented members of{' '}
                <strong>{batchNameFor(inviteTarget)}</strong>?
              </p>
              <p className={styles.formHint}>
                Members without marketing consent are skipped automatically. Repeating the send for
                this batch is deduplicated platform-side, so a double-click can&apos;t fan out a
                second wave.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.btnCancel}
                onClick={() => setShowInviteConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnSubmit}
                onClick={handleInviteConfirm}
                disabled={!canInvite}
              >
                {invite.isPending ? 'Sending…' : 'Send invitations'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Default export for Payload import map
export default MarketingView
