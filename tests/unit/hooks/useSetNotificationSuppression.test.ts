import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useSetNotificationSuppression } from '@/hooks/mutations/useSetNotificationSuppression'

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

const mockSuppression = {
  customerId: 'cust_abc',
  mode: 'non_essential',
  reason: 'Hardship plan',
  setBy: 'agent:rohan@billie.loans',
  setAt: '2026-05-11T00:00:00Z',
  expiresAt: null,
  sourceEventId: 'evt-1',
  activeNow: true,
}

describe('useSetNotificationSuppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to /api/notifications/suppression with the expected body', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suppression: mockSuppression }),
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSetNotificationSuppression(), { wrapper: Wrapper })

    await result.current.setSuppressionAsync({
      customerId: 'cust_abc',
      mode: 'non_essential',
      reason: 'Hardship plan',
      expiresAt: '2026-06-10T23:59:59Z',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/notifications/suppression')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      customerId: 'cust_abc',
      mode: 'non_essential',
      reason: 'Hardship plan',
      expiresAt: '2026-06-10T23:59:59Z',
    })
  })

  it('invalidates the suppression query on success', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suppression: mockSuppression }),
    })

    const { Wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useSetNotificationSuppression(), { wrapper: Wrapper })

    await result.current.setSuppressionAsync({
      customerId: 'cust_abc',
      mode: 'non_essential',
      reason: 'Hardship plan',
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['notification-suppression', 'cust_abc'],
    })
  })

  it('surfaces server error message', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { message: 'gateway down' } }),
    })

    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useSetNotificationSuppression(), { wrapper: Wrapper })

    await expect(
      result.current.setSuppressionAsync({
        customerId: 'cust_abc',
        mode: 'non_essential',
        reason: 'Hardship plan',
      }),
    ).rejects.toThrow('gateway down')

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
