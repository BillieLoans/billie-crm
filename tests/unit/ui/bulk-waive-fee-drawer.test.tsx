/**
 * Unit tests for BulkWaiveFeeDrawer component
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BulkWaiveFeeDrawer } from '@/components/ServicingView/BulkWaiveFeeDrawer'
import type { SelectedFee } from '@/components/ServicingView/FeeList'

// Mock useWaiveFee
vi.mock('@/hooks/mutations/useWaiveFee', () => ({
  useWaiveFee: vi.fn(() => ({
    waiveFee: vi.fn(),
    isPending: false,
    isReadOnlyMode: false,
    hasPendingWaive: false,
  })),
}))

import { useWaiveFee } from '@/hooks/mutations/useWaiveFee'

const mockSelectedFees: SelectedFee[] = [
  {
    transactionId: 'TX-001',
    amount: 25,
    type: 'LATE_FEE',
    typeLabel: 'Late Fee',
    date: '2024-01-15T00:00:00Z',
  },
  {
    transactionId: 'TX-002',
    amount: 50,
    type: 'DISHONOUR_FEE',
    typeLabel: 'Dishonour Fee',
    date: '2024-01-20T00:00:00Z',
  },
]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('BulkWaiveFeeDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('rendering', () => {
    it('should render drawer when open', () => {
      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Bulk Fee Waiver')).toBeInTheDocument()
    })

    it('should show summary with fee count and total', () => {
      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByText('Number of Fees')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('Total Amount')).toBeInTheDocument()
      expect(screen.getByText('$75.00')).toBeInTheDocument()
    })

    it('should show list of selected fees', () => {
      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByText(/Late Fee/)).toBeInTheDocument()
      expect(screen.getByText(/Dishonour Fee/)).toBeInTheDocument()
      expect(screen.getByText('$25.00')).toBeInTheDocument()
      expect(screen.getByText('$50.00')).toBeInTheDocument()
    })

    it('should show reason field', () => {
      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByLabelText(/Reason/)).toBeInTheDocument()
    })

    it('should show submit button with total amount', () => {
      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByRole('button', { name: /Waive \$75\.00/ })).toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('should require reason field', () => {
      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      // Submit button should be disabled when reason empty
      const submitBtn = screen.getByRole('button', { name: /Waive \$75\.00/ })
      expect(submitBtn).toBeDisabled()

      // Type a space (not a valid reason)
      fireEvent.change(screen.getByLabelText(/Reason/), {
        target: { value: '   ' },
      })

      // Should still be disabled - whitespace-only not valid
      expect(submitBtn).toBeDisabled()
    })

    it('should disable submit when reason empty', () => {
      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      const submitBtn = screen.getByRole('button', { name: /Waive \$75\.00/ })
      expect(submitBtn).toBeDisabled()
    })
  })

  describe('submission', () => {
    it('should call waiveFee with total amount on submit', () => {
      const mockWaiveFee = vi.fn()
      vi.mocked(useWaiveFee).mockReturnValue({
        waiveFee: mockWaiveFee,
        waiveFeeAsync: vi.fn(),
        isPending: false,
        isSuccess: false,
        isError: false,
        error: null,
        isReadOnlyMode: false,
        hasPendingWaive: false,
        isVersionConflict: false,
      })

      const handleClose = vi.fn()
      const handleSuccess = vi.fn()

      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={handleClose}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
          onSuccess={handleSuccess}
        />,
        { wrapper: createWrapper() }
      )

      // Fill reason
      fireEvent.change(screen.getByLabelText(/Reason/), {
        target: { value: 'Bulk waiver for dispute resolution' },
      })

      // Submit
      fireEvent.click(screen.getByRole('button', { name: /Waive \$75\.00/ }))

      expect(mockWaiveFee).toHaveBeenCalledWith({
        loanAccountId: 'LA-001',
        waiverAmount: 75,
        reason: 'Bulk waiver for dispute resolution',
        approvedBy: 'current-user',
      })
      expect(handleClose).toHaveBeenCalled()
      expect(handleSuccess).toHaveBeenCalled()
    })

    it('should close drawer on cancel', () => {
      const handleClose = vi.fn()

      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={handleClose}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(handleClose).toHaveBeenCalled()
    })
  })

  describe('disabled states', () => {
    it('should show pending warning when action in progress', () => {
      vi.mocked(useWaiveFee).mockReturnValue({
        waiveFee: vi.fn(),
        waiveFeeAsync: vi.fn(),
        isPending: false,
        isSuccess: false,
        isError: false,
        error: null,
        isReadOnlyMode: false,
        hasPendingWaive: true,
        isVersionConflict: false,
      })

      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByText(/Action in progress/)).toBeInTheDocument()
    })

    it('should show read-only warning in read-only mode', () => {
      vi.mocked(useWaiveFee).mockReturnValue({
        waiveFee: vi.fn(),
        waiveFeeAsync: vi.fn(),
        isPending: false,
        isSuccess: false,
        isError: false,
        error: null,
        isReadOnlyMode: true,
        hasPendingWaive: false,
        isVersionConflict: false,
      })

      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByText(/read-only mode/)).toBeInTheDocument()
    })

    it('should disable form when pending', () => {
      vi.mocked(useWaiveFee).mockReturnValue({
        waiveFee: vi.fn(),
        waiveFeeAsync: vi.fn(),
        isPending: true,
        isSuccess: false,
        isError: false,
        error: null,
        isReadOnlyMode: false,
        hasPendingWaive: false,
        isVersionConflict: false,
      })

      render(
        <BulkWaiveFeeDrawer
          isOpen={true}
          onClose={vi.fn()}
          loanAccountId="LA-001"
          selectedFees={mockSelectedFees}
        />,
        { wrapper: createWrapper() }
      )

      expect(screen.getByLabelText(/Reason/)).toBeDisabled()
      expect(screen.getByRole('button', { name: /Waiving/ })).toBeDisabled()
    })
  })
})
