import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useScheduleConfigChange } from '@/hooks/mutations/useScheduleConfigChange'
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

describe('useScheduleConfigChange', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should schedule overlay change successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        changeId: 'change-123',
        effectiveDate: '2026-02-01',
      }),
    })

    const { result } = renderHook(() => useScheduleConfigChange(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.scheduleChange({
        parameter: 'overlay_multiplier',
        newValue: 1.35,
        effectiveDate: '2026-02-01',
        createdBy: 'user-1',
        reason: 'Quarterly review',
      })
    })

    expect(response?.success).toBe(true)
    expect(response?.changeId).toBe('change-123')
  })

  it('should schedule PD rate change successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        changeId: 'change-456',
        effectiveDate: '2026-03-01',
      }),
    })

    const { result } = renderHook(() => useScheduleConfigChange(), { wrapper: createWrapper() })

    let response: any
    await act(async () => {
      response = await result.current.scheduleChange({
        parameter: 'pd_rate',
        bucket: 'BUCKET_1',
        newValue: 0.07,
        effectiveDate: '2026-03-01',
        createdBy: 'user-1',
      })
    })

    expect(response?.success).toBe(true)
    expect(response?.changeId).toBe('change-456')
  })

  it('should handle scheduling error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Effective date must be in the future' }),
    })

    const { result } = renderHook(() => useScheduleConfigChange(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.scheduleChange({
          parameter: 'overlay_multiplier',
          newValue: 1.2,
          effectiveDate: '2025-01-01', // Past date
          createdBy: 'user-1',
        })
      })
    ).rejects.toThrow('Effective date must be in the future')
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

    const { result } = renderHook(() => useScheduleConfigChange(), { wrapper: createWrapper() })

    await expect(
      act(async () => {
        await result.current.scheduleChange({
          parameter: 'overlay_multiplier',
          newValue: 1.2,
          effectiveDate: '2026-02-01',
          createdBy: 'user-1',
        })
      }),
    ).rejects.toThrow('Please log in to continue.')
  })

  it('surfaces a sensible message for a 403 from requireAuth, never "[object Object]"', async () => {
    // Scheduling an ECL config change is approval-gated (requireAuth(hasApprovalAuthority) in
    // api/ecl-config/schedule/route.ts), so a 403 FORBIDDEN from requireAuth is a routine path.
    // Same shape as the 401 above: error.error is an object.
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

    const { result } = renderHook(() => useScheduleConfigChange(), { wrapper: createWrapper() })

    let caughtMessage = ''
    await act(async () => {
      try {
        await result.current.scheduleChange({
          parameter: 'overlay_multiplier',
          newValue: 1.2,
          effectiveDate: '2026-02-01',
          createdBy: 'user-1',
        })
      } catch (err) {
        caughtMessage = (err as Error).message
      }
    })

    expect(caughtMessage).toBe('You do not have permission to perform this action.')
    expect(caughtMessage).not.toContain('[object Object]')
  })
})
