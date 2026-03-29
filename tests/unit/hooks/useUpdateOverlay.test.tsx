import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUpdateOverlay } from '@/hooks/mutations/useUpdateOverlay'
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

describe('useUpdateOverlay', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should update overlay successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        newValue: 1.3,
        previousValue: 1.2,
        updatedAt: '2026-01-18T14:00:00Z',
      }),
    })

    const { result } = renderHook(() => useUpdateOverlay(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.updateOverlay({
        value: 1.3,
        updatedBy: 'user-1',
        reason: 'Market adjustment',
      })
    })

    expect(response?.success).toBe(true)
    expect(response?.newValue).toBe(1.3)
    expect(response?.previousValue).toBe(1.2)
  })

  it('should handle update error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid value' }),
    })

    const { result } = renderHook(() => useUpdateOverlay(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.updateOverlay({
          value: 3.0, // Out of range
          updatedBy: 'user-1',
        })
      })
    ).rejects.toThrow('Invalid value')
  })

  it('should send correct request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, newValue: 1.25, previousValue: 1.2, updatedAt: '' }),
    })

    const { result } = renderHook(() => useUpdateOverlay(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.updateOverlay({
        value: 1.25,
        updatedBy: 'user-123',
        reason: 'Test reason',
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/ecl-config/overlay', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        value: 1.25,
        updatedBy: 'user-123',
        reason: 'Test reason',
      }),
    })
  })
})
