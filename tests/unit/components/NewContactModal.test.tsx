import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { NewContactModal } from '@/components/MarketingView/NewContactModal'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const renderModal = () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <NewContactModal onClose={onClose} onSuccess={onSuccess} />
    </QueryClientProvider>,
  )
  return { onClose, onSuccess }
}

const matchResponse = {
  match: {
    contactId: 'c-rohan',
    firstName: 'Rohan Sharp',
    mobileE164: '+61403320117',
    email: 'rohan@billie.loans',
    derivedStage: 'customer',
    matchedOn: 'mobile',
  },
}

/** fetch stub routing by URL: match pre-check vs create POST. */
function stubFetch({ match }: { match: unknown }) {
  return vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/marketing/contacts/match')) {
      return { ok: true, json: async () => ({ match }) }
    }
    return {
      ok: true,
      json: async () => ({ contactId: 'c-new', eventId: 'e-1', created: match === null }),
    }
  }) as unknown as typeof fetch
}

const fillAndSubmit = (label: string) => {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Gary Smith' } })
  fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0403 320 117' } })
  fireEvent.click(screen.getByRole('button', { name: label }))
}

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NewContactModal warn-and-confirm', () => {
  it('creates directly when the natural keys match nothing', async () => {
    global.fetch = stubFetch({ match: null })
    const { onSuccess } = renderModal()
    fillAndSubmit('Create contact')

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(calls[0]).toContain('/api/marketing/contacts/match?')
    expect(calls[1]).toBe('/api/marketing/contacts')
    expect(screen.queryByTestId('duplicate-warning')).not.toBeInTheDocument()
  })

  it('shows the warning instead of creating when a contact matches', async () => {
    global.fetch = stubFetch({ match: matchResponse.match })
    const { onSuccess } = renderModal()
    fillAndSubmit('Create contact')

    await waitFor(() =>
      expect(screen.getByTestId('duplicate-warning')).toBeInTheDocument(),
    )
    expect(screen.getByText('Rohan Sharp')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update existing contact' })).toBeInTheDocument()

    // Only the pre-check has fired — no create POST.
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(calls).toHaveLength(1)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('second submit confirms and posts the update', async () => {
    global.fetch = stubFetch({ match: matchResponse.match })
    const { onSuccess } = renderModal()
    fillAndSubmit('Create contact')

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update existing contact' })).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Update existing contact' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(calls[1]).toBe('/api/marketing/contacts')
  })

  it('editing a natural key clears the pending confirmation', async () => {
    global.fetch = stubFetch({ match: matchResponse.match })
    renderModal()
    fillAndSubmit('Create contact')

    await waitFor(() =>
      expect(screen.getByTestId('duplicate-warning')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: '0403 320 118' } })

    expect(screen.queryByTestId('duplicate-warning')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create contact' })).toBeInTheDocument()
  })

  it('fails closed when the duplicate check errors', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/match')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: { message: 'Duplicate check failed. Please retry.' } }),
        }
      }
      throw new Error('create must not be called')
    }) as unknown as typeof fetch

    const { onSuccess } = renderModal()
    fillAndSubmit('Create contact')

    await waitFor(() =>
      expect(screen.getByText('Duplicate check failed. Please retry.')).toBeInTheDocument(),
    )
    expect(onSuccess).not.toHaveBeenCalled()
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })
})
