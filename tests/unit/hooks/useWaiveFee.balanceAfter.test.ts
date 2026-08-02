/**
 * Task 5: useWaiveFee must report the settled balance (transaction.totalAfter)
 * on the pending mutation once the waiver is confirmed AND the waiver actually
 * moved the total (transaction.totalDelta !== 0) — and must NOT report one
 * when nothing settled (the mutation failed) or when the response settled
 * with a zero delta (e.g. an idempotent replay against an account whose fee
 * balance was already zero).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useWaiveFee } from '@/hooks/mutations/useWaiveFee'
import { useOptimisticStore } from '@/stores/optimistic'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useWaiveFee balanceAfter wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    global.fetch = vi.fn()
    useOptimisticStore.setState({ pendingByAccount: new Map() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the settled totalAfter balance once the waiver is confirmed', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          transaction: {
            id: 'tx-1',
            accountId: 'LA-1',
            type: 'FEE_WAIVER',
            typeLabel: 'Fee Waiver',
            date: '2026-07-31T00:00:00Z',
            feeDelta: -25,
            totalDelta: -25,
            feeAfter: 0,
            totalAfter: 475.5,
            description: 'Waived',
          },
          eventId: 'evt-1',
        }),
    })

    const { result } = renderHook(() => useWaiveFee('LA-1'), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.waiveFeeAsync({
        loanAccountId: 'LA-1',
        waiverAmount: 25,
        reason: 'test',
        approvedBy: 'admin',
      })
    })

    const confirmed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-1')
      .find((m) => m.action === 'waive-fee')

    expect(confirmed?.stage).toBe('confirmed')
    expect(confirmed?.balanceAfter).toBe(475.5)
  })

  it('does not report a balance on failure — nothing settled to report (discrimination guard)', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'ledger_unavailable', message: 'Ledger unavailable' }),
    })

    const { result } = renderHook(() => useWaiveFee('LA-2'), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.waiveFeeAsync({
          loanAccountId: 'LA-2',
          waiverAmount: 10,
          reason: 'test',
          approvedBy: 'admin',
        }),
      ).rejects.toThrow()
    })

    const failed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-2')
      .find((m) => m.action === 'waive-fee')

    expect(failed?.stage).toBe('failed')
    expect(failed?.balanceAfter).toBeUndefined()
  })

  it('does not report a balance when the waiver settled with zero delta (discrimination guard)', async () => {
    // An idempotent replay, or a second waiver racing a first, can settle
    // against a fee balance that is already zero: feeDelta/totalDelta are 0
    // and totalAfter equals what it already was. balanceAfter must stay
    // undefined so the announcer never claims the balance "updated".
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          transaction: {
            id: 'tx-2',
            accountId: 'LA-3',
            type: 'FEE_WAIVER',
            typeLabel: 'Fee Waiver',
            date: '2026-07-31T00:00:00Z',
            feeDelta: 0,
            totalDelta: 0,
            feeAfter: 0,
            totalAfter: 500,
            description: 'No-op waiver (fee balance already zero)',
          },
          eventId: 'evt-2',
        }),
    })

    const { result } = renderHook(() => useWaiveFee('LA-3'), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.waiveFeeAsync({
        loanAccountId: 'LA-3',
        waiverAmount: 25,
        reason: 'test',
        approvedBy: 'admin',
      })
    })

    const confirmed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-3')
      .find((m) => m.action === 'waive-fee')

    expect(confirmed?.stage).toBe('confirmed')
    expect(confirmed?.balanceAfter).toBeUndefined()
  })

  it('does not report a balance when totalDelta/totalAfter arrive as null (discrimination guard)', async () => {
    // The route parseFloat()s proto3 string fields; an unset proto string is
    // "", parseFloat("") is NaN, and JSON.stringify(NaN) emits null. So the
    // client can receive totalDelta: null — the OLD gate (`totalDelta !== 0`)
    // is true for null, and Number(null) is 0, so it would have reported
    // balanceAfter: 0, making the announcer say "Balance updated to $0.00"
    // for a field the server never actually sent.
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          transaction: {
            id: 'tx-3',
            accountId: 'LA-5',
            type: 'FEE_WAIVER',
            typeLabel: 'Fee Waiver',
            date: '2026-07-31T00:00:00Z',
            feeDelta: null,
            totalDelta: null,
            feeAfter: null,
            totalAfter: null,
            description: 'Waived (missing proto fields)',
          },
          eventId: 'evt-3',
        }),
    })

    const { result } = renderHook(() => useWaiveFee('LA-5'), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.waiveFeeAsync({
        loanAccountId: 'LA-5',
        waiverAmount: 25,
        reason: 'test',
        approvedBy: 'admin',
      })
    })

    const confirmed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-5')
      .find((m) => m.action === 'waive-fee')

    expect(confirmed?.stage).toBe('confirmed')
    expect(confirmed?.balanceAfter).toBeUndefined()
  })

  it('does not report a balance when totalAfter is null but totalDelta is a valid non-zero number (asymmetric unset, discrimination guard)', async () => {
    // totalAfter and totalDelta are independently parseFloat()'d proto3 string
    // fields on the route, so one can go missing (-> null) while the other
    // arrives fine. The OLD gate coerced both with `Number(...)` before
    // Number.isFinite — `Number(null)` is 0, which IS finite, so a valid
    // non-zero totalDelta paired with a null totalAfter would have passed the
    // gate and reported `balanceAfter: 0`, telling the operator "Balance
    // updated to $0.00" for a balance the server never actually sent. The
    // `typeof totalAfter === 'number'` guard must reject this before
    // Number.isFinite ever gets a chance to launder the null into 0.
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          transaction: {
            id: 'tx-4',
            accountId: 'LA-7',
            type: 'FEE_WAIVER',
            typeLabel: 'Fee Waiver',
            date: '2026-07-31T00:00:00Z',
            feeDelta: -25,
            totalDelta: -25,
            feeAfter: null,
            totalAfter: null,
            description: 'Waived (totalAfter unset, totalDelta present)',
          },
          eventId: 'evt-4',
        }),
    })

    const { result } = renderHook(() => useWaiveFee('LA-7'), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.waiveFeeAsync({
        loanAccountId: 'LA-7',
        waiverAmount: 25,
        reason: 'test',
        approvedBy: 'admin',
      })
    })

    const confirmed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-7')
      .find((m) => m.action === 'waive-fee')

    expect(confirmed?.stage).toBe('confirmed')
    expect(confirmed?.balanceAfter).toBeUndefined()
  })
})
