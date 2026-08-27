import type { LlmCost } from '@/payload-types'

/**
 * Shared shapes + aggregation for the per-conversation LLM cost panel (BTB-302).
 *
 * The `llm-costs` collection stores cost BOTH as logged by LiteLLM and as
 * recomputed from tokens × the versioned rate table. The "effective" cost used
 * for totals prefers the recomputed figure, falling back to the logged one for
 * rows the rate table couldn't price (`priced: false` — model missing) or that
 * carried no token usage (`hasUsage: false` — computed not derivable).
 */

/** Per-call row as sent to the client — projection of an LlmCost doc. */
export interface LlmCostRow {
  streamId: string
  calledAt: string | null
  agentName: string | null
  model: string | null
  serviceTier: string | null
  promptTokens: number | null
  completionTokens: number | null
  cachedTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  responseTimeMs: number | null
  loggedCostUsd: number | null
  computedCostUsd: number | null
  /** Effective cost — computed when priced, else logged, else 0. */
  costUsd: number
  rateVersion: string | null
  priced: boolean
  hasUsage: boolean
}

export interface LlmCostBreakdownEntry {
  key: string
  calls: number
  totalTokens: number
  costUsd: number
}

export interface LlmCostsSummary {
  calls: number
  /** Sum of per-row effective costs. */
  costUsd: number
  /** Sum of loggedCostUsd over rows that have one. */
  loggedCostUsd: number
  /** Sum of computedCostUsd over rows that have one. */
  computedCostUsd: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  reasoningTokens: number
  totalTokens: number
  avgResponseTimeMs: number | null
  maxResponseTimeMs: number | null
  /** Rows the rate table couldn't price (model missing — never costed at zero). */
  unpricedCalls: number
  /** Rows whose source llm_logs entry carried no token counts. */
  noUsageCalls: number
  firstCalledAt: string | null
  lastCalledAt: string | null
  /** Distinct rate table versions seen across the rows. */
  rateVersions: string[]
  /** Sorted by cost, highest first. */
  byModel: LlmCostBreakdownEntry[]
  byAgent: LlmCostBreakdownEntry[]
}

export interface LlmCostsResponse {
  summary: LlmCostsSummary
  /** Newest first. */
  rows: LlmCostRow[]
  /** True when the conversation had more rows than the query limit. */
  truncated: boolean
  totalDocs: number
}

/**
 * Effective cost of one call. Computed is authoritative only when the row was
 * actually priced from token usage; an unpriced or usage-less row falls back to
 * the logged figure. Missing both → 0.
 */
export function effectiveCostUsd(
  doc: Pick<LlmCost, 'loggedCostUsd' | 'computedCostUsd' | 'priced' | 'hasUsage'>,
): number {
  const pricedFromTokens = doc.priced !== false && doc.hasUsage !== false
  if (pricedFromTokens && doc.computedCostUsd != null) return doc.computedCostUsd
  return doc.loggedCostUsd ?? doc.computedCostUsd ?? 0
}

export function toLlmCostRow(doc: LlmCost): LlmCostRow {
  return {
    streamId: doc.streamId,
    calledAt: doc.calledAt ?? null,
    agentName: doc.agentName ?? null,
    model: doc.model ?? null,
    serviceTier: doc.serviceTier ?? null,
    promptTokens: doc.promptTokens ?? null,
    completionTokens: doc.completionTokens ?? null,
    cachedTokens: doc.cachedTokens ?? null,
    reasoningTokens: doc.reasoningTokens ?? null,
    totalTokens: doc.totalTokens ?? null,
    responseTimeMs: doc.responseTimeMs ?? null,
    loggedCostUsd: doc.loggedCostUsd ?? null,
    computedCostUsd: doc.computedCostUsd ?? null,
    costUsd: effectiveCostUsd(doc),
    rateVersion: doc.rateVersion ?? null,
    priced: doc.priced !== false,
    hasUsage: doc.hasUsage !== false,
  }
}

function addToBreakdown(map: Map<string, LlmCostBreakdownEntry>, key: string, row: LlmCostRow) {
  const entry = map.get(key) ?? { key, calls: 0, totalTokens: 0, costUsd: 0 }
  entry.calls += 1
  entry.totalTokens += row.totalTokens ?? 0
  entry.costUsd += row.costUsd
  map.set(key, entry)
}

const byCostDesc = (a: LlmCostBreakdownEntry, b: LlmCostBreakdownEntry) => b.costUsd - a.costUsd

export function summarizeLlmCosts(rows: LlmCostRow[]): LlmCostsSummary {
  const byModel = new Map<string, LlmCostBreakdownEntry>()
  const byAgent = new Map<string, LlmCostBreakdownEntry>()
  const rateVersions = new Set<string>()

  let costUsd = 0
  let loggedCostUsd = 0
  let computedCostUsd = 0
  let promptTokens = 0
  let completionTokens = 0
  let cachedTokens = 0
  let reasoningTokens = 0
  let totalTokens = 0
  let responseTimeSum = 0
  let responseTimeCount = 0
  let maxResponseTimeMs: number | null = null
  let unpricedCalls = 0
  let noUsageCalls = 0
  let firstCalledAt: string | null = null
  let lastCalledAt: string | null = null

  for (const row of rows) {
    costUsd += row.costUsd
    loggedCostUsd += row.loggedCostUsd ?? 0
    computedCostUsd += row.computedCostUsd ?? 0
    promptTokens += row.promptTokens ?? 0
    completionTokens += row.completionTokens ?? 0
    cachedTokens += row.cachedTokens ?? 0
    reasoningTokens += row.reasoningTokens ?? 0
    totalTokens += row.totalTokens ?? 0
    if (row.responseTimeMs != null) {
      responseTimeSum += row.responseTimeMs
      responseTimeCount += 1
      if (maxResponseTimeMs == null || row.responseTimeMs > maxResponseTimeMs) {
        maxResponseTimeMs = row.responseTimeMs
      }
    }
    if (!row.priced) unpricedCalls += 1
    if (!row.hasUsage) noUsageCalls += 1
    if (row.calledAt != null) {
      if (firstCalledAt == null || row.calledAt < firstCalledAt) firstCalledAt = row.calledAt
      if (lastCalledAt == null || row.calledAt > lastCalledAt) lastCalledAt = row.calledAt
    }
    if (row.rateVersion) rateVersions.add(row.rateVersion)
    addToBreakdown(byModel, row.model ?? 'unknown', row)
    addToBreakdown(byAgent, row.agentName ?? 'unknown', row)
  }

  return {
    calls: rows.length,
    costUsd,
    loggedCostUsd,
    computedCostUsd,
    promptTokens,
    completionTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens,
    avgResponseTimeMs: responseTimeCount > 0 ? Math.round(responseTimeSum / responseTimeCount) : null,
    maxResponseTimeMs,
    unpricedCalls,
    noUsageCalls,
    firstCalledAt,
    lastCalledAt,
    rateVersions: [...rateVersions].sort(),
    byModel: [...byModel.values()].sort(byCostDesc),
    byAgent: [...byAgent.values()].sort(byCostDesc),
  }
}
