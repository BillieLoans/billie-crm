import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { MergeContactsModal } from '@/components/MarketingView/MergeContactsModal'
import type { IdentitySibling } from '@/hooks/queries/useContactIdentity'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const sibling: IdentitySibling = {
  contactId: 'c-dup',
  firstName: 'R. Sharp',
  mobileE164: '+61400111222',
  email: null,
  derivedStage: 'lead',
  customerId: null,
  bases: ['same_customer'],
}

const renderModal = (onClose = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MergeContactsModal
        survivorContactId="c-surv"
        survivorName="Rohan Sharp"
        sibling={sibling}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return onClose
}

beforeEach(() => {
  cleanup()
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ survivorContactId: 'c-surv', eventId: 'e-1' }),
  })) as unknown as typeof fetch
})

describe('MergeContactsModal', () => {
  it('names both records and disables Merge until MERGE is typed exactly', () => {
    renderModal()
    expect(screen.getByText('Rohan Sharp')).toBeInTheDocument()
    expect(screen.getByText(/R\. Sharp/)).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: 'Merge permanently' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'merge' } })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'MERGE' } })
    expect(submit).not.toBeDisabled()
  })

  it('POSTs the absorbed contact to the survivor merge route and closes', async () => {
    const onClose = renderModal()
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'MERGE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge permanently' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toBe('/api/marketing/contacts/c-surv/merge')
    expect(JSON.parse(init.body)).toEqual({ merged_contact_id: 'c-dup' })
  })

  it('surfaces the API error and stays open', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: 'COMMAND_FAILED', message: 'Merge failed. Please retry.' } }),
    })) as unknown as typeof fetch

    const onClose = renderModal()
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'MERGE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge permanently' }))

    await waitFor(() =>
      expect(screen.getByText('Merge failed. Please retry.')).toBeInTheDocument(),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
