import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePeriodClosePreview } from '@/hooks/mutations/usePeriodClosePreview'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Create wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockPreviewResponse = {
  previewId: 'preview-123',
  periodDate: '2026-01-31',
  expiresAt: '2026-01-15T18:00:00Z',
  status: 'ready',
  totalAccounts: 1000,
  totalAccruedYield: 50000,
  totalECLAllowance: 25000,
  totalCarryingAmount: 975000,
  eclByBucket: [
    { bucket: 'CURRENT', accountCount: 800, eclAmount: 5000, carryingAmount: 800000, pdRate: 0.01 },
    { bucket: 'BUCKET_1', accountCount: 100, eclAmount: 10000, carryingAmount: 100000, pdRate: 0.05 },
    { bucket: 'BUCKET_2', accountCount: 50, eclAmount: 5000, carryingAmount: 50000, pdRate: 0.15 },
    { bucket: 'BUCKET_3', accountCount: 50, eclAmount: 5000, carryingAmount: 25000, pdRate: 0.35 },
  ],
  priorPeriodECL: 23000,
  eclChange: 2000,
  eclChangePercent: 8.7,
  anomalies: [],
  anomalyCount: 0,
  acknowledgedCount: 0,
  reconciled: true,
  journalEntries: [
    { type: 'ECL_PROVISION', description: 'ECL Provision Increase', debitAccount: '4100', creditAccount: '2100', amount: 2000 },
  ],
}

describe('usePeriodClosePreview', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should generate preview successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPreviewResponse),
    })

    const { result } = renderHook(() => usePeriodClosePreview(), {
      wrapper: createWrapper(),
    })

    let preview: any
    await act(async () => {
      preview = await result.current.generatePreview({
        periodDate: '2026-01-31',
        requestedBy: 'user-1',
      })
    })

    expect(preview).toBeDefined()
    expect(preview?.previewId).toBe('preview-123')
    expect(preview?.totalAccounts).toBe(1000)
    expect(preview?.eclByBucket).toHaveLength(4)
  })

  it('should handle preview generation error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Period already closed' }),
    })

    const { result } = renderHook(() => usePeriodClosePreview(), {
      wrapper: createWrapper(),
    })

    await expect(
      act(async () => {
        await result.current.generatePreview({
          periodDate: '2025-12-31',
          requestedBy: 'user-1',
        })
      })
    ).rejects.toThrow('Period already closed')
  })

  it('should send correct request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPreviewResponse),
    })

    const { result } = renderHook(() => usePeriodClosePreview(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.generatePreview({
        periodDate: '2026-01-31',
        requestedBy: 'user-123',
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/period-close/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        periodDate: '2026-01-31',
        requestedBy: 'user-123',
      }),
    })
  })

  it('should report isPending during request', async () => {
    let resolvePromise: ((value: unknown) => void) | undefined
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve
    })

    mockFetch.mockImplementationOnce(() => pendingPromise)

    const { result } = renderHook(() => usePeriodClosePreview(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isPending).toBe(false)

    // Start the mutation but don't await it
    act(() => {
      result.current.generatePreview({
        periodDate: '2026-01-31',
        requestedBy: 'user-1',
      }).catch(() => {})
    })

    // Wait for pending state
    await waitFor(() => {
      expect(result.current.isPending).toBe(true)
    })

    // Resolve the promise
    await act(async () => {
      resolvePromise!({
        ok: true,
        json: () => Promise.resolve(mockPreviewResponse),
      })
    })
  })
})
