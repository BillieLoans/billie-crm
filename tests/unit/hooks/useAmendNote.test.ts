import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useAmendNote, type AmendNoteParams } from '@/hooks/mutations/useAmendNote'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children)
    },
  }
}

const validParams: AmendNoteParams = {
  originalNoteId: 'note-original-1',
  customer: 'cust-123',
  channel: 'phone',
  topic: 'complaint',
  subject: 'Corrected note subject',
  content: { type: 'doc', content: [] },
  priority: 'normal',
  sentiment: 'neutral',
}

describe('useAmendNote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates amendment then marks original note as amended', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-amend-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-original-1', status: 'amended' } }),
      })

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useAmendNote('cust-123'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(validParams)
    })

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/contact-notes',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/contact-notes/note-original-1/amend',
      expect.objectContaining({
        method: 'PATCH',
      }),
    )

    const firstCallBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(firstCallBody.amendsNote).toBe('note-original-1')
  })

  it('does not attempt status update if amendment creation fails', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Validation failed' }),
    })

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useAmendNote('cust-123'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(validParams).catch(() => {})
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces actionable error and retry context when status update fails after create', async () => {
    const { toast } = await import('sonner')
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-amend-1' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Update failed' }),
      })

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useAmendNote('cust-123'), { wrapper })

    let caught: unknown
    await act(async () => {
      caught = await result.current.mutateAsync(validParams).catch((e) => e)
    })

    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect((caught as { retryContext?: unknown }).retryContext).toEqual({
      originalNoteId: 'note-original-1',
      amendmentNoteId: 'note-amend-1',
    })
    expect(toast.error).toHaveBeenCalledWith('Amendment partially applied', {
      description:
        'A new amendment was saved, but the original note status update failed. Retry marking the original as amended.',
    })
  })

  it('invalidates contact-notes query and shows success toast after full success', async () => {
    const { toast } = await import('sonner')
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-amend-1' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-original-1', status: 'amended' } }),
      })

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useAmendNote('cust-123'), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(validParams)
    })

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Amendment created')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contact-notes', 'cust-123'] })
    })
  })
})
