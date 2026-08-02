import { describe, test, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/stores/failed-actions', () => ({
  useFailedActionsStore: { getState: () => ({ addFailedAction: vi.fn() }) },
}))

import { useCreateRelease, useRevokeRelease } from '@/hooks/mutations/useReleaseCommands'

const fetchMock = vi.fn()
global.fetch = fetchMock as never

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => fetchMock.mockReset())

describe('useCreateRelease', () => {
  test('POSTs the command and resolves the 202 body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ releaseId: 'rel_1', eventId: 'e-1' }),
    })
    const { result } = renderHook(() => useCreateRelease(), { wrapper })
    result.current.mutate({
      releaseId: 'rel_12345678',
      name: 'Wave',
      type: 'waitlist',
      count: 10,
      expiryDays: 14,
      sendInviteSms: false,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/marketing/releases')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).releaseId).toBe('rel_12345678')
  })

  test('surfaces command failure as error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: 'EVENT_PUBLISH_FAILED', message: 'try again' } }),
    })
    const { result } = renderHook(() => useCreateRelease(), { wrapper })
    result.current.mutate({
      releaseId: 'rel_12345678',
      name: 'Wave',
      type: 'waitlist',
      count: 10,
      expiryDays: 14,
      sendInviteSms: false,
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as Error).message).toContain('try again')
  })
})

describe('useRevokeRelease', () => {
  test('POSTs to the right URL with reason', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ releaseId: 'rel_1', eventId: 'e-1' }),
    })
    const { result } = renderHook(() => useRevokeRelease(), { wrapper })
    result.current.mutate({ releaseId: 'rel_12345678', reason: 'duplicate' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/marketing/releases/rel_12345678/revoke')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reason).toBe('duplicate')
  })
})
