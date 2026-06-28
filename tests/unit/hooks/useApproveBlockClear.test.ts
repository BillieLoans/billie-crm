import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useApproveBlockClear } from '@/hooks/mutations/useApproveBlockClear'
import React from 'react'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

// Mock error toast utility
vi.mock('@/lib/utils/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

// Create a fresh query client for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper() {
  const queryClient = createTestQueryClient()
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useApproveBlockClear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should expose mutation functions and states', () => {
    const { result } = renderHook(() => useApproveBlockClear(), {
      wrapper: createWrapper(),
    })

    expect(result.current.approveAsync).toBeDefined()
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
  })

  it('should POST to /api/commands/reapp-block-clear/approve with correct body', async () => {
    const commandResponse = {
      eventId: 'evt-bc-123',
      requestId: 'req-bc-123',
      status: 'accepted',
      message: 'Event accepted',
    }

    const projectionResponse = {
      docs: [
        {
          id: 'doc-bc-123',
          requestNumber: 'BC-20241211-ABCD',
          requestId: 'req-bc-123',
          status: 'approved',
        },
      ],
    }

    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(commandResponse),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(projectionResponse),
      })

    const { result } = renderHook(() => useApproveBlockClear(), {
      wrapper: createWrapper(),
    })

    const approvePromise = result.current.approveAsync({
      requestId: 'req-bc-123',
      requestNumber: 'BC-20241211-ABCD',
      comment: 'Approval is justified by customer circumstances',
    })

    await vi.runAllTimersAsync()
    await approvePromise

    // Verify command API was called with correct URL
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/commands/reapp-block-clear/approve',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // Verify request body
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.requestId).toBe('req-bc-123')
    expect(body.requestNumber).toBe('BC-20241211-ABCD')
    expect(body.comment).toBe('Approval is justified by customer circumstances')
  })

  it('should poll /api/reapplication-block-clear-requests after approve command', async () => {
    const commandResponse = { eventId: 'evt-poll', requestId: 'req-poll', status: 'accepted' }
    const projectionResponse = {
      docs: [
        { id: 'doc-poll', requestId: 'req-poll', requestNumber: 'BC-POLL', status: 'approved' },
      ],
    }

    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(commandResponse) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(projectionResponse) })

    const { result } = renderHook(() => useApproveBlockClear(), {
      wrapper: createWrapper(),
    })

    const approvePromise = result.current.approveAsync({
      requestId: 'req-poll',
      requestNumber: 'BC-POLL',
      comment: 'Valid approval comment here',
    })

    await vi.runAllTimersAsync()
    await approvePromise

    // Second fetch should be polling the projection collection
    const pollCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(pollCall[0]).toContain('/api/reapplication-block-clear-requests')
    expect(pollCall[0]).toContain('req-poll')
    expect(pollCall[0]).toContain('approved')
  })

  it('should handle command API errors gracefully', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Forbidden' } }),
    })

    const { result } = renderHook(() => useApproveBlockClear(), {
      wrapper: createWrapper(),
    })

    await expect(
      result.current.approveAsync({
        requestId: 'req-err',
        requestNumber: 'BC-ERR',
        comment: 'This should fail due to API error',
      }),
    ).rejects.toThrow('Forbidden')
  })

  it('should start in non-pending state', () => {
    const { result } = renderHook(() => useApproveBlockClear(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isPending).toBe(false)
  })
})
