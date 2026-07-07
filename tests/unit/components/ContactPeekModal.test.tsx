import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { ContactPeekModal } from '@/components/MarketingView/ContactPeekModal'

const CONTACT_ID = 'a79ae28f-2e9d-4650-b466-b5a00e5abfc5'

const contactResponse = {
  contact: {
    contactId: CONTACT_ID,
    firstName: 'Rohan',
    mobileE164: '+61403320117',
    email: 'rohan@example.com',
    derivedStage: 'lead',
    source: 'referral',
    city: null,
    customerId: null,
    referralCode: '23CTBW',
    consent: null,
    updatedAt: '2026-07-07T11:04:00.000Z',
  },
  interactions: [],
  audit: [],
}

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  cleanup()
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => contactResponse,
  })) as unknown as typeof fetch
})

describe('ContactPeekModal', () => {
  it('renders the contact facts once loaded, with fixed rows for empty fields', async () => {
    renderWithProviders(<ContactPeekModal contactId={CONTACT_ID} onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Rohan')).toBeInTheDocument())
    expect(screen.getByText('+61403320117')).toBeInTheDocument()
    expect(screen.getByText('rohan@example.com')).toBeInTheDocument()
    expect(screen.getByText('Lead')).toBeInTheDocument()
    expect(screen.getByText('Not linked')).toBeInTheDocument()
    expect(screen.getByText('23CTBW')).toBeInTheDocument()
    // Fixed layout: the City row is present with an em-dash value.
    expect(screen.getByText('City')).toBeInTheDocument()

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/marketing/contacts/${CONTACT_ID}`)
  })

  it('links out to the full profile', async () => {
    renderWithProviders(<ContactPeekModal contactId={CONTACT_ID} onClose={vi.fn()} />)
    const link = await screen.findByRole('link', { name: 'Open full profile →' })
    expect(link).toHaveAttribute('href', `/admin/marketing/contacts/${CONTACT_ID}`)
  })

  it('both close controls (× and footer button) call onClose', async () => {
    const onClose = vi.fn()
    renderWithProviders(<ContactPeekModal contactId={CONTACT_ID} onClose={onClose} />)
    // Two controls share the accessible name "Close": the × and the footer button.
    const closeButtons = await screen.findAllByRole('button', { name: 'Close' })
    expect(closeButtons).toHaveLength(2)
    closeButtons.forEach((btn) => fireEvent.click(btn))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('surfaces a load failure', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => null,
    })) as unknown as typeof fetch

    renderWithProviders(<ContactPeekModal contactId={CONTACT_ID} onClose={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('Failed to load the contact. Please retry.')).toBeInTheDocument(),
    )
  })
})
