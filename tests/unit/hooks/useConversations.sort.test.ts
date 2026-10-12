/**
 * useConversations — passes the Applications list sort through to the API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useConversations } from '@/hooks/queries/useConversations'

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const EMPTY_PAGE = { conversations: [], cursor: null, hasMore: false, total: 0 }

describe('useConversations — sort', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => EMPTY_PAGE })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the sort as a query param', async () => {
    const { result } = renderHook(() => useConversations({ filters: {}, sort: '-startedAt' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(new URL(url, 'http://localhost').searchParams.get('sort')).toBe('-startedAt')
  })

  it('omits the sort param when none is given', async () => {
    const { result } = renderHook(() => useConversations({ filters: {} }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(new URL(url, 'http://localhost').searchParams.has('sort')).toBe(false)
  })

  it('refetches from the first page when the sort changes', async () => {
    const { result, rerender } = renderHook(
      ({ sort }: { sort?: string }) => useConversations({ filters: {}, sort }),
      { wrapper: createWrapper(), initialProps: { sort: undefined as string | undefined } },
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender({ sort: 'applicationNumber' })
    await waitFor(() =>
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2),
    )
    const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0] as string
    const params = new URL(url, 'http://localhost').searchParams
    expect(params.get('sort')).toBe('applicationNumber')
    expect(params.has('cursor')).toBe(false)
  })
})
