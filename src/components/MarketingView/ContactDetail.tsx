'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useMarketingContact, marketingContactQueryKey } from '@/hooks/queries/useMarketingContact'
import { useContactReferrals } from '@/hooks/queries/useContactReferrals'
import { useFeedbackQueue } from '@/hooks/queries/useFeedbackQueue'
import { useSetReviewFlag, useUnlinkContact } from '@/hooks/mutations/useMarketingCommands'
import { LinkCustomerModal } from './LinkCustomerModal'
import type { ContactAuditLog, Interaction } from '@/payload-types'
import { formatDateMedium } from '@/lib/formatters'
import { getMarketingConsentGranted } from '@/lib/marketing'
import styles from './styles.module.css'

export interface ContactDetailProps {
  contactId: string
}

const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  waitlist: 'Waitlist',
  invited: 'Invited',
  applicant: 'Applicant',
  customer: 'Customer',
  former_customer: 'Former customer',
}

const KIND_META: Record<string, { icon: string; label: string }> = {
  signup: { icon: '🆕', label: 'Signup' },
  message_out: { icon: '📤', label: 'Message out' },
  message_in: { icon: '📥', label: 'Message in' },
  feedback_prompt: { icon: '💬', label: 'Feedback prompt' },
  referral: { icon: '🔗', label: 'Referral' },
  stage_change: { icon: '🔀', label: 'Stage change' },
  note: { icon: '🗒️', label: 'Note' },
  import: { icon: '📦', label: 'Import' },
}

function sortByOccurredAtDesc<T extends { occurredAt?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : 0
    const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : 0
    return bTime - aTime
  })
}

interface LogNoteParams {
  contactId: string
  body: string
}

interface LogNoteResult {
  contactId: string
  eventId: string
}

async function logNote({ contactId, body }: LogNoteParams): Promise<LogNoteResult> {
  const res = await fetch(`/api/marketing/contacts/${encodeURIComponent(contactId)}/interactions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'note', body }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Logging the note failed: ${res.status}`)
  }
  return res.json()
}

const BackLink: React.FC = () => (
  <Link href="/admin/marketing" className={styles.backLink}>
    ← Back to Marketing
  </Link>
)

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className={styles.panel}>
    <h2 className={styles.panelTitle}>{title}</h2>
    <div className={styles.panelBody}>{children}</div>
  </section>
)

const InteractionCard: React.FC<{ interaction: Interaction }> = ({ interaction }) => {
  const meta = interaction.kind
    ? (KIND_META[interaction.kind] ?? { icon: '📝', label: interaction.kind })
    : { icon: '📝', label: 'Unknown' }

  return (
    <article className={styles.timelineCard}>
      <div className={styles.timelineCardHeader}>
        <span className={styles.timelineIcon} aria-hidden="true">
          {meta.icon}
        </span>
        <span className={styles.timelineKind}>{meta.label}</span>
        {interaction.direction && (
          <span className={styles.timelineDirection}>({interaction.direction})</span>
        )}
        <span className={styles.timelineTimestamp}>
          {interaction.occurredAt ? formatDateMedium(interaction.occurredAt) : '—'}
        </span>
      </div>
      <div className={styles.timelineSubject}>{interaction.subject ?? '—'}</div>
      <div className={styles.timelineBody}>{interaction.body ?? '—'}</div>
    </article>
  )
}

/**
 * ContactDetail — right-hand pane of the Task C6 marketing view.
 *
 * Header shows identity + stage/consent/linked-customer badges. Left column
 * is the reverse-chron interaction timeline (with an inline "Log note" form
 * posting to the C5 interactions command route). Right column is fixed
 * panels: consent history (derived from the audit trail), referral,
 * loan status, and the last 10 audit rows.
 */
export const ContactDetail: React.FC<ContactDetailProps> = ({ contactId }) => {
  const { data, isLoading, isError } = useMarketingContact(contactId)
  const { data: referrals } = useContactReferrals(contactId)
  const { data: feedback } = useFeedbackQueue({ contact_id: contactId })
  const queryClient = useQueryClient()
  const [noteText, setNoteText] = useState('')
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [showFlagModal, setShowFlagModal] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const unlink = useUnlinkContact()
  const reviewFlag = useSetReviewFlag()

  const logNoteMutation = useMutation({
    mutationFn: logNote,
    onSuccess: () => {
      toast.success('Note logged')
      setNoteText('')
      queryClient.invalidateQueries({ queryKey: marketingContactQueryKey(contactId) })
    },
    onError: (error) => {
      toast.error('Failed to log note', {
        description: error instanceof Error ? error.message : 'Please retry',
      })
    },
  })

  const handleLogNote = () => {
    const trimmed = noteText.trim()
    if (!trimmed) return
    logNoteMutation.mutate({ contactId, body: trimmed })
  }

  if (isLoading && !data) {
    return (
      <div className={styles.container}>
        <BackLink />
        <div className={styles.emptyState}>Loading contact…</div>
      </div>
    )
  }

  if (isError || !data?.contact) {
    return (
      <div className={styles.container}>
        <BackLink />
        <div className={styles.emptyState}>Contact not found.</div>
      </div>
    )
  }

  const { contact, interactions, audit } = data
  const timeline = sortByOccurredAtDesc(interactions)
  const consentHistory: ContactAuditLog[] = audit.filter((row) => /consent/i.test(row.eventType))
  const recentAudit = sortByOccurredAtDesc(audit).slice(0, 10)
  const consentGranted = getMarketingConsentGranted(contact.consent)

  return (
    <div className={styles.container}>
      <BackLink />

      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderMain}>
          <h1 className={styles.headerTitle}>{contact.firstName ?? 'Unnamed contact'}</h1>
          <div className={styles.detailHeaderContact}>
            <span>{contact.mobileE164 ?? '—'}</span>
            <span>{contact.email ?? '—'}</span>
          </div>
        </div>
        <div className={styles.detailHeaderBadges}>
          <span className={styles.badge}>
            {contact.derivedStage
              ? (STAGE_LABELS[contact.derivedStage] ?? contact.derivedStage)
              : '—'}
          </span>
          {consentGranted === true && (
            <span className={`${styles.badge} ${styles.badgeConsentGranted}`}>Consent granted</span>
          )}
          {consentGranted === false && (
            <span className={`${styles.badge} ${styles.badgeConsentDeclined}`}>
              Consent declined
            </span>
          )}
          {consentGranted === null && <span className={styles.placeholder}>Consent —</span>}
          {contact.customerId ? (
            <Link
              href={`/admin/servicing/${contact.customerId}`}
              className={`${styles.badge} ${styles.badgeLinked}`}
            >
              Linked customer: {contact.customerId}
            </Link>
          ) : (
            <span className={`${styles.badge} ${styles.badgeMuted}`}>Not linked</span>
          )}
        </div>
      </div>

      <div className={styles.detailBody}>
        <div className={styles.detailLeft}>
          <div className={styles.noteForm}>
            <textarea
              className={styles.noteTextarea}
              placeholder="Log a note…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={3}
              aria-label="Note text"
            />
            <button
              type="button"
              className={styles.noteButton}
              onClick={handleLogNote}
              disabled={!noteText.trim() || logNoteMutation.isPending}
            >
              {logNoteMutation.isPending ? 'Logging…' : 'Log note'}
            </button>
          </div>

          <div className={styles.timeline}>
            {timeline.length === 0 ? (
              <div className={styles.emptyState}>No interactions recorded yet.</div>
            ) : (
              timeline.map((item) => <InteractionCard key={item.id} interaction={item} />)
            )}
          </div>
        </div>

        <div className={styles.detailRight}>
          {/* Manual contact<->customer linking (LinkContact/UnlinkContact
              commands). Fixed layout: both buttons always present; Unlink
              disables when there is no link to remove. */}
          <Panel title="Customer link">
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Status</span>
              <span className={styles.panelRowValue}>
                {contact.customerId ? 'Linked' : 'Not linked'}
              </span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Customer</span>
              <span className={styles.panelRowValue}>
                {contact.customerId ? (
                  <Link href={`/admin/servicing/${contact.customerId}`} className={styles.nameLink}>
                    {contact.customerId}
                  </Link>
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Basis</span>
              <span className={styles.panelRowValue}>{contact.linkBasis ?? '—'}</span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Linked</span>
              <span className={styles.panelRowValue}>
                {contact.linkedAt ? formatDateMedium(contact.linkedAt) : '—'}
              </span>
            </div>
            <div className={styles.panelButtonRow}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setShowLinkModal(true)}
              >
                {contact.customerId ? 'Change…' : 'Link customer…'}
              </button>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setShowUnlinkConfirm(true)}
                disabled={!contact.customerId || unlink.isPending}
              >
                {unlink.isPending ? 'Unlinking…' : 'Unlink'}
              </button>
            </div>
          </Panel>

          {/* A2: needs-review flag — parked contacts receive no sends. */}
          <Panel title="Review">
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Status</span>
              <span className={styles.panelRowValue}>
                {contact.needsReview ? '⚑ Needs review' : '—'}
              </span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Reason</span>
              <span className={styles.panelRowValue}>
                {(contact.attributes as Record<string, unknown> | null)?.[
                  'needs_review_reason'
                ]?.toString() ?? '—'}
              </span>
            </div>
            <div className={styles.panelButtonRow}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setShowFlagModal(true)}
                disabled={!!contact.needsReview || reviewFlag.isPending}
              >
                Flag for review…
              </button>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => reviewFlag.mutate({ contactId, needsReview: false })}
                disabled={!contact.needsReview || reviewFlag.isPending}
              >
                {reviewFlag.isPending ? 'Saving…' : 'Clear flag'}
              </button>
            </div>
          </Panel>

          <Panel title="Consent history">
            {consentHistory.length === 0 ? (
              <div className={styles.panelEmpty}>—</div>
            ) : (
              consentHistory.map((row) => (
                <div key={row.id} className={styles.panelRow}>
                  <span className={styles.panelRowPrimary}>{row.eventType}</span>
                  <span className={styles.panelRowMeta}>
                    {row.occurredAt ? formatDateMedium(row.occurredAt) : '—'}
                  </span>
                </div>
              ))
            )}
          </Panel>

          <Panel title="Referrals">
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Referral code</span>
              <span className={styles.panelRowValue}>{contact.referralCode ?? '—'}</span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Referred by</span>
              <span className={styles.panelRowValue}>
                {referrals?.referrer
                  ? (referrals.referrer.firstName ?? referrals.referrer.contactId)
                  : '—'}
              </span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Referred</span>
              <span className={styles.panelRowValue}>{referrals?.referredCount ?? 0}</span>
            </div>
            {(referrals?.referred ?? []).map((r) => (
              <div key={r.contactId} className={styles.panelRow}>
                <span className={styles.panelRowPrimary}>↳ {r.firstName ?? r.contactId}</span>
                <span className={styles.panelRowMeta}>
                  {r.derivedStage ? (STAGE_LABELS[r.derivedStage] ?? r.derivedStage) : '—'}
                </span>
              </div>
            ))}
          </Panel>

          <Panel title={`Feedback${feedback?.totalDocs ? ` (${feedback.totalDocs})` : ''}`}>
            {!feedback || feedback.docs.length === 0 ? (
              <div className={styles.panelEmpty}>—</div>
            ) : (
              feedback.docs.map((f) => (
                <div key={f.id} className={styles.panelRow}>
                  <span className={styles.panelRowPrimary}>
                    {f.feedbackType ? `${f.feedbackType}: ` : ''}
                    {f.body ?? '—'}
                  </span>
                  <span className={styles.panelRowMeta}>{f.status ?? '—'}</span>
                </div>
              ))
            )}
          </Panel>

          <Panel title="Loan status">
            <div className={styles.panelRow}>
              <span className={styles.panelRowValue}>{contact.loanStatus ?? '—'}</span>
            </div>
          </Panel>

          <Panel title="Audit (last 10)">
            {recentAudit.length === 0 ? (
              <div className={styles.panelEmpty}>—</div>
            ) : (
              recentAudit.map((row) => (
                <div key={row.id} className={styles.panelRow}>
                  <span className={styles.panelRowPrimary}>{row.eventType}</span>
                  <span className={styles.panelRowMeta}>
                    {row.actor ?? 'system'} ·{' '}
                    {row.occurredAt ? formatDateMedium(row.occurredAt) : '—'}
                  </span>
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>

      {showLinkModal && (
        <LinkCustomerModal
          contactId={contactId}
          contactName={contact.firstName ?? 'this contact'}
          onClose={() => setShowLinkModal(false)}
        />
      )}

      {showFlagModal && (
        <div className={styles.modalOverlay} onClick={() => setShowFlagModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Flag for review</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowFlagModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.formHint}>
                While flagged, this contact is excluded from every invitation send. The flag and
                reason are audited.
              </p>
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="review-flag-reason">
                  Reason (optional)
                </label>
                <textarea
                  id="review-flag-reason"
                  className={styles.noteTextarea}
                  rows={3}
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  placeholder="e.g. Possible duplicate of another contact — confirm before messaging"
                  maxLength={500}
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.btnCancel}
                onClick={() => setShowFlagModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnSubmit}
                onClick={() =>
                  reviewFlag.mutate(
                    { contactId, needsReview: true, reason: flagReason.trim() || undefined },
                    {
                      onSettled: () => {
                        setShowFlagModal(false)
                        setFlagReason('')
                      },
                    },
                  )
                }
                disabled={reviewFlag.isPending}
              >
                {reviewFlag.isPending ? 'Flagging…' : 'Flag for review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUnlinkConfirm && (
        <div className={styles.modalOverlay} onClick={() => setShowUnlinkConfirm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Unlink customer</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowUnlinkConfirm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>
                Remove the link between <strong>{contact.firstName ?? 'this contact'}</strong> and
                customer <strong>{contact.customerId}</strong>?
              </p>
              <p className={styles.formHint}>
                The matcher may re-link automatically if the contact&apos;s mobile or email matches
                a customer record.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.btnCancel}
                onClick={() => setShowUnlinkConfirm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnSubmit}
                onClick={() =>
                  unlink.mutate(contactId, { onSettled: () => setShowUnlinkConfirm(false) })
                }
                disabled={unlink.isPending}
              >
                {unlink.isPending ? 'Unlinking…' : 'Unlink'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Default export for Payload import map
export default ContactDetail
