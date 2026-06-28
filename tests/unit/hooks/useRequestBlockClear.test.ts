import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRequestBlockClear } from '@/hooks/mutations/useRequestBlockClear'
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

describe('useRequestBlockClear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should expose mutation functions and states', () => {
    const { result } = renderHook(() => useRequestBlockClear(), {
      wrapper: createWrapper(),
    })

    expect(result.current.requestAsync).toBeDefined()
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
  })

  it('should POST to /api/commands/reapp-block-clear/request with correct body', async () => {
    const commandResponse = {
      eventId: 'evt-req-123',
      requestId: 'req-req-123',
      status: 'accepted',
      message: 'Block clear submitted',
    }

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(commandResponse),
    })

    const { result } = renderHook(() => useRequestBlockClear(), {
      wrapper: createWrapper(),
    })

    const requestPromise = result.current.requestAsync({
      canonicalCustomerId: 'cust-abc-123',
      reasons: ['SERVICEABILITY'],
      justification: 'Customer has improved financial situation',
    })

    await vi.runAllTimersAsync()
    await requestPromise

    // Verify command API was called with correct URL
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/commands/reapp-block-clear/request',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // Verify request body
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.canonicalCustomerId).toBe('cust-abc-123')
    expect(body.reasons).toEqual(['SERVICEABILITY'])
    expect(body.justification).toBe('Customer has improved financial situation')
  })

  it('should NOT poll after request — single-op returns immediately', async () => {
    const commandResponse = {
      eventId: 'evt-no-poll',
      requestId: 'req-no-poll',
      status: 'accepted',
    }

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(commandResponse),
    })

    const { result } = renderHook(() => useRequestBlockClear(), {
      wrapper: createWrapper(),
    })

    const requestPromise = result.current.requestAsync({
      canonicalCustomerId: 'cust-no-poll',
      reasons: ['SERVICEABILITY'],
      justification: 'Single-operator path should not poll',
    })

    await vi.runAllTimersAsync()
    await requestPromise

    // Only one fetch call — no polling
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('should include optional fields when provided', async () => {
    const commandResponse = { eventId: 'evt-opt', requestId: 'req-opt', status: 'accepted' }

    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(commandResponse),
    })

    const { result } = renderHook(() => useRequestBlockClear(), {
      wrapper: createWrapper(),
    })

    const requestPromise = result.current.requestAsync({
      canonicalCustomerId: 'cust-opt',
      reasons: ['SERVICEABILITY'],
      justification: 'Valid justification for test',
      conversationId: 'conv-xyz',
      customerName: 'Jane Doe',
    })

    await vi.runAllTimersAsync()
    await requestPromise

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(fetchCall[1].body)
    expect(body.conversationId).toBe('conv-xyz')
    expect(body.customerName).toBe('Jane Doe')
  })

  it('should handle command API errors gracefully', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Unauthorized' } }),
    })

    const { result } = renderHook(() => useRequestBlockClear(), {
      wrapper: createWrapper(),
    })

    await expect(
      result.current.requestAsync({
        canonicalCustomerId: 'cust-err',
        reasons: ['SERVICEABILITY'],
        justification: 'This should fail at the API level',
      }),
    ).rejects.toThrow('Unauthorized')
  })
})
