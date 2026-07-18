'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useBatch } from '@/hooks/queries/useBatches'
import { useBatchPreflight } from '@/hooks/queries/useBatchPreflight'
import { useMarketingContacts } from '@/hooks/queries/useMarketingContacts'
import { useTriggerInvitations } from '@/hooks/mutations/useMarketingCommands'
import { formatDateMedium, formatDateShort } from '@/lib/formatters'
import { describeCriteria, stageLabel, summariseConsent } from '@/lib/marketing-labels'
import { MarketingSubnav } from './MarketingSubnav'
import { Modal } from './Modal'
import styles from './styles.module.css'

export interface CampaignDetailProps {
  batchId: string
}

/**
 * Campaign detail — criteria snapshot, send results, and the member list, on
 * one page. This is also where invitations are sent: the confirmation shows a
 * pre-flight partition of the audience (will receive / no consent / flagged)
 * computed from the same projection MarketingService partitions at send time,
 * so a send is an informed decision rather than an act of faith.
 */
export const CampaignDetail: React.FC<CampaignDetailProps> = ({ batchId }) => {
  const router = useRouter()
  const [page, setPage] = useState(1)
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  const { data: batch, isLoading } = useBatch(batchId)
  const members = useMarketingContacts({ batch: batchId, page })
  const preflight = useBatchPreflight(batchId, showSendConfirm)
  const invite = useTriggerInvitations()

  const docs = members.data?.docs ?? []
  const criteria =
    batch?.criteria && typeof batch.criteria === 'object' && !Array.isArray(batch.criteria)
      ? describeCriteria(batch.criteria as Record<string, unknown>)
      : []

  const handleSend = () => {
    if (invite.isPending) return
    invite.mutate(batchId, { onSettled: () => setShowSendConfirm(false) })
  }

  if (!batch && !isLoading) {
    return (
      <div className={styles.container}>
        <MarketingSubnav />
        <div className={styles.emptyState}>
          <p>This campaign is still syncing — it should appear within a few seconds.</p>
          <p className={styles.formHint}>
            Created campaigns land after the platform confirms them. This page refreshes
            automatically;{' '}
            <Link href="/admin/marketing/campaigns" className={styles.nameLink}>
              back to campaigns
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderMain}>
          <h1 className={styles.headerTitle}>{batch?.name ?? 'Campaign'}</h1>
          <div className={styles.detailHeaderContact}>
            <span>
              Created{' '}
              {batch?.batchCreatedAt ? formatDateMedium(batch.batchCreatedAt) : '—'}
            </span>
            <span>
              {typeof batch?.memberCount === 'number'
                ? `${batch.memberCount.toLocaleString('en-AU')} member${batch.memberCount === 1 ? '' : 's'}`
                : ''}
            </span>
          </div>
        </div>
        <div className={styles.detailHeaderBadges}>
          {batch?.invitedAt ? (
            <span
              className={`${styles.badge} ${styles.badgeConsentGranted}`}
              title={`Last send ${formatDateMedium(batch.invitedAt)}`}
            >
              Sent {formatDateShort(batch.invitedAt)}
            </span>
          ) : (
            <span className={`${styles.badge} ${styles.badgeMuted}`}>Not sent yet</span>
          )}
          <button
            type="button"
            className={styles.btnSubmit}
            onClick={() => setShowSendConfirm(true)}
            disabled={invite.isPending}
          >
            {invite.isPending ? 'Sending…' : 'Send invitations…'}
          </button>
        </div>
      </div>

      <div className={styles.statsStrip}>
        {criteria.length > 0 && (
          <div className={styles.statChip} title="The grid filters this campaign was built from">
            <span className={styles.statLabel}>Built from</span>
            <span className={styles.identitySecondary}>
              {criteria.map((c) => `${c.label}: ${c.value}`).join(' · ')}
            </span>
          </div>
        )}
        {batch?.invitedAt && (
          <>
            <div className={styles.statChip}>
              <span className={styles.statValue}>{batch.invitedCount ?? '—'}</span>
              <span className={styles.statLabel}>Invited</span>
            </div>
            <div className={styles.statChip}>
              <span className={styles.statValue}>{batch.skippedUnconsented ?? 0}</span>
              <span className={styles.statLabel}>No consent</span>
            </div>
            <div className={styles.statChip}>
              <span className={styles.statValue}>{batch.skippedNeedsReview ?? 0}</span>
              <span className={styles.statLabel}>Flagged</span>
            </div>
          </>
        )}
      </div>

      <div className={styles.tableWrapper}>
        {members.isError ? (
          <div className={styles.emptyState}>Failed to load members. Please retry.</div>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Stage</th>
                  <th>Consent</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {members.isLoading && docs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles.emptyCell}>
                      Loading members…
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles.emptyCell}>
                      No members yet — select contacts in the{' '}
                      <Link href="/admin/marketing" className={styles.nameLink}>
                        contacts grid
                      </Link>{' '}
                      and assign them to this campaign.
                    </td>
                  </tr>
                ) : (
                  docs.map((contact) => {
                    const consent = summariseConsent(contact.consent)
                    return (
                      <tr
                        key={contact.id}
                        className={styles.row}
                        onClick={() =>
                          router.push(`/admin/marketing/contacts/${contact.contactId}`)
                        }
                      >
                        <td>
                          <div className={styles.identityCell}>
                            <Link
                              href={`/admin/marketing/contacts/${contact.contactId}`}
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
                            <span className={styles.badge}>
                              {stageLabel(contact.derivedStage)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {consent.granted === true ? (
                            <span className={`${styles.badge} ${styles.badgeConsentGranted}`}>
                              Granted
                            </span>
                          ) : consent.granted === false ? (
                            <span className={`${styles.badge} ${styles.badgeConsentDeclined}`}>
                              Declined
                            </span>
                          ) : (
                            <span className={styles.placeholder}>—</span>
                          )}
                        </td>
                        <td>
                          {contact.needsReview ? (
                            <span className={`${styles.badge} ${styles.badgeConsentDeclined}`}>
                              ⚑ Review
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
                disabled={!members.data || !members.data.hasPrevPage}
              >
                ← Previous
              </button>
              <span className={styles.pageStatus}>
                Page {members.data?.page ?? page} of {members.data?.totalPages ?? 1} ·{' '}
                {members.data?.totalDocs ?? 0} members
              </span>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => p + 1)}
                disabled={!members.data || !members.data.hasNextPage}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>

      {showSendConfirm && (
        <Modal
          title={`Send invitations — ${batch?.name ?? 'campaign'}`}
          onClose={() => setShowSendConfirm(false)}
          footer={
            <>
              <button
                type="button"
                className={styles.btnCancel}
                onClick={() => setShowSendConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnSubmit}
                onClick={handleSend}
                disabled={invite.isPending || preflight.isLoading || !preflight.data}
              >
                {invite.isPending
                  ? 'Sending…'
                  : preflight.data
                    ? `Send to ${preflight.data.willReceive.toLocaleString('en-AU')} member${preflight.data.willReceive === 1 ? '' : 's'}`
                    : 'Send invitations'}
              </button>
            </>
          }
        >
          <div className={styles.modalBody}>
            {preflight.isLoading ? (
              <p className={styles.formHint}>Checking the audience…</p>
            ) : preflight.isError ? (
              <div className={styles.errorMessage}>
                Could not compute the audience summary. You can still send — the platform
                applies the same consent and review rules server-side.
              </div>
            ) : preflight.data ? (
              <>
                <div className={styles.preflightRow}>
                  <span>Campaign members</span>
                  <span className={styles.preflightValue}>
                    {preflight.data.memberCount.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Will receive an invitation</span>
                  <span className={`${styles.preflightValue} ${styles.preflightHighlight}`}>
                    {preflight.data.willReceive.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — no marketing consent</span>
                  <span className={styles.preflightValue}>
                    {preflight.data.skippedUnconsented.toLocaleString('en-AU')}
                  </span>
                </div>
                <div className={styles.preflightRow}>
                  <span>Skipped — flagged for review</span>
                  <span className={styles.preflightValue}>
                    {preflight.data.skippedNeedsReview.toLocaleString('en-AU')}
                  </span>
                </div>
                {preflight.data.willReceive === 0 && (
                  <div className={styles.warningMessage} style={{ marginTop: '0.75rem' }}>
                    Nobody in this campaign is currently eligible to receive an invitation.
                  </div>
                )}
              </>
            ) : null}
            <p className={styles.formHint}>
              Repeating the send for this campaign is deduplicated platform-side, so a
              double-click can&apos;t fan out a second wave.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default CampaignDetail
