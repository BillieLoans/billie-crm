import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NotificationBadge } from '@/components/Notifications'

// Mock useAuth — lending-side role by default; individual tests flip it
const mockUseAuth = vi.fn(() => ({ user: { id: 'u-1', role: 'operations' } }))
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => mockUseAuth(),
}))

// Mock the useApprovalNotifications hook
const mockRefetch = vi.fn()
const mockMarkAllAsRead = vi.fn()
const mockMarkAsRead = vi.fn()

vi.mock('@/hooks/queries/useApprovalNotifications', () => ({
  useApprovalNotifications: vi.fn(() => ({
    notifications: [],
    totalPending: 0,
    unreadCount: 0,
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    markAllAsRead: mockMarkAllAsRead,
    markAsRead: mockMarkAsRead,
  })),
}))

// Import the mocked module to control it
import { useApprovalNotifications } from '@/hooks/queries/useApprovalNotifications'
const mockUseApprovalNotifications = vi.mocked(useApprovalNotifications)

describe('NotificationBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('should render badge button', () => {
    render(<NotificationBadge />)
    expect(screen.getByTestId('notification-badge-button')).toBeInTheDocument()
  })

  it('does not render or poll for lending-walled roles (marketing)', () => {
    mockUseAuth.mockReturnValueOnce({ user: { id: 'u-2', role: 'marketing' } })
    render(<NotificationBadge />)
    expect(screen.queryByTestId('notification-badge-button')).not.toBeInTheDocument()
    expect(mockUseApprovalNotifications).toHaveBeenCalledWith({ enabled: false })
  })

  it('should not render when visible is false', () => {
    render(<NotificationBadge visible={false} />)
    expect(screen.queryByTestId('notification-badge-button')).not.toBeInTheDocument()
  })

  it('should show count when there are pending approvals', () => {
    mockUseApprovalNotifications.mockReturnValue({
      notifications: [],
      totalPending: 5,
      unreadCount: 3,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      markAllAsRead: mockMarkAllAsRead,
      markAsRead: mockMarkAsRead,
    })

    render(<NotificationBadge />)
    expect(screen.getByTestId('notification-badge-count')).toHaveTextContent('5')
  })

  it('should show 99+ when count exceeds 99', () => {
    mockUseApprovalNotifications.mockReturnValue({
      notifications: [],
      totalPending: 150,
      unreadCount: 100,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      markAllAsRead: mockMarkAllAsRead,
      markAsRead: mockMarkAsRead,
    })

    render(<NotificationBadge />)
    expect(screen.getByTestId('notification-badge-count')).toHaveTextContent('99+')
  })

  it('should not show count badge when totalPending is 0', () => {
    mockUseApprovalNotifications.mockReturnValue({
      notifications: [],
      totalPending: 0,
      unreadCount: 0,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      markAllAsRead: mockMarkAllAsRead,
      markAsRead: mockMarkAsRead,
    })

    render(<NotificationBadge />)
    expect(screen.queryByTestId('notification-badge-count')).not.toBeInTheDocument()
  })

  it('should open panel when badge is clicked', () => {
    mockUseApprovalNotifications.mockReturnValue({
      notifications: [
        {
          id: '1',
          requestNumber: 'WO-TEST-001',
          amount: 1000,
          customerName: 'John Doe',
          reason: 'hardship',
          requestedByName: 'Jane Smith',
          createdAt: new Date().toISOString(),
          requiresSeniorApproval: false,
        },
      ],
      totalPending: 1,
      unreadCount: 1,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      markAllAsRead: mockMarkAllAsRead,
      markAsRead: mockMarkAsRead,
    })

    render(<NotificationBadge />)
    
    fireEvent.click(screen.getByTestId('notification-badge-button'))
    
    expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
  })

  it('should close panel when button is clicked again', () => {
    render(<NotificationBadge />)
    
    const button = screen.getByTestId('notification-badge-button')
    
    // Open
    fireEvent.click(button)
    expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
    
    // Close
    fireEvent.click(button)
    expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument()
  })

  it('should have correct aria-label', () => {
    mockUseApprovalNotifications.mockReturnValue({
      notifications: [],
      totalPending: 3,
      unreadCount: 2,
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      markAllAsRead: mockMarkAllAsRead,
      markAsRead: mockMarkAsRead,
    })

    render(<NotificationBadge />)
    expect(screen.getByTestId('notification-badge-button')).toHaveAttribute(
      'aria-label',
      '3 pending approvals'
    )
  })
})
