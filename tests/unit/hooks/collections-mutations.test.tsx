/**
 * Unit tests for the Collections operator mutation hooks (BTB-198 WS5):
 * useFlagHardship, useResumeHardship, useApplyStopContact,
 * useAdvanceToNextStep.
 *
 * Per hook: success POSTs the right body (incl. idempotencyKey) and
 * invalidates ['collections-cases']; a 409 FAILED_PRECONDITION response
 * surfaces the server message verbatim in the toast and does NOT enqueue
 * a failed action; a network/system error does enqueue a failed action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useFlagHardship } from '@/hooks/mutations/useFlagHardship'
import { useResumeHardship } from '@/hooks/mutations/useResumeHardship'
import { useApplyStopContact } from '@/hooks/mutations/useApplyStopContact'
import { useAdvanceToNextStep } from '@/hooks/mutations/useAdvanceToNextStep'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { useOptimisticStore } from '@/stores/optimistic'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children)
    },
  }
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }
}

function fetchMock() {
  return global.fetch as ReturnType<typeof vi.fn>
}

function lastRequestBody() {
  return JSON.parse(fetchMock().mock.calls[0][1].body as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn()
  useFailedActionsStore.setState({ actions: [] })
  useOptimisticStore.setState({ pendingByAccount: new Map() })
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useFlagHardship', () => {
  it('POSTs accountId, reason and idempotencyKey, then invalidates collections-cases', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, {
        result: { accountId: 'acc-1', newState: 'hardship_paused', emittedEventId: 'evt-1' },
      }),
    )

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useFlagHardship(), { wrapper })

    await act(async () => {
      await result.current.flagHardshipAsync({ accountId: 'acc-1', reason: 'temp job loss' })
    })

    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/collections/actions/flag-hardship',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = lastRequestBody()
    expect(body.accountId).toBe('acc-1')
    expect(body.reason).toBe('temp job loss')
    expect(typeof body.idempotencyKey).toBe('string')
    expect(body.idempotencyKey.length).toBeGreaterThan(0)

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['collections-cases'] })

    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalled()
  })

  it('surfaces the server message verbatim on 409 and does not enqueue a failed action', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(409, {
        error: { code: 'FAILED_PRECONDITION', message: 'case already hardship-paused' },
      }),
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useFlagHardship(), { wrapper })

    await act(async () => {
      await result.current
        .flagHardshipAsync({ accountId: 'acc-1', reason: 'temp job loss' })
        .catch(() => {})
    })

    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Cannot flag hardship', {
      description: 'case already hardship-paused',
    })
    expect(useFailedActionsStore.getState().actions).toHaveLength(0)
  })

  it('enqueues a failed action on network error', async () => {
    fetchMock().mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useFlagHardship('LOAN-1'), { wrapper })

    await act(async () => {
      await result.current
        .flagHardshipAsync({ accountId: 'acc-1', reason: 'temp job loss' })
        .catch(() => {})
    })

    const actions = useFailedActionsStore.getState().actions
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('flag-hardship')
    expect(actions[0].accountId).toBe('acc-1')
    expect(actions[0].accountLabel).toBe('LOAN-1')
  })
})

describe('useResumeHardship', () => {
  it('POSTs accountId and idempotencyKey (no reason), then invalidates collections-cases', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, { result: { accountId: 'acc-2', newState: 'open', emittedEventId: 'evt-2' } }),
    )

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useResumeHardship(), { wrapper })

    await act(async () => {
      await result.current.resumeHardshipAsync({ accountId: 'acc-2' })
    })

    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/collections/actions/resume-hardship',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = lastRequestBody()
    expect(body.accountId).toBe('acc-2')
    expect(body.reason).toBeUndefined()
    expect(typeof body.idempotencyKey).toBe('string')

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['collections-cases'] })

    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalled()
  })

  it('surfaces the server message verbatim on 409 and does not enqueue a failed action', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'FAILED_PRECONDITION', message: 'case is not hardship-paused' } }),
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useResumeHardship(), { wrapper })

    await act(async () => {
      await result.current.resumeHardshipAsync({ accountId: 'acc-2' }).catch(() => {})
    })

    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Cannot resume hardship', {
      description: 'case is not hardship-paused',
    })
    expect(useFailedActionsStore.getState().actions).toHaveLength(0)
  })

  it('enqueues a failed action on network error', async () => {
    fetchMock().mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useResumeHardship('LOAN-2'), { wrapper })

    await act(async () => {
      await result.current.resumeHardshipAsync({ accountId: 'acc-2' }).catch(() => {})
    })

    const actions = useFailedActionsStore.getState().actions
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('resume-hardship')
    expect(actions[0].accountId).toBe('acc-2')
    expect(actions[0].accountLabel).toBe('LOAN-2')
  })
})

describe('useApplyStopContact', () => {
  it('POSTs accountId, reason and idempotencyKey, then invalidates collections-cases', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, {
        result: { accountId: 'acc-3', newState: 'awaiting_human', emittedEventId: 'evt-3' },
      }),
    )

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useApplyStopContact(), { wrapper })

    await act(async () => {
      await result.current.applyStopContactAsync({ accountId: 'acc-3', reason: 'dispute' })
    })

    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/collections/actions/stop-contact',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = lastRequestBody()
    expect(body.accountId).toBe('acc-3')
    expect(body.reason).toBe('dispute')
    expect(typeof body.idempotencyKey).toBe('string')

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['collections-cases'] })

    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalled()
  })

  it('surfaces the server message verbatim on 409 and does not enqueue a failed action', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(409, { error: { code: 'FAILED_PRECONDITION', message: 'contact already stopped' } }),
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useApplyStopContact(), { wrapper })

    await act(async () => {
      await result.current
        .applyStopContactAsync({ accountId: 'acc-3', reason: 'dispute' })
        .catch(() => {})
    })

    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Cannot apply stop-contact', {
      description: 'contact already stopped',
    })
    expect(useFailedActionsStore.getState().actions).toHaveLength(0)
  })

  it('enqueues a failed action on network error', async () => {
    fetchMock().mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useApplyStopContact('LOAN-3'), { wrapper })

    await act(async () => {
      await result.current
        .applyStopContactAsync({ accountId: 'acc-3', reason: 'dispute' })
        .catch(() => {})
    })

    const actions = useFailedActionsStore.getState().actions
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('stop-contact')
    expect(actions[0].accountId).toBe('acc-3')
    expect(actions[0].accountLabel).toBe('LOAN-3')
  })
})

describe('useAdvanceToNextStep', () => {
  it('POSTs accountId and idempotencyKey, then invalidates collections-cases', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(200, { result: { accountId: 'acc-4', newState: 'rung_2', emittedEventId: 'evt-4' } }),
    )

    const { wrapper, queryClient } = createWrapper()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useAdvanceToNextStep(), { wrapper })

    await act(async () => {
      await result.current.advanceToNextStepAsync({ accountId: 'acc-4' })
    })

    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/collections/actions/advance',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = lastRequestBody()
    expect(body.accountId).toBe('acc-4')
    expect(typeof body.idempotencyKey).toBe('string')

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['collections-cases'] })

    const { toast } = await import('sonner')
    expect(toast.success).toHaveBeenCalled()
  })

  it('surfaces the server message verbatim on 409 (state or economic gate) and does not enqueue a failed action', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(409, {
        error: { code: 'FAILED_PRECONDITION', message: 'cost of recovery exceeds threshold' },
      }),
    )

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useAdvanceToNextStep(), { wrapper })

    await act(async () => {
      await result.current.advanceToNextStepAsync({ accountId: 'acc-4' }).catch(() => {})
    })

    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledWith('Cannot advance case', {
      description: 'cost of recovery exceeds threshold',
    })
    expect(useFailedActionsStore.getState().actions).toHaveLength(0)
  })

  it('enqueues a failed action on network error', async () => {
    fetchMock().mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useAdvanceToNextStep('LOAN-4'), { wrapper })

    await act(async () => {
      await result.current.advanceToNextStepAsync({ accountId: 'acc-4' }).catch(() => {})
    })

    const actions = useFailedActionsStore.getState().actions
    expect(actions).toHaveLength(1)
    expect(actions[0].type).toBe('advance-step')
    expect(actions[0].accountId).toBe('acc-4')
    expect(actions[0].accountLabel).toBe('LOAN-4')
  })
})
