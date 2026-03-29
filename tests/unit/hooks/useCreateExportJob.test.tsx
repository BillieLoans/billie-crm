import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCreateExportJob } from '@/hooks/mutations/useCreateExportJob'
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

describe('useCreateExportJob', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should create export job successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          jobId: 'job-123',
          status: 'pending',
        }),
    })

    const { result } = renderHook(() => useCreateExportJob(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.createExportJob({
        type: 'journal_entries',
        format: 'csv',
        createdBy: 'user-1',
        options: { periodDate: '2026-01-31' },
      })
    })

    expect(response?.success).toBe(true)
    expect(response?.jobId).toBe('job-123')
  })

  it('should handle creation error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid period date' }),
    })

    const { result } = renderHook(() => useCreateExportJob(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.createExportJob({
          type: 'journal_entries',
          format: 'csv',
          createdBy: 'user-1',
          options: { periodDate: 'invalid' },
        })
      })
    ).rejects.toThrow('Invalid period date')
  })

  it('should send correct request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          jobId: 'job-456',
          status: 'pending',
        }),
    })

    const { result } = renderHook(() => useCreateExportJob(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.createExportJob({
        type: 'audit_trail',
        format: 'json',
        createdBy: 'user-2',
        options: {
          accountIds: ['acc-1', 'acc-2'],
          includeCalculationBreakdown: true,
        },
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/export/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exportType: 'EXPORT_TYPE_AUDIT_TRAIL',
        exportFormat: 'EXPORT_FORMAT_JSON',
        createdBy: 'user-2',
        periodDate: undefined,
        accountIds: ['acc-1', 'acc-2'],
        dateRangeStart: undefined,
        dateRangeEnd: undefined,
        includeCalculationBreakdown: true,
      }),
    })
  })
})
