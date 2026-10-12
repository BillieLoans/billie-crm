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
import { ClearBlockButton } from '@/components/BlockClear'
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
 * - Blocked, no decision → red, same block detail. The authenticated
 *   session-start halt (BTB-139) emits application.reapplication_blocked.v1
 *   without the follow-on final_credit_decision, so the row carries the
 *   block while finalDecision stays null and status stays active. Rendered
 *   whenever an uncleared "block"-kind halt exists and no credit decision has
 *   been recorded, so the halt is never hidden behind "No decision yet".
 * - Review halt      → indigo. A "review"-kind re-application halt is
 *   NOT a decline: the applicant was flagged as a probable returning customer
 *   and auto-held for manual review. Rendered on its own axis (before the
 *   decision states) with the identity-recognition match context — see
 *   {@link ReviewHalt}.
 */
export function DecisionBanner({ conversation }: DecisionBannerProps) {
  const { finalDecision, decisionDetail, reapplicationBlock } = conversation

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
    // An uncleared eligibility block with no credit decision behind it: the
    // halt happened at session start, before the credit FSM could decline.
    if (block && block.clearStatus !== 'cleared') {
      return (
        <div className={`${styles.banner} ${styles.declined}`} data-testid="decision-banner">
          <span className={styles.headline}>✗ Blocked · Re-application block</span>
          <span className={styles.subhead}>
            Application halted by an eligibility block — no credit decision recorded
          </span>
          <BlockDetail conversation={conversation} block={block} />
          <ClearBlockButton
            block={block}
            conversationId={conversation.conversationId}
            customerName={conversation.customer?.fullName ?? undefined}
          />
        </div>
      )
    }
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

  return (
    <div className={`${styles.banner} ${styles.declined}`} data-testid="decision-banner">
      <span className={styles.headline}>{headline}</span>
      {isBlockDecline && <BlockDetail conversation={conversation} block={block} />}
      {isBlockDecline && (
        <ClearBlockButton
          block={block}
          conversationId={conversation.conversationId}
          customerName={conversation.customer?.fullName ?? undefined}
        />
      )}
    </div>
  )
}

/**
 * BlockDetail — the "why was this halted" rows shared by the block-decline and
 * the blocked-without-decision states. Prefers the rich block fields (event 1,
 * application.reapplication_blocked.v1); falls back to the decision detail
 * carried on final_credit_decision (event 2) when only that has projected.
 */
function BlockDetail({
  conversation,
  block,
}: {
  conversation: ConversationDetail
  block: ReapplicationBlock | null
}) {
  const { decisionDetail, sourceConversationId } = conversation
  const blockReason = block?.reason ?? decisionDetail?.reason?.replace('REAPPLICATION_BLOCK:', '')
  const blockedUntilText = formatBlockedUntil({
    reason: blockReason,
    blockedUntil: (block?.blockedUntil ?? decisionDetail?.blockedUntil) as string | null,
  })
  const sourceApplicationNumber =
    block?.sourceApplicationNumber ?? decisionDetail?.sourceApplicationNumber
  const sourceAccountId = block?.sourceAccountId
  // Prefer the human-readable account number; the ledger GUID is the fallback
  // (older rows, or an account the CRM has not projected yet).
  const sourceAccountLabel = block?.sourceAccountNumber ?? sourceAccountId
  const customerId = conversation.customer?.customerId

  return (
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
            {block?.sourceDecidedAt ? ` (${formatDateOnly(block.sourceDecidedAt as string)})` : ''}
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
                title={sourceAccountId}
              >
                {sourceAccountLabel} →
              </Link>
            ) : (
              <span className={styles.mono} title={sourceAccountId}>
                {sourceAccountLabel}
              </span>
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
