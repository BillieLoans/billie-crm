import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { EraseContactModal } from '@/components/MarketingView/EraseContactModal'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const renderModal = (contactName: string | null = 'Rohan', onClose = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <EraseContactModal contactId="c-1" contactName={contactName} onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

beforeEach(() => {
  cleanup()
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ contactId: 'c-1', eventId: 'e-1' }),
  })) as unknown as typeof fetch
})

describe('EraseContactModal', () => {
  it('disables Erase until the confirmation phrase matches exactly', () => {
    renderModal('Rohan')
    const submit = screen.getByRole('button', { name: 'Erase permanently' })
    expect(submit).toBeDisabled()

    const input = screen.getByLabelText(/to confirm/)
    fireEvent.change(input, { target: { value: 'rohan' } }) // wrong case
    expect(submit).toBeDisabled()

    fireEvent.change(input, { target: { value: 'Rohan' } })
    expect(submit).not.toBeDisabled()
  })

  it('falls back to the literal ERASE phrase when the contact has no name', () => {
    renderModal(null)
    const submit = screen.getByRole('button', { name: 'Erase permanently' })

    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'ERASE' } })
    expect(submit).not.toBeDisabled()
  })

  it('POSTs to the erase route and closes on success', async () => {
    const onClose = renderModal('Rohan')
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'Rohan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Erase permanently' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toBe('/api/marketing/contacts/c-1/erase')
    expect(init.method).toBe('POST')
  })

  it('does not submit on Enter while the phrase is wrong', () => {
    renderModal('Rohan')
    const input = screen.getByLabelText(/to confirm/)
    fireEvent.change(input, { target: { value: 'Roha' } })
    fireEvent.submit(input.closest('form')!)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('surfaces the API error and stays open', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: 'COMMAND_FAILED', message: 'Erasure failed. Please retry.' },
      }),
    })) as unknown as typeof fetch

    const onClose = renderModal('Rohan')
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'Rohan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Erase permanently' }))

    await waitFor(() =>
      expect(screen.getByText('Erasure failed. Please retry.')).toBeInTheDocument(),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
