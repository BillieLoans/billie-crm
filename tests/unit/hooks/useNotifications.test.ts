import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useNotifications,
  notificationsQueryKey,
  type NotificationsFilters,
} from '@/hooks/queries/useNotifications'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockResponse = {
  docs: [
    {
      id: 'doc-1',
      notificationId: 'ntn_001',
      customerId: 'cust_abc',
      status: 'sent',
      channel: 'email',
      templateName: 'pre_due_email_first',
      eventAt: '2026-05-11T03:14:09.000Z',
      createdAt: '2026-05-11T03:14:09.000Z',
      updatedAt: '2026-05-11T03:14:09.000Z',
    },
  ],
  totalDocs: 1,
  hasNextPage: false,
  hasPrevPage: false,
  page: 1,
}

describe('useNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('query key generation', () => {
    it('produces distinct keys per filter', () => {
      const all = notificationsQueryKey('cust_abc', {})
      const sent = notificationsQueryKey('cust_abc', { status: 'sent' })
      expect(all).not.toEqual(sent)
    })

    it('namespaces by customer id', () => {
      const a = notificationsQueryKey('cust_a', {})
      const b = notificationsQueryKey('cust_b', {})
      expect(a).not.toEqual(b)
    })
  })

  describe('fetch behavior', () => {
    it('fetches with no status filter and returns docs', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      })

      const { result } = renderHook(() => useNotifications('cust_abc', {}), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isLoading).toBe(false))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('/api/notifications')
      expect(url).toContain('customerId%5D%5Bequals%5D=cust_abc')
      expect(url).toContain('sort=-eventAt')
      expect(url).not.toContain('status%5D%5Bequals%5D')

      expect(result.current.notifications).toHaveLength(1)
      expect(result.current.notifications[0].notificationId).toBe('ntn_001')
    })

    it('includes status filter in the query string when provided', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockResponse, docs: [] }),
      })

      const filters: NotificationsFilters = { status: 'failed' }
      renderHook(() => useNotifications('cust_abc', filters), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      const url = fetchMock.mock.calls[0][0] as string
      expect(url).toContain('status%5D%5Bequals%5D=failed')
    })

    it('does not fetch when customer id is empty (disabled)', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      renderHook(() => useNotifications('', {}), { wrapper: createWrapper() })
      // give react-query a tick
      await new Promise((r) => setTimeout(r, 10))
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('surfaces an error when the fetch fails', async () => {
      const fetchMock = global.fetch as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })

      const { result } = renderHook(() => useNotifications('cust_abc', {}), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error).toBeInstanceOf(Error)
    })
  })
})
