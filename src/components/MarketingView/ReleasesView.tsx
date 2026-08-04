'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useGateStatus, useReleases } from '@/hooks'
import { formatDateShort } from '@/lib/formatters'
import { MarketingSubnav } from './MarketingSubnav'
import { NewReleaseModal } from './NewReleaseModal'
import styles from './styles.module.css'

const TYPE_LABELS: Record<string, string> = {
  waitlist: 'Waitlist next-N',
  phone_list: 'Phone list',
  open_quota: 'Open quota',
}

/**
 * Releases list — every batch of applicants released past the billieChat
 * gate, with capacity at a glance. The gate-off banner is a loud reminder
 * that release volumes are decorative while the gate is open (anyone can
 * apply regardless of what's been "released").
 */
export const ReleasesView: React.FC = () => {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const { data, isLoading, isError } = useReleases({ page })
  const { data: gate } = useGateStatus()
  const docs = data?.docs ?? []

  const active = docs.filter((d) => d.derivedStatus === 'active')
  const unclaimedGrants = active
    .filter((d) => d.type !== 'open_quota')
    .reduce((sum, d) => sum + Math.max((d.grantedCount ?? 0) - (d.claimedCount ?? 0), 0), 0)
  const quotaSlots = active
    .filter((d) => d.type === 'open_quota')
    .reduce((sum, d) => sum + Math.max((d.quotaCount ?? 0) - (d.claimedCount ?? 0), 0), 0)

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      {gate?.mode === 'open' && (
        <div className={styles.warningMessage} role="status">
          Application gate is OFF — releases are not being enforced. Turn it on with the gate CLI
          before relying on release volumes.
        </div>
      )}
      {gate?.mode === 'closed' && (
        <div className={styles.errorMessage} role="alert">
          Kill switch ON — all new applications are blocked. Releases and grants are not being
          honoured while this is on.
        </div>
      )}
      <div className={styles.statsStrip}>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{unclaimedGrants.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Unclaimed grants</span>
        </div>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{quotaSlots.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Open quota slots</span>
        </div>
        <button type="button" className={styles.btnSubmit} onClick={() => setShowNew(true)}>
          + New release
        </button>
      </div>
      <div className={styles.tableWrapper}>
        {isError ? (
          <div className={styles.emptyState}>Failed to load releases. Please retry.</div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Released</th>
                  <th>Granted</th>
                  <th>Claimed</th>
                  <th>Remaining</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      Loading releases…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className={styles.emptyCell}>
                      No releases yet.
                    </td>
                  </tr>
                ) : (
                  docs.map((r) => {
                    const isQuota = r.type === 'open_quota'
                    const remaining = isQuota
                      ? `${Math.max((r.quotaCount ?? 0) - (r.claimedCount ?? 0), 0)} / ${r.quotaCount ?? 0}`
                      : String(Math.max((r.grantedCount ?? 0) - (r.claimedCount ?? 0), 0))
                    return (
                      <tr
                        key={r.id}
                        className={styles.row}
                        onClick={() => router.push(`/admin/marketing/releases/${r.releaseId}`)}
                      >
                        <td>
                          <Link
                            href={`/admin/marketing/releases/${r.releaseId}`}
                            className={styles.nameLink}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.name ?? r.releaseId}
                          </Link>
                        </td>
                        <td>{TYPE_LABELS[r.type ?? ''] ?? r.type}</td>
                        <td>
                          <span className={styles.badge}>{r.derivedStatus}</span>
                        </td>
                        <td>{r.releasedAt ? formatDateShort(r.releasedAt) : '—'}</td>
                        <td>{isQuota ? '—' : (r.grantedCount ?? 0)}</td>
                        <td>{r.claimedCount ?? 0}</td>
                        <td>{r.derivedStatus === 'active' ? remaining : '0'}</td>
                        <td>{r.expiresAt ? formatDateShort(r.expiresAt) : '—'}</td>
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
                releases
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
      {showNew && (
        <NewReleaseModal
          onClose={() => setShowNew(false)}
          onSuccess={(releaseId) => {
            setShowNew(false)
            router.push(`/admin/marketing/releases/${releaseId}`)
          }}
        />
      )}
    </div>
  )
}

export default ReleasesView
