/**
 * Task 5: useWaiveFee must report the settled balance (transaction.totalAfter)
 * on the pending mutation once the waiver is confirmed — and must NOT report
 * one when nothing settled (the mutation failed and the balance is unchanged).
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
})
