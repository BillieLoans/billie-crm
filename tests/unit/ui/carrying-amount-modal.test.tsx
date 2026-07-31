import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CarryingAmountModal } from '@/components/ServicingView/AccountPanel/CarryingAmountModal'

// Mock the useCarryingAmountBreakdown hook
vi.mock('@/hooks/queries', () => ({
  useCarryingAmountBreakdown: vi.fn(),
}))

import { useCarryingAmountBreakdown } from '@/hooks/queries'

const mockUseCarryingAmountBreakdown = useCarryingAmountBreakdown as ReturnType<typeof vi.fn>

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

describe('CarryingAmountModal', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  const mockBreakdown = {
    accountId: 'LOAN-123',
    principalBalance: '5000.00',
    accruedYield: '250.00',
    carryingAmount: '5250.00',
    feeBalance: '100.00',
    disbursedPrincipal: '6000.00',
    establishmentFee: '300.00',
    totalPaid: '1050.00',
    lastAccrualDate: '2026-01-17',
    daysAccrued: 45,
    termDays: 90,
    dailyAccrualRate: '5.56',
    calculationTimestamp: '2026-01-18T10:00:00Z',
  }

  describe('Modal visibility', () => {
    test('renders nothing when isOpen is false', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: null,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      const { container } = renderWithProviders(
        <CarryingAmountModal accountId="LOAN-123" isOpen={false} onClose={vi.fn()} />,
      )

      expect(container.firstChild).toBeNull()
    })

    test('renders modal when isOpen is true', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByTestId('carrying-amount-modal')).toBeInTheDocument()
    })
  })

  describe('Loading state', () => {
    test('shows loading indicator when fetching', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: null,
        isLoading: true,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText('Loading breakdown...')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    test('shows error message with retry button', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: null,
        isLoading: false,
        isError: true,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText('Failed to load breakdown')).toBeInTheDocument()
      expect(screen.getByText('Retry')).toBeInTheDocument()
    })

    test('retry button calls refetch', () => {
      const mockRefetch = vi.fn()
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: null,
        isLoading: false,
        isError: true,
        isFallback: false,
        refetch: mockRefetch,
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      fireEvent.click(screen.getByText('Retry'))
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  describe('Fallback state', () => {
    test('shows fallback message when service unavailable', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: null,
        isLoading: false,
        isError: false,
        isFallback: true,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText(/Ledger service unavailable/)).toBeInTheDocument()
    })
  })

  describe('Data display', () => {
    test('shows carrying amount in summary', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText('$5,250.00')).toBeInTheDocument()
    })

    test('shows balance components', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText('Principal Balance')).toBeInTheDocument()
      expect(screen.getByText('$5,000.00')).toBeInTheDocument()
      expect(screen.getByText('Accrued Yield')).toBeInTheDocument()
      expect(screen.getByText('$250.00')).toBeInTheDocument()
    })

    test('shows loan details', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText('Disbursed Principal')).toBeInTheDocument()
      expect(screen.getByText('$6,000.00')).toBeInTheDocument()
      expect(screen.getByText('Establishment Fee')).toBeInTheDocument()
      expect(screen.getByText('$300.00')).toBeInTheDocument()
    })

    test('shows accrual details', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText('Days Accrued')).toBeInTheDocument()
      expect(screen.getByText('45 of 90')).toBeInTheDocument()
      expect(screen.getByText('Daily Accrual Rate')).toBeInTheDocument()
      expect(screen.getByText('50% accrued')).toBeInTheDocument()
    })

    test('shows formula', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      // Formula should show the calculation expression
      expect(screen.getByRole('code')).toBeInTheDocument()
      // The formula contains the calculation: Principal + Accrued
      const codeElement = screen.getByRole('code')
      expect(codeElement.textContent).toContain('$5,000.00')
      expect(codeElement.textContent).toContain('$250.00')
    })
  })

  describe('Modal interactions', () => {
    test('calls onClose when close button clicked', () => {
      const mockOnClose = vi.fn()
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(
        <CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={mockOnClose} />,
      )

      fireEvent.click(screen.getByLabelText('Close'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    test('calls onClose when clicking overlay', () => {
      const mockOnClose = vi.fn()
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(
        <CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={mockOnClose} />,
      )

      // Click the backdrop. The dialog role sits on the panel, so the backdrop is
      // its parent — clicking the panel itself must NOT dismiss.
      fireEvent.click(screen.getByRole('dialog').parentElement!)
      expect(mockOnClose).toHaveBeenCalled()
    })

    test('calls onClose when Close button in footer clicked', () => {
      const mockOnClose = vi.fn()
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(
        <CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={mockOnClose} />,
      )

      fireEvent.click(screen.getByText('Close'))
      expect(mockOnClose).toHaveBeenCalled()
    })

    test('calls onClose when Escape key pressed', () => {
      const mockOnClose = vi.fn()
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(
        <CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={mockOnClose} />,
      )

      const dialog = screen.getByRole('dialog')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('Copy functionality', () => {
    test('shows copy button when data is loaded', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByText('Copy to Clipboard')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    test('has dialog role', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    test('has aria-modal attribute', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    test('has aria-labelledby for title', () => {
      mockUseCarryingAmountBreakdown.mockReturnValue({
        breakdown: mockBreakdown,
        isLoading: false,
        isError: false,
        isFallback: false,
        refetch: vi.fn(),
      })

      renderWithProviders(<CarryingAmountModal accountId="LOAN-123" isOpen={true} onClose={vi.fn()} />)

      // The id is generated by the Modal primitive; assert the resulting name.
      expect(screen.getByRole('dialog')).toHaveAccessibleName('Carrying Amount Breakdown')
    })
  })
})
