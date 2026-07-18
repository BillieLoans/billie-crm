'use client'

import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useMarketingContacts, fetchMarketingContactIds } from '@/hooks/queries/useMarketingContacts'
import type { MarketingContactsFilters } from '@/hooks/queries/useMarketingContacts'
import { useBatches } from '@/hooks/queries/useBatches'
import {
  useAssignBatch,
  useMarketingCommandRetryListener,
} from '@/hooks/mutations/useMarketingCommands'
import type { Contact } from '@/payload-types'
import { formatDateShort } from '@/lib/formatters'
import { summariseConsent, stageLabel, sourceLabel } from '@/lib/marketing-labels'
import { ContactDetail } from './ContactDetail'
import { FeedbackQueueView } from './FeedbackQueueView'
import { CampaignsView } from './CampaignsView'
import { CampaignDetail } from './CampaignDetail'
import { ContactPeekModal } from './ContactPeekModal'
import { MarketingSubnav } from './MarketingSubnav'
import { MarketingStats } from './MarketingStats'
import { NewBatchModal } from './NewBatchModal'
import { NewContactModal } from './NewContactModal'
import styles from './styles.module.css'

export interface MarketingViewProps {
  contactId: string
  feedback?: boolean
  campaigns?: boolean
  campaignId?: string
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

// Sentinel value for the assign dropdown's "＋ New campaign…" option — never a
// real batchId (batch ids are UUIDs minted by marketingService).
const NEW_BATCH_SENTINEL = '__new_batch__'

// Bounds for the post-create projection poll (see handleBatchCreated).
const BATCH_POLL_MAX_ATTEMPTS = 8
const BATCH_POLL_INTERVAL_MS = 1500

/** URL params owned by the grid — everything the view needs to restore itself. */
const FILTER_KEYS = [
  'q',
  'stage',
  'source',
  'city',
  'batch',
  'needs_review',
  'advisory_council',
  'loan_status',
] as const

function ConsentBadge({ consent }: { consent: Contact['consent'] }) {
  const summary = summariseConsent(consent)
  if (summary.granted === true) {
    const channels = summary.channels?.length
      ? ` — ${summary.channels.map((c) => c.toUpperCase()).join(', ')}`
      : ''
    return (
      <span
        className={`${styles.badge} ${styles.badgeConsentGranted}`}
        title={`Marketing consent granted${channels}`}
      >
        Granted
      </span>
    )
  }
  if (summary.granted === false) {
    return <span className={`${styles.badge} ${styles.badgeConsentDeclined}`}>Declined</span>
  }
  return <span className={styles.placeholder}>—</span>
}

/**
 * MarketingView — Task C6 admin view.
 *
 * Routes between the module's surfaces based on the URL segments the
 * WithTemplate wrapper parses: contacts grid (default), contact detail,
 * campaigns list/detail, and the feedback queue.
 */
export const MarketingView: React.FC<MarketingViewProps> = ({
  contactId,
  feedback,
  campaigns,
  campaignId,
}) => {
  if (feedback) {
    return <FeedbackQueueView />
  }
  if (campaignId) {
    return <CampaignDetail batchId={campaignId} />
  }
  if (campaigns) {
    return <CampaignsView />
  }
  if (contactId) {
    return <ContactDetail contactId={contactId} />
  }
  return <MarketingContactsGrid />
}

const MarketingContactsGrid: React.FC = () => {
  const router = useRouter()
  const pathname = usePathname() ?? '/admin/marketing'
  const searchParams = useSearchParams()

  // All grid state lives in the URL so refresh/back/share restore the exact
  // view (and the CSV export matches what's on screen). The search box keeps
  // a local mirror for responsive typing; the deferred value syncs to the URL.
  const stage = searchParams?.get('stage') ?? ''
  const source = searchParams?.get('source') ?? ''
  const city = searchParams?.get('city') ?? ''
  const batch = searchParams?.get('batch') ?? ''
  const needsReview = searchParams?.get('needs_review') ?? ''
  const advisoryCouncil = searchParams?.get('advisory_council') ?? ''
  const loanStatus = searchParams?.get('loan_status') ?? ''
  const sort = searchParams?.get('sort') ?? ''
  const urlQ = searchParams?.get('q') ?? ''
  const page = Math.max(1, Number(searchParams?.get('page') ?? '1') || 1)

  const [q, setQ] = useState(urlQ)
  const deferredQ = useDeferredValue(q)

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '')
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  // Deferred search → URL (resetting the page); skip when already in sync so
  // this never loops with the param read above.
  useEffect(() => {
    if (deferredQ !== urlQ) setParams({ q: deferredQ || null, page: null })
  }, [deferredQ, urlQ, setParams])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectingAll, setSelectingAll] = useState(false)
  const [assignTarget, setAssignTarget] = useState('')
  const [creatingBatch, setCreatingBatch] = useState(false)
  const [showNewContact, setShowNewContact] = useState(false)
  const [showNewBatch, setShowNewBatch] = useState(false)
  const [peekContactId, setPeekContactId] = useState<string | null>(null)

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
      sort: sort || undefined,
      page,
    }),
    [deferredQ, stage, source, city, batch, needsReview, advisoryCouncil, loanStatus, sort, page],
  )

  const { data, isLoading, isError, isFetching } = useMarketingContacts(filters)
  useMarketingCommandRetryListener()
  const { data: batchesData, refetch: refetchBatches } = useBatches()
  const assign = useAssignBatch()
  const docs = data?.docs ?? []
  const batchOptions = batchesData?.docs ?? []
  const batchNameFor = (id?: string | null) =>
    id ? (batchOptions.find((b) => b.batchId === id)?.name ?? id) : '—'
  const batchLabelWithCount = (b: (typeof batchOptions)[number]) =>
    `${b.name ?? b.batchId}${typeof b.memberCount === 'number' ? ` (${b.memberCount})` : ''}${
      b.invitedAt ? ` · sent ${new Date(b.invitedAt).toLocaleDateString('en-AU')}` : ''
    }`

  // Keyboard navigation (j/k move · Enter opens · Space previews) — same
  // convention as the Accounts browser; hinted in the table footer.
  const { index: focusedIndex, setIndex: setFocusedIndex } = useListKeyboardNav({
    count: docs.length,
    onOpen: (idx) => {
      const contact = docs[idx]
      if (contact) router.push(contactHref(contact))
    },
    onPeek: (idx) => {
      const contact = docs[idx]
      if (contact?.contactId) setPeekContactId(contact.contactId)
    },
    enabled: !showNewContact && !showNewBatch && !peekContactId,
  })

  const onFilter =
    (key: (typeof FILTER_KEYS)[number]) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setParams({ [key]: e.target.value || null, page: null })

  const activeFilterChips: Array<{ key: string; label: string }> = []
  if (stage) activeFilterChips.push({ key: 'stage', label: `Stage: ${stageLabel(stage)}` })
  if (source) activeFilterChips.push({ key: 'source', label: `Source: ${sourceLabel(source)}` })
  if (city) activeFilterChips.push({ key: 'city', label: `City: ${city}` })
  if (batch) activeFilterChips.push({ key: 'batch', label: `Campaign: ${batchNameFor(batch)}` })
  if (needsReview) activeFilterChips.push({ key: 'needs_review', label: 'Needs review' })
  if (advisoryCouncil)
    activeFilterChips.push({ key: 'advisory_council', label: 'Advisory council' })
  if (loanStatus)
    activeFilterChips.push({ key: 'loan_status', label: `Loan outcome: ${loanStatus}` })

  const clearAllFilters = () => {
    setQ('')
    setParams(Object.fromEntries([...FILTER_KEYS, 'page'].map((k) => [k, null])))
  }
  const hasActiveFilters = activeFilterChips.length > 0 || !!urlQ

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
  const selectedOffPage = Array.from(selected).filter((id) => !pageContactIds.includes(id)).length

  const handleSelectAllMatching = async () => {
    setSelectingAll(true)
    try {
      const res = await fetchMarketingContactIds(filters)
      setSelected(new Set(res.contactIds))
      if (res.capped) {
        toast.warning(
          `Selected the first ${res.contactIds.length.toLocaleString('en-AU')} of ${res.totalDocs.toLocaleString('en-AU')} matches`,
          { description: 'Assignments are capped at 10,000 contacts per action.' },
        )
      }
    } catch (e) {
      toast.error('Failed to select all matches', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSelectingAll(false)
    }
  }

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

  const handleAssignTargetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === NEW_BATCH_SENTINEL) {
      setShowNewBatch(true)
      return // leave the current target untouched while the modal is open
    }
    setAssignTarget(e.target.value)
  }

  // The batch projection lags the CreateBatch 202 (command → event → projection).
  // Poll the batches list until the new id appears, then pre-select it as the
  // assign target so "New campaign… → Assign" is a single flow. The picker
  // shows an explicit "Creating campaign…" state while the poll runs; on
  // timeout the batch still lands via the list's regular 30s refetch.
  const handleBatchCreated = async (batchId: string) => {
    setShowNewBatch(false)
    setCreatingBatch(true)
    try {
      for (let attempt = 0; attempt < BATCH_POLL_MAX_ATTEMPTS; attempt++) {
        const res = await refetchBatches()
        if (res.data?.docs?.some((b) => b.batchId === batchId)) {
          setAssignTarget(batchId)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, BATCH_POLL_INTERVAL_MS))
      }
      toast.info('The campaign is still syncing', {
        description: 'It will appear in the campaign picker shortly.',
      })
    } finally {
      setCreatingBatch(false)
    }
  }

  // Segment snapshot for a new batch: the grid's active filters, verbatim.
  const criteriaSnapshot = useMemo(() => {
    const snapshot: Record<string, string> = {}
    if (deferredQ) snapshot.q = deferredQ
    if (stage) snapshot.stage = stage
    if (source) snapshot.source = source
    if (city) snapshot.city = city
    if (batch) snapshot.batch = batch
    if (needsReview) snapshot.needs_review = needsReview
    if (advisoryCouncil) snapshot.advisory_council = advisoryCouncil
    if (loanStatus) snapshot.loan_status = loanStatus
    return snapshot
  }, [deferredQ, stage, source, city, batch, needsReview, advisoryCouncil, loanStatus])

  const contactHref = (contact: Contact) => `/admin/marketing/contacts/${contact.contactId}`

  const exportHref = useMemo(() => {
    const params = new URLSearchParams()
    for (const key of FILTER_KEYS) {
      const value = key === 'q' ? deferredQ : searchParams?.get(key)
      if (value) params.set(key, value)
    }
    return `/api/marketing/contacts/export?${params.toString()}`
  }, [deferredQ, searchParams])

  const toggleSort = (key: 'name' | 'updated') => {
    const next =
      key === 'updated'
        ? sort === 'updated_asc'
          ? null // back to the default (updated_desc)
          : sort === ''
            ? 'updated_asc'
            : sort === 'updated_desc'
              ? 'updated_asc'
              : 'updated_desc'
        : sort === 'name_asc'
          ? 'name_desc'
          : 'name_asc'
    setParams({ sort: next, page: null })
  }
  const sortArrow = (key: 'name' | 'updated') => {
    if (key === 'updated' && (sort === '' || sort === 'updated_desc')) return ' ↓'
    if (key === 'updated' && sort === 'updated_asc') return ' ↑'
    if (key === 'name' && sort === 'name_asc') return ' ↑'
    if (key === 'name' && sort === 'name_desc') return ' ↓'
    return ''
  }

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Contacts</h1>
        <button type="button" className={styles.pageButton} onClick={() => setShowNewContact(true)}>
          + New contact
        </button>
        <a
          className={styles.pageButton}
          title="Download the current filter as CSV"
          href={exportHref}
          download
        >
          Export CSV
        </a>
      </div>

      <MarketingStats />

      <div className={styles.filters}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search name, email, mobile"
          value={q}
          onChange={(e) => setQ(e.target.value)}
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
            onChange={onFilter('stage')}
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
            onChange={onFilter('source')}
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
          <input
            id="marketing-city-filter"
            type="text"
            className={styles.filterSelect}
            placeholder="Any city"
            value={city}
            onChange={onFilter('city')}
            list="marketing-city-suggestions"
          />
          {/* Free-text on the backend (a `like` filter) — the datalist offers
              the cities campaigns usually target without locking others out. */}
          <datalist id="marketing-city-suggestions">
            {['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra'].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="marketing-batch-filter">
            Campaign
          </label>
          <select
            id="marketing-batch-filter"
            className={styles.filterSelect}
            value={batch}
            onChange={onFilter('batch')}
          >
            <option value="">All campaigns</option>
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
            onChange={onFilter('loan_status')}
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
            onChange={onFilter('needs_review')}
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
            onChange={onFilter('advisory_council')}
          >
            <option value="">All contacts</option>
            <option value="true">Members only</option>
          </select>
        </div>
      </div>

      {hasActiveFilters && (
        <div className={styles.activeFilters}>
          {urlQ && (
            <button
              type="button"
              className={styles.filterChip}
              onClick={() => setQ('')}
              title="Remove this filter"
            >
              “{urlQ}” ×
            </button>
          )}
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={styles.filterChip}
              onClick={() => setParams({ [chip.key]: null, page: null })}
              title="Remove this filter"
            >
              {chip.label} ×
            </button>
          ))}
          <button type="button" className={styles.clearFiltersButton} onClick={clearAllFilters}>
            Clear all
          </button>
        </div>
      )}

      {/* Contextual bulk-action bar — appears only while contacts are
          selected. Sending invitations now lives on the campaign's page
          (with a pre-flight summary), not next to the grid filters. */}
      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkBarCount}>
            {selected.size.toLocaleString('en-AU')} selected
          </span>
          {selectedOffPage > 0 && (
            <span className={styles.bulkBarMeta}>({selectedOffPage} on other pages)</span>
          )}
          {data && data.totalDocs > selected.size && (
            <button
              type="button"
              className={styles.clearFiltersButton}
              onClick={handleSelectAllMatching}
              disabled={selectingAll}
            >
              {selectingAll
                ? 'Selecting…'
                : `Select all ${data.totalDocs.toLocaleString('en-AU')} matching`}
            </button>
          )}
          <div className={styles.spacer} />
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel} htmlFor="marketing-assign-batch">
              Assign to campaign
            </label>
            <select
              id="marketing-assign-batch"
              className={styles.filterSelect}
              value={assignTarget}
              onChange={handleAssignTargetChange}
              disabled={creatingBatch}
            >
              <option value="">{creatingBatch ? 'Creating campaign…' : 'Choose a campaign…'}</option>
              {batchOptions.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {batchLabelWithCount(b)}
                </option>
              ))}
              <option value={NEW_BATCH_SENTINEL}>＋ New campaign…</option>
            </select>
          </div>
          <button
            type="button"
            className={styles.btnSubmit}
            onClick={handleAssign}
            disabled={!canAssign}
            title={!assignTarget ? 'Choose a target campaign' : undefined}
          >
            {assign.isPending ? 'Assigning…' : 'Assign'}
          </button>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

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
                  <th>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleSort('name')}
                      title="Sort by name"
                    >
                      Contact{sortArrow('name')}
                    </button>
                  </th>
                  <th>Stage</th>
                  <th>Source</th>
                  <th>Campaign</th>
                  <th>Flags</th>
                  <th>Consent</th>
                  <th>
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => toggleSort('updated')}
                      title="Sort by last update"
                    >
                      Updated{sortArrow('updated')}
                    </button>
                  </th>
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
                      {hasActiveFilters ? (
                        <>
                          No contacts match the current filters.{' '}
                          <button
                            type="button"
                            className={styles.clearFiltersButton}
                            onClick={clearAllFilters}
                          >
                            Clear all filters
                          </button>
                        </>
                      ) : (
                        <>
                          No contacts yet.{' '}
                          <button
                            type="button"
                            className={styles.clearFiltersButton}
                            onClick={() => setShowNewContact(true)}
                          >
                            Create the first contact
                          </button>
                        </>
                      )}
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
                        <div className={styles.identityCell}>
                          <Link
                            href={contactHref(contact)}
                            className={styles.nameLink}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {contact.firstName ?? 'Unnamed contact'}
                          </Link>
                          <span className={styles.identitySecondary}>
                            {[contact.mobileE164, contact.email].filter(Boolean).join(' · ') ||
                              '—'}
                          </span>
                        </div>
                      </td>
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
                          <Link
                            href={`/admin/marketing/campaigns/${contact.batchId}`}
                            className={styles.nameLink}
                            title="Open this campaign"
                          >
                            {batchNameFor(contact.batchId)}
                          </Link>
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
                onClick={() => setParams({ page: String(Math.max(1, page - 1)) })}
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
                onClick={() => setParams({ page: String(page + 1) })}
                disabled={!data || !data.hasNextPage}
              >
                Next →
              </button>
            </div>

            <div className={styles.kbdHint}>
              <span>
                <span className={styles.kbd}>j</span>/<span className={styles.kbd}>k</span> navigate
              </span>
              <span>
                <span className={styles.kbd}>⏎</span> open
              </span>
              <span>
                <span className={styles.kbd}>space</span> preview
              </span>
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

      {peekContactId && (
        <ContactPeekModal contactId={peekContactId} onClose={() => setPeekContactId(null)} />
      )}
    </div>
  )
}

// Default export for Payload import map
export default MarketingView
