import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { NewBatchModal } from '@/components/MarketingView/NewBatchModal'

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  cleanup()
  vi.restoreAllMocks()
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ batchId: 'batch-123', eventId: 'evt-1' }),
  })) as unknown as typeof fetch
})

describe('NewBatchModal', () => {
  it('disables Create until a name is entered', () => {
    renderWithProviders(<NewBatchModal criteria={{}} onClose={vi.fn()} onSuccess={vi.fn()} />)
    const submit = screen.getByRole('button', { name: 'Create campaign' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Campus wave 2' } })
    expect(submit).not.toBeDisabled()
  })

  it('shows the criteria snapshot entries, or a none-hint when empty', () => {
    const { unmount } = renderWithProviders(
      <NewBatchModal
        criteria={{ source: 'campus', city: 'Sydney' }}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )
    expect(screen.getByText('Source: Campus')).toBeInTheDocument()
    expect(screen.getByText('City: Sydney')).toBeInTheDocument()
    unmount()

    renderWithProviders(<NewBatchModal criteria={{}} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByText(/No grid filters are active/)).toBeInTheDocument()
  })

  it('POSTs name + criteria and hands the new batchId to onSuccess', async () => {
    const onSuccess = vi.fn()
    renderWithProviders(
      <NewBatchModal criteria={{ source: 'campus' }} onClose={vi.fn()} onSuccess={onSuccess} />,
    )

    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Campus wave 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('batch-123'))

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/marketing/batches')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      name: 'Campus wave 2',
      criteria: { source: 'campus' },
    })
  })

  it('surfaces the API error message and does not call onSuccess', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        error: { code: 'COMMAND_FAILED', message: 'Creating the batch failed. Please retry.' },
      }),
    })) as unknown as typeof fetch

    const onSuccess = vi.fn()
    renderWithProviders(<NewBatchModal criteria={{}} onClose={vi.fn()} onSuccess={onSuccess} />)

    fireEvent.change(screen.getByLabelText('Campaign name'), { target: { value: 'Doomed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }))

    await waitFor(() =>
      expect(screen.getByText('Creating the batch failed. Please retry.')).toBeInTheDocument(),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
