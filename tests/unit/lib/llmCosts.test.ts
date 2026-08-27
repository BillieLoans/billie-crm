import { describe, it, expect } from 'vitest'
import {
  effectiveCostUsd,
  toLlmCostRow,
  summarizeLlmCosts,
  type LlmCostRow,
} from '@/lib/llm-costs'
import type { LlmCost } from '@/payload-types'

const baseDoc = (overrides: Partial<LlmCost> = {}): LlmCost =>
  ({
    id: '1',
    streamId: '1756300000000-0',
    conversationId: 'conv-1',
    seq: 1,
    model: 'gpt-4.1-mini',
    agentName: 'CreditAgent',
    serviceTier: 'default',
    promptTokens: 1000,
    completionTokens: 200,
    cachedTokens: 100,
    reasoningTokens: 0,
    totalTokens: 1200,
    responseTimeMs: 900,
    loggedCostUsd: 0.005,
    computedCostUsd: 0.004,
    rateVersion: '2026-08-01',
    hasUsage: true,
    priced: true,
    calledAt: '2026-08-27T10:00:00.000Z',
    updatedAt: '2026-08-27T10:00:01.000Z',
    createdAt: '2026-08-27T10:00:01.000Z',
    ...overrides,
  }) as LlmCost

describe('effectiveCostUsd', () => {
  it('prefers computed cost when the row was priced from usage', () => {
    expect(effectiveCostUsd(baseDoc())).toBe(0.004)
  })

  it('falls back to logged cost when the model is unpriced', () => {
    expect(effectiveCostUsd(baseDoc({ priced: false, computedCostUsd: null }))).toBe(0.005)
  })

  it('ignores a computed figure on an unpriced row (never trusts it)', () => {
    expect(effectiveCostUsd(baseDoc({ priced: false, computedCostUsd: 0 }))).toBe(0.005)
  })

  it('falls back to logged cost when the row has no usage', () => {
    expect(effectiveCostUsd(baseDoc({ hasUsage: false, computedCostUsd: null }))).toBe(0.005)
  })

  it('returns 0 when no cost is available at all', () => {
    expect(
      effectiveCostUsd(baseDoc({ loggedCostUsd: null, computedCostUsd: null, priced: false })),
    ).toBe(0)
  })
})

describe('summarizeLlmCosts', () => {
  const rows: LlmCostRow[] = [
    toLlmCostRow(baseDoc()),
    toLlmCostRow(
      baseDoc({
        id: '2',
        streamId: '1756300001000-0',
        agentName: 'FraudRiskAgent',
        model: 'gpt-4.1',
        promptTokens: 2000,
        completionTokens: 500,
        cachedTokens: 0,
        reasoningTokens: 50,
        totalTokens: 2550,
        responseTimeMs: 1500,
        loggedCostUsd: 0.02,
        computedCostUsd: 0.018,
        calledAt: '2026-08-27T10:05:00.000Z',
      }),
    ),
    toLlmCostRow(
      baseDoc({
        id: '3',
        streamId: '1756300002000-0',
        agentName: 'CreditAgent',
        model: 'mystery-model',
        priced: false,
        computedCostUsd: null,
        loggedCostUsd: 0.01,
        responseTimeMs: null,
        rateVersion: '2026-08-15',
        calledAt: '2026-08-27T09:55:00.000Z',
      }),
    ),
  ]

  const summary = summarizeLlmCosts(rows)

  it('totals effective, logged and computed costs separately', () => {
    expect(summary.calls).toBe(3)
    expect(summary.costUsd).toBeCloseTo(0.004 + 0.018 + 0.01, 10)
    expect(summary.loggedCostUsd).toBeCloseTo(0.035, 10)
    expect(summary.computedCostUsd).toBeCloseTo(0.022, 10)
  })

  it('totals tokens by kind', () => {
    expect(summary.promptTokens).toBe(4000)
    expect(summary.completionTokens).toBe(900)
    expect(summary.cachedTokens).toBe(200)
    expect(summary.reasoningTokens).toBe(50)
    expect(summary.totalTokens).toBe(4950)
  })

  it('averages response time over rows that have one and tracks the max', () => {
    expect(summary.avgResponseTimeMs).toBe(1200)
    expect(summary.maxResponseTimeMs).toBe(1500)
  })

  it('counts data-quality flags', () => {
    expect(summary.unpricedCalls).toBe(1)
    expect(summary.noUsageCalls).toBe(0)
  })

  it('finds the first and last call time regardless of row order', () => {
    expect(summary.firstCalledAt).toBe('2026-08-27T09:55:00.000Z')
    expect(summary.lastCalledAt).toBe('2026-08-27T10:05:00.000Z')
  })

  it('collects distinct rate versions', () => {
    expect(summary.rateVersions).toEqual(['2026-08-01', '2026-08-15'])
  })

  it('breaks down by model and agent, highest cost first', () => {
    expect(summary.byModel.map((m) => m.key)).toEqual(['gpt-4.1', 'mystery-model', 'gpt-4.1-mini'])
    expect(summary.byAgent.map((a) => a.key)).toEqual(['FraudRiskAgent', 'CreditAgent'])
    const credit = summary.byAgent.find((a) => a.key === 'CreditAgent')!
    expect(credit.calls).toBe(2)
    expect(credit.costUsd).toBeCloseTo(0.014, 10)
  })

  it('returns an empty summary for no rows', () => {
    const empty = summarizeLlmCosts([])
    expect(empty.calls).toBe(0)
    expect(empty.costUsd).toBe(0)
    expect(empty.avgResponseTimeMs).toBeNull()
    expect(empty.firstCalledAt).toBeNull()
    expect(empty.byModel).toEqual([])
  })
})
