'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useFeedbackQueue } from '@/hooks/queries/useFeedbackQueue'
import { useSetFeedbackStatus } from '@/hooks/mutations/useMarketingCommands'
import type { Feedback } from '@/payload-types'
import { formatDateShort } from '@/lib/formatters'
import styles from './styles.module.css'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'resolved', label: 'Resolved' },
]

/**
 * FeedbackQueueView — the marketing feedback triage queue at
 * `/admin/marketing/feedback`. Lists the `feedback` projection (filterable by
 * status) and advances items via the SetFeedbackStatus command. Reuses the
 * marketing view styles; fixed-layout action cells keep the row shape stable.
 */
export const FeedbackQueueView: React.FC = () => {
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const filters = useMemo(() => ({ status: status || undefined, page }), [status, page])
  const { data, isLoading, isError } = useFeedbackQueue(filters)
  const setStatusMutation = useSetFeedbackStatus()
  const docs = data?.docs ?? []

  const advance = (feedbackId: string | null | undefined, to: 'acknowledged' | 'resolved') => {
    if (!feedbackId) return
    setStatusMutation.mutate({ feedbackId, status: to })
  }

  const statusBadge = (s: Feedback['status']) => <span className={styles.badge}>{s ?? 'new'}</span>

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
                  <th>Received</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      Loading feedback…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      No feedback matches the current filter.
                    </td>
                  </tr>
                ) : (
                  docs.map((fb) => (
                    <tr key={fb.id} className={styles.row}>
                      <td>
                        {fb.contactIdString ? (
                          <Link
                            href={`/admin/marketing/contacts/${fb.contactIdString}`}
                            className={styles.nameLink}
                          >
                            {fb.contactIdString}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{fb.feedbackType ?? '—'}</td>
                      <td>{fb.body ?? '—'}</td>
                      <td>{statusBadge(fb.status)}</td>
                      <td>{fb.receivedAt ? formatDateShort(fb.receivedAt) : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.pageButton}
                          onClick={() => advance(fb.feedbackId, 'acknowledged')}
                          disabled={setStatusMutation.isPending || fb.status !== 'new'}
                        >
                          Acknowledge
                        </button>{' '}
                        <button
                          type="button"
                          className={styles.pageButton}
                          onClick={() => advance(fb.feedbackId, 'resolved')}
                          disabled={setStatusMutation.isPending || fb.status === 'resolved'}
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
    </div>
  )
}

export default FeedbackQueueView
