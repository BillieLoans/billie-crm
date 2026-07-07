import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { ResolveFeedbackModal } from '@/components/MarketingView/ResolveFeedbackModal'
import type { FeedbackWithContact } from '@/hooks/queries/useFeedbackQueue'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const feedback = {
  id: 1,
  feedbackId: 'f-1',
  contactIdString: 'c-1',
  contactName: 'Rohan',
  body: 'The repayment screen is confusing',
  status: 'acknowledged',
} as unknown as FeedbackWithContact

const renderModal = (onClose = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <ResolveFeedbackModal feedback={feedback} onClose={onClose} />
    </QueryClientProvider>,
  )
  return onClose
}

beforeEach(() => {
  cleanup()
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ feedbackId: 'f-1', status: 'resolved' }),
  })) as unknown as typeof fetch
})

describe('ResolveFeedbackModal', () => {
  it('quotes the feedback and disables Resolve until a note is entered', () => {
    renderModal()
    expect(screen.getByText('The repayment screen is confusing')).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: 'Resolve' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('What was done?'), {
      target: { value: '   ' },
    })
    expect(submit).toBeDisabled() // whitespace-only stays disabled

    fireEvent.change(screen.getByLabelText('What was done?'), {
      target: { value: 'Walked the contact through the screen' },
    })
    expect(submit).not.toBeDisabled()
  })

  it('POSTs status=resolved with the trimmed note, then closes', async () => {
    const onClose = renderModal()
    fireEvent.change(screen.getByLabelText('What was done?'), {
      target: { value: '  Walked the contact through the screen  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())

    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toBe('/api/marketing/feedback/f-1/status')
    expect(JSON.parse(init.body)).toEqual({
      status: 'resolved',
      note: 'Walked the contact through the screen',
    })
  })

  it('surfaces the API error and stays open', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: 'VALIDATION_ERROR', message: 'A resolution note is required' },
      }),
    })) as unknown as typeof fetch

    const onClose = renderModal()
    fireEvent.change(screen.getByLabelText('What was done?'), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

    await waitFor(() =>
      expect(screen.getByText('A resolution note is required')).toBeInTheDocument(),
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})
