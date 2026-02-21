import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useCreateNote, type CreateNoteParams } from '@/hooks/mutations/useCreateNote'

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

const validParams: CreateNoteParams = {
  customer: 'cust-123',
  channel: 'phone',
  topic: 'general_enquiry',
  subject: 'Test note',
  content: { root: { type: 'root', children: [] } },
}

describe('useCreateNote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Successful creation', () => {
    it('should POST to /api/contact-notes with the note payload', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-new-1' } }),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams)
      })

      expect(global.fetch).toHaveBeenCalledWith('/api/contact-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validParams),
      })
    })

    it('should show success toast on success', async () => {
      const { toast } = await import('sonner')
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-new-1' } }),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams)
      })

      expect(toast.success).toHaveBeenCalledWith('Note added')
    })

    it('should invalidate contact-notes queries for the customer on success', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-new-1' } }),
      })

      const { wrapper, queryClient } = createWrapper()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams)
      })

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['contact-notes', 'cust-123'],
      })
    })

    it('should return the created note id', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-abc-123' } }),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      let noteResult: { doc: { id: string } } | undefined
      await act(async () => {
        noteResult = await result.current.mutateAsync(validParams)
      })

      expect(noteResult?.doc.id).toBe('note-abc-123')
    })

    it('should include optional fields in the POST body when provided', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ doc: { id: 'note-1' } }),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      const fullParams: CreateNoteParams = {
        ...validParams,
        loanAccount: 'loan-456',
        contactDirection: 'inbound',
        priority: 'high',
        sentiment: 'negative',
      }

      await act(async () => {
        await result.current.mutateAsync(fullParams)
      })

      const [, callOptions] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(callOptions.body)
      expect(body.loanAccount).toBe('loan-456')
      expect(body.contactDirection).toBe('inbound')
      expect(body.priority).toBe('high')
      expect(body.sentiment).toBe('negative')
    })
  })

  describe('Error handling', () => {
    it('should show error toast on API failure', async () => {
      const { toast } = await import('sonner')
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Validation failed' }),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams).catch(() => {})
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to add note', {
          description: 'Validation failed',
        })
      })
    })

    it('should extract Payload errors array message when present', async () => {
      const { toast } = await import('sonner')
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({
            errors: [{ message: 'Required field missing: subject' }],
          }),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams).catch(() => {})
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to add note', {
          description: 'Required field missing: subject',
        })
      })
    })

    it('should show fallback error description when response has no message', async () => {
      const { toast } = await import('sonner')
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams).catch(() => {})
      })

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to add note', {
          description: 'Failed to create note',
        })
      })
    })

    it('should not invalidate queries on failure', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Server error' }),
      })

      const { wrapper, queryClient } = createWrapper()
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams).catch(() => {})
      })

      expect(invalidateSpy).not.toHaveBeenCalled()
    })

    it('should set isError to true on failure', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ message: 'Server error' }),
      })

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      await act(async () => {
        await result.current.mutateAsync(validParams).catch(() => {})
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })
    })
  })

  describe('Loading state', () => {
    it('should expose isPending during mutation', async () => {
      let resolveFetch!: (val: unknown) => void
      ;(global.fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve
        })
      )

      const { wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateNote('cust-123'), { wrapper })

      expect(result.current.isPending).toBe(false)

      act(() => {
        result.current.mutate(validParams)
      })

      await waitFor(() => expect(result.current.isPending).toBe(true))

      act(() => {
        resolveFetch({
          ok: true,
          json: () => Promise.resolve({ doc: { id: 'note-1' } }),
        })
      })

      await waitFor(() => expect(result.current.isPending).toBe(false))
    })
  })
})
