'use client'

import React from 'react'
import { useAuth } from '@payloadcms/ui'
import { hasApprovalAuthority } from '@/lib/access'
import { useLlmCosts } from '@/hooks/queries/useLlmCosts'
import { formatUsd, formatDateShort, formatDateMedium } from '@/lib/formatters'
import type { LlmCostBreakdownEntry } from '@/lib/llm-costs'
import { AssessmentSection } from '../AssessmentPanel/AssessmentSection'
import panelStyles from '../AssessmentPanel/styles.module.css'
import styles from './styles.module.css'

const tokenFormatter = new Intl.NumberFormat('en-AU')

const formatTokens = (n: number | null | undefined): string =>
  n == null ? '—' : tokenFormatter.format(n)

const formatMs = (ms: number | null | undefined): string =>
  ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms} ms`

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={panelStyles.statementRow}>
      <span className={panelStyles.statementLabel}>{label}</span>
      <span className={panelStyles.statementValue}>{value}</span>
    </div>
  )
}

function BreakdownTable({
  caption,
  keyHeader,
  entries,
}: {
  caption: string
  keyHeader: string
  entries: LlmCostBreakdownEntry[]
}) {
  if (entries.length === 0) return null
  return (
    <div className={styles.tableBlock}>
      <div className={styles.tableCaption}>{caption}</div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{keyHeader}</th>
              <th scope="col" className={styles.num}>
                Calls
              </th>
              <th scope="col" className={styles.num}>
                Tokens
              </th>
              <th scope="col" className={styles.num}>
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.key}>
                <td className={styles.keyCell}>{e.key}</td>
                <td className={styles.num}>{e.calls}</td>
                <td className={styles.num}>{formatTokens(e.totalTokens)}</td>
                <td className={styles.num}>{formatUsd(e.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface LlmCostsSectionProps {
  conversationId: string
}

/**
 * "LLM Costs" expandable section for the right-hand assessment panel
 * (BTB-302). Rolls up the `llm-costs` projection for this conversation:
 * effective/logged/computed USD totals, token and latency stats, per-model
 * and per-agent breakdowns, and the per-call detail.
 *
 * Rendered only for supervisor/admin (`hasApprovalAuthority`), matching the
 * collection's read access — other roles get no section and no request.
 */
export function LlmCostsSection({ conversationId }: LlmCostsSectionProps) {
  const { user } = useAuth()
  const canView = hasApprovalAuthority(user)
  const { data, isLoading, error } = useLlmCosts(conversationId, canView)

  if (!canView) return null

  const summary = data?.summary
  const headerSummary = summary
    ? summary.calls === 0
      ? 'No calls'
      : `${formatUsd(summary.costUsd)} · ${summary.calls} call${summary.calls === 1 ? '' : 's'}`
    : isLoading
      ? 'Loading…'
      : error
        ? 'Unavailable'
        : 'No data'

  return (
    <AssessmentSection title="LLM Costs" summary={headerSummary}>
      {!data ? (
        <p>{error ? 'Could not load LLM costs.' : 'Loading LLM costs…'}</p>
      ) : summary && summary.calls === 0 ? (
        <p>No LLM calls recorded for this conversation.</p>
      ) : summary ? (
        <div>
          <StatRow label="Total cost" value={formatUsd(summary.costUsd)} />
          <StatRow label="Logged (LiteLLM)" value={formatUsd(summary.loggedCostUsd)} />
          <StatRow label="Computed (rate table)" value={formatUsd(summary.computedCostUsd)} />
          <StatRow
            label="Calls"
            value={
              data.truncated
                ? `${summary.calls} (latest of ${data.totalDocs})`
                : String(summary.calls)
            }
          />
          <StatRow label="Total tokens" value={formatTokens(summary.totalTokens)} />
          <div className={styles.tokenDetail}>
            <StatRow label="· Prompt" value={formatTokens(summary.promptTokens)} />
            <StatRow label="· Completion" value={formatTokens(summary.completionTokens)} />
            <StatRow label="· Cached" value={formatTokens(summary.cachedTokens)} />
            <StatRow label="· Reasoning" value={formatTokens(summary.reasoningTokens)} />
          </div>
          <StatRow
            label="Response time"
            value={`avg ${formatMs(summary.avgResponseTimeMs)} · max ${formatMs(summary.maxResponseTimeMs)}`}
          />
          {summary.firstCalledAt && (
            <StatRow label="First call" value={formatDateMedium(summary.firstCalledAt)} />
          )}
          {summary.lastCalledAt && (
            <StatRow label="Last call" value={formatDateMedium(summary.lastCalledAt)} />
          )}
          {summary.rateVersions.length > 0 && (
            <StatRow label="Rate version" value={summary.rateVersions.join(', ')} />
          )}

          {summary.unpricedCalls > 0 && (
            <p className={styles.warning}>
              {summary.unpricedCalls} call{summary.unpricedCalls === 1 ? '' : 's'} unpriced — model
              missing from the rate table; logged cost used instead.
            </p>
          )}
          {summary.noUsageCalls > 0 && (
            <p className={styles.warning}>
              {summary.noUsageCalls} call{summary.noUsageCalls === 1 ? '' : 's'} logged without
              token usage — computed cost not derivable.
            </p>
          )}
          {data.truncated && (
            <p className={styles.warning}>
              Totals cover the latest {summary.calls} of {data.totalDocs} calls.
            </p>
          )}

          <BreakdownTable caption="By model" keyHeader="Model" entries={summary.byModel} />
          <BreakdownTable caption="By agent" keyHeader="Agent" entries={summary.byAgent} />

          {data.rows.length > 0 && (
            <div className={styles.tableBlock}>
              <div className={styles.tableCaption}>Calls (newest first)</div>
              <div className={`${styles.tableWrap} ${styles.callsWrap}`}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Time</th>
                      <th scope="col">Agent</th>
                      <th scope="col">Model</th>
                      <th scope="col" className={styles.num}>
                        Tokens
                      </th>
                      <th scope="col" className={styles.num}>
                        Time
                      </th>
                      <th scope="col" className={styles.num}>
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => {
                      const flags = [
                        !row.priced ? 'unpriced (model missing from rate table)' : null,
                        !row.hasUsage ? 'no token usage logged' : null,
                      ].filter(Boolean)
                      return (
                        <tr key={row.streamId}>
                          <td className={styles.timeCell}>
                            {row.calledAt ? formatDateShort(row.calledAt) : '—'}
                          </td>
                          <td className={styles.keyCell}>{row.agentName ?? '—'}</td>
                          <td className={styles.keyCell}>
                            {row.model ?? '—'}
                            {flags.length > 0 && (
                              <span className={styles.flag} title={flags.join('; ')}>
                                {' '}
                                ⚠
                              </span>
                            )}
                          </td>
                          <td className={styles.num}>{formatTokens(row.totalTokens)}</td>
                          <td className={styles.num}>{formatMs(row.responseTimeMs)}</td>
                          <td className={styles.num}>{formatUsd(row.costUsd)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </AssessmentSection>
  )
}
