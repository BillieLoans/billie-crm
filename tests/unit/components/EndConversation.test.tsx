/**
 * Tests for the "End conversation" button, confirm modal, and kill banner.
 *
 * Covers:
 * - Button gating: approval authority (admin/supervisor) + non-terminal status
 * - Disabled state when the conversation has no linked customer id
 * - Modal: customer-facing copy, reason radios, note textarea, confirm gating
 * - Confirm submits the kill command (including applicationNumber — billieChat
 *   needs it for the zombie-safe session close)
 * - KillBanner rendering from `conversation.killRecord`
 * - The block checkbox stays hidden while NEXT_PUBLIC_ENABLE_KILL_BLOCK is unset
 * - Success toast fires on a successful submit (useKillConversation's onSuccess)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  EndConversationButton,
  KillBanner,
} from '@/components/ConversationDetailView/EndConversation'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import { formatDateMedium } from '@/lib/formatters'

// EndConversationButton transitively pulls the @payloadcms/ui client barrel in
// (useAuth), which side-effect-imports react-image-crop's CSS. Stub it so the
// suite can collect without the externalised .css import blowing up.
let mockUser: { id: string; role: string } | null = { id: '42', role: 'supervisor' }
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: mockUser }),
}))

// useKillConversation toasts on success (docs/ux-standards.md §1.2 4.1.3 — async
// state must be announced). Mock sonner so the toast call is assertable.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function baseConversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    conversationId: 'conv-001',
    applicationNumber: 'APP-001',
    status: 'active',
    decisionStatus: null,
    finalDecision: null,
    customer: { fullName: 'Jane Smith', customerId: 'CUS-001' },
    utterances: [],
    noticeboard: [],
    messageCount: 5,
    ...overrides,
  }
}

const STOP_MESSAGE_COPY =
  'This conversation has been ended by our team. If you have any questions, please contact our support team.'

describe('EndConversationButton', () => {
  beforeEach(() => {
    mockUser = { id: '42', role: 'supervisor' }
    mockFetch.mockReset()
    vi.clearAllMocks()
    delete process.env.NEXT_PUBLIC_ENABLE_KILL_BLOCK
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
  })

  it('renders "End conversation" for a supervisor user when status is active', () => {
    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    expect(screen.getByRole('button', { name: 'End conversation' })).toBeInTheDocument()
  })

  it('does not render the button for an operations user', () => {
    mockUser = { id: '7', role: 'operations' }
    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    expect(screen.queryByRole('button', { name: 'End conversation' })).not.toBeInTheDocument()
  })

  it('does not render the button when status is hard_end', () => {
    renderWithProviders(
      <EndConversationButton
        conversation={baseConversation({ status: 'hard_end' })}
        conversationId="conv-001"
      />,
    )
    expect(screen.queryByRole('button', { name: 'End conversation' })).not.toBeInTheDocument()
  })

  it('renders the button disabled with an explanatory title when the conversation has no customer id', () => {
    renderWithProviders(
      <EndConversationButton
        conversation={baseConversation({
          customer: { fullName: 'Jane Smith', customerId: null },
        })}
        conversationId="conv-001"
      />,
    )
    const button = screen.getByRole('button', { name: 'End conversation' })
    expect(button).toBeDisabled()
    expect(button.getAttribute('title')).toMatch(/customer/i)
  })

  it('opens a modal with the exact customer-facing copy, three reason radios, and a note textarea; confirm is disabled until a reason is chosen', () => {
    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'End conversation' }))

    expect(screen.getByText(STOP_MESSAGE_COPY)).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: /note/i })).toBeInTheDocument()

    const confirm = screen.getByTestId('end-conversation-confirm')
    expect(confirm).toBeDisabled()

    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(confirm).not.toBeDisabled()
  })

  it('confirm posts to /api/commands/conversation-kill with conversationId, customerId, applicationNumber, reasonCategory, and note', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ eventId: 'evt-1', requestId: 'req-1', status: 'accepted' }),
    })

    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'End conversation' }))
    fireEvent.click(screen.getByLabelText('Fraud / abuse'))
    fireEvent.change(screen.getByRole('textbox', { name: /note/i }), {
      target: { value: 'Confirmed fraud ring' },
    })
    fireEvent.click(screen.getByTestId('end-conversation-confirm'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commands/conversation-kill')
    expect(JSON.parse(options.body)).toEqual({
      conversationId: 'conv-001',
      customerId: 'CUS-001',
      applicationNumber: 'APP-001',
      reasonCategory: 'fraud_abuse',
      note: 'Confirmed fraud ring',
    })

    await waitFor(() =>
      expect(screen.queryByTestId('end-conversation-modal')).not.toBeInTheDocument(),
    )
  })

  it('shows a success toast once the kill command is accepted', async () => {
    const { toast } = await import('sonner')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ eventId: 'evt-1', requestId: 'req-1', status: 'accepted' }),
    })

    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'End conversation' }))
    fireEvent.click(screen.getByLabelText('Fraud / abuse'))
    fireEvent.click(screen.getByTestId('end-conversation-confirm'))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('End-conversation request submitted'),
    )
  })

  it('does not render a block checkbox in the modal when NEXT_PUBLIC_ENABLE_KILL_BLOCK is unset', () => {
    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'End conversation' }))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('renders the block checkbox in the modal when NEXT_PUBLIC_ENABLE_KILL_BLOCK is true', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_KILL_BLOCK', 'true')
    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'End conversation' }))
    expect(screen.getByRole('checkbox', { name: /also block/i })).toBeInTheDocument()
  })

  it('posts blockRequested: true when the checkbox is ticked and confirmed with the flag enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_KILL_BLOCK', 'true')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ eventId: 'evt-1', requestId: 'req-1', status: 'accepted' }),
    })

    renderWithProviders(
      <EndConversationButton conversation={baseConversation()} conversationId="conv-001" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'End conversation' }))
    fireEvent.click(screen.getByLabelText('Fraud / abuse'))
    fireEvent.click(screen.getByRole('checkbox', { name: /also block/i }))
    fireEvent.click(screen.getByTestId('end-conversation-confirm'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/commands/conversation-kill')
    expect(JSON.parse(options.body)).toEqual({
      conversationId: 'conv-001',
      customerId: 'CUS-001',
      applicationNumber: 'APP-001',
      reasonCategory: 'fraud_abuse',
      note: undefined,
      blockRequested: true,
    })

    await waitFor(() =>
      expect(screen.queryByTestId('end-conversation-modal')).not.toBeInTheDocument(),
    )
  })
})

describe('KillBanner', () => {
  afterEach(() => cleanup())

  it('renders "Ended by <actor> · <friendly reason> · <date>" when a killRecord is present (back-compat: no actorName)', () => {
    const killedAt = '2026-08-24T04:00:00.000Z'
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          reason_category: 'fraud_abuse',
          note: null,
          killed_at: killedAt,
        }}
      />,
    )
    expect(
      screen.getByText(`Ended by user:42 · Fraud / abuse · ${formatDateMedium(killedAt)}`),
    ).toBeInTheDocument()
  })

  it('renders the resolved staff name instead of the raw actor id when actorName is present', () => {
    const killedAt = '2026-08-24T04:00:00.000Z'
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:95979e54-7f2e-4578-a9d0-807c8951d684',
          actorName: 'Jane Smith',
          reason_category: 'fraud_abuse',
          note: null,
          killed_at: killedAt,
        }}
      />,
    )
    expect(
      screen.getByText(`Ended by Jane Smith · Fraud / abuse · ${formatDateMedium(killedAt)}`),
    ).toBeInTheDocument()
    expect(screen.queryByText(/95979e54/)).not.toBeInTheDocument()
  })

  it('renders nothing when killRecord is absent', () => {
    const { container } = renderWithProviders(<KillBanner killRecord={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('falls back to the raw reason category when it does not match a known REASON_OPTIONS value', () => {
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          reason_category: 'some_future_category',
          note: null,
          killed_at: '2026-08-24T04:00:00.000Z',
        }}
      />,
    )
    expect(screen.getByText(/some_future_category/)).toBeInTheDocument()
  })

  it('renders the compact line as a button that opens a "Conversation ended" drawer on click', () => {
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          actorName: 'Jane Smith',
          reason_category: 'fraud_abuse',
          note: 'Confirmed fraud ring across three linked accounts.',
          killed_at: '2026-08-24T04:00:00.000Z',
        }}
      />,
    )

    const banner = screen.getByTestId('kill-banner')
    expect(banner.tagName).toBe('BUTTON')
    expect(banner).toHaveAttribute('aria-haspopup', 'dialog')
    expect(banner).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Conversation ended')).not.toBeInTheDocument()

    fireEvent.click(banner)

    expect(banner).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Conversation ended')).toBeInTheDocument()
  })

  it('shows the staff name, friendly reason, timestamp, and note in the drawer', () => {
    const killedAt = '2026-08-24T04:00:00.000Z'
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          actorName: 'Jane Smith',
          reason_category: 'compliance',
          note: 'Customer requested account closure via phone.',
          killed_at: killedAt,
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('kill-banner'))

    const drawer = screen.getByTestId('context-drawer')
    expect(drawer).toHaveTextContent('Jane Smith')
    expect(drawer).toHaveTextContent('Compliance / customer request')
    expect(drawer).toHaveTextContent(formatDateMedium(killedAt))
    expect(drawer).toHaveTextContent('Customer requested account closure via phone.')
  })

  it('renders multi-line notes with line breaks preserved', () => {
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          actorName: 'Jane Smith',
          reason_category: 'operational',
          note: 'Line one\nLine two',
          killed_at: '2026-08-24T04:00:00.000Z',
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('kill-banner'))

    const note = screen.getByTestId('kill-note')
    expect(note.textContent).toBe('Line one\nLine two')
    expect(note).toHaveStyle({ whiteSpace: 'pre-wrap' })
  })

  it('shows "No note recorded." (and no empty note area) when the killRecord note is null', () => {
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          actorName: 'Jane Smith',
          reason_category: 'operational',
          note: null,
          killed_at: '2026-08-24T04:00:00.000Z',
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('kill-banner'))

    expect(screen.getByText('No note recorded.')).toBeInTheDocument()
    expect(screen.queryByTestId('kill-note')).not.toBeInTheDocument()
  })

  it('shows "No note recorded." when the killRecord note is an empty/whitespace-only string', () => {
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          actorName: 'Jane Smith',
          reason_category: 'operational',
          note: '   ',
          killed_at: '2026-08-24T04:00:00.000Z',
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('kill-banner'))

    expect(screen.getByText('No note recorded.')).toBeInTheDocument()
    expect(screen.queryByTestId('kill-note')).not.toBeInTheDocument()
  })

  it('back-compat: shows the raw actor (never blank) in both the banner and the drawer when actorName is absent', () => {
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:xyz',
          reason_category: 'fraud_abuse',
          note: 'Some note',
          killed_at: '2026-08-24T04:00:00.000Z',
        }}
      />,
    )
    expect(screen.getByText(/Ended by user:xyz/)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('kill-banner'))
    expect(screen.getByTestId('context-drawer')).toHaveTextContent('user:xyz')
  })

  it('closes the drawer when its close button is clicked', () => {
    renderWithProviders(
      <KillBanner
        killRecord={{
          request_id: 'req-1',
          actor: 'user:42',
          reason_category: 'fraud_abuse',
          note: null,
          killed_at: '2026-08-24T04:00:00.000Z',
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('kill-banner'))
    expect(screen.getByTestId('context-drawer')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('context-drawer-close'))
    expect(screen.queryByTestId('context-drawer')).not.toBeInTheDocument()
  })
})
