import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { installMockLocalStorage } from '../../utils/mock-local-storage'

// Mock sonner toast
const mockToastInfo = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}))

// Mock formatCurrency
vi.mock('@/lib/formatters', () => ({
  formatCurrency: (amount: number) => `$${amount.toLocaleString()}`,
}))

// Import after mocks are set up
import { useApprovalNotifications, approvalNotificationsQueryKey } from '@/hooks/queries/useApprovalNotifications'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

installMockLocalStorage(localStorageMock)

// Create a fresh query client for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    )
  }
}

const mockNotification = {
  id: 'notif-1',
  requestNumber: 'WO-TEST-001',
  amount: 5000,
  customerName: 'John Doe',
  reason: 'hardship',
  requestedByName: 'Jane Smith',
  createdAt: new Date().toISOString(),
  requiresSeniorApproval: false,
}

describe('useApprovalNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should have correct query key prefix for cache sharing', () => {
    expect(approvalNotificationsQueryKey[0]).toBe('write-off-requests')
    expect(approvalNotificationsQueryKey[1]).toBe('notifications')
  })

  it('should expose correct return values', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [],
          totalDocs: 0,
          page: 1,
          totalPages: 0,
        }),
    })

    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useApprovalNotifications(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.notifications).toEqual([])
    expect(result.current.totalPending).toBe(0)
    expect(result.current.unreadCount).toBe(0)
    expect(result.current.markAllAsRead).toBeDefined()
    expect(result.current.markAsRead).toBeDefined()
    expect(result.current.refetch).toBeDefined()
  })

  it('should NOT show toast on initial fetch', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [mockNotification],
          totalDocs: 1,
          page: 1,
          totalPages: 1,
        }),
    })

    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useApprovalNotifications(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Should NOT have called toast on first fetch
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it('should show toast when new notification arrives after initial fetch', async () => {
    const queryClient = createTestQueryClient()

    // First fetch - empty
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [],
          totalDocs: 0,
          page: 1,
          totalPages: 0,
        }),
    })

    const { result, rerender } = renderHook(() => useApprovalNotifications(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Second fetch - new notification
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [mockNotification],
          totalDocs: 1,
          page: 1,
          totalPages: 1,
        }),
    })

    // Trigger refetch
    await act(async () => {
      await result.current.refetch()
    })

    // Wait for toast to be called
    await waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalled()
    })

    expect(mockToastInfo).toHaveBeenCalledWith(
      expect.stringContaining('WO-TEST-001'),
      expect.objectContaining({
        description: expect.stringContaining('John Doe'),
      })
    )
  })

  it('should calculate unreadCount correctly', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [
            mockNotification,
            { ...mockNotification, id: 'notif-2', requestNumber: 'WO-TEST-002' },
          ],
          totalDocs: 2,
          page: 1,
          totalPages: 1,
        }),
    })

    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useApprovalNotifications(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Both should be unread (not in localStorage)
    expect(result.current.unreadCount).toBe(2)
    expect(result.current.totalPending).toBe(2)
  })

  it('should mark notification as read via markAsRead', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [mockNotification],
          totalDocs: 1,
          page: 1,
          totalPages: 1,
        }),
    })

    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useApprovalNotifications(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Initially unread
    expect(result.current.unreadCount).toBe(1)

    // Mark as read
    act(() => {
      result.current.markAsRead('notif-1')
    })

    // Check localStorage was updated
    const stored = JSON.parse(localStorageMock.getItem('billie-crm-seen-notifications') || '[]')
    expect(stored).toContain('notif-1')
  })

  it('should mark all as read via markAllAsRead', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [
            mockNotification,
            { ...mockNotification, id: 'notif-2' },
            { ...mockNotification, id: 'notif-3' },
          ],
          totalDocs: 3,
          page: 1,
          totalPages: 1,
        }),
    })

    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useApprovalNotifications(), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Mark all as read
    act(() => {
      result.current.markAllAsRead()
    })

    // Check localStorage was updated with all IDs
    const stored = JSON.parse(localStorageMock.getItem('billie-crm-seen-notifications') || '[]')
    expect(stored).toContain('notif-1')
    expect(stored).toContain('notif-2')
    expect(stored).toContain('notif-3')
  })

  it('should disable polling when enabled is false', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [],
          totalDocs: 0,
          page: 1,
          totalPages: 0,
        }),
    })

    const queryClient = createTestQueryClient()
    renderHook(() => useApprovalNotifications({ enabled: false }), {
      wrapper: createWrapper(queryClient),
    })

    // Should NOT have called fetch since enabled is false
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should not show toasts when showToasts is false', async () => {
    const queryClient = createTestQueryClient()

    // First fetch - empty
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [],
          totalDocs: 0,
          page: 1,
          totalPages: 0,
        }),
    })

    const { result } = renderHook(
      () => useApprovalNotifications({ showToasts: false }),
      {
        wrapper: createWrapper(queryClient),
      }
    )

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Second fetch - new notification
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          docs: [mockNotification],
          totalDocs: 1,
          page: 1,
          totalPages: 1,
        }),
    })

    await act(async () => {
      await result.current.refetch()
    })

    // Should NOT show toast
    expect(mockToastInfo).not.toHaveBeenCalled()
  })
})
