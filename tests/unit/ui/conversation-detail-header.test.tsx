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

// ConversationDetailView now renders EndConversationButton, which pulls the
// @payloadcms/ui client barrel in (useAuth), which side-effect-imports
// react-image-crop's CSS. Stub it (matching tests/unit/ui/assessment-views.test.tsx
// and the nav-sidebar precedent) so the suite can collect without the
// externalised .css import blowing up. `user: null` means the button simply
// won't render — these tests don't assert on it.
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: null }),
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

  it('renders copy buttons for the application number and customer id', () => {
    mockConversation({ startedAt: null })
    render(<ConversationDetailView conversationId="conv-1" />)
    expect(screen.getAllByTestId('copy-button')).toHaveLength(2)
    expect(screen.getByLabelText('Copy application number 5CA0380F-38F')).toBeTruthy()
    expect(screen.getByLabelText('Copy customer id 86E8925E')).toBeTruthy()
  })

  it('links the customer id to the customer profile', () => {
    mockConversation({ startedAt: null })
    render(<ConversationDetailView conversationId="conv-1" />)
    const link = screen.getByText('86E8925E').closest('a')
    expect(link).toBeTruthy()
    expect(link!.getAttribute('href')).toBe('/admin/servicing/86E8925E')
  })
})
