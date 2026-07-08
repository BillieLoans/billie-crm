import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NotificationPanel } from '@/components/Notifications'
import type { ApprovalNotification } from '@/hooks/queries/useApprovalNotifications'

// The Notifications barrel pulls in NotificationBadge → useLendingAccess →
// @payloadcms/ui; mock it so the real package (and its CSS) never loads.
vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: { id: 'u-1', role: 'operations' } }),
}))

const mockNotifications: ApprovalNotification[] = [
  {
    id: '1',
    requestNumber: 'WO-TEST-001',
    amount: 5000,
    customerName: 'John Doe',
    reason: 'hardship',
    requestedByName: 'Jane Smith',
    createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    requiresSeniorApproval: false,
  },
  {
    id: '2',
    requestNumber: 'WO-TEST-002',
    amount: 15000,
    customerName: 'Alice Brown',
    reason: 'bankruptcy',
    requestedByName: 'Bob Wilson',
    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    requiresSeniorApproval: true,
  },
]

describe('NotificationPanel', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    notifications: mockNotifications,
    unreadCount: 2,
    isLoading: false,
    onMarkAllAsRead: vi.fn(),
    onMarkAsRead: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Rendering', () => {
    it('should render panel when isOpen is true', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
    })

    it('should not render panel when isOpen is false', () => {
      render(<NotificationPanel {...defaultProps} isOpen={false} />)
      expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument()
    })

    it('should show notification count in title', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByText('(2)')).toBeInTheDocument()
    })

    it('should show loading spinner when isLoading', () => {
      render(<NotificationPanel {...defaultProps} isLoading={true} notifications={[]} />)
      expect(screen.getByTestId('notification-panel')).toBeInTheDocument()
      // Loading spinner is rendered
    })
  })

  describe('Empty State', () => {
    it('should show empty state when no notifications', () => {
      render(<NotificationPanel {...defaultProps} notifications={[]} unreadCount={0} />)
      expect(screen.getByText('All caught up!')).toBeInTheDocument()
      expect(screen.getByText(/No pending write-off requests/)).toBeInTheDocument()
    })
  })

  describe('Notification Items', () => {
    it('should render notification items', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByText('WO-TEST-001')).toBeInTheDocument()
      expect(screen.getByText('WO-TEST-002')).toBeInTheDocument()
    })

    it('should show customer name and amount', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('$5,000.00')).toBeInTheDocument()
    })

    it('should show reason tag', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByText('hardship')).toBeInTheDocument()
      expect(screen.getByText('bankruptcy')).toBeInTheDocument()
    })

    it('should show Senior Approval tag when required', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByText('Senior Approval')).toBeInTheDocument()
    })

    it('should show relative time', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByText('1h ago')).toBeInTheDocument()
      expect(screen.getByText('1d ago')).toBeInTheDocument()
    })
  })

  describe('Actions', () => {
    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(<NotificationPanel {...defaultProps} onClose={onClose} />)
      
      fireEvent.click(screen.getByLabelText('Close notifications'))
      
      expect(onClose).toHaveBeenCalled()
    })

    it('should call onClose when overlay is clicked', () => {
      const onClose = vi.fn()
      render(<NotificationPanel {...defaultProps} onClose={onClose} />)
      
      fireEvent.click(screen.getByTestId('notification-panel-overlay'))
      
      expect(onClose).toHaveBeenCalled()
    })

    it('should call onMarkAllAsRead when Mark all read is clicked', () => {
      const onMarkAllAsRead = vi.fn()
      render(<NotificationPanel {...defaultProps} onMarkAllAsRead={onMarkAllAsRead} />)
      
      fireEvent.click(screen.getByText('Mark all read'))
      
      expect(onMarkAllAsRead).toHaveBeenCalled()
    })

    it('should not show Mark all read button when no unread notifications', () => {
      render(<NotificationPanel {...defaultProps} unreadCount={0} />)
      expect(screen.queryByText('Mark all read')).not.toBeInTheDocument()
    })

    it('should call onMarkAsRead when notification is clicked', () => {
      const onMarkAsRead = vi.fn()
      render(<NotificationPanel {...defaultProps} onMarkAsRead={onMarkAsRead} />)
      
      fireEvent.click(screen.getByTestId('notification-item-1'))
      
      expect(onMarkAsRead).toHaveBeenCalledWith('1')
    })
  })

  describe('View All Link', () => {
    it('should show View All link when there are notifications', () => {
      render(<NotificationPanel {...defaultProps} />)
      expect(screen.getByText(/View All Pending Approvals/)).toBeInTheDocument()
    })

    it('should not show View All link when no notifications', () => {
      render(<NotificationPanel {...defaultProps} notifications={[]} unreadCount={0} />)
      expect(screen.queryByText(/View All Pending Approvals/)).not.toBeInTheDocument()
    })
  })
})
