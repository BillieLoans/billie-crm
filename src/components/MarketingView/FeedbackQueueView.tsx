'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useFeedbackQueue } from '@/hooks/queries/useFeedbackQueue'
import type { FeedbackWithContact } from '@/hooks/queries/useFeedbackQueue'
import { useSetFeedbackStatus } from '@/hooks/mutations/useMarketingCommands'
import type { Feedback } from '@/payload-types'
import { formatDateShort } from '@/lib/formatters'
import { FEEDBACK_STATUS_LABELS, OVERDUE_COMPLAINT_DAYS } from '@/lib/marketing-labels'
import { ContactPeekModal } from './ContactPeekModal'
import { MarketingSubnav } from './MarketingSubnav'
import { ResolveFeedbackModal } from './ResolveFeedbackModal'
import styles from './styles.module.css'

/**
 * Status tabs. "Open" (new + acknowledged) is the default — triage starts
 * from live work, and resolved history is an explicit choice.
 */
const STATUS_TABS = [
  { value: 'open', label: 'Open' },
  { value: 'new', label: 'New' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
]

const TYPE_SUGGESTIONS = ['complaint', 'suggestion', 'praise', 'question']

/** Fallback label when the contact has no name (or the lookup missed). */
const shortId = (id: string) => `${id.slice(0, 8)}…`

/**
 * FeedbackQueueView — the marketing feedback triage queue at
 * `/admin/marketing/feedback`. Lists the `feedback` projection and advances
 * items via the SetFeedbackStatus command. Filters live in the URL so the
 * view survives refresh/back and can be shared; rows expand in place so a
 * long complaint can be read without leaving the queue.
 */
export const FeedbackQueueView: React.FC = () => {
  const router = useRouter()
  const pathname = usePathname() ?? '/admin/marketing/feedback'
  const searchParams = useSearchParams()

  const status = searchParams?.get('status') ?? 'open'
  const type = searchParams?.get('type') ?? ''
  const overdue = searchParams?.get('overdue') ?? ''
  const page = Math.max(1, Number(searchParams?.get('page') ?? '1') || 1)

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

  const [peekContactId, setPeekContactId] = useState<string | null>(null)
  const [resolveTarget, setResolveTarget] = useState<FeedbackWithContact | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filters = useMemo(
    () => ({
      status: status === 'all' ? undefined : status,
      type: type || undefined,
      overdue: overdue || undefined,
      page,
    }),
    [status, type, overdue, page],
  )
  const { data, isLoading, isError } = useFeedbackQueue(filters)
  // Clock snapshot for the Age column, refreshed with each fetch — memoised
  // against `data` so ages stay stable between fetches (render-pure).
  const now = useMemo(() => Date.now(), [data])
  const setStatusMutation = useSetFeedbackStatus()
  const docs = data?.docs ?? []

  // Acknowledge is a one-click nudge; Resolve requires a note (see
  // ResolveFeedbackModal), matching the approval flows' comment requirement.
  const acknowledge = (feedbackId: string | null | undefined) => {
    if (!feedbackId) return
    setStatusMutation.mutate({ feedbackId, status: 'acknowledged' })
  }

  const statusBadge = (s: Feedback['status']) => {
    const value = s ?? 'new'
    const cls =
      value === 'resolved'
        ? styles.badgeStatusResolved
        : value === 'acknowledged'
          ? styles.badgeStatusAcknowledged
          : styles.badgeStatusNew
    return (
      <span className={`${styles.badge} ${cls}`}>{FEEDBACK_STATUS_LABELS[value] ?? value}</span>
    )
  }

  // Row-scoped pending: acknowledging one item must not freeze the buttons on
  // every other row — triage is fast sequential work.
  const isRowPending = (feedbackId: string | null | undefined) =>
    setStatusMutation.isPending && setStatusMutation.variables?.feedbackId === feedbackId

  const daysOpen = (receivedAt: string | null | undefined): number | null => {
    if (!receivedAt) return null
    return Math.floor((now - new Date(receivedAt).getTime()) / 86_400_000)
  }
  const isOverdue = (fb: Feedback) =>
    fb.status !== 'resolved' &&
    (fb.feedbackType ?? '').toLowerCase() === 'complaint' &&
    (daysOpen(fb.receivedAt) ?? 0) > OVERDUE_COMPLAINT_DAYS

  const exportHref = useMemo(() => {
    const params = new URLSearchParams()
    if (status !== 'all') params.set('status', status)
    if (type) params.set('type', type)
    return `/api/marketing/feedback/export?${params.toString()}`
  }, [status, type])

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Feedback</h1>
        <a
          className={styles.pageButton}
          title="Download the current filter as CSV"
          href={exportHref}
          download
        >
          Export CSV
        </a>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Status</span>
          <div className={styles.timelineFilters} role="group" aria-label="Status filter">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                className={
                  status === tab.value
                    ? `${styles.timelineFilterChip} ${styles.timelineFilterChipActive}`
                    : styles.timelineFilterChip
                }
                onClick={() => setParams({ status: tab.value === 'open' ? null : tab.value, page: null })}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="feedback-type-filter">
            Type
          </label>
          <input
            id="feedback-type-filter"
            type="text"
            className={styles.filterSelect}
            placeholder="Any type"
            value={type}
            onChange={(e) => setParams({ type: e.target.value || null, page: null })}
            list="feedback-type-suggestions"
          />
          <datalist id="feedback-type-suggestions">
            {TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Quick filter</span>
          <button
            type="button"
            className={
              overdue
                ? `${styles.timelineFilterChip} ${styles.timelineFilterChipActive}`
                : styles.timelineFilterChip
            }
            onClick={() => setParams({ overdue: overdue ? null : 'true', page: null })}
            title={`Unresolved complaints older than ${OVERDUE_COMPLAINT_DAYS} days`}
          >
            Overdue complaints
          </button>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load feedback. Please retry.</div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Type</th>
                  <th>Feedback</th>
                  <th>Status</th>
                  <th>Resolution</th>
                  <th>Age</th>
                  <th>Received</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      Loading feedback…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      {status === 'open' && !type && !overdue
                        ? 'The queue is clear — no open feedback. 🎉'
                        : 'No feedback matches the current filter.'}
                    </td>
                  </tr>
                ) : (
                  docs.map((fb) => (
                    <React.Fragment key={fb.id}>
                      <tr
                        className={styles.row}
                        onClick={() =>
                          setExpandedId((prev) => (prev === String(fb.id) ? null : String(fb.id)))
                        }
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          {fb.contactIdString ? (
                            <button
                              type="button"
                              className={styles.linkButton}
                              onClick={() => setPeekContactId(fb.contactIdString!)}
                            >
                              {fb.contactName ?? shortId(fb.contactIdString)}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{fb.feedbackType ?? '—'}</td>
                        <td>
                          {fb.body ? (
                            <span className={styles.noteCell} title="Click the row to read in full">
                              {fb.body}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{statusBadge(fb.status)}</td>
                        <td>
                          {fb.statusNote ? (
                            <span className={styles.noteCell} title="Click the row to read in full">
                              {fb.statusNote}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {daysOpen(fb.receivedAt) === null ? (
                            '—'
                          ) : isOverdue(fb) ? (
                            <span className={`${styles.badge} ${styles.badgeConsentDeclined}`}>
                              Overdue · {daysOpen(fb.receivedAt)}d
                            </span>
                          ) : (
                            <span>{daysOpen(fb.receivedAt)}d</span>
                          )}
                        </td>
                        <td>{fb.receivedAt ? formatDateShort(fb.receivedAt) : '—'}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={styles.pageButton}
                            onClick={() => acknowledge(fb.feedbackId)}
                            disabled={isRowPending(fb.feedbackId) || fb.status !== 'new'}
                          >
                            Acknowledge
                          </button>{' '}
                          <button
                            type="button"
                            className={styles.pageButton}
                            onClick={() => setResolveTarget(fb)}
                            disabled={isRowPending(fb.feedbackId) || fb.status === 'resolved'}
                          >
                            Resolve
                          </button>
                        </td>
                      </tr>
                      {expandedId === String(fb.id) && (
                        <tr>
                          <td colSpan={8}>
                            <div className={styles.expandedBody}>
                              {fb.body ?? '—'}
                              {fb.statusNote && (
                                <>
                                  {'\n\n'}
                                  <strong>Resolution:</strong> {fb.statusNote}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
                Page {data?.page ?? page} of {data?.totalPages ?? 1} · {data?.totalDocs ?? 0} items
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
          </>
        )}
      </div>

      {peekContactId && (
        <ContactPeekModal contactId={peekContactId} onClose={() => setPeekContactId(null)} />
      )}

      {resolveTarget && (
        <ResolveFeedbackModal feedback={resolveTarget} onClose={() => setResolveTarget(null)} />
      )}
    </div>
  )
}

export default FeedbackQueueView
