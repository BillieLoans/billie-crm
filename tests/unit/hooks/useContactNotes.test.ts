import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useContactNotes,
  contactNotesQueryKey,
  type ContactNotesFilters,
} from '@/hooks/queries/useContactNotes'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockNotesResponse = {
  docs: [
    {
      id: 'note-1',
      channel: 'phone',
      topic: 'general_enquiry',
      subject: 'Customer enquiry',
      content: {},
      priority: 'normal',
      sentiment: 'neutral',
      status: 'active',
      customer: 'cust-123',
      createdBy: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  totalDocs: 1,
  hasNextPage: false,
  hasPrevPage: false,
  page: 1,
}

describe('useContactNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Query Key Generation', () => {
    it('should generate correct query key structure', () => {
      const key = contactNotesQueryKey('cust-123', {})
      expect(key[0]).toBe('contact-notes')
      expect(key[1]).toBe('cust-123')
      expect(key[2]).toEqual({})
    })

    it('should include filters in query key', () => {
      const filters: ContactNotesFilters = { topic: 'complaint', accountId: 'acc-1' }
      const key = contactNotesQueryKey('cust-123', filters)
      expect(key[2]).toEqual({ topic: 'complaint', accountId: 'acc-1' })
    })

    it('should generate different keys for different customers', () => {
      const key1 = contactNotesQueryKey('cust-1', {})
      const key2 = contactNotesQueryKey('cust-2', {})
      expect(key1).not.toEqual(key2)
    })

    it('should generate different keys for different filters', () => {
      const key1 = contactNotesQueryKey('cust-1', {})
      const key2 = contactNotesQueryKey('cust-1', { topic: 'complaint' })
      expect(key1).not.toEqual(key2)
    })
  })

  describe('Hook Behavior', () => {
    it('should be disabled when customerId is empty string', () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise(() => {}),
      )

      const { result } = renderHook(() => useContactNotes(''), {
        wrapper: createWrapper(),
      })

      expect(result.current.fetchStatus).toBe('idle')
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('should fetch notes when customerId is provided', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      const { result } = renderHook(() => useContactNotes('cust-123'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(result.current.notes).toHaveLength(1)
      expect(result.current.totalDocs).toBe(1)
      expect(result.current.hasNextPage).toBe(false)
    })

    it('should return error state on non-ok response', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      const { result } = renderHook(() => useContactNotes('cust-123'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      expect((result.current.error as Error).message).toBe('Failed to fetch contact notes')
    })

    it('should expose fetchNextPage function for infinite pagination', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      const { result } = renderHook(() => useContactNotes('cust-123'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(typeof result.current.fetchNextPage).toBe('function')
    })
  })

  describe('Fetch URL Construction', () => {
    it('should call the correct API endpoint', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('/api/contact-notes')
    })

    it('should include customer equals filter in URL', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('customer')
      expect(callUrl).toContain('equals')
      expect(callUrl).toContain('cust-123')
    })

    it('should include depth=1 in URL', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('depth=1')
    })

    it('should sort by -createdAt', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('sort')
      expect(callUrl).toContain('-createdAt')
    })

    it('should include limit=5 in URL', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('limit=5')
    })
  })

  describe('Topic Filter', () => {
    it('should include topic equals filter when topic is set', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123', { topic: 'complaint' }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('topic')
      expect(callUrl).toContain('equals')
      expect(callUrl).toContain('complaint')
    })

    it('should not include topic filter when topic is null', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123', { topic: null }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).not.toContain('topic')
    })
  })

  describe('Account Filter', () => {
    it('should use loanAccount exists=false when accountId is "none"', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123', { accountId: 'none' }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('loanAccount')
      expect(callUrl).toContain('exists')
      expect(callUrl).toContain('false')
    })

    it('should use loanAccount equals when accountId is a real ID', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123', { accountId: 'acc-456' }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('loanAccount')
      expect(callUrl).toContain('equals')
      expect(callUrl).toContain('acc-456')
    })

    it('should not include loanAccount filter when accountId is null', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123', { accountId: null }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).not.toContain('loanAccount')
    })

    it('should not include loanAccount filter when accountId is undefined', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123', {}), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).not.toContain('loanAccount')
    })
  })

  describe('Pagination', () => {
    it('should include page number in URL', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...mockNotesResponse, page: 3 }),
      })

      renderHook(() => useContactNotes('cust-123'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('page=1')
    })

    it('should default to first page with page=1', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockNotesResponse),
      })

      renderHook(() => useContactNotes('cust-123'), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })

      const callUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(callUrl).toContain('page=1')
    })
  })
})
