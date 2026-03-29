import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUpdatePDRate } from '@/hooks/mutations/useUpdatePDRate'
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

describe('useUpdatePDRate', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should update PD rate successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        bucket: 'BUCKET_1',
        newRate: 0.08,
        previousRate: 0.05,
        updatedAt: '2026-01-18T14:00:00Z',
      }),
    })

    const { result } = renderHook(() => useUpdatePDRate(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.updatePDRate({
        bucket: 'BUCKET_1',
        rate: 0.08,
        updatedBy: 'user-1',
        reason: 'Annual review',
      })
    })

    expect(response?.success).toBe(true)
    expect(response?.bucket).toBe('BUCKET_1')
    expect(response?.newRate).toBe(0.08)
  })

  it('should handle update error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid bucket' }),
    })

    const { result } = renderHook(() => useUpdatePDRate(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.updatePDRate({
          bucket: 'INVALID',
          rate: 0.1,
          updatedBy: 'user-1',
        })
      })
    ).rejects.toThrow('Invalid bucket')
  })

  it('should send correct request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, bucket: 'BUCKET_2', newRate: 0.2, previousRate: 0.15, updatedAt: '' }),
    })

    const { result } = renderHook(() => useUpdatePDRate(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.updatePDRate({
        bucket: 'BUCKET_2',
        rate: 0.2,
        updatedBy: 'user-456',
        reason: 'Quarterly adjustment',
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/ecl-config/pd-rate', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucket: 'BUCKET_2',
        rate: 0.2,
        updatedBy: 'user-456',
        reason: 'Quarterly adjustment',
      }),
    })
  })
})
