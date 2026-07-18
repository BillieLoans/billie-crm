'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  useMarketingContact,
  marketingContactQueryKey,
  fetchMarketingContact,
} from '@/hooks/queries/useMarketingContact'
import { useContactIdentity, type IdentitySibling } from '@/hooks/queries/useContactIdentity'
import { useContactReferrals } from '@/hooks/queries/useContactReferrals'
import { useFeedbackQueue } from '@/hooks/queries/useFeedbackQueue'
import { useAuth } from '@payloadcms/ui'
import {
  useSetAdvisoryCouncil,
  useSetReviewFlag,
  useUnlinkContact,
} from '@/hooks/mutations/useMarketingCommands'
import { isAdmin } from '@/lib/access'
import { LinkCustomerModal } from './LinkCustomerModal'
import { RecordConsentModal } from './RecordConsentModal'
import { EraseContactModal } from './EraseContactModal'
import { MergeContactsModal } from './MergeContactsModal'
import { MarketingSubnav } from './MarketingSubnav'
import { Modal } from './Modal'
import type { ContactAuditLog, Interaction } from '@/payload-types'
import { formatDateMedium } from '@/lib/formatters'
import {
  CHANNEL_LABELS,
  CONSENT_CHANNELS,
  describeConsentAudit,
  eventTypeLabel,
  interactionKindLabel,
  loanStatusLabel,
  sourceLabel,
  stageLabel,
  summariseConsent,
} from '@/lib/marketing-labels'
import styles from './styles.module.css'

export interface ContactDetailProps {
  contactId: string
}

const KIND_ICONS: Record<string, string> = {
  signup: '🆕',
  message_out: '📤',
  message_in: '📥',
  feedback_prompt: '💬',
  referral: '🔗',
  stage_change: '🔀',
  note: '🗒️',
  import: '📦',
}

/** Timeline filter chips → the interaction kinds they cover. */
const TIMELINE_FILTERS: Array<{ key: string; label: string; kinds: string[] | null }> = [
  { key: 'all', label: 'All', kinds: null },
  { key: 'messages', label: 'Messages', kinds: ['message_out', 'message_in'] },
  { key: 'notes', label: 'Notes', kinds: ['note'] },
  { key: 'feedback', label: 'Feedback', kinds: ['feedback_prompt'] },
  { key: 'system', label: 'System', kinds: ['signup', 'referral', 'stage_change', 'import'] },
]

const TIMELINE_PAGE_SIZE = 25

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

const BASIS_LABELS: Record<string, string> = {
  same_customer: 'same customer',
  same_mobile: 'same mobile',
  same_email: 'same email',
}

const siblingDisplayName = (s: IdentitySibling): string =>
  s.firstName ?? s.mobileE164 ?? s.email ?? s.contactId.slice(0, 8)

const Panel: React.FC<{ title: string; children: React.ReactNode; danger?: boolean }> = ({
  title,
  children,
  danger,
}) => (
  <section className={danger ? `${styles.panel} ${styles.dangerZone}` : styles.panel}>
    <h2 className={styles.panelTitle}>{title}</h2>
    <div className={styles.panelBody}>{children}</div>
  </section>
)

const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <button
    type="button"
    className={styles.copyButton}
    title={`Copy ${label}`}
    aria-label={`Copy ${label}`}
    onClick={async () => {
      try {
        await navigator.clipboard.writeText(value)
        toast.success(`${label} copied`)
      } catch {
        toast.error(`Could not copy the ${label.toLowerCase()}`)
      }
    }}
  >
    ⧉
  </button>
)

const InteractionCard: React.FC<{ interaction: Interaction; sourceLabel?: string }> = ({
  interaction,
  sourceLabel: siblingLabel,
}) => (
  <article className={styles.timelineCard}>
    <div className={styles.timelineCardHeader}>
      <span className={styles.timelineIcon} aria-hidden="true">
        {(interaction.kind && KIND_ICONS[interaction.kind]) ?? '📝'}
      </span>
      <span className={styles.timelineKind}>{interactionKindLabel(interaction.kind)}</span>
      {siblingLabel && <span className={styles.timelineSourceBadge}>{siblingLabel}</span>}
      {interaction.direction && (
        <span className={styles.timelineDirection}>({interaction.direction})</span>
      )}
      <span className={styles.timelineTimestamp}>
        {interaction.occurredAt ? formatDateMedium(interaction.occurredAt) : '—'}
      </span>
    </div>
    {interaction.subject && <div className={styles.timelineSubject}>{interaction.subject}</div>}
    <div className={styles.timelineBody}>{interaction.body ?? '—'}</div>
  </article>
)

/**
 * ContactDetail — the marketing contact profile.
 *
 * Left column: filterable reverse-chron interaction timeline with an inline
 * "Log note" form. Right rail: three groups — Profile (customer link,
 * referrals, advisory council), Compliance (consent, review flag, privacy),
 * Activity (feedback, duplicates, audit) — with all platform vocabulary
 * humanized via marketing-labels.
 */
export const ContactDetail: React.FC<ContactDetailProps> = ({ contactId }) => {
  const { data, isLoading, isError } = useMarketingContact(contactId)
  const { data: identity } = useContactIdentity(contactId)
  const { data: referrals } = useContactReferrals(contactId)
  const { data: feedback } = useFeedbackQueue({ contact_id: contactId })
  const queryClient = useQueryClient()
  const [noteText, setNoteText] = useState('')
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [showFlagModal, setShowFlagModal] = useState(false)
  const [showConsentModal, setShowConsentModal] = useState(false)
  const [showEraseModal, setShowEraseModal] = useState(false)
  const [includeSiblings, setIncludeSiblings] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<IdentitySibling | null>(null)
  const [flagReason, setFlagReason] = useState('')
  const [timelineFilter, setTimelineFilter] = useState('all')
  const [timelineLimit, setTimelineLimit] = useState(TIMELINE_PAGE_SIZE)
  const { user } = useAuth()
  const userIsAdmin = isAdmin(user)
  const unlink = useUnlinkContact()
  const reviewFlag = useSetReviewFlag()
  const advisory = useSetAdvisoryCouncil()

  const logNoteMutation = useMutation({
    mutationFn: logNote,
    // Optimistic: the note appears in the timeline immediately; the lagged
    // invalidations below replace it with the projected row once it lands.
    onMutate: async ({ body }) => {
      await queryClient.cancelQueries({ queryKey: marketingContactQueryKey(contactId) })
      const key = marketingContactQueryKey(contactId)
      const previous = queryClient.getQueryData(key)
      queryClient.setQueryData(key, (old: unknown) => {
        const detail = old as
          | { contact: unknown; interactions: Interaction[]; audit: unknown[] }
          | undefined
        if (!detail) return old
        const optimistic = {
          id: `optimistic-${body.length}-${detail.interactions.length}`,
          kind: 'note',
          body,
          occurredAt: new Date().toISOString(),
        } as unknown as Interaction
        return { ...detail, interactions: [optimistic, ...detail.interactions] }
      })
      return { previous }
    },
    onSuccess: () => {
      toast.success('Note logged')
      setNoteText('')
      // Command → projection lag: refetch now and again shortly after so the
      // optimistic entry is replaced by the real row without a manual refresh.
      const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: marketingContactQueryKey(contactId) })
      invalidate()
      setTimeout(invalidate, 1500)
      setTimeout(invalidate, 4000)
    },
    onError: (error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(marketingContactQueryKey(contactId), context.previous)
      }
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

  // Combined timeline: siblings' interactions load only when toggled on, via
  // the same per-contact query key the detail view uses (shared cache).
  const siblings = useMemo(() => identity?.siblings ?? [], [identity?.siblings])
  const siblingDetails = useQueries({
    queries: siblings.map((s) => ({
      queryKey: marketingContactQueryKey(s.contactId),
      queryFn: () => fetchMarketingContact(s.contactId),
      enabled: includeSiblings,
    })),
  })

  const timeline = useMemo(() => {
    if (!data) return []
    const ownEntries = data.interactions.map((i) => ({
      interaction: i,
      sourceLabel: undefined as string | undefined,
    }))
    const siblingEntries = includeSiblings
      ? siblingDetails.flatMap((q, idx) => {
          const sibling = siblings[idx]
          if (!q.data || !sibling) return []
          const label = siblingDisplayName(sibling)
          return q.data.interactions.map((i) => ({ interaction: i, sourceLabel: label }))
        })
      : []
    const activeKinds = TIMELINE_FILTERS.find((f) => f.key === timelineFilter)?.kinds ?? null
    const combined = [...ownEntries, ...siblingEntries].filter(
      (e) => !activeKinds || (e.interaction.kind && activeKinds.includes(e.interaction.kind)),
    )
    combined.sort((a, b) => {
      const aTime = a.interaction.occurredAt ? new Date(a.interaction.occurredAt).getTime() : 0
      const bTime = b.interaction.occurredAt ? new Date(b.interaction.occurredAt).getTime() : 0
      return bTime - aTime
    })
    return combined
  }, [data, includeSiblings, siblingDetails, siblings, timelineFilter])

  if (isLoading && !data) {
    return (
      <div className={styles.container}>
        <MarketingSubnav />
        <div className={styles.emptyState}>Loading contact…</div>
      </div>
    )
  }

  if (isError || !data?.contact) {
    return (
      <div className={styles.container}>
        <MarketingSubnav />
        <div className={styles.emptyState}>Contact not found.</div>
      </div>
    )
  }

  const { contact, audit } = data
  const consentHistory: ContactAuditLog[] = sortByOccurredAtDesc(
    audit.filter((row) => /consent/i.test(row.eventType)),
  )
  const recentAudit = sortByOccurredAtDesc(audit).slice(0, 10)
  const consent = summariseConsent(contact.consent)
  const visibleTimeline = timeline.slice(0, timelineLimit)

  return (
    <div className={styles.container}>
      <MarketingSubnav />

      <div className={styles.detailHeader}>
        <div className={styles.detailHeaderMain}>
          <h1 className={styles.headerTitle}>{contact.firstName ?? 'Unnamed contact'}</h1>
          <div className={styles.detailHeaderContact}>
            <span>
              {contact.mobileE164 ?? '—'}
              {contact.mobileE164 && <CopyButton value={contact.mobileE164} label="Mobile" />}
            </span>
            <span>
              {contact.email ?? '—'}
              {contact.email && <CopyButton value={contact.email} label="Email" />}
            </span>
          </div>
          <div className={styles.detailHeaderContact}>
            {contact.city && <span>{contact.city}</span>}
            {contact.source && <span>Source: {sourceLabel(contact.source)}</span>}
            {contact.referralCode && <span>Referral code: {contact.referralCode}</span>}
          </div>
        </div>
        <div className={styles.detailHeaderBadges}>
          <span className={styles.badge}>{stageLabel(contact.derivedStage)}</span>
          {consent.granted === true && consent.channels ? (
            <span className={styles.channelChips} title="Marketing consent by channel">
              {CONSENT_CHANNELS.map((ch) => (
                <span
                  key={ch}
                  className={
                    consent.channels?.includes(ch)
                      ? styles.channelChip
                      : `${styles.channelChip} ${styles.channelChipOff}`
                  }
                >
                  {CHANNEL_LABELS[ch]}
                </span>
              ))}
            </span>
          ) : consent.granted === true ? (
            <span className={`${styles.badge} ${styles.badgeConsentGranted}`}>Consent granted</span>
          ) : consent.granted === false ? (
            <span className={`${styles.badge} ${styles.badgeConsentDeclined}`}>
              Consent declined
            </span>
          ) : (
            <span className={styles.placeholder}>No consent recorded</span>
          )}
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

          <div className={styles.timelineFilters}>
            {TIMELINE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={
                  timelineFilter === f.key
                    ? `${styles.timelineFilterChip} ${styles.timelineFilterChipActive}`
                    : styles.timelineFilterChip
                }
                onClick={() => {
                  setTimelineFilter(f.key)
                  setTimelineLimit(TIMELINE_PAGE_SIZE)
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          {siblings.length > 0 && (
            <label className={styles.timelineToggle}>
              <input
                type="checkbox"
                checked={includeSiblings}
                onChange={(e) => setIncludeSiblings(e.target.checked)}
              />
              Include {siblings.length} linked record{siblings.length === 1 ? '' : 's'} in the
              timeline
            </label>
          )}

          <div className={styles.timeline}>
            {visibleTimeline.length === 0 ? (
              <div className={styles.emptyState}>
                {timelineFilter === 'all'
                  ? 'No interactions recorded yet — log the first note above.'
                  : 'Nothing in the timeline matches this filter.'}
              </div>
            ) : (
              visibleTimeline.map((item) => (
                <InteractionCard
                  key={`${item.sourceLabel ?? 'own'}-${item.interaction.id}`}
                  interaction={item.interaction}
                  sourceLabel={item.sourceLabel}
                />
              ))
            )}
            {timeline.length > timelineLimit && (
              <button
                type="button"
                className={styles.showMoreButton}
                onClick={() => setTimelineLimit((l) => l + TIMELINE_PAGE_SIZE)}
              >
                Show {Math.min(TIMELINE_PAGE_SIZE, timeline.length - timelineLimit)} more of{' '}
                {timeline.length}
              </button>
            )}
          </div>
        </div>

        <div className={styles.detailRight}>
          <h2 className={styles.railGroupTitle}>Profile</h2>

          {/* Manual contact<->customer linking (LinkContact/UnlinkContact
              commands). Fixed layout: both buttons always present; Unlink
              disables when there is no link to remove. */}
          <Panel title="Customer">
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
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Loan status</span>
              <span className={styles.panelRowValue}>{loanStatusLabel(contact.loanStatus)}</span>
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

          <Panel title="Referrals">
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Referral code</span>
              <span className={styles.panelRowValue}>{contact.referralCode ?? '—'}</span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Referred by</span>
              <span className={styles.panelRowValue}>
                {referrals?.referrer ? (
                  <Link
                    href={`/admin/marketing/contacts/${referrals.referrer.contactId}`}
                    className={styles.nameLink}
                  >
                    {referrals.referrer.firstName ?? referrals.referrer.contactId}
                  </Link>
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Referred</span>
              <span className={styles.panelRowValue}>{referrals?.referredCount ?? 0}</span>
            </div>
            {(referrals?.referred ?? []).map((r) => (
              <div key={r.contactId} className={styles.panelRow}>
                <span className={styles.panelRowPrimary}>
                  ↳{' '}
                  <Link href={`/admin/marketing/contacts/${r.contactId}`} className={styles.nameLink}>
                    {r.firstName ?? r.contactId}
                  </Link>
                </span>
                <span className={styles.panelRowMeta}>{stageLabel(r.derivedStage)}</span>
              </div>
            ))}
          </Panel>

          {/* Advisory council (panel_member) — first-batch feedback panel. */}
          <Panel title="Advisory council">
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Status</span>
              <span className={styles.panelRowValue}>{contact.panelMember ? 'Member' : '—'}</span>
            </div>
            <div className={styles.panelButtonRow}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => advisory.mutate({ contactId, member: !contact.panelMember })}
                disabled={advisory.isPending}
              >
                {advisory.isPending
                  ? 'Saving…'
                  : contact.panelMember
                    ? 'Remove from council'
                    : 'Add to council…'}
              </button>
            </div>
          </Panel>

          <h2 className={styles.railGroupTitle}>Compliance</h2>

          <Panel title="Consent">
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Marketing</span>
              <span className={styles.panelRowValue}>
                {consent.granted === true
                  ? 'Granted'
                  : consent.granted === false
                    ? 'Declined'
                    : 'Not recorded'}
              </span>
            </div>
            {consent.channels && (
              <div className={styles.panelRow}>
                <span className={styles.panelRowLabel}>Channels</span>
                <span className={styles.panelRowValue}>
                  {consent.channels.map((c) => CHANNEL_LABELS[c]).join(', ')}
                </span>
              </div>
            )}
            {consentHistory.map((row) => (
              <div key={row.id} className={styles.panelRow}>
                <span className={styles.panelRowPrimary}>
                  {describeConsentAudit(row.detail) ?? eventTypeLabel(row.eventType)}
                </span>
                <span className={styles.panelRowMeta}>
                  {row.occurredAt ? formatDateMedium(row.occurredAt) : '—'}
                </span>
              </div>
            ))}
            {consentHistory.length === 0 && <div className={styles.panelEmpty}>No history yet</div>}
            <div className={styles.panelButtonRow}>
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setShowConsentModal(true)}
              >
                Record consent…
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

          <Panel title="Data & privacy" danger>
            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Status</span>
              <span className={styles.panelRowValue}>{contact.erased ? 'Erased' : 'Active'}</span>
            </div>
            <div className={styles.panelButtonRow}>
              <button
                type="button"
                className={styles.pageButton}
                title="Download everything held about this contact (admin only)"
                onClick={() => {
                  window.location.href = `/api/marketing/contacts/${contactId}/export`
                }}
              >
                Download export
              </button>
              <button
                type="button"
                className={styles.pageButtonDanger}
                disabled={!userIsAdmin || !!contact.erased}
                title={
                  userIsAdmin
                    ? 'Permanently erase this contact (right to be forgotten)'
                    : 'Admin only'
                }
                onClick={() => setShowEraseModal(true)}
              >
                Erase contact…
              </button>
            </div>
          </Panel>

          <h2 className={styles.railGroupTitle}>Activity</h2>

          <Panel title={`Feedback${feedback?.totalDocs ? ` (${feedback.totalDocs})` : ''}`}>
            {!feedback || feedback.docs.length === 0 ? (
              <div className={styles.panelEmpty}>No feedback from this contact</div>
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

          {/* Identity graph: every record the system believes is this same
              person, with the basis for each connection. */}
          <Panel title="Possible duplicates">
            {siblings.length === 0 ? (
              <div className={styles.panelEmpty}>None detected</div>
            ) : (
              siblings.map((s) => (
                <div key={s.contactId} className={styles.panelRow}>
                  <span className={styles.panelRowPrimary}>
                    <Link
                      href={`/admin/marketing/contacts/${s.contactId}`}
                      className={styles.nameLink}
                    >
                      {siblingDisplayName(s)}
                    </Link>
                    {s.derivedStage ? ` · ${stageLabel(s.derivedStage)}` : ''}
                  </span>
                  <span className={styles.panelRowMeta}>
                    {s.bases.map((b) => BASIS_LABELS[b] ?? b).join(', ')}
                  </span>
                  <button
                    type="button"
                    className={styles.pageButton}
                    onClick={() => setMergeTarget(s)}
                    title="Merge this record into the contact being viewed"
                  >
                    Merge…
                  </button>
                </div>
              ))
            )}
          </Panel>

          <Panel title="Audit (last 10)">
            {recentAudit.length === 0 ? (
              <div className={styles.panelEmpty}>—</div>
            ) : (
              recentAudit.map((row) => (
                <div key={row.id} className={styles.panelRow}>
                  <span className={styles.panelRowPrimary} title={row.eventType}>
                    {eventTypeLabel(row.eventType)}
                  </span>
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

      {mergeTarget && (
        <MergeContactsModal
          survivorContactId={contactId}
          survivorName={contact.firstName ?? 'this contact'}
          sibling={mergeTarget}
          onClose={() => setMergeTarget(null)}
        />
      )}

      {showEraseModal && (
        <EraseContactModal
          contactId={contactId}
          contactName={contact.firstName ?? null}
          onClose={() => setShowEraseModal(false)}
        />
      )}

      {showLinkModal && (
        <LinkCustomerModal
          contactId={contactId}
          contactName={contact.firstName ?? 'this contact'}
          onClose={() => setShowLinkModal(false)}
        />
      )}

      {showConsentModal && (
        <RecordConsentModal
          contactId={contactId}
          contactName={contact.firstName ?? 'this contact'}
          onClose={() => setShowConsentModal(false)}
        />
      )}

      {showFlagModal && (
        <Modal
          title="Flag for review"
          onClose={() => setShowFlagModal(false)}
          footer={
            <>
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
            </>
          }
        >
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
        </Modal>
      )}

      {showUnlinkConfirm && (
        <Modal
          title="Unlink customer"
          onClose={() => setShowUnlinkConfirm(false)}
          footer={
            <>
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
            </>
          }
        >
          <div className={styles.modalBody}>
            <p>
              Remove the link between <strong>{contact.firstName ?? 'this contact'}</strong> and
              customer <strong>{contact.customerId}</strong>?
            </p>
            <p className={styles.formHint}>
              The matcher may re-link automatically if the contact&apos;s mobile or email matches a
              customer record.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Default export for Payload import map
export default ContactDetail
