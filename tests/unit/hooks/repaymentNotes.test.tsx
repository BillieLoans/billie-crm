/**
 * The Record Repayment drawer collects a Notes field and passes it into
 * `useRecordRepayment`, but the hook's POST body listed every other param and
 * omitted `notes` — so the operator's note never left the browser. It has to
 * reach the route on the first attempt AND on a Failed Actions replay, since
 * the replay rebuilds the params from the persisted snapshot.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useRecordRepayment } from '@/hooks/mutations/useRecordRepayment'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { useOptimisticStore } from '@/stores/optimistic'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) =>
    (global.fetch as ReturnType<typeof vi.fn>)(...(args as [string, RequestInit])),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const fetchMock = () => global.fetch as ReturnType<typeof vi.fn>
const bodyOfCall = (index: number) =>
  JSON.parse(fetchMock().mock.calls[index][1].body as string)

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: () => Promise.resolve(body) })

/** 503 as a real Response — parseApiError branches on `instanceof Response`. */
const serverErrorResponse = () =>
  new Response(JSON.stringify({ error: 'Ledger unavailable' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })

const REPAYMENT_RESPONSE = {
  success: true,
  transaction: {
    id: 'tx-1',
    accountId: 'LA-1',
    type: 'REPAYMENT',
    typeLabel: 'Repayment',
    date: '2026-09-01T00:00:00Z',
    principalDelta: -10,
    feeDelta: 0,
    totalDelta: -10,
    principalAfter: 90,
    feeAfter: 0,
    totalAfter: 90,
    description: 'Payment received',
  },
  eventId: 'evt-1',
  allocation: { allocatedToFees: 0, allocatedToPrincipal: 10, overpayment: 0 },
}

const params = {
  loanAccountId: 'LA-1',
  amount: 10,
  paymentReference: 'REF-1',
  paymentMethod: 'direct_debit',
  notes: 'Customer called to arrange early payout',
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

describe('useRecordRepayment — operator notes', () => {
  it('sends the notes in the POST body', async () => {
    fetchMock().mockResolvedValueOnce(okResponse(REPAYMENT_RESPONSE))

    const { result } = renderHook(() => useRecordRepayment('LA-1'), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.recordRepaymentAsync(params)
    })

    expect(bodyOfCall(0).notes).toBe('Customer called to arrange early payout')
  })

  it('carries the notes through a Failed Actions replay', async () => {
    fetchMock().mockResolvedValueOnce(serverErrorResponse())

    const { result } = renderHook(() => useRecordRepayment('LA-1', 'LOAN-1'), {
      wrapper: createWrapper(),
    })
    await act(async () => {
      await result.current.recordRepaymentAsync(params).catch(() => {})
    })

    const queued = useFailedActionsStore.getState().actions
    expect(queued).toHaveLength(1)

    fetchMock().mockResolvedValueOnce(okResponse(REPAYMENT_RESPONSE))
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('billie-retry-action', {
          detail: {
            id: queued[0].id,
            type: 'record-repayment',
            accountId: queued[0].accountId,
            params: queued[0].params,
          },
        }),
      )
      await Promise.resolve()
    })

    expect(fetchMock()).toHaveBeenCalledTimes(2)
    expect(bodyOfCall(1).notes).toBe('Customer called to arrange early payout')
  })

  it('omits notes entirely when the operator left the field blank', async () => {
    fetchMock().mockResolvedValueOnce(okResponse(REPAYMENT_RESPONSE))

    const { result } = renderHook(() => useRecordRepayment('LA-1'), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.recordRepaymentAsync({ ...params, notes: undefined })
    })

    expect(bodyOfCall(0).notes).toBeUndefined()
  })
})
