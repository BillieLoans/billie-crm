'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRelease, useRevokeRelease } from '@/hooks'
import type { ReleaseWithDerived } from '@/hooks'
import { formatDateMedium, formatDateShort } from '@/lib/formatters'
import { MarketingSubnav } from './MarketingSubnav'
import { Modal } from './Modal'
import styles from './styles.module.css'

export interface ReleaseDetailProps {
  releaseId: string
}

const TYPE_LABELS: Record<string, string> = {
  waitlist: 'Waitlist next-N',
  phone_list: 'Phone list',
  open_quota: 'Open quota',
}

const SOURCE_LABELS: Record<string, string> = {
  targeted: 'Targeted',
  quota_claim: 'Quota claim',
}

/** Falls back to the same expiry check the list endpoint uses when the
 * detail projection hasn't been enriched with `derivedStatus`. */
function deriveStatus(release: ReleaseWithDerived): string {
  if (release.derivedStatus) return release.derivedStatus
  if (
    release.status === 'active' &&
    release.expiresAt &&
    Date.parse(release.expiresAt) < Date.now()
  ) {
    return 'expired'
  }
  return release.status ?? 'active'
}

function grantStatusBadgeClass(status: string | null | undefined): string {
  if (status === 'claimed') return `${styles.badge} ${styles.badgeConsentGranted}`
  if (status === 'revoked' || status === 'expired')
    return `${styles.badge} ${styles.badgeConsentDeclined}`
  return styles.badge
}

function smsStatusBadgeClass(status: string | null | undefined): string {
  if (status === 'sent') return `${styles.badge} ${styles.badgeConsentGranted}`
  if (status === 'failed') return `${styles.badge} ${styles.badgeConsentDeclined}`
  return `${styles.badge} ${styles.badgeMuted}`
}

/**
 * Release detail — stat tiles for capacity at a glance, the grant-level
 * table (who was targeted, what happened to them), and the revoke action.
 * Revoking is irreversible (every remaining grant — granted AND claimed —
 * is cancelled, blocking gate re-entry; only conversations already in
 * progress continue), so it requires typing the release name exactly,
 * mirroring the friction of the other irreversible actions in this module
 * (erase, merge).
 */
export const ReleaseDetail: React.FC<ReleaseDetailProps> = ({ releaseId }) => {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [showRevoke, setShowRevoke] = useState(false)
  const { data, isLoading } = useRelease(releaseId, page)

  const release = data?.release
  const grants = data?.grants
  const docs = grants?.docs ?? []

  if (!release) {
    return (
      <div className={styles.container}>
        <MarketingSubnav />
        <div className={styles.emptyState}>
          <p>This release is still syncing — it should appear within a few seconds.</p>
          <p className={styles.formHint}>
            Released batches land after the platform confirms them. This page refreshes
            automatically;{' '}
            <Link href="/admin/marketing/releases" className={styles.nameLink}>
              back to releases
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  const status = deriveStatus(release)
  const isQuota = release.type === 'open_quota'
  const grantedCount = release.grantedCount ?? 0
  const claimedCount = release.claimedCount ?? 0
  const quotaCount = release.quotaCount ?? 0
  const unclaimed = isQuota
    ? Math.max(quotaCount - claimedCount, 0)
    : Math.max(grantedCount - claimedCount, 0)
  const canRevoke = status === 'active'

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderMain}>
          <h1 className={styles.headerTitle}>{release.name ?? release.releaseId}</h1>
          <div className={styles.detailHeaderContact}>
            <span>{TYPE_LABELS[release.type ?? ''] ?? release.type ?? '—'}</span>
            <span>
              Released {release.releasedAt ? formatDateMedium(release.releasedAt) : '—'}
              {release.createdByActor ? ` by ${release.createdByActor}` : ''}
            </span>
            {release.revokedAt && (
              <span>
                Revoked {formatDateMedium(release.revokedAt)}
                {release.revokedBy ? ` by ${release.revokedBy}` : ''}
              </span>
            )}
          </div>
        </div>
        <div className={styles.detailHeaderBadges}>
          <span className={styles.badge}>{status}</span>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={() => setShowRevoke(true)}
            disabled={!canRevoke}
            title={!canRevoke ? 'Only active releases can be revoked' : undefined}
          >
            Revoke release…
          </button>
        </div>
      </div>

      <div className={styles.statsStrip}>
        <div className={styles.statChip}>
          <span className={styles.statValue}>
            {isQuota ? '—' : grantedCount.toLocaleString('en-AU')}
          </span>
          <span className={styles.statLabel}>Granted</span>
        </div>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{claimedCount.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Claimed</span>
        </div>
        <div className={styles.statChip}>
          <span className={styles.statValue}>{unclaimed.toLocaleString('en-AU')}</span>
          <span className={styles.statLabel}>Unclaimed</span>
        </div>
        <div className={styles.statChip}>
          <span className={styles.statValue}>
            {(release.smsSentCount ?? 0).toLocaleString('en-AU')}
          </span>
          <span className={styles.statLabel}>SMS sent</span>
        </div>
        <div className={styles.statChip}>
          <span className={styles.statValue}>
            {(release.smsFailedCount ?? 0).toLocaleString('en-AU')}
          </span>
          <span className={styles.statLabel}>SMS failed</span>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Mobile</th>
              <th>Contact</th>
              <th>Source</th>
              <th>Status</th>
              <th>SMS</th>
              <th>Claimed</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && docs.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.emptyCell}>
                  Loading grants…
                </td>
              </tr>
            ) : docs.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.emptyCell}>
                  No grants yet.
                </td>
              </tr>
            ) : (
              docs.map((g) => (
                <tr
                  key={g.id}
                  className={styles.row}
                  onClick={() => {
                    if (g.contactId) router.push(`/admin/marketing/contacts/${g.contactId}`)
                  }}
                >
                  <td>{g.mobileE164}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {g.contactId ? (
                      <Link
                        href={`/admin/marketing/contacts/${g.contactId}`}
                        className={styles.nameLink}
                      >
                        {g.contactId}
                      </Link>
                    ) : g.customerId ? (
                      // Back-filled from customer.* events (join key: verified
                      // mobile) — no marketing contact yet, but the claimant is
                      // a customer we can jump straight to in servicing.
                      <Link href={`/admin/servicing/${g.customerId}`} className={styles.nameLink}>
                        {g.customerId}
                      </Link>
                    ) : (
                      <span className={styles.placeholder}>—</span>
                    )}
                  </td>
                  <td>{SOURCE_LABELS[g.source ?? ''] ?? g.source ?? '—'}</td>
                  <td>
                    <span className={grantStatusBadgeClass(g.status)}>{g.status ?? '—'}</span>
                  </td>
                  <td>
                    <span className={smsStatusBadgeClass(g.smsStatus)}>
                      {g.smsStatus ?? 'not_sent'}
                    </span>
                  </td>
                  <td>{g.claimedAt ? formatDateShort(g.claimedAt) : '—'}</td>
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
            disabled={!grants || page <= 1}
          >
            ← Previous
          </button>
          <span className={styles.pageStatus}>
            Page {grants?.page ?? page} of {grants?.totalPages ?? 1} · {grants?.totalDocs ?? 0}{' '}
            grants
          </span>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setPage((p) => p + 1)}
            disabled={!grants || page >= (grants.totalPages ?? 1)}
          >
            Next →
          </button>
        </div>
      </div>

      {showRevoke && (
        <RevokeReleaseModal
          releaseId={release.releaseId}
          releaseName={release.name ?? release.releaseId}
          onClose={() => setShowRevoke(false)}
        />
      )}
    </div>
  )
}

interface RevokeReleaseModalProps {
  releaseId: string
  releaseName: string
  onClose: () => void
}

/**
 * Typed-confirmation revoke dialog (ux-standards irreversible-action
 * pattern): the exact release name must be typed to enable the confirm
 * button. Every remaining grant — granted and claimed — is cancelled
 * immediately, blocking gate re-entry; only conversations already in
 * progress continue. This can't be undone.
 */
const RevokeReleaseModal: React.FC<RevokeReleaseModalProps> = ({
  releaseId,
  releaseName,
  onClose,
}) => {
  const [confirmation, setConfirmation] = useState('')
  const [reason, setReason] = useState('')
  const revoke = useRevokeRelease()

  const canSubmit = confirmation.trim() === releaseName && !revoke.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    revoke.mutate({ releaseId, reason: reason.trim() || undefined }, { onSuccess: () => onClose() })
  }

  return (
    <Modal title="Revoke release — irreversible" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          {revoke.isError && (
            <div className={styles.errorMessage}>
              {revoke.error instanceof Error ? revoke.error.message : 'Failed to revoke release'}
            </div>
          )}

          <div className={styles.errorMessage}>
            Cancels every remaining grant — including claimed ones, blocking re-entry. Conversations
            already in progress are not interrupted. <strong>This cannot be undone.</strong>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="revoke-reason">
              Reason (optional)
            </label>
            <textarea
              id="revoke-reason"
              className={styles.formInput}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="revoke-confirmation">
              Type <strong>{releaseName}</strong> to confirm
            </label>
            <input
              id="revoke-confirmation"
              autoFocus
              type="text"
              className={styles.formInput}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={releaseName}
              autoComplete="off"
            />
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnCancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.btnDanger}
            disabled={!canSubmit}
            title={!canSubmit ? `Type "${releaseName}" exactly to enable` : undefined}
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke release'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default ReleaseDetail
