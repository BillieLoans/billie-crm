/**
 * Unit tests for the ConversationDetailView header — application (started) date display.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { formatDateOnly } from '@/lib/formatters'
import type { ConversationDetail } from '@/lib/schemas/conversations'

// Mock next/link to avoid router issues in unit tests
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string; [key: string]: unknown }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/applications',
}))

// Panels are exercised by their own tests — stub them out here
vi.mock('@/components/ConversationDetailView/MessagePanel', () => ({
  MessagePanel: () => <div data-testid="message-panel" />,
}))
vi.mock('@/components/ConversationDetailView/AssessmentPanel', () => ({
  AssessmentPanel: () => <div data-testid="assessment-panel" />,
}))

const { useConversationMock } = vi.hoisted(() => ({ useConversationMock: vi.fn() }))
vi.mock('@/hooks/queries/useConversation', () => ({
  useConversation: useConversationMock,
}))

import { ConversationDetailView } from '@/components/ConversationDetailView'

const baseConversation = {
  conversationId: 'conv-1',
  applicationNumber: '5CA0380F-38F',
  status: 'declined',
  customer: { fullName: 'Test Customer', customerId: '86E8925E' },
  application: { loanAmount: 100, purpose: 'Rego' },
  utterances: [],
  noticeboard: [],
  messageCount: 0,
} as unknown as ConversationDetail

function mockConversation(overrides: Partial<ConversationDetail>) {
  useConversationMock.mockReturnValue({
    data: { ...baseConversation, ...overrides },
    isLoading: false,
    error: null,
  })
}

describe('ConversationDetailView header — application date', () => {
  afterEach(() => {
    cleanup()
    useConversationMock.mockReset()
  })

  it('shows the application started date in the header', () => {
    const startedAt = '2026-06-09T13:06:00.000Z'
    mockConversation({ startedAt })
    render(<ConversationDetailView conversationId="conv-1" />)
    expect(screen.getByText(`Started ${formatDateOnly(startedAt)}`)).toBeTruthy()
  })

  it('omits the started date when startedAt is absent', () => {
    mockConversation({ startedAt: null })
    render(<ConversationDetailView conversationId="conv-1" />)
    expect(screen.queryByText(/^Started /)).toBeNull()
    // Rest of the header still renders in its usual position
    expect(screen.getByText('86E8925E')).toBeTruthy()
  })
})
