'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useBatches } from '@/hooks/queries/useBatches'
import { formatDateShort } from '@/lib/formatters'
import { MarketingSubnav } from './MarketingSubnav'
import { NewBatchModal } from './NewBatchModal'
import styles from './styles.module.css'

/**
 * Campaigns list — the home the batch projection never had. Every campaign
 * shows its size and, once sent, the actual send outcome (invited / skipped)
 * that previously only surfaced in a transient toast. Row click opens the
 * campaign detail page, where members are listed and sends are triggered.
 */
export const CampaignsView: React.FC = () => {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [showNewBatch, setShowNewBatch] = useState(false)
  const { data, isLoading, isError } = useBatches({ page })
  const docs = data?.docs ?? []

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      <div className={styles.header}>
        <h1 className={styles.headerTitle}>Campaigns</h1>
        <button type="button" className={styles.pageButton} onClick={() => setShowNewBatch(true)}>
          + New campaign
        </button>
      </div>

      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load campaigns. Please retry.</div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Members</th>
                  <th>Created</th>
                  <th>Invitations</th>
                  <th>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.emptyCell}>
                      Loading campaigns…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={styles.emptyCell}>
                      No campaigns yet.{' '}
                      <button
                        type="button"
                        className={styles.clearFiltersButton}
                        onClick={() => setShowNewBatch(true)}
                      >
                        Create the first campaign
                      </button>{' '}
                      — or select contacts in the grid and assign them.
                    </td>
                  </tr>
                ) : (
                  docs.map((batch) => {
                    const skipped =
                      (batch.skippedUnconsented ?? 0) + (batch.skippedNeedsReview ?? 0)
                    return (
                      <tr
                        key={batch.id}
                        className={styles.row}
                        onClick={() => router.push(`/admin/marketing/campaigns/${batch.batchId}`)}
                      >
                        <td>
                          <Link
                            href={`/admin/marketing/campaigns/${batch.batchId}`}
                            className={styles.nameLink}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {batch.name ?? batch.batchId}
                          </Link>
                        </td>
                        <td>{typeof batch.memberCount === 'number' ? batch.memberCount : '—'}</td>
                        <td>
                          {batch.batchCreatedAt ? formatDateShort(batch.batchCreatedAt) : '—'}
                        </td>
                        <td>
                          {batch.invitedAt ? (
                            <span
                              className={`${styles.badge} ${styles.badgeConsentGranted}`}
                              title={`Invitations sent ${formatDateShort(batch.invitedAt)}`}
                            >
                              {batch.invitedCount ?? '?'} sent · {formatDateShort(batch.invitedAt)}
                            </span>
                          ) : (
                            <span className={`${styles.badge} ${styles.badgeMuted}`}>Not sent</span>
                          )}
                        </td>
                        <td>
                          {batch.invitedAt && skipped > 0 ? (
                            <span
                              title={`${batch.skippedUnconsented ?? 0} without consent, ${batch.skippedNeedsReview ?? 0} flagged for review`}
                            >
                              {skipped}
                            </span>
                          ) : (
                            <span className={styles.placeholder}>—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
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
                campaigns
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

      {showNewBatch && (
        <NewBatchModal
          criteria={{}}
          onClose={() => setShowNewBatch(false)}
          onSuccess={(batchId) => {
            setShowNewBatch(false)
            router.push(`/admin/marketing/campaigns/${batchId}`)
          }}
        />
      )}
    </div>
  )
}

export default CampaignsView
