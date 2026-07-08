import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Import after mocking
import { useReadOnlyMode } from '@/hooks/useReadOnlyMode'
import { useUIStore } from '@/stores/ui'
import { toast } from 'sonner'

// Create query client wrapper
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockConnectedResponse = {
  status: 'connected',
  latencyMs: 150,
  message: 'Ledger Connected',
  checkedAt: '2025-12-11T10:00:00Z',
}

const mockOfflineResponse = {
  status: 'offline',
  latencyMs: 0,
  message: 'Ledger Offline - read-only mode active',
  checkedAt: '2025-12-11T10:00:00Z',
}

describe('useReadOnlyMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    // Reset store state
    useUIStore.setState({ readOnlyMode: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Lending wall (enabled: false)', () => {
    it('does not poll and never flips readOnlyMode when disabled', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOfflineResponse),
      })

      const { result } = renderHook(() => useReadOnlyMode({ enabled: false }), {
        wrapper: createWrapper(),
      })

      // The disabled query defaults status to 'offline' — that must NOT be
      // synced into the store as read-only mode.
      await new Promise((r) => setTimeout(r, 50))
      expect(global.fetch).not.toHaveBeenCalled()
      expect(result.current.isReadOnly).toBe(false)
      expect(useUIStore.getState().readOnlyMode).toBe(false)
    })
  })

  describe('Status Sync', () => {
    it('should set readOnlyMode to false when ledger is connected', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConnectedResponse),
      })

      renderHook(() => useReadOnlyMode(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(false)
      })
    })

    it('should set readOnlyMode to true when ledger is offline', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOfflineResponse),
      })

      renderHook(() => useReadOnlyMode(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(true)
      })
    })

    it('should return isReadOnly status', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOfflineResponse),
      })

      const { result } = renderHook(() => useReadOnlyMode(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isReadOnly).toBe(true)
      })
    })

    it('should return current ledger status', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConnectedResponse),
      })

      const { result } = renderHook(() => useReadOnlyMode(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.status).toBe('connected')
      })
    })
  })

  describe('Recovery Toast', () => {
    it('should not show toast on initial load when connected', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConnectedResponse),
      })

      renderHook(() => useReadOnlyMode(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(false)
      })

      // Toast should not be called on initial load
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should not show toast on initial load when offline', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOfflineResponse),
      })

      renderHook(() => useReadOnlyMode(), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(true)
      })

      // Toast should not be called on initial load
      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should show recovery toast when transitioning from offline to connected', async () => {
      // Create a fresh query client for this test
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      })

      // Start offline
      let fetchCallCount = 0
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        fetchCallCount++
        if (fetchCallCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockOfflineResponse),
          })
        }
        // Second call returns connected
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockConnectedResponse),
        })
      })

      const wrapper = function Wrapper({ children }: { children: React.ReactNode }) {
        return React.createElement(QueryClientProvider, { client: queryClient }, children)
      }

      const { result } = renderHook(() => useReadOnlyMode(), { wrapper })

      // Wait for offline state
      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(true)
      })

      // Toast should not be called yet (initial load)
      expect(toast.success).not.toHaveBeenCalled()

      // Trigger refetch to simulate status change
      await act(async () => {
        await result.current.status // Access to ensure hook is initialized
        await queryClient.invalidateQueries({ queryKey: ['ledger', 'health'] })
      })

      // Wait for connected state
      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(false)
      })

      // Now toast should be called for recovery
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('System restored', expect.objectContaining({
          description: 'Ledger connection restored. All actions are now available.',
        }))
      })
    })
  })

  describe('Loading State', () => {
    it('should return isLoading state from useLedgerHealth', async () => {
      // Create a delayed response to capture loading state
      ;(global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve(mockConnectedResponse),
                }),
              100
            )
          )
      )

      const { result } = renderHook(() => useReadOnlyMode(), {
        wrapper: createWrapper(),
      })

      // Initially should be loading
      expect(result.current.isLoading).toBe(true)

      // After response, should not be loading
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe('Options', () => {
    it('should respect showRecoveryToast option', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockConnectedResponse),
      })

      renderHook(() => useReadOnlyMode({ showRecoveryToast: false }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(false)
      })

      expect(toast.success).not.toHaveBeenCalled()
    })

    it('should treat degraded as offline when option is set', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'degraded',
            latencyMs: 2500,
            message: 'Ledger Degraded',
            checkedAt: '2025-12-11T10:00:00Z',
          }),
      })

      renderHook(() => useReadOnlyMode({ treatDegradedAsOffline: true }), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(true)
      })
    })

    it('should not treat degraded as offline by default', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'degraded',
            latencyMs: 2500,
            message: 'Ledger Degraded',
            checkedAt: '2025-12-11T10:00:00Z',
          }),
      })

      renderHook(() => useReadOnlyMode(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(useUIStore.getState().readOnlyMode).toBe(false)
      })
    })
  })
})
