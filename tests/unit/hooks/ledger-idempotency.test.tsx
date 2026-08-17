/**
 * Unit tests for stable per-intent idempotency keys on the money mutation
 * hooks (P0-1): useWaiveFee and useRecordRepayment.
 *
 * The key (and, for repayments, the `paymentId` payment reference) must be
 * minted ONCE per user intent and carried in the mutation variables, so that
 * every retry of that intent re-POSTs the SAME key:
 *   - the toast "Retry" button (calls `mutation.mutate(params)` with the
 *     original variables), and
 *   - the Failed Actions Center replay (the store snapshots the params object
 *     into localStorage; the `billie-retry-action` listener reads the key back
 *     out of it).
 *
 * A second, independent user intent must get a DIFFERENT key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useWaiveFee } from '@/hooks/mutations/useWaiveFee'
import { useRecordRepayment } from '@/hooks/mutations/useRecordRepayment'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { useOptimisticStore } from '@/stores/optimistic'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) =>
    (global.fetch as ReturnType<typeof vi.fn>)(...(args as [string, RequestInit])),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function fetchMock() {
  return global.fetch as ReturnType<typeof vi.fn>
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) }
}

/**
 * A real 503 `Response` — `parseApiError` branches on `instanceof Response`,
 * so a plain object would be mis-parsed as the error body itself and degrade
 * to UNKNOWN_ERROR (system error, but NOT retryable → no Retry toast action).
 * "unavailable" maps to LEDGER_UNAVAILABLE: system error AND retryable.
 */
function serverErrorResponse() {
  return new Response(JSON.stringify({ error: 'Ledger unavailable' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })
}

function bodyOfCall(index: number) {
  return JSON.parse(fetchMock().mock.calls[index][1].body as string)
}

const WAIVE_TX = {
  id: 'tx-1',
  accountId: 'LA-1',
  type: 'FEE_WAIVER',
  typeLabel: 'Fee Waiver',
  date: '2026-01-01T00:00:00Z',
  feeDelta: -10,
  totalDelta: -10,
  feeAfter: 0,
  totalAfter: 100,
  description: 'Fee waived',
}

const REPAYMENT_RESPONSE = {
  success: true,
  transaction: {
    ...WAIVE_TX,
    type: 'REPAYMENT',
    typeLabel: 'Repayment',
    principalDelta: -10,
    principalAfter: 90,
  },
  eventId: 'evt-1',
  allocation: { allocatedToFees: 0, allocatedToPrincipal: 10, overpayment: 0 },
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

describe('useWaiveFee — idempotency key', () => {
  const params = {
    loanAccountId: 'LA-1',
    waiverAmount: 10,
    reason: 'goodwill',
    approvedBy: 'sup-1',
  }

  it('sends an idempotencyKey in the POST body', async () => {
    fetchMock().mockResolvedValueOnce(
      okResponse({ success: true, transaction: WAIVE_TX, eventId: 'evt-1' }),
    )

    const { result } = renderHook(() => useWaiveFee('LA-1'), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.waiveFeeAsync(params)
    })

    const body = bodyOfCall(0)
    expect(typeof body.idempotencyKey).toBe('string')
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8)
  })

  it('mints a DIFFERENT key for a second, independent user intent', async () => {
    fetchMock().mockResolvedValue(
      okResponse({ success: true, transaction: WAIVE_TX, eventId: 'evt-1' }),
    )

    const { result } = renderHook(() => useWaiveFee('LA-1'), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.waiveFeeAsync(params)
    })
    await act(async () => {
      await result.current.waiveFeeAsync(params)
    })

    expect(bodyOfCall(0).idempotencyKey).not.toBe(bodyOfCall(1).idempotencyKey)
  })

  it('replays the SAME key from the Failed Actions Center (billie-retry-action)', async () => {
    fetchMock().mockResolvedValueOnce(serverErrorResponse())

    const { result } = renderHook(() => useWaiveFee('LA-1', 'LOAN-1'), {
      wrapper: createWrapper(),
    })
    await act(async () => {
      await result.current.waiveFeeAsync(params).catch(() => {})
    })

    const originalKey = bodyOfCall(0).idempotencyKey
    const queued = useFailedActionsStore.getState().actions
    expect(queued).toHaveLength(1)
    // The store snapshots this params object (and persists it to
    // localStorage), so minting the key before the first POST is sufficient
    // for the replay to carry it.
    expect(queued[0].params.idempotencyKey).toBe(originalKey)

    fetchMock().mockResolvedValueOnce(
      okResponse({ success: true, transaction: WAIVE_TX, eventId: 'evt-1' }),
    )

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('billie-retry-action', {
          detail: {
            id: queued[0].id,
            type: 'waive-fee',
            accountId: queued[0].accountId,
            params: queued[0].params,
          },
        }),
      )
      await Promise.resolve()
    })

    expect(fetchMock()).toHaveBeenCalledTimes(2)
    expect(bodyOfCall(1).idempotencyKey).toBe(originalKey)
  })

  it('replays the SAME key from the error toast Retry button', async () => {
    fetchMock().mockResolvedValueOnce(serverErrorResponse())

    const { result } = renderHook(() => useWaiveFee('LA-1'), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.waiveFeeAsync(params).catch(() => {})
    })

    const originalKey = bodyOfCall(0).idempotencyKey

    const { toast } = await import('sonner')
    const toastOptions = (toast.error as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      action?: { label: string; onClick: () => void }
    }
    expect(toastOptions.action?.label).toBe('Retry')

    fetchMock().mockResolvedValueOnce(
      okResponse({ success: true, transaction: WAIVE_TX, eventId: 'evt-1' }),
    )

    await act(async () => {
      toastOptions.action!.onClick()
      await Promise.resolve()
    })

    expect(fetchMock()).toHaveBeenCalledTimes(2)
    // The Retry handler re-calls mutate() with the SAME variables object, so
    // the key rides along unchanged.
    expect(bodyOfCall(1).idempotencyKey).toBe(originalKey)
  })
})

describe('useRecordRepayment — idempotency key and paymentId', () => {
  const params = {
    loanAccountId: 'LA-1',
    amount: 10,
    paymentReference: 'REF-1',
    paymentMethod: 'direct_debit',
  }

  it('sends an idempotencyKey and a paymentId in the POST body', async () => {
    fetchMock().mockResolvedValueOnce(okResponse(REPAYMENT_RESPONSE))

    const { result } = renderHook(() => useRecordRepayment('LA-1'), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.recordRepaymentAsync(params)
    })

    const body = bodyOfCall(0)
    expect(typeof body.idempotencyKey).toBe('string')
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8)
    expect(body.paymentId).toMatch(/^PAY-/)
  })

  it('replays the SAME key AND paymentId from the Failed Actions Center', async () => {
    fetchMock().mockResolvedValueOnce(serverErrorResponse())

    const { result } = renderHook(() => useRecordRepayment('LA-1', 'LOAN-1'), {
      wrapper: createWrapper(),
    })
    await act(async () => {
      await result.current.recordRepaymentAsync(params).catch(() => {})
    })

    const first = bodyOfCall(0)
    const queued = useFailedActionsStore.getState().actions
    expect(queued).toHaveLength(1)
    expect(queued[0].params.idempotencyKey).toBe(first.idempotencyKey)
    expect(queued[0].params.paymentId).toBe(first.paymentId)

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
    const second = bodyOfCall(1)
    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    // Previously re-minted inside mutationFn on every attempt, so the ledger
    // could not dedupe on the payment reference either.
    expect(second.paymentId).toBe(first.paymentId)
  })

  it('mints a DIFFERENT key and paymentId for a second, independent intent', async () => {
    fetchMock().mockResolvedValue(okResponse(REPAYMENT_RESPONSE))

    const { result } = renderHook(() => useRecordRepayment('LA-1'), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.recordRepaymentAsync(params)
    })
    await act(async () => {
      await result.current.recordRepaymentAsync(params)
    })

    expect(bodyOfCall(0).idempotencyKey).not.toBe(bodyOfCall(1).idempotencyKey)
    expect(bodyOfCall(0).paymentId).not.toBe(bodyOfCall(1).paymentId)
  })
})
