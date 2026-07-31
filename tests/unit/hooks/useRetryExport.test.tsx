import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRetryExport } from '@/hooks/mutations/useRetryExport'
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

describe('useRetryExport', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should retry an export job successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, jobId: 'job-123', status: 'pending' }),
    })

    const { result } = renderHook(() => useRetryExport(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.retryExport('job-123')
    })

    expect(response?.success).toBe(true)
    expect(response?.jobId).toBe('job-123')
  })

  it('should send correct request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, jobId: 'job-456', status: 'pending' }),
    })

    const { result } = renderHook(() => useRetryExport(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.retryExport('job-456')
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/export/jobs/job-456/retry', { method: 'POST' })
  })

  it('surfaces the real 403 permission reason instead of the generic fallback', async () => {
    // The exact scenario from the review finding: api/export/jobs/[jobId]/retry/route.ts:33
    // returns { error: 'You do not have permission to retry this export job' } on 403, with
    // no `details` and no `message` — before the fix, error.message was always undefined so
    // the hook's hardcoded 'Failed to retry export' fallback always won instead.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'You do not have permission to retry this export job' }),
    })

    const { result } = renderHook(() => useRetryExport(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.retryExport('job-123')
      }),
    ).rejects.toThrow('You do not have permission to retry this export job')
  })

  it('prefers the route detail sentence over the duplicate error title on a 500', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: 'Failed to retry export',
          details: 'An internal error occurred. Please try again.',
        }),
    })

    const { result } = renderHook(() => useRetryExport(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.retryExport('job-123')
      }),
    ).rejects.toThrow('An internal error occurred. Please try again.')
  })
})
