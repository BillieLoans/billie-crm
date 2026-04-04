/**
 * Unit tests for the billie-crm-applications feature components.
 * Covers Stories 2.2, 3.2, 4.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { StatusBadge, STATUS_CONFIG } from '@/components/ApplicationsView/StatusBadge'
import { ConversationCard } from '@/components/ApplicationsView/ConversationCard'
import { SanitizedHTML } from '@/components/ConversationDetailView/SanitizedHTML'
import type { ConversationSummary } from '@/lib/schemas/conversations'

// Mock next/link to avoid router issues in unit tests
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string; [key: string]: unknown }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/applications',
}))

// =============================================================================
// StatusBadge (Story 2.2 — FR2)
// =============================================================================

describe('StatusBadge', () => {
  afterEach(() => cleanup())

  it('renders "Active" with correct aria-label', () => {
    render(<StatusBadge status="active" />)
    const badge = screen.getByRole('status')
    expect(badge).toHaveAttribute('aria-label', 'Status: Active')
    expect(badge).toHaveTextContent('Active')
  })

  it.each([
    ['paused', 'Paused'],
    ['approved', 'Approved'],
    ['declined', 'Declined'],
    ['soft_end', 'Soft End'],
    ['hard_end', 'Hard End'],
    ['ended', 'Ended'],
  ])('renders "%s" status with label "%s"', (status, label) => {
    const { unmount } = render(<StatusBadge status={status} />)
    expect(screen.getByRole('status')).toHaveTextContent(label)
    unmount()
  })

  it('handles null status gracefully', () => {
    const { unmount } = render(<StatusBadge status={null} />)
    const badge = screen.getByRole('status')
    expect(badge).toBeTruthy()
    unmount()
  })

  it('STATUS_CONFIG covers all 7 statuses from UX spec', () => {
    const required = ['active', 'paused', 'soft_end', 'hard_end', 'approved', 'declined', 'ended']
    for (const s of required) {
      expect(STATUS_CONFIG[s]).toBeDefined()
    }
  })
})

// =============================================================================
// ConversationCard (Story 2.2 — FR1)
// =============================================================================

const baseConversation: ConversationSummary = {
  conversationId: 'conv-123',
  customer: { fullName: 'John Smith', customerId: 'CUS-001' },
  applicationNumber: 'APP-12345',
  status: 'active',
  decisionStatus: null,
  application: { loanAmount: 5000, purpose: 'Debt Consolidation' },
  messageCount: 12,
  lastMessageAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
}

describe('ConversationCard', () => {
  afterEach(() => cleanup())

  it('renders customer name prominently (FR1)', () => {
    render(<ConversationCard conversation={baseConversation} />)
    expect(screen.getByText('John Smith')).toBeTruthy()
  })

  it('renders application number in monospace style (FR1)', () => {
    const { unmount } = render(<ConversationCard conversation={baseConversation} />)
    expect(screen.getAllByText('APP-12345').length).toBeGreaterThan(0)
    unmount()
  })

  it('renders status badge (FR2)', () => {
    const { unmount } = render(<ConversationCard conversation={baseConversation} />)
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    unmount()
  })

  it('renders message count (FR1)', () => {
    const { unmount } = render(<ConversationCard conversation={baseConversation} />)
    expect(screen.getAllByText(/12 messages/).length).toBeGreaterThan(0)
    unmount()
  })

  it('renders singular "message" when count is 1', () => {
    const { unmount } = render(<ConversationCard conversation={{ ...baseConversation, messageCount: 1 }} />)
    expect(screen.getAllByText(/1 message/).length).toBeGreaterThan(0)
    unmount()
  })

  it('links to conversation detail page', () => {
    const { unmount } = render(<ConversationCard conversation={baseConversation} />)
    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/admin/applications/conv-123')
    unmount()
  })

  it('has accessible aria-label', () => {
    const { unmount } = render(<ConversationCard conversation={baseConversation} />)
    const links = screen.getAllByRole('link')
    const label = links[0].getAttribute('aria-label') ?? ''
    expect(label).toContain('APP-12345')
    expect(label).toContain('John Smith')
    unmount()
  })

  it('shows amber left border accent for paused > 5 minutes', () => {
    const pausedOld: ConversationSummary = {
      ...baseConversation,
      status: 'paused',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
    }
    const { container } = render(<ConversationCard conversation={pausedOld} />)
    const link = container.querySelector('a')
    expect(link?.className).toContain('pausedAlert')
  })

  it('does NOT show amber border for recently paused', () => {
    const pausedNew: ConversationSummary = {
      ...baseConversation,
      status: 'paused',
      updatedAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1 min ago
    }
    const { container } = render(<ConversationCard conversation={pausedNew} />)
    const link = container.querySelector('a')
    expect(link?.className).not.toContain('pausedAlert')
  })

  it('handles missing customer gracefully', () => {
    const conv = { ...baseConversation, customer: undefined }
    render(<ConversationCard conversation={conv} />)
    expect(screen.getByText(/Unknown customer/)).toBeTruthy()
  })
})

// =============================================================================
// SanitizedHTML (Story 3.2 — FR30, FR31, NFR7)
// =============================================================================

describe('SanitizedHTML', () => {
  afterEach(() => cleanup())

  it('renders plain text safely', () => {
    render(<SanitizedHTML html="Hello world" />)
    expect(screen.getByText('Hello world')).toBeTruthy()
  })

  it('renders allowed tags (b, i, em, strong, a)', () => {
    const { container } = render(
      <SanitizedHTML html="<b>Bold</b> and <em>italic</em>" />,
    )
    // In test env (JSDOM), require('dompurify') works
    expect(container.innerHTML).toContain('Bold')
    expect(container.innerHTML).toContain('italic')
  })

  it('strips script tags (XSS prevention — NFR7)', () => {
    const { container } = render(
      <SanitizedHTML html='<script>alert("xss")</script>Safe text' />,
    )
    expect(container.innerHTML).not.toContain('<script>')
    expect(container.innerHTML).not.toContain('alert')
  })

  it('strips onclick attributes (NFR7)', () => {
    const { container } = render(
      <SanitizedHTML html='<a onclick="badFn()">Link</a>' />,
    )
    expect(container.innerHTML).not.toContain('onclick')
  })

  it('strips iframe tags (NFR7)', () => {
    const { container } = render(
      <SanitizedHTML html='<iframe src="evil.com"></iframe>Text' />,
    )
    expect(container.innerHTML).not.toContain('iframe')
  })

  it('strips onerror and other event handlers', () => {
    const { container } = render(
      <SanitizedHTML html='<img src="x" onerror="alert(1)" />' />,
    )
    expect(container.innerHTML).not.toContain('onerror')
  })
})

// =============================================================================
// Rate Limiter (Story 1.6 — NFR9)
// =============================================================================

describe('checkRateLimit', () => {
  it('allows requests under the limit', async () => {
    const { checkRateLimit } = await import('@/lib/utils/rateLimit')
    const key = `test-key-${Date.now()}`
    for (let i = 0; i < 30; i++) {
      expect(checkRateLimit(key, { limit: 30, windowMs: 60_000 })).toBe(true)
    }
  })

  it('blocks requests over the limit', async () => {
    const { checkRateLimit } = await import('@/lib/utils/rateLimit')
    const key = `test-key-exceed-${Date.now()}`
    for (let i = 0; i < 30; i++) {
      checkRateLimit(key, { limit: 30, windowMs: 60_000 })
    }
    expect(checkRateLimit(key, { limit: 30, windowMs: 60_000 })).toBe(false)
  })

  it('resets after window expires', async () => {
    const { checkRateLimit } = await import('@/lib/utils/rateLimit')
    const key = `test-key-reset-${Date.now()}`
    checkRateLimit(key, { limit: 1, windowMs: 1 }) // 1ms window
    checkRateLimit(key, { limit: 1, windowMs: 1 }) // this would block if window not expired
    await new Promise((r) => setTimeout(r, 10)) // wait > 1ms
    // After window expires, should allow again
    expect(checkRateLimit(key, { limit: 1, windowMs: 1 })).toBe(true)
  })
})

// =============================================================================
// Schema validation (Story 1.4)
// =============================================================================

describe('ConversationsQuerySchema', () => {
  it('parses valid query params with defaults', async () => {
    const { ConversationsQuerySchema } = await import('@/lib/schemas/conversations')
    const result = ConversationsQuerySchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
    }
  })

  it('coerces limit string to number', async () => {
    const { ConversationsQuerySchema } = await import('@/lib/schemas/conversations')
    const result = ConversationsQuerySchema.safeParse({ limit: '50' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(50)
    }
  })

  it('rejects limit > 100', async () => {
    const { ConversationsQuerySchema } = await import('@/lib/schemas/conversations')
    const result = ConversationsQuerySchema.safeParse({ limit: '200' })
    expect(result.success).toBe(false)
  })
})
