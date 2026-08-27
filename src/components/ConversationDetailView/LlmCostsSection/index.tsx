'use client'

import React from 'react'
import { useAuth } from '@payloadcms/ui'
import { hasApprovalAuthority } from '@/lib/access'
import { formatUsd } from '@/lib/formatters'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import { AssessmentSection } from '../AssessmentPanel/AssessmentSection'
import panelStyles from '../AssessmentPanel/styles.module.css'
import styles from './styles.module.css'

const countFormatter = new Intl.NumberFormat('en-AU')

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={panelStyles.statementRow}>
      <span className={panelStyles.statementLabel}>{label}</span>
      <span className={panelStyles.statementValue}>{value}</span>
    </div>
  )
}

interface LlmCostsSectionProps {
  conversation: ConversationDetail
}

/**
 * "LLM Costs" expandable section for the right-hand assessment panel (BTB-302).
 *
 * Reads the cost roll-up carried on the conversation record itself —
 * `llmCostTotalUsd`, `llmCallCount`, `llmUnpricedCount` — which the event
 * processor maintains as it ingests llm_logs. That roll-up is the single
 * source of truth for display; the per-call `llm-costs` rows remain the
 * supervisor-only audit trail behind it. Deriving the totals here instead
 * would produce a second, silently divergent answer.
 *
 * No fetch of its own: the conversation is already loaded by the parent view.
 *
 * Rendered only for supervisor/admin (`hasApprovalAuthority`), matching how
 * the same cost data is classified on the `llm-costs` collection.
 */
export function LlmCostsSection({ conversation }: LlmCostsSectionProps) {
  const { user } = useAuth()
  if (!hasApprovalAuthority(user)) return null

  const totalUsd = conversation.llmCostTotalUsd ?? null
  const callCount = conversation.llmCallCount ?? null
  const unpricedCount = conversation.llmUnpricedCount ?? null

  // No roll-up yet: either the conversation predates BTB-302 or no llm_logs
  // entries have been ingested for it. Distinguish that from a genuine zero.
  const hasRollup = totalUsd != null || callCount != null

  const headerSummary = !hasRollup
    ? 'No data'
    : callCount === 0
      ? 'No calls'
      : `${formatUsd(totalUsd ?? 0)} · ${countFormatter.format(callCount ?? 0)} call${
          callCount === 1 ? '' : 's'
        }`

  const avgCostUsd =
    totalUsd != null && callCount != null && callCount > 0 ? totalUsd / callCount : null

  return (
    <AssessmentSection title="LLM Costs" summary={headerSummary}>
      {!hasRollup ? (
        <p>
          No LLM cost roll-up recorded for this application. Conversations that
          completed before cost tracking was enabled will not have one.
        </p>
      ) : callCount === 0 ? (
        <p>No LLM calls recorded for this application.</p>
      ) : (
        <div>
          <StatRow label="Total cost" value={formatUsd(totalUsd)} />
          <StatRow
            label="Calls"
            value={callCount != null ? countFormatter.format(callCount) : '—'}
          />
          <StatRow label="Average per call" value={formatUsd(avgCostUsd)} />
          {unpricedCount != null && (
            <StatRow label="Unpriced calls" value={countFormatter.format(unpricedCount)} />
          )}

          {unpricedCount != null && unpricedCount > 0 && (
            <p className={styles.warning}>
              {countFormatter.format(unpricedCount)} call
              {unpricedCount === 1 ? ' was' : 's were'} made with a model missing from the rate
              table, so the total above understates the true cost. Add the model to
              <code className={styles.code}>llm_rates.py</code> to price it.
            </p>
          )}
        </div>
      )}
    </AssessmentSection>
  )
}
