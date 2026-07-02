import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useCollectionsCases,
  collectionsCasesQueryKey,
  type CollectionsCasesFilters,
} from '@/hooks/queries/useCollectionsCases'
import { useCollectionsCase, collectionsCaseQueryKey } from '@/hooks/queries/useCollectionsCase'
import {
  useCollectionsCasesByCustomer,
  collectionsCasesByCustomerQueryKey,
} from '@/hooks/queries/useCollectionsCasesByCustomer'
import type { CollectionsCaseRow } from '@/types/collections'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function makeCase(overrides: Partial<CollectionsCaseRow> = {}): CollectionsCaseRow {
  return {
    accountId: 'acc-1',
    customerId: 'cust-1',
    customerName: 'Jane Doe',
    accountNumber: 'ACC-0001',
    state: 'open',
    rung: 1,
    hardshipPaused: false,
    stoppedContact: false,
    overdueAmount: 100.5,
    daysOverdue: 10,
    lastStep: 2,
    openedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    aging: { dpd: 10, bucket: 'early_arrears', totalOverdue: '100.50' },
    ...overrides,
  }
}

function pageResponse(opts: {
  cases: CollectionsCaseRow[]
  page: number
  totalPages: number
  hasNextPage: boolean
  totalDocs: number
  agingUnavailable?: boolean
}) {
  return {
    cases: opts.cases,
    totalDocs: opts.totalDocs,
    page: opts.page,
    totalPages: opts.totalPages,
    hasNextPage: opts.hasNextPage,
    agingUnavailable: opts.agingUnavailable ?? false,
  }
}

describe('collectionsCasesQueryKey', () => {
  it('includes the filters object in the key', () => {
    const filters: CollectionsCasesFilters = { state: 'open', rung: 2 }
    expect(collectionsCasesQueryKey(filters)).toEqual(['collections-cases', filters])
  })
})

describe('collectionsCaseQueryKey', () => {
  it('uses a detail namespace with the accountId', () => {
    expect(collectionsCaseQueryKey('acc-1')).toEqual(['collections-cases', 'detail', 'acc-1'])
  })

  it('carries null through when no accountId is given', () => {
    expect(collectionsCaseQueryKey(null)).toEqual(['collections-cases', 'detail', null])
  })
})

describe('collectionsCasesByCustomerQueryKey', () => {
  it('uses a customer namespace with the customerId', () => {
    expect(collectionsCasesByCustomerQueryKey('cust-1')).toEqual([
      'collections-cases',
      'customer',
      'cust-1',
    ])
  })
})

describe('useCollectionsCases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds the querystring from filters, omitting falsy booleans', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        pageResponse({ cases: [], page: 1, totalPages: 1, hasNextPage: false, totalDocs: 0 }),
    })

    renderHook(
      () =>
        useCollectionsCases({
          state: 'open',
          rung: 3,
          hardshipPaused: false,
          stoppedContact: false,
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/collections/cases?')
    expect(url).toContain('state=open')
    expect(url).toContain('rung=3')
    expect(url).toContain('page=1')
    expect(url).not.toContain('hardshipPaused')
    expect(url).not.toContain('stoppedContact')
    expect(init).toMatchObject({ credentials: 'include' })
  })

  it('only serializes hardshipPaused/stoppedContact when true', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        pageResponse({ cases: [], page: 1, totalPages: 1, hasNextPage: false, totalDocs: 0 }),
    })

    renderHook(() => useCollectionsCases({ hardshipPaused: true, stoppedContact: true }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('hardshipPaused=true')
    expect(url).toContain('stoppedContact=true')
  })

  it('omits state/rung entirely when not provided', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        pageResponse({ cases: [], page: 1, totalPages: 1, hasNextPage: false, totalDocs: 0 }),
    })

    renderHook(() => useCollectionsCases({}), { wrapper: createWrapper() })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain('state=')
    expect(url).not.toContain('rung=')
  })

  it('flatMaps cases across pages as fetchNextPage advances, and surfaces last-page metadata', async () => {
    const page1Cases = [makeCase({ accountId: 'acc-1' }), makeCase({ accountId: 'acc-2' })]
    const page2Cases = [makeCase({ accountId: 'acc-3' })]

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          pageResponse({
            cases: page1Cases,
            page: 1,
            totalPages: 2,
            hasNextPage: true,
            totalDocs: 3,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          pageResponse({
            cases: page2Cases,
            page: 2,
            totalPages: 2,
            hasNextPage: false,
            totalDocs: 3,
            agingUnavailable: true,
          }),
      })

    const { result } = renderHook(() => useCollectionsCases({}), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.cases.map((c) => c.accountId)).toEqual(['acc-1', 'acc-2'])
    expect(result.current.hasNextPage).toBe(true)
    expect(result.current.totalDocs).toBe(3)
    expect(result.current.agingUnavailable).toBe(false)

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.hasNextPage).toBe(false))

    // Page-number pagination: second call requests page=2.
    expect(fetchMock.mock.calls[1][0]).toContain('page=2')

    expect(result.current.cases.map((c) => c.accountId)).toEqual(['acc-1', 'acc-2', 'acc-3'])
    // Metadata reflects the *last* fetched page.
    expect(result.current.totalDocs).toBe(3)
    expect(result.current.agingUnavailable).toBe(true)
  })

  it('throws when the response is not ok', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const { result } = renderHook(() => useCollectionsCases({}), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.cases).toEqual([])
  })

  it('keeps agingUnavailable true even when a later page succeeds (C4 review)', async () => {
    const page1Cases = [makeCase({ accountId: 'acc-1' })]
    const page2Cases = [makeCase({ accountId: 'acc-2' })]

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          pageResponse({
            cases: page1Cases,
            page: 1,
            totalPages: 2,
            hasNextPage: true,
            totalDocs: 2,
            agingUnavailable: true,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          pageResponse({
            cases: page2Cases,
            page: 2,
            totalPages: 2,
            hasNextPage: false,
            totalDocs: 2,
            agingUnavailable: false,
          }),
      })

    const { result } = renderHook(() => useCollectionsCases({}), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.agingUnavailable).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.hasNextPage).toBe(false))

    // Page 1's degraded aging outcome must not be masked by page 2 succeeding —
    // page 1's rows are still shown via flatMap.
    expect(result.current.cases.map((c) => c.accountId)).toEqual(['acc-1', 'acc-2'])
    expect(result.current.agingUnavailable).toBe(true)
  })
})

describe('useCollectionsCase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not fetch when accountId is null (enabled gating)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    renderHook(() => useCollectionsCase(null), { wrapper: createWrapper() })

    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches and returns the case when accountId is provided', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const row = makeCase()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ case: row }),
    })

    const { result } = renderHook(() => useCollectionsCase('acc-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/collections/cases/acc-1',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(result.current.data).toEqual(row)
  })

  it('resolves to null (not an error) on 404', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND' } }),
    })

    const { result } = renderHook(() => useCollectionsCase('acc-missing'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.isError).toBe(false)
    expect(result.current.data).toBeNull()
  })

  it('surfaces an error for non-404 failures', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const { result } = renderHook(() => useCollectionsCase('acc-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useCollectionsCasesByCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not fetch when customerId is null (enabled gating)', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>

    renderHook(() => useCollectionsCasesByCustomer(null), { wrapper: createWrapper() })

    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches with customerId + limit=100 and returns cases', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    const rows = [makeCase({ accountId: 'acc-1' }), makeCase({ accountId: 'acc-2' })]
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        pageResponse({ cases: rows, page: 1, totalPages: 1, hasNextPage: false, totalDocs: 2 }),
    })

    const { result } = renderHook(() => useCollectionsCasesByCustomer('cust-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('customerId=cust-1')
    expect(url).toContain('limit=100')
    expect(result.current.cases).toHaveLength(2)
  })
})
