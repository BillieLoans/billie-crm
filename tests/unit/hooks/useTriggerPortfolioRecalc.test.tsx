import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTriggerPortfolioRecalc } from '@/hooks/mutations/useTriggerPortfolioRecalc'
import React from 'react'

const mockFetch = vi.fn()
global.fetch = mockFetch

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useTriggerPortfolioRecalc', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should trigger portfolio recalc successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        jobId: 'job-123',
        accountCount: 1000,
        status: 'queued',
      }),
    })

    const { result } = renderHook(() => useTriggerPortfolioRecalc(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.triggerRecalc({
        triggeredBy: 'user-1',
      })
    })

    expect(response?.success).toBe(true)
    expect(response?.jobId).toBe('job-123')
    expect(response?.accountCount).toBe(1000)
    expect(response?.status).toBe('queued')
  })

  it('should trigger bulk recalc with account IDs', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        jobId: 'job-456',
        accountCount: 50,
        status: 'queued',
      }),
    })

    const { result } = renderHook(() => useTriggerPortfolioRecalc(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.triggerRecalc({
        triggeredBy: 'user-1',
        accountIds: ['acc-1', 'acc-2', 'acc-3'],
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/ledger/ecl/recalc/bulk', expect.any(Object))
  })

  it('should call portfolio endpoint when no account IDs provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        jobId: 'job-789',
        accountCount: 5000,
        status: 'queued',
      }),
    })

    const { result } = renderHook(() => useTriggerPortfolioRecalc(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.triggerRecalc({
        triggeredBy: 'user-1',
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/ledger/ecl/recalc/portfolio', expect.any(Object))
  })

  it('should handle recalc error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Recalculation already in progress' }),
    })

    const { result } = renderHook(() => useTriggerPortfolioRecalc(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.triggerRecalc({
          triggeredBy: 'user-1',
        })
      })
    ).rejects.toThrow('Recalculation already in progress')
  })

  it('should store result data after successful trigger', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        jobId: 'job-999',
        accountCount: 2000,
        status: 'processing',
      }),
    })

    const { result } = renderHook(() => useTriggerPortfolioRecalc(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.triggerRecalc({
        triggeredBy: 'user-1',
      })
    })

    await waitFor(() => {
      expect(result.current.data?.jobId).toBe('job-999')
    })
    expect(result.current.data?.status).toBe('processing')
  })
})
