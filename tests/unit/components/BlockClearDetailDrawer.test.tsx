import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { BlockClearDetailDrawer } from '@/components/ApprovalsView/BlockClearDetailDrawer'
import type { BlockClearRequest } from '@/hooks/queries/usePendingBlockClears'

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

// Mock useApproveBlockClear
const mockApproveAsync = vi.fn()

vi.mock('@/hooks/mutations/useApproveBlockClear', () => ({
  useApproveBlockClear: () => ({
    approve: vi.fn(),
    approveAsync: mockApproveAsync,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}))

// Mock useRejectBlockClear
const mockRejectAsync = vi.fn()

vi.mock('@/hooks/mutations/useRejectBlockClear', () => ({
  useRejectBlockClear: () => ({
    reject: vi.fn(),
    rejectAsync: mockRejectAsync,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}))

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

const renderWithProviders = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const baseRequest: BlockClearRequest = {
  id: 'req-1',
  requestId: 'req-1',
  requestNumber: 'BC-20241211-001',
  canonicalCustomerId: 'cust-abc-123',
  customerName: 'Jane Doe',
  reasons: ['ID_VERIFICATION', 'INCORRECT_INFO'],
  justification: 'Customer provided valid documents',
  status: 'pending',
  requestedBy: 'user-other-456',
  requestedByName: 'Other User',
  createdAt: '2024-12-11T00:00:00.000Z',
  updatedAt: '2024-12-11T00:00:00.000Z',
}

const defaultProps = {
  request: baseRequest,
  isOpen: true,
  onClose: vi.fn(),
  currentUserId: 'user-me-123',
  currentUserName: 'Me',
}

describe('BlockClearDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('isOwnRequest — self-approval disabled', () => {
    it('disables the Approve button and shows "Cannot approve own request" when requestedBy matches currentUserId', () => {
      const ownRequest: BlockClearRequest = {
        ...baseRequest,
        requestedBy: 'user-me-123',
      }

      renderWithProviders(
        <BlockClearDetailDrawer
          {...defaultProps}
          request={ownRequest}
          currentUserId="user-me-123"
        />,
      )

      const approveBtn = screen.getByTestId('approve-button')
      expect(approveBtn).toBeDisabled()
      expect(screen.getByText('Cannot approve own request')).toBeInTheDocument()
    })

    it('enables the Approve button when requestedBy differs from currentUserId', () => {
      renderWithProviders(<BlockClearDetailDrawer {...defaultProps} />)

      const approveBtn = screen.getByTestId('approve-button')
      expect(approveBtn).not.toBeDisabled()
      expect(screen.queryByText('Cannot approve own request')).not.toBeInTheDocument()
    })
  })

  describe('Approve action', () => {
    it('calls approveAsync with requestId, requestNumber, and comment when Approve is confirmed via modal', async () => {
      mockApproveAsync.mockResolvedValueOnce({
        id: 'req-1',
        requestNumber: 'BC-20241211-001',
        requestId: 'req-1',
        status: 'approved',
      })

      renderWithProviders(<BlockClearDetailDrawer {...defaultProps} />)

      // Click Approve button (not own request, so enabled)
      fireEvent.click(screen.getByTestId('approve-button'))

      // Modal should open
      expect(screen.getByTestId('approval-action-modal')).toBeInTheDocument()

      // Fill in comment (minimum 10 chars)
      fireEvent.change(screen.getByTestId('approval-comment-input'), {
        target: { value: 'Valid reason for approval' },
      })

      // Confirm
      fireEvent.click(screen.getByTestId('modal-confirm-button'))

      await waitFor(() => {
        expect(mockApproveAsync).toHaveBeenCalledWith({
          requestId: 'req-1',
          requestNumber: 'BC-20241211-001',
          comment: 'Valid reason for approval',
        })
      })
    })
  })

  describe('Reject action', () => {
    it('calls rejectAsync with requestId, requestNumber, and reason when Reject is confirmed via modal', async () => {
      mockRejectAsync.mockResolvedValueOnce({
        id: 'req-1',
        requestNumber: 'BC-20241211-001',
        requestId: 'req-1',
        status: 'rejected',
      })

      renderWithProviders(<BlockClearDetailDrawer {...defaultProps} />)

      // Click Reject button
      fireEvent.click(screen.getByTestId('reject-button'))

      // Modal should open
      expect(screen.getByTestId('approval-action-modal')).toBeInTheDocument()

      // Fill in comment (minimum 10 chars)
      fireEvent.change(screen.getByTestId('approval-comment-input'), {
        target: { value: 'Rejected for this reason' },
      })

      // Confirm
      fireEvent.click(screen.getByTestId('modal-confirm-button'))

      await waitFor(() => {
        expect(mockRejectAsync).toHaveBeenCalledWith({
          requestId: 'req-1',
          requestNumber: 'BC-20241211-001',
          reason: 'Rejected for this reason',
        })
      })
    })
  })
})
