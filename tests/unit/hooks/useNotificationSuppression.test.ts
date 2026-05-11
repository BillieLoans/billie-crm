import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useNotificationSuppression } from '@/hooks/queries/useNotificationSuppression'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useNotificationSuppression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null suppression with isActive=false when none exists', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ suppression: null }),
    })

    const { result } = renderHook(() => useNotificationSuppression('cust_abc'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.suppression).toBeNull()
    expect(result.current.isActive).toBe(false)
    expect(result.current.isExpired).toBe(false)
  })

  it('derives isActive=true when activeNow is true', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suppression: {
          customerId: 'cust_abc',
          mode: 'non_essential',
          reason: 'Hardship plan',
          setBy: 'agent:test@billie.loans',
          setAt: '2026-05-11T00:00:00Z',
          expiresAt: null,
          sourceEventId: 'evt1',
          activeNow: true,
        },
      }),
    })

    const { result } = renderHook(() => useNotificationSuppression('cust_abc'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isActive).toBe(true)
    expect(result.current.isExpired).toBe(false)
    expect(result.current.suppression?.mode).toBe('non_essential')
  })

  it('derives isExpired=true when activeNow is false but suppression exists', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        suppression: {
          customerId: 'cust_abc',
          mode: 'non_essential',
          reason: 'old',
          setBy: 'agent:test',
          setAt: '2026-04-01T00:00:00Z',
          expiresAt: '2026-05-01T00:00:00Z',
          sourceEventId: 'evt2',
          activeNow: false,
        },
      }),
    })

    const { result } = renderHook(() => useNotificationSuppression('cust_abc'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isActive).toBe(false)
    expect(result.current.isExpired).toBe(true)
  })

  it('does not fetch when customer id is empty', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    renderHook(() => useNotificationSuppression(''), { wrapper: createWrapper() })
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
