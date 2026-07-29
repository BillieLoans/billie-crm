import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAcknowledgeAnomaly } from '@/hooks/mutations/useAcknowledgeAnomaly'

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

describe('useAcknowledgeAnomaly', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('resolves when the gRPC response reports success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, allAnomaliesAcknowledged: false }),
    })

    const { result } = renderHook(() => useAcknowledgeAnomaly(), {
      wrapper: createWrapper(),
    })

    let response: any
    await act(async () => {
      response = await result.current.acknowledgeAnomaly({
        previewId: 'preview-123',
        anomalyId: 'anomaly-1',
        acknowledgedBy: 'user-1',
      })
    })

    expect(response).toEqual({ success: true, allAnomaliesAcknowledged: false })
  })

  it('rejects with the gRPC errorMessage when the response reports success: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: false,
          errorMessage: 'Preview not found or expired',
          allAnomaliesAcknowledged: false,
        }),
    })

    const { result } = renderHook(() => useAcknowledgeAnomaly(), {
      wrapper: createWrapper(),
    })

    await expect(
      act(async () => {
        await result.current.acknowledgeAnomaly({
          previewId: 'preview-123',
          anomalyId: 'anomaly-1',
          acknowledgedBy: 'user-1',
        })
      })
    ).rejects.toThrow('Preview not found or expired')
  })

  it('rejects when the HTTP response is non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Internal server error' }),
    })

    const { result } = renderHook(() => useAcknowledgeAnomaly(), {
      wrapper: createWrapper(),
    })

    await expect(
      act(async () => {
        await result.current.acknowledgeAnomaly({
          previewId: 'preview-123',
          anomalyId: 'anomaly-1',
          acknowledgedBy: 'user-1',
        })
      })
    ).rejects.toThrow('Internal server error')
  })
})
