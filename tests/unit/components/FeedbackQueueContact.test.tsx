/**
 * FeedbackQueueView — Contact column behavior: shows the enriched contactName
 * (shortened GUID fallback), and opens the ContactPeekModal instead of
 * navigating away from the queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { FeedbackQueueView } from '@/components/MarketingView/FeedbackQueueView'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const NAMED_ID = 'a79ae28f-2e9d-4650-b466-b5a00e5abfc5'
const NAMELESS_ID = 'bb12cd34-0000-4000-8000-000000000000'

const feedbackResponse = {
  docs: [
    {
      id: 1,
      feedbackId: 'f-1',
      contactIdString: NAMED_ID,
      contactName: 'Rohan',
      feedbackType: 'praise',
      body: 'Great stuff',
      status: 'new',
      receivedAt: '2026-07-07T11:21:30.000Z',
    },
    {
      id: 2,
      feedbackId: 'f-2',
      contactIdString: NAMELESS_ID,
      contactName: null,
      feedbackType: 'bug',
      body: 'Broken thing',
      status: 'new',
      receivedAt: '2026-07-07T11:22:30.000Z',
    },
    {
      id: 3,
      feedbackId: 'f-3',
      contactIdString: NAMED_ID,
      contactName: 'Rohan',
      feedbackType: 'complaint',
      body: 'Was overcharged',
      status: 'resolved',
      statusNote: 'Refunded the fee and apologised',
      receivedAt: '2026-07-06T10:00:00.000Z',
    },
  ],
  totalDocs: 3,
  totalPages: 1,
  page: 1,
  hasNextPage: false,
  hasPrevPage: false,
  limit: 50,
}

const contactResponse = {
  contact: { contactId: NAMED_ID, firstName: 'Rohan', updatedAt: null, consent: null },
  interactions: [],
  audit: [],
}

const renderView = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <FeedbackQueueView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  cleanup()
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    return {
      ok: true,
      json: async () =>
        url.includes('/api/marketing/contacts/') ? contactResponse : feedbackResponse,
    }
  }) as unknown as typeof fetch
})

describe('FeedbackQueueView contact column', () => {
  it('shows the contact name, with a shortened GUID fallback', async () => {
    renderView()
    await waitFor(() => expect(screen.getAllByText('Rohan')).not.toHaveLength(0))
    expect(screen.getByText('bb12cd34…')).toBeInTheDocument()
    // The raw GUID never renders.
    expect(screen.queryByText(NAMED_ID)).not.toBeInTheDocument()
  })

  it('shows the resolution note in the Resolution column', async () => {
    renderView()
    await waitFor(() =>
      expect(screen.getByText('Refunded the fee and apologised')).toBeInTheDocument(),
    )
  })

  it('Resolve opens the note modal instead of firing the command immediately', async () => {
    renderView()
    const resolveButtons = await screen.findAllByRole('button', { name: 'Resolve' })
    fireEvent.click(resolveButtons[0]!) // first row (status: new)

    // The modal is open, nothing was POSTed yet.
    expect(await screen.findByText('What was done?')).toBeInTheDocument()
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const postCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })

  it('clicking the name opens the contact peek modal (stays on the queue)', async () => {
    renderView()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Rohan' }))[0]!)

    const link = await screen.findByRole('link', { name: 'Open full profile →' })
    expect(link).toHaveAttribute('href', `/admin/marketing/contacts/${NAMED_ID}`)

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u === `/api/marketing/contacts/${NAMED_ID}`)).toBe(true)
  })
})
