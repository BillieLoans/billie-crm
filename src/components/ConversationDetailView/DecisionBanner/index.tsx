'use client'

import Link from 'next/link'
import type { ConversationDetail, RecognitionCandidate } from '@/lib/schemas/conversations'
import {
  formatBlockReason,
  formatBlockedUntil,
  isBlockDeclineReason,
} from '@/lib/reapplicationBlock'
import {
  type SignalEntry,
  formatPosterior,
  formatSignalBits,
  groupSignalBits,
  signalLabel,
} from '@/lib/recognition'
import { formatDateOnly } from '@/lib/formatters'
import styles from './styles.module.css'

type ReapplicationBlock = NonNullable<ConversationDetail['reapplicationBlock']>

export interface DecisionBannerProps {
  conversation: ConversationDetail
}

/**
 * DecisionBanner — fixed slot at the top of the assessment panel answering
 * "what was decided, and why?" without expanding any section (BTB-135).
 *
 * Always rendered in the same position across all states (no reflow):
 * - No decision yet  → neutral
 * - APPROVED         → green
 * - REFERRED         → amber
 * - DECLINED         → red, with the decline reason. Block-declines render the
 *   rich detail from application.reapplication_blocked.v1 (the causal "why"),
 *   including the exclusion window, the prior decline that caused it, and the
 *   exact stop message the customer saw.
 * - Review halt      → indigo. A "review"-kind re-application halt is
 *   NOT a decline: the applicant was flagged as a probable returning customer
 *   and auto-held for manual review. Rendered on its own axis (before the
 *   decision states) with the identity-recognition match context — see
 *   {@link ReviewHalt}.
 */
export function DecisionBanner({ conversation }: DecisionBannerProps) {
  const { finalDecision, decisionDetail, reapplicationBlock, sourceConversationId } = conversation

  const decision = finalDecision?.toUpperCase() ?? null

  // A "review" halt is NOT a decline — the applicant was flagged as a probable
  // returning customer and auto-held for manual review. Surface it on
  // its own axis, before the credit-decision states, so it renders whatever the
  // (usually absent) decision is.
  if (reapplicationBlock?.dispositionKind === 'review') {
    return <ReviewHalt block={reapplicationBlock} />
  }

  const block = reapplicationBlock?.reason ? reapplicationBlock : null
  const isBlockDecline = Boolean(block) || isBlockDeclineReason(decisionDetail?.reason)

  if (decision === 'APPROVED') {
    return (
      <div className={`${styles.banner} ${styles.approved}`} data-testid="decision-banner">
        <span className={styles.headline}>✓ Approved</span>
      </div>
    )
  }

  if (decision === 'REFERRED') {
    return (
      <div className={`${styles.banner} ${styles.referred}`} data-testid="decision-banner">
        <span className={styles.headline}>→ Referred</span>
      </div>
    )
  }

  if (decision !== 'DECLINED') {
    return (
      <div className={`${styles.banner} ${styles.pending}`} data-testid="decision-banner">
        <span className={styles.headline}>○ No decision yet</span>
      </div>
    )
  }

  // DECLINED — answer "why?"
  const headline = isBlockDecline
    ? '✗ Declined · Re-application block'
    : decisionDetail?.reason
      ? `✗ Declined · ${decisionDetail.reason}`
      : '✗ Declined'

  // Prefer the rich block fields (event 1); fall back to decision detail (event 2).
  const blockReason = block?.reason ?? decisionDetail?.reason?.replace('REAPPLICATION_BLOCK:', '')
  const blockedUntilText = isBlockDecline
    ? formatBlockedUntil({
        reason: blockReason,
        blockedUntil: (block?.blockedUntil ?? decisionDetail?.blockedUntil) as string | null,
      })
    : null
  const sourceApplicationNumber =
    block?.sourceApplicationNumber ?? decisionDetail?.sourceApplicationNumber
  const sourceAccountId = block?.sourceAccountId
  const customerId = conversation.customer?.customerId

  return (
    <div className={`${styles.banner} ${styles.declined}`} data-testid="decision-banner">
      <span className={styles.headline}>{headline}</span>
      {isBlockDecline && (
        <div className={styles.detail}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Reason</span>
            <span className={styles.detailValue}>{formatBlockReason(blockReason)}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Blocked</span>
            <span className={styles.detailValue}>
              {blockedUntilText}
              {block?.blockedAt ? ` · since ${formatDateOnly(block.blockedAt as string)}` : ''}
            </span>
          </div>
          {sourceApplicationNumber && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Source decline</span>
              <span className={styles.detailValue}>
                {sourceConversationId ? (
                  <Link
                    href={`/admin/applications/${sourceConversationId}`}
                    className={styles.detailLink}
                  >
                    {sourceApplicationNumber} →
                  </Link>
                ) : (
                  <span className={styles.mono}>{sourceApplicationNumber}</span>
                )}
                {block?.sourceDecidedAt
                  ? ` (${formatDateOnly(block.sourceDecidedAt as string)})`
                  : ''}
              </span>
            </div>
          )}
          {sourceAccountId && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Source account</span>
              <span className={styles.detailValue}>
                {customerId ? (
                  <Link
                    href={`/admin/servicing/${customerId}?accountId=${encodeURIComponent(sourceAccountId)}`}
                    className={styles.detailLink}
                  >
                    {sourceAccountId} →
                  </Link>
                ) : (
                  <span className={styles.mono}>{sourceAccountId}</span>
                )}
              </span>
            </div>
          )}
          {block?.stopMessage && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Customer saw</span>
              <span className={`${styles.detailValue} ${styles.stopMessage}`}>
                “{block.stopMessage}”
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * ReviewHalt — the indigo "under review" panel for a review-kind halt. Unlike a
 * confirmed block (red), this isn't a decision: the applicant looks like a
 * returning customer and was auto-held. We surface the match confidence, the
 * case reference, and a per-candidate evidence breakdown so a reviewer can tell
 * a genuine returning customer from shared/duplicate contact details.
 */
function ReviewHalt({ block }: { block: ReapplicationBlock }) {
  const recognition = block.recognition
  const candidates = recognition?.candidates ?? []

  return (
    <div className={`${styles.banner} ${styles.review}`} data-testid="decision-banner">
      <span className={styles.headline}>⚑ Flagged for manual review</span>
      <span className={styles.subhead}>
        Not yet reviewed — auto-held as a probable returning customer
      </span>
      <div className={styles.detail}>
        {recognition?.posterior != null && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Match confidence</span>
            <span className={styles.detailValue}>
              {formatPosterior(recognition.posterior)}
              {recognition.band && <span className={styles.bandTag}>{recognition.band} band</span>}
            </span>
          </div>
        )}
        {recognition?.case_id && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Case</span>
            <span className={`${styles.detailValue} ${styles.mono}`}>{recognition.case_id}</span>
          </div>
        )}

        {candidates.length > 0 && (
          <div className={styles.matches}>
            <span className={styles.matchesHeading}>Potential matches</span>
            {candidates.map((candidate, i) => (
              <CandidateRow key={candidate.candidate_id ?? i} candidate={candidate} />
            ))}
          </div>
        )}

        {block.stopMessage && (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Customer saw</span>
            <span className={`${styles.detailValue} ${styles.stopMessage}`}>
              “{block.stopMessage}”
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function CandidateRow({ candidate }: { candidate: RecognitionCandidate }) {
  const { core, corroborating } = groupSignalBits(candidate.per_signal_bits)

  return (
    <div className={styles.candidate}>
      <div className={styles.candidateHead}>
        <span className={styles.mono}>{candidate.candidate_id ?? '—'}</span>
        <span className={styles.candidateScore}>{formatPosterior(candidate.posterior)}</span>
        {candidate.concealment && (
          <span className={styles.concealment} title="Applicant appears to be concealing identity">
            ⚠ Concealment
          </span>
        )}
      </div>
      {core.length > 0 && <SignalGroup label="Identity core" signals={core} />}
      {corroborating.length > 0 && <SignalGroup label="Corroborating" signals={corroborating} />}
    </div>
  )
}

function SignalGroup({ label, signals }: { label: string; signals: SignalEntry[] }) {
  return (
    <div className={styles.signalGroup}>
      <span className={styles.signalGroupLabel}>{label}</span>
      <div className={styles.chips}>
        {signals.map((s) => (
          <span
            key={s.signal}
            data-testid={`signal-chip-${s.signal}`}
            className={`${styles.chip} ${styles[s.sign]}`}
          >
            <span className={styles.chipLabel}>{signalLabel(s.signal)}</span>
            <span className={styles.chipBits}>{formatSignalBits(s.bits)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
