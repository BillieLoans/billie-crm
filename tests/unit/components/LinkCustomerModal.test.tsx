import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { LinkCustomerModal } from '@/components/MarketingView/LinkCustomerModal'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const CONTACT_ID = 'a79ae28f-2e9d-4650-b466-b5a00e5abfc5'

const searchResponse = {
  results: [
    {
      id: 1,
      customerId: '08F7B13B',
      fullName: 'John Smith',
      emailAddress: 'john@example.com',
      identityVerified: true,
      accountCount: 1,
    },
    {
      id: 2,
      customerId: '0A11C22D',
      fullName: 'Joan Park',
      emailAddress: null,
      identityVerified: false,
      accountCount: 0,
    },
  ],
  total: 2,
}

const renderModal = (onClose = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <LinkCustomerModal contactId={CONTACT_ID} contactName="Rohan" onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

beforeEach(() => {
  cleanup()
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    return {
      ok: true,
      json: async () =>
        url.includes('/api/customer/search') ? searchResponse : { contactId: CONTACT_ID },
    }
  }) as unknown as typeof fetch
})

describe('LinkCustomerModal', () => {
  it('searches once ≥3 chars and renders selectable results', async () => {
    renderModal()
    expect(screen.getByText('Type at least 3 characters to search.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'jo' } })
    // Still below threshold — no search call.
    expect(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
        String(c[0]).includes('/api/customer/search'),
      ),
    ).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'john' } })
    await waitFor(() => expect(screen.getByText('John Smith')).toBeInTheDocument())
    expect(screen.getByText(/✓ ID verified/)).toBeInTheDocument()
    expect(screen.getByText('Joan Park')).toBeInTheDocument()
  })

  it('Link stays disabled until a customer is selected, then POSTs and closes', async () => {
    const onClose = renderModal()
    const submit = screen.getByRole('button', { name: 'Link customer' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'john' } })
    fireEvent.click(await screen.findByRole('option', { name: /John Smith/ }))
    expect(screen.getByText('John Smith (08F7B13B)')).toBeInTheDocument()
    expect(submit).not.toBeDisabled()

    fireEvent.click(submit)
    await waitFor(() => expect(onClose).toHaveBeenCalled())

    const linkCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes('/link'),
    )!
    expect(String(linkCall[0])).toBe(`/api/marketing/contacts/${CONTACT_ID}/link`)
    expect(JSON.parse((linkCall[1] as RequestInit).body as string)).toEqual({
      customer_id: '08F7B13B',
    })
  })

  it('changing the query clears the selection', async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'john' } })
    fireEvent.click(await screen.findByRole('option', { name: /John Smith/ }))
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'joan' } })
    expect(screen.getByRole('button', { name: 'Link customer' })).toBeDisabled()
  })
})
