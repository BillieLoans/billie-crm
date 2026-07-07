'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useFeedbackQueue } from '@/hooks/queries/useFeedbackQueue'
import type { FeedbackWithContact } from '@/hooks/queries/useFeedbackQueue'
import { useSetFeedbackStatus } from '@/hooks/mutations/useMarketingCommands'
import type { Feedback } from '@/payload-types'
import { formatDateShort } from '@/lib/formatters'
import { ContactPeekModal } from './ContactPeekModal'
import { ResolveFeedbackModal } from './ResolveFeedbackModal'
import styles from './styles.module.css'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
]

/** Fallback label when the contact has no name (or the lookup missed). */
const shortId = (id: string) => `${id.slice(0, 8)}…`

/**
 * FeedbackQueueView — the marketing feedback triage queue at
 * `/admin/marketing/feedback`. Lists the `feedback` projection (filterable by
 * status) and advances items via the SetFeedbackStatus command. Reuses the
 * marketing view styles; fixed-layout action cells keep the row shape stable.
 */
export const FeedbackQueueView: React.FC = () => {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [peekContactId, setPeekContactId] = useState<string | null>(null)
  const [resolveTarget, setResolveTarget] = useState<FeedbackWithContact | null>(null)

  const filters = useMemo(() => ({ status: status || undefined, page }), [status, page])
  const { data, isLoading, isError } = useFeedbackQueue(filters)
  // Render-pure clock snapshot for the Age column; refreshed with each fetch.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
  }, [data])
  const setStatusMutation = useSetFeedbackStatus()
  const docs = data?.docs ?? []

  // Acknowledge is a one-click nudge; Resolve requires a note (see
  // ResolveFeedbackModal), matching the approval flows' comment requirement.
  const acknowledge = (feedbackId: string | null | undefined) => {
    if (!feedbackId) return
    setStatusMutation.mutate({ feedbackId, status: 'acknowledged' })
  }

  const statusBadge = (s: Feedback['status']) => <span className={styles.badge}>{s ?? 'new'}</span>

  // Row-scoped pending: acknowledging one item must not freeze the buttons on
  // every other row — triage is fast sequential work.
  const isRowPending = (feedbackId: string | null | undefined) =>
    setStatusMutation.isPending && setStatusMutation.variables?.feedbackId === feedbackId

  // Days-open ages the queue; unresolved complaints older than 21 days get an
  // overdue highlight (internal IDR posture: resolve complaints well inside
  // 30 days).
  const daysOpen = (receivedAt: string | null | undefined): number | null => {
    if (!receivedAt) return null
    return Math.floor((now - new Date(receivedAt).getTime()) / 86_400_000)
  }
  const isOverdue = (fb: Feedback) =>
    fb.status !== 'resolved' &&
    (fb.feedbackType ?? '').toLowerCase() === 'complaint' &&
    (daysOpen(fb.receivedAt) ?? 0) > 21

  return (
    <div className={styles.container}>
      <Link href="/admin/marketing" className={styles.backLink}>
        ← Back to Marketing
      </Link>

      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Feedback queue</h1>
      </div>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel} htmlFor="feedback-status-filter">
            Status
          </label>
          <select
            id="feedback-status-filter"
            className={styles.filterSelect}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
                      No feedback matches the current filter.
                    </td>
                  </tr>
                ) : (
                  docs.map((fb) => (
                    <tr key={fb.id} className={styles.row}>
                      <td>
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
                          <span className={styles.noteCell} title={fb.body}>
                            {fb.body}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{statusBadge(fb.status)}</td>
                      <td>
                        {fb.statusNote ? (
                          <span className={styles.noteCell} title={fb.statusNote}>
                            {fb.statusNote}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {daysOpen(fb.receivedAt) === null ? (
                          '—'
                        ) : (
                          <span
                            className={
                              isOverdue(fb)
                                ? `${styles.badge} ${styles.badgeConsentDeclined}`
                                : undefined
                            }
                            title={
                              isOverdue(fb) ? 'Unresolved complaint over 21 days old' : undefined
                            }
                          >
                            {daysOpen(fb.receivedAt)}d
                          </span>
                        )}
                      </td>
                      <td>{fb.receivedAt ? formatDateShort(fb.receivedAt) : '—'}</td>
                      <td>
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
                Page {data?.page ?? page} of {data?.totalPages ?? 1} · {data?.totalDocs ?? 0} items
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
