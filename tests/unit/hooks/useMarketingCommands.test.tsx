/**
 * Functional tests for the B6 marketing command mutation hooks — assert the
 * POST URL + body each hook sends. fetch + sonner are mocked.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import {
  useCreateBatch,
  useAssignBatch,
  useTriggerInvitations,
  useSetFeedbackStatus,
} from '@/hooks/mutations/useMarketingCommands'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(QueryClientProvider, { client: queryClient }, children)
    },
  }
}

function mockFetch(): ReturnType<typeof vi.fn> {
  return global.fetch as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ assignedCount: 3, invitedCount: 5, skippedUnconsented: 1 }),
  })) as unknown as typeof fetch
})

describe('useMarketingCommands', () => {
  test('useCreateBatch POSTs name + criteria to /api/marketing/batches', async () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateBatch(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ name: 'Campus 1', criteria: { source: 'campus' } })
    })
    const [url, init] = mockFetch().mock.calls[0]
    expect(url).toBe('/api/marketing/batches')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'Campus 1', criteria: { source: 'campus' } })
  })

  test('useAssignBatch POSTs contact_ids to the batch assign route', async () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useAssignBatch(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ batchId: 'b-1', contactIds: ['c-1', 'c-2'] })
    })
    const [url, init] = mockFetch().mock.calls[0]
    expect(url).toBe('/api/marketing/batches/b-1/assign')
    expect(JSON.parse(init.body)).toEqual({ contact_ids: ['c-1', 'c-2'] })
  })

  test('useTriggerInvitations POSTs (no body) to the invite route', async () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useTriggerInvitations(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('b-1')
    })
    const [url, init] = mockFetch().mock.calls[0]
    expect(url).toBe('/api/marketing/batches/b-1/invite')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  test('useSetFeedbackStatus POSTs status to the feedback status route', async () => {
    const { wrapper } = createWrapper()
    const { result } = renderHook(() => useSetFeedbackStatus(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ feedbackId: 'f-1', status: 'acknowledged' })
    })
    const [url, init] = mockFetch().mock.calls[0]
    expect(url).toBe('/api/marketing/feedback/f-1/status')
    expect(JSON.parse(init.body)).toEqual({ status: 'acknowledged' })
  })
})
