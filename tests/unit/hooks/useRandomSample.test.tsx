import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRandomSample } from '@/hooks/mutations/useRandomSample'
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

describe('useRandomSample', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should generate sample successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          accountIds: ['acc-1', 'acc-2', 'acc-3', 'acc-4', 'acc-5'],
          sampleSize: 5,
          seed: 12345,
          matchingAccountCount: 100,
          filters: { bucket: 'BUCKET_1' },
        }),
    })

    const { result } = renderHook(() => useRandomSample(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.generateSample({
        sampleSize: 5,
        filters: { bucket: 'BUCKET_1' },
      })
    })

    expect(response?.accountIds).toHaveLength(5)
    expect(response?.sampleSize).toBe(5)
    expect(response?.matchingAccountCount).toBe(100)
  })

  it('should handle generation error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Sample size exceeds limit' }),
    })

    const { result } = renderHook(() => useRandomSample(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.generateSample({
          sampleSize: 1000,
        })
      })
    ).rejects.toThrow('Sample size exceeds limit')
  })

  it('should send filters and seed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          accountIds: [],
          sampleSize: 10,
          seed: 54321,
          matchingAccountCount: 0,
        }),
    })

    const { result } = renderHook(() => useRandomSample(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.generateSample({
        sampleSize: 10,
        seed: 54321,
        filters: {
          bucket: 'BUCKET_2',
          minECL: 100,
          maxECL: 500,
          minDPD: 30,
          maxDPD: 60,
        },
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/investigation/sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleSize: 10,
        seed: 54321,
        filters: {
          bucket: 'BUCKET_2',
          minECL: 100,
          maxECL: 500,
          minDPD: 30,
          maxDPD: 60,
        },
      }),
    })
  })

  it('should store result data after generation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          accountIds: ['acc-a', 'acc-b'],
          sampleSize: 2,
          seed: 99999,
          matchingAccountCount: 50,
        }),
    })

    const { result } = renderHook(() => useRandomSample(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.generateSample({ sampleSize: 2 })
    })

    await waitFor(() => {
      expect(result.current.data?.accountIds).toEqual(['acc-a', 'acc-b'])
    })
    expect(result.current.data?.seed).toBe(99999)
  })
})
