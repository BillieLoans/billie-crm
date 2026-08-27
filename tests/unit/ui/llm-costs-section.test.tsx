/**
 * Tests for LlmCostsSection (BTB-302) — the supervisor/admin-only LLM cost
 * roll-up in the ConversationDetailView right panel.
 *
 * The section reads the roll-up carried on the conversation record itself, so
 * these tests drive it purely through props — there is no fetch to stub.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import { formatUsd } from '@/lib/formatters'

// Stub the @payloadcms/ui barrel (repo pattern — avoids the react-image-crop
// CSS side-effect import) with a switchable user role.
const authState: { user: { role?: string } | null } = { user: null }
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: authState.user }),
}))

import { LlmCostsSection } from '@/components/ConversationDetailView/LlmCostsSection'

const conversation = (overrides: Partial<ConversationDetail> = {}): ConversationDetail =>
  ({
    conversationId: 'conv-001',
    utterances: [],
    noticeboard: [],
    messageCount: 0,
    llmCostTotalUsd: 0.0225,
    llmCallCount: 9,
    llmUnpricedCount: 0,
    ...overrides,
  }) as ConversationDetail

/** Testing Library normalizes the DOM's non-breaking spaces to plain spaces. */
const plain = (s: string) => s.replace(/\s/g, ' ')

const expand = () => fireEvent.click(screen.getByRole('button', { name: /LLM Costs/ }))

afterEach(() => {
  cleanup()
  authState.user = null
})

describe('LlmCostsSection', () => {
  it('renders nothing for roles without approval authority', () => {
    authState.user = { role: 'operations' }
    render(<LlmCostsSection conversation={conversation()} />)
    expect(screen.queryByText('LLM Costs')).toBeNull()
  })

  it('shows the roll-up total and call count in the collapsed header', () => {
    authState.user = { role: 'supervisor' }
    render(<LlmCostsSection conversation={conversation()} />)
    expect(screen.getByText(plain(`${formatUsd(0.0225)} · 9 calls`))).toBeDefined()
  })

  it('singularises a one-call conversation', () => {
    authState.user = { role: 'supervisor' }
    render(
      <LlmCostsSection conversation={conversation({ llmCostTotalUsd: 0.004, llmCallCount: 1 })} />,
    )
    expect(screen.getByText(plain(`${formatUsd(0.004)} · 1 call`))).toBeDefined()
  })

  it('shows totals and the derived average when expanded', () => {
    authState.user = { role: 'admin' }
    render(<LlmCostsSection conversation={conversation()} />)
    expand()
    expect(screen.getByText('Total cost')).toBeDefined()
    expect(screen.getByText('Calls')).toBeDefined()
    expect(screen.getByText('Average per call')).toBeDefined()
    expect(screen.getByText(plain(formatUsd(0.0225 / 9)))).toBeDefined()
  })

  it('warns that the total understates cost when calls were unpriced', () => {
    authState.user = { role: 'admin' }
    render(<LlmCostsSection conversation={conversation({ llmUnpricedCount: 2 })} />)
    expand()
    expect(screen.getByText(/2 calls were made with a model missing/)).toBeDefined()
    expect(screen.getByText(/understates the true cost/)).toBeDefined()
  })

  it('does not warn when every call was priced', () => {
    authState.user = { role: 'admin' }
    render(<LlmCostsSection conversation={conversation({ llmUnpricedCount: 0 })} />)
    expand()
    expect(screen.queryByText(/understates the true cost/)).toBeNull()
  })

  it('distinguishes a zero-call conversation from a missing roll-up', () => {
    authState.user = { role: 'supervisor' }
    render(
      <LlmCostsSection
        conversation={conversation({ llmCostTotalUsd: 0, llmCallCount: 0, llmUnpricedCount: 0 })}
      />,
    )
    expect(screen.getByText('No calls')).toBeDefined()
    expand()
    expect(screen.getByText('No LLM calls recorded for this application.')).toBeDefined()
  })

  it('explains a missing roll-up on a pre-BTB-302 conversation', () => {
    authState.user = { role: 'supervisor' }
    render(
      <LlmCostsSection
        conversation={conversation({
          llmCostTotalUsd: null,
          llmCallCount: null,
          llmUnpricedCount: null,
        })}
      />,
    )
    expect(screen.getByText('No data')).toBeDefined()
    expand()
    expect(screen.getByText(/No LLM cost roll-up recorded/)).toBeDefined()
  })
})
