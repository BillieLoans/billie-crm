import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useBatchQuery } from '@/hooks/mutations/useBatchQuery'
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

describe('useBatchQuery', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should execute batch query successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            { accountId: 'acc-1', found: true, balance: { total: 1000 }, ecl: { amount: 50 } },
            { accountId: 'acc-2', found: true, balance: { total: 2000 }, ecl: { amount: 100 } },
            { accountId: 'acc-3', found: false },
          ],
          foundCount: 2,
          notFoundCount: 1,
        }),
    })

    const { result } = renderHook(() => useBatchQuery(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.batchQuery({
        accountIds: ['acc-1', 'acc-2', 'acc-3'],
        includeBalance: true,
        includeECL: true,
      })
    })

    expect(response?.foundCount).toBe(2)
    expect(response?.notFoundCount).toBe(1)
    expect(response?.results).toHaveLength(3)
  })

  it('should handle query error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Too many accounts' }),
    })

    const { result } = renderHook(() => useBatchQuery(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.batchQuery({
          accountIds: Array(101).fill('acc'),
          includeBalance: true,
        })
      })
    ).rejects.toThrow('Too many accounts')
  })

  it('should send correct request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [],
          foundCount: 0,
          notFoundCount: 0,
        }),
    })

    const { result } = renderHook(() => useBatchQuery(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.batchQuery({
        accountIds: ['acc-1', 'acc-2'],
        includeBalance: true,
        includeECL: false,
        includeAccrual: true,
        includeAging: true,
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/investigation/batch-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountIds: ['acc-1', 'acc-2'],
        includeBalance: true,
        includeECL: false,
        includeAccrual: true,
        includeAging: true,
      }),
    })
  })
})
