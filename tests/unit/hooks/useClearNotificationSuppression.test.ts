import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useClearNotificationSuppression } from '@/hooks/mutations/useClearNotificationSuppression'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/utils/error-toast', () => ({
  showErrorToast: vi.fn(),
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
    Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children)
    },
  }
}

describe('useClearNotificationSuppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('DELETEs with customerId in the query string', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ customerId: 'cust_abc', cleared: true }),
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useClearNotificationSuppression(), {
      wrapper: Wrapper,
    })

    const response = await result.current.clearSuppressionAsync({ customerId: 'cust_abc' })

    expect(response.cleared).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/notifications/suppression?customerId=cust_abc')
    expect(init.method).toBe('DELETE')
  })

  it('invalidates the suppression query on success', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ customerId: 'cust_abc', cleared: true }),
    })

    const { Wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useClearNotificationSuppression(), {
      wrapper: Wrapper,
    })

    await result.current.clearSuppressionAsync({ customerId: 'cust_abc' })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['notification-suppression', 'cust_abc'],
    })
  })

  it('propagates error message from server', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'gateway error' } }),
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useClearNotificationSuppression(), {
      wrapper: Wrapper,
    })

    await expect(
      result.current.clearSuppressionAsync({ customerId: 'cust_abc' }),
    ).rejects.toThrow('gateway error')
  })
})
