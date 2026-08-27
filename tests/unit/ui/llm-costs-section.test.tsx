/**
 * Tests for LlmCostsSection (BTB-302) — the supervisor/admin-only expandable
 * LLM cost roll-up in the ConversationDetailView right panel.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LlmCostsResponse } from '@/lib/llm-costs'
import { formatUsd } from '@/lib/formatters'
import { summarizeLlmCosts, type LlmCostRow } from '@/lib/llm-costs'

const render = (ui: React.ReactElement) =>
  rtlRender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )

// Stub the @payloadcms/ui barrel (repo pattern — avoids the react-image-crop
// CSS side-effect import) with a switchable user role.
const authState: { user: { role?: string } | null } = { user: null }
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: authState.user }),
}))

const llmCostsState: { data: LlmCostsResponse | undefined; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: null,
}
const useLlmCostsMock = vi.fn(() => llmCostsState)
vi.mock('@/hooks/queries/useLlmCosts', () => ({
  useLlmCosts: (conversationId: string | undefined, enabled?: boolean) =>
    useLlmCostsMock(conversationId, enabled),
}))

import { LlmCostsSection } from '@/components/ConversationDetailView/LlmCostsSection'

const row = (overrides: Partial<LlmCostRow> = {}): LlmCostRow => ({
  streamId: '1756300000000-0',
  calledAt: '2026-08-27T10:00:00.000Z',
  agentName: 'CreditAgent',
  model: 'gpt-4.1-mini',
  serviceTier: 'default',
  promptTokens: 1000,
  completionTokens: 200,
  cachedTokens: 0,
  reasoningTokens: 0,
  totalTokens: 1200,
  responseTimeMs: 900,
  loggedCostUsd: 0.005,
  computedCostUsd: 0.004,
  costUsd: 0.004,
  rateVersion: '2026-08-01',
  priced: true,
  hasUsage: true,
  ...overrides,
})

const responseFor = (rows: LlmCostRow[], totalDocs = rows.length): LlmCostsResponse => ({
  summary: summarizeLlmCosts(rows),
  rows,
  truncated: totalDocs > rows.length,
  totalDocs,
})

afterEach(() => {
  cleanup()
  authState.user = null
  llmCostsState.data = undefined
  llmCostsState.isLoading = false
  llmCostsState.error = null
  useLlmCostsMock.mockClear()
})

describe('LlmCostsSection', () => {
  it('renders nothing for roles without approval authority', () => {
    authState.user = { role: 'operations' }
    render(<LlmCostsSection conversationId="conv-001" />)
    expect(screen.queryByText('LLM Costs')).toBeNull()
  })

  it('disables the query for roles without approval authority', () => {
    authState.user = { role: 'readonly' }
    render(<LlmCostsSection conversationId="conv-001" />)
    expect(useLlmCostsMock).toHaveBeenCalledWith('conv-001', false)
  })

  it('shows cost and call count in the collapsed header for supervisors', () => {
    authState.user = { role: 'supervisor' }
    llmCostsState.data = responseFor([row(), row({ streamId: 'x-1', costUsd: 0.018 })])
    render(<LlmCostsSection conversationId="conv-001" />)
    expect(screen.getByText('LLM Costs')).toBeDefined()
    // Testing Library normalizes the DOM's non-breaking spaces to plain spaces
    const expected = `${formatUsd(0.022)} · 2 calls`.replace(/\s/g, ' ')
    expect(screen.getByText(expected)).toBeDefined()
  })

  it('shows totals, breakdowns and per-call rows when expanded', () => {
    authState.user = { role: 'admin' }
    llmCostsState.data = responseFor([
      row(),
      row({ streamId: 'x-1', agentName: 'FraudRiskAgent', model: 'gpt-4.1', costUsd: 0.018 }),
    ])
    render(<LlmCostsSection conversationId="conv-001" />)
    fireEvent.click(screen.getByRole('button', { name: /LLM Costs/ }))
    expect(screen.getByText('Total cost')).toBeDefined()
    expect(screen.getByText('Logged (LiteLLM)')).toBeDefined()
    expect(screen.getByText('Computed (rate table)')).toBeDefined()
    expect(screen.getByText('By model')).toBeDefined()
    expect(screen.getByText('By agent')).toBeDefined()
    expect(screen.getByText('Calls (newest first)')).toBeDefined()
    expect(screen.getAllByText('FraudRiskAgent').length).toBeGreaterThan(0)
    expect(screen.getByText('Rate version')).toBeDefined()
  })

  it('flags unpriced calls', () => {
    authState.user = { role: 'admin' }
    llmCostsState.data = responseFor([
      row({ priced: false, computedCostUsd: null, costUsd: 0.005, model: 'mystery-model' }),
    ])
    render(<LlmCostsSection conversationId="conv-001" />)
    fireEvent.click(screen.getByRole('button', { name: /LLM Costs/ }))
    expect(screen.getByText(/1 call unpriced/)).toBeDefined()
  })

  it('shows an empty state when the conversation has no LLM calls', () => {
    authState.user = { role: 'supervisor' }
    llmCostsState.data = responseFor([])
    render(<LlmCostsSection conversationId="conv-001" />)
    expect(screen.getByText('No calls')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /LLM Costs/ }))
    expect(screen.getByText('No LLM calls recorded for this conversation.')).toBeDefined()
  })
})
