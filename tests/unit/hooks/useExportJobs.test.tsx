import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useExportJobs } from '@/hooks/queries/useExportJobs'
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

const mockJobs = {
  jobs: [
    {
      id: 'job-1',
      type: 'journal_entries',
      format: 'csv',
      status: 'ready',
      createdAt: '2026-01-18T10:00:00Z',
      createdBy: 'user-1',
      sizeBytes: 1024,
      downloadUrl: 'https://example.com/download/job-1',
    },
    {
      id: 'job-2',
      type: 'audit_trail',
      format: 'json',
      status: 'processing',
      createdAt: '2026-01-18T11:00:00Z',
      createdBy: 'user-1',
    },
  ],
  totalCount: 2,
}

describe('useExportJobs', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should fetch export jobs successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockJobs),
    })

    const { result } = renderHook(() => useExportJobs(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data?.jobs).toHaveLength(2)
    expect(result.current.data?.jobs[0].status).toBe('ready')
    expect(result.current.data?.jobs[1].status).toBe('processing')
  })

  it('should handle fetch error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })

    const { result } = renderHook(() => useExportJobs(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })

    expect(result.current.error?.message).toBe('Failed to fetch export jobs')
  })

  it('should call correct API endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockJobs),
    })

    renderHook(() => useExportJobs(), { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/export/jobs?userId=unknown')
  })

  it('should be disabled when enabled is false', async () => {
    const { result } = renderHook(() => useExportJobs({ enabled: false }), {
      wrapper: createWrapper(),
    })

    expect(result.current.isFetching).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
