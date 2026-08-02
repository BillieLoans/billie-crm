import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCancelConfigChange } from '@/hooks/mutations/useCancelConfigChange'
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

describe('useCancelConfigChange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should cancel a pending config change successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          changeId: 'change-123',
          cancelledAt: '2026-01-15T14:30:00Z',
        }),
    })

    const { result } = renderHook(() => useCancelConfigChange(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.cancelChange({
        changeId: 'change-123',
        cancelledBy: 'user-1',
      })
    })

    expect(response?.success).toBe(true)
    expect(response?.changeId).toBe('change-123')
  })

  it('should send correct request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, changeId: 'change-456', cancelledAt: '2026-01-15' }),
    })

    const { result } = renderHook(() => useCancelConfigChange(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.cancelChange({ changeId: 'change-456', cancelledBy: 'user-789' })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/ecl-config/pending/change-456', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelledBy: 'user-789' }),
    })
  })

  it('prefers the route detail sentence over the duplicate error title on a 500', async () => {
    // Real route shape (api/ecl-config/pending/[changeId]/route.ts) is { error, details },
    // never { message } — before the fix, error.message was always undefined so the hook's
    // hardcoded fallback always fired instead of the server's actual reason.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: 'Failed to cancel config change',
          details: 'An internal error occurred. Please try again.',
        }),
    })

    const { result } = renderHook(() => useCancelConfigChange(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.cancelChange({ changeId: 'change-123', cancelledBy: 'user-1' })
      }),
    ).rejects.toThrow('An internal error occurred. Please try again.')
  })

  it('surfaces a sensible message for a 401 from requireAuth, never "[object Object]"', async () => {
    // requireAuth (src/lib/auth.ts) returns { error: { code, message } } on 401 — error.error
    // is an OBJECT here, not a string. An unguarded `error.error ||` produces
    // `new Error(<object>)`, whose message is the literal string "[object Object]".
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' },
        }),
    })

    const { result } = renderHook(() => useCancelConfigChange(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.cancelChange({ changeId: 'change-123', cancelledBy: 'user-1' })
      }),
    ).rejects.toThrow('Please log in to continue.')
  })

  it('surfaces a sensible message for a 403 from requireAuth, never "[object Object]"', async () => {
    // Cancelling a pending ECL config change is approval-gated, so a 403 FORBIDDEN from
    // requireAuth is a routine path. Same shape as the 401 above: error.error is an object.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
          },
        }),
    })

    const { result } = renderHook(() => useCancelConfigChange(), { wrapper: createWrapper() })

    let caughtMessage = ''
    await act(async () => {
      try {
        await result.current.cancelChange({ changeId: 'change-123', cancelledBy: 'user-1' })
      } catch (err) {
        caughtMessage = (err as Error).message
      }
    })

    expect(caughtMessage).toBe('You do not have permission to perform this action.')
    expect(caughtMessage).not.toContain('[object Object]')
  })

  it('surfaces the route-specific error when there is no details field', async () => {
    // The changeId-required 400 on this route carries no `details` at all.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'changeId is required' }),
    })

    const { result } = renderHook(() => useCancelConfigChange(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.cancelChange({ changeId: '', cancelledBy: 'user-1' })
      }),
    ).rejects.toThrow('changeId is required')
  })
})
