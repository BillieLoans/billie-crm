import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApprovalDetailDrawer } from '@/components/ApprovalsView'
import type { WriteOffApproval } from '@/hooks/queries/usePendingApprovals'

// Mock the mutation hooks
const mockApproveRequestAsync = vi.fn()
const mockRejectRequestAsync = vi.fn()
const mockCancelRequestAsync = vi.fn()

vi.mock('@/hooks/mutations/useApproveWriteOff', () => ({
  useApproveWriteOff: () => ({
    approveRequestAsync: mockApproveRequestAsync,
    isPending: false,
  }),
}))

vi.mock('@/hooks/mutations/useRejectWriteOff', () => ({
  useRejectWriteOff: () => ({
    rejectRequestAsync: mockRejectRequestAsync,
    isPending: false,
  }),
}))

vi.mock('@/hooks/mutations/useCancelWriteOff', () => ({
  useCancelWriteOff: () => ({
    cancelRequestAsync: mockCancelRequestAsync,
    isPending: false,
  }),
}))

// Test utilities
const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const mockApproval: WriteOffApproval = {
  id: 'req-123',
  requestNumber: 'WO-TEST-001',
  loanAccountId: 'loan-456',
  customerId: 'cust-789',
  customerName: 'John Doe',
  accountNumber: 'ACC-001',
  amount: 5000,
  originalBalance: 5000,
  reason: 'hardship',
  notes: 'Test notes',
  status: 'pending',
  priority: 'normal',
  requiresSeniorApproval: false,
  requestedBy: 'user-abc',
  requestedByName: 'Jane Smith',
  requestedAt: '2025-12-01T10:00:00Z',
  createdAt: '2025-12-01T10:00:00Z',
  updatedAt: '2025-12-01T10:00:00Z',
}

describe('ApprovalDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Rendering', () => {
    it('should render drawer when open with approval', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
        />
      )
      expect(screen.getByText('WO-TEST-001')).toBeInTheDocument()
    })

    it('should not render when approval is null', () => {
      const { container } = renderWithProviders(
        <ApprovalDetailDrawer
          approval={null}
          isOpen={true}
          onClose={vi.fn()}
        />
      )
      expect(container.firstChild).toBeNull()
    })

    it('should display customer and account details', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
        />
      )
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('cust-789')).toBeInTheDocument()
      expect(screen.getByText('loan-456')).toBeInTheDocument()
    })
  })

  describe('Segregation of Duties', () => {
    it('should disable Approve button when user is the requestor', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-abc" // Same as requestedBy
          currentUserName="Jane Smith"
        />
      )

      const approveButton = screen.getByTestId('approve-button')
      expect(approveButton).toBeDisabled()
    })

    it('should show disabled reason text when user is the requestor', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-abc" // Same as requestedBy
        />
      )

      expect(screen.getByText('Cannot approve own request')).toBeInTheDocument()
    })

    it('should enable Approve button when user is NOT the requestor', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-xyz" // Different from requestedBy
        />
      )

      const approveButton = screen.getByTestId('approve-button')
      expect(approveButton).not.toBeDisabled()
    })

    it('should enable Reject button even when user is the requestor', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-abc" // Same as requestedBy
        />
      )

      const rejectButton = screen.getByTestId('reject-button')
      expect(rejectButton).not.toBeDisabled()
    })

    it('should show correct tooltip when user is the requestor', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-abc"
        />
      )

      const approveButton = screen.getByTestId('approve-button')
      expect(approveButton).toHaveAttribute('title', 'Cannot approve your own request')
    })

    it('should show correct tooltip when user is NOT the requestor', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-xyz"
        />
      )

      const approveButton = screen.getByTestId('approve-button')
      expect(approveButton).toHaveAttribute('title', 'Approve this request')
    })
  })

  describe('Action Buttons', () => {
    it('should only show action buttons for pending status', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByTestId('approve-button')).toBeInTheDocument()
      expect(screen.getByTestId('reject-button')).toBeInTheDocument()
    })

    it('should NOT show action buttons for approved status', () => {
      const approvedRequest = { ...mockApproval, status: 'approved' as const }
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={approvedRequest}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByTestId('approve-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('reject-button')).not.toBeInTheDocument()
    })

    it('should open modal when Approve is clicked', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-xyz"
        />
      )

      fireEvent.click(screen.getByTestId('approve-button'))
      expect(screen.getByTestId('approval-action-modal')).toBeInTheDocument()
      expect(screen.getByText('Approve Write-Off')).toBeInTheDocument()
    })

    it('should open modal when Reject is clicked', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
          currentUserId="user-xyz"
        />
      )

      fireEvent.click(screen.getByTestId('reject-button'))
      expect(screen.getByTestId('approval-action-modal')).toBeInTheDocument()
      expect(screen.getByText('Reject Write-Off')).toBeInTheDocument()
    })
  })

  describe('Senior Approval Warning', () => {
    it('should show senior approval warning when required', () => {
      const seniorApproval = { ...mockApproval, requiresSeniorApproval: true }
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={seniorApproval}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByText(/This request requires senior approval/)).toBeInTheDocument()
    })

    it('should NOT show senior approval warning when not required', () => {
      renderWithProviders(
        <ApprovalDetailDrawer
          approval={mockApproval}
          isOpen={true}
          onClose={vi.fn()}
        />
      )

      expect(screen.queryByText(/This request requires senior approval/)).not.toBeInTheDocument()
    })
  })
})
