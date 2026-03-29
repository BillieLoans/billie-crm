import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useFinalizePeriodClose } from '@/hooks/mutations/useFinalizePeriodClose'

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

const mockFinalizeResponse = {
  success: true,
  periodDate: '2026-01-31',
  finalizedAt: '2026-01-15T14:30:00Z',
  journalEntries: [
    { id: 'je-1', type: 'ECL_PROVISION', description: 'ECL Increase', debitAccount: '4100', creditAccount: '2100', amount: 2000, createdAt: '2026-01-15T14:30:00Z' },
    { id: 'je-2', type: 'YIELD_RECOGNITION', description: 'Accrued Yield', debitAccount: '1200', creditAccount: '4200', amount: 50000, createdAt: '2026-01-15T14:30:00Z' },
  ],
  totalAccounts: 1000,
  totalECLAllowance: 25000,
  totalAccruedYield: 50000,
}

describe('useFinalizePeriodClose', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('should finalize period close successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockFinalizeResponse),
    })

    const { result } = renderHook(() => useFinalizePeriodClose(), {
      wrapper: createWrapper(),
    })

    let response: any
    await act(async () => {
      response = await result.current.finalizePeriodClose({
        previewId: 'preview-123',
        finalizedBy: 'user-1',
      })
    })

    expect(response).toBeDefined()
    expect(response?.success).toBe(true)
    expect(response?.periodDate).toBe('2026-01-31')
    expect(response?.journalEntries).toHaveLength(2)
  })

  it('should handle finalization error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Preview has expired' }),
    })

    const { result } = renderHook(() => useFinalizePeriodClose(), {
      wrapper: createWrapper(),
    })

    await expect(
      act(async () => {
        await result.current.finalizePeriodClose({
          previewId: 'preview-123',
          finalizedBy: 'user-1',
        })
      })
    ).rejects.toThrow('Preview has expired')
  })

  it('should handle unacknowledged anomalies error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'All anomalies must be acknowledged before finalizing' }),
    })

    const { result } = renderHook(() => useFinalizePeriodClose(), {
      wrapper: createWrapper(),
    })

    await expect(
      act(async () => {
        await result.current.finalizePeriodClose({
          previewId: 'preview-123',
          finalizedBy: 'user-1',
        })
      })
    ).rejects.toThrow('All anomalies must be acknowledged before finalizing')
  })

  it('should send correct request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockFinalizeResponse),
    })

    const { result } = renderHook(() => useFinalizePeriodClose(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.finalizePeriodClose({
        previewId: 'preview-456',
        finalizedBy: 'user-789',
      })
    })

    expect(mockFetch).toHaveBeenCalledWith('/api/period-close/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        previewId: 'preview-456',
        finalizedBy: 'user-789',
      }),
    })
  })

  it('should store result data after successful finalization', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockFinalizeResponse),
    })

    const { result } = renderHook(() => useFinalizePeriodClose(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.finalizePeriodClose({
        previewId: 'preview-123',
        finalizedBy: 'user-1',
      })
    })

    await waitFor(() => {
      expect(result.current.data?.periodDate).toBe('2026-01-31')
    })
    expect(result.current.data?.journalEntries).toHaveLength(2)
  })
})
