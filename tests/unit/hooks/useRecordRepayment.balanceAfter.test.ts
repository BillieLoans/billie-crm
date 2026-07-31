/**
 * Task 5: useRecordRepayment must report the settled balance
 * (transaction.totalAfter) on the pending mutation once the repayment is
 * confirmed AND the payment actually moved the total (transaction.totalDelta
 * !== 0) — and must NOT report one when nothing settled (the mutation
 * failed) or when the response settled with a zero delta (e.g. a late or
 * duplicate payment against an account that is already fully paid off,
 * which allocates entirely to overpayment).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useRecordRepayment } from '@/hooks/mutations/useRecordRepayment'
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

describe('useRecordRepayment balanceAfter wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    global.fetch = vi.fn()
    useOptimisticStore.setState({ pendingByAccount: new Map() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the settled totalAfter balance once the repayment is confirmed', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          transaction: {
            id: 'tx-1',
            accountId: 'LA-1',
            type: 'REPAYMENT',
            typeLabel: 'Repayment',
            date: '2026-07-31T00:00:00Z',
            principalDelta: -40,
            feeDelta: -10,
            totalDelta: -50,
            principalAfter: 400,
            feeAfter: 0,
            totalAfter: 400,
            description: 'Repayment applied',
          },
          eventId: 'evt-1',
          allocation: { allocatedToFees: 10, allocatedToPrincipal: 40, overpayment: 0 },
        }),
    })

    const { result } = renderHook(() => useRecordRepayment('LA-1'), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.recordRepaymentAsync({
        loanAccountId: 'LA-1',
        amount: 50,
        paymentReference: 'ref-1',
        paymentMethod: 'direct_debit',
      })
    })

    const confirmed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-1')
      .find((m) => m.action === 'record-repayment')

    expect(confirmed?.stage).toBe('confirmed')
    expect(confirmed?.balanceAfter).toBe(400)
  })

  it('does not report a balance on failure — nothing settled to report (discrimination guard)', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'ledger_unavailable', message: 'Ledger unavailable' }),
    })

    const { result } = renderHook(() => useRecordRepayment('LA-2'), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.recordRepaymentAsync({
          loanAccountId: 'LA-2',
          amount: 10,
          paymentReference: 'ref-2',
          paymentMethod: 'direct_debit',
        }),
      ).rejects.toThrow()
    })

    const failed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-2')
      .find((m) => m.action === 'record-repayment')

    expect(failed?.stage).toBe('failed')
    expect(failed?.balanceAfter).toBeUndefined()
  })

  it('does not report a balance for a zero-allocation repayment (discrimination guard)', async () => {
    // A late or duplicate payment recorded against an account that is already
    // fully paid off allocates entirely to overpayment: allocatedToFees and
    // allocatedToPrincipal are both 0, totalDelta is 0, and totalAfter equals
    // totalBefore. RecordRepaymentDrawer's isOverpayment check
    // (`numAmount > totalOutstanding && totalOutstanding > 0`) is false when
    // totalOutstanding is exactly 0, so this path submits without a
    // confirmation dialog — it is reachable, not hypothetical. balanceAfter
    // must stay undefined so the announcer never claims the balance
    // "updated" when it did not move.
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          transaction: {
            id: 'tx-2',
            accountId: 'LA-4',
            type: 'REPAYMENT',
            typeLabel: 'Repayment',
            date: '2026-07-31T00:00:00Z',
            principalDelta: 0,
            feeDelta: 0,
            totalDelta: 0,
            principalAfter: 0,
            feeAfter: 0,
            totalAfter: 0,
            description: 'Repayment applied (fully overpayment)',
          },
          eventId: 'evt-2',
          allocation: { allocatedToFees: 0, allocatedToPrincipal: 0, overpayment: 50 },
        }),
    })

    const { result } = renderHook(() => useRecordRepayment('LA-4'), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.recordRepaymentAsync({
        loanAccountId: 'LA-4',
        amount: 50,
        paymentReference: 'ref-4',
        paymentMethod: 'direct_debit',
      })
    })

    const confirmed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-4')
      .find((m) => m.action === 'record-repayment')

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
            id: 'tx-5',
            accountId: 'LA-6',
            type: 'REPAYMENT',
            typeLabel: 'Repayment',
            date: '2026-07-31T00:00:00Z',
            principalDelta: null,
            feeDelta: null,
            totalDelta: null,
            principalAfter: null,
            feeAfter: null,
            totalAfter: null,
            description: 'Repayment applied (missing proto fields)',
          },
          eventId: 'evt-5',
          allocation: { allocatedToFees: 0, allocatedToPrincipal: 0, overpayment: 0 },
        }),
    })

    const { result } = renderHook(() => useRecordRepayment('LA-6'), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.recordRepaymentAsync({
        loanAccountId: 'LA-6',
        amount: 50,
        paymentReference: 'ref-6',
        paymentMethod: 'direct_debit',
      })
    })

    const confirmed = useOptimisticStore
      .getState()
      .getPendingForAccount('LA-6')
      .find((m) => m.action === 'record-repayment')

    expect(confirmed?.stage).toBe('confirmed')
    expect(confirmed?.balanceAfter).toBeUndefined()
  })
})
