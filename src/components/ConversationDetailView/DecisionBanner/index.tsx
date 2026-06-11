'use client'

import Link from 'next/link'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import {
  formatBlockReason,
  formatBlockedUntil,
  isBlockDeclineReason,
} from '@/lib/reapplicationBlock'
import { formatDateOnly } from '@/lib/formatters'
import styles from './styles.module.css'

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
 */
export function DecisionBanner({ conversation }: DecisionBannerProps) {
  const { finalDecision, decisionDetail, reapplicationBlock, sourceConversationId } = conversation

  const decision = finalDecision?.toUpperCase() ?? null
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
