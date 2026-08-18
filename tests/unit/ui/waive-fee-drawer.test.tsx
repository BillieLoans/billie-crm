/**
 * Unit tests for WaiveFeeDrawer component
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { WaiveFeeDrawer } from '@/components/ServicingView/WaiveFeeDrawer'

// Mock the useWaiveFee hook. Mutable state (via vi.hoisted) so individual
// tests can flip flags like isReadOnlyMode without vi.doMock — a stale doMock
// registration here previously leaked into later test files in the shared fork.
const mockWaiveFeeState = vi.hoisted(() => ({
  waiveFee: vi.fn(),
  waiveFeeAsync: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  isReadOnlyMode: false,
  hasPendingWaive: false,
}))

vi.mock('@/hooks/mutations/useWaiveFee', () => ({
  useWaiveFee: () => ({ ...mockWaiveFeeState }),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('WaiveFeeDrawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    loanAccountId: 'LA-12345',
    currentFeeBalance: 50.0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockWaiveFeeState.isReadOnlyMode = false
  })

  afterEach(() => {
    cleanup()
  })

  describe('rendering', () => {
    it('should render when open', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      expect(screen.getByText('Waive Fee')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      render(<WaiveFeeDrawer {...defaultProps} isOpen={false} />)
      expect(screen.queryByText('Waive Fee')).not.toBeInTheDocument()
    })

    it('should display current fee balance', () => {
      render(<WaiveFeeDrawer {...defaultProps} currentFeeBalance={75.5} />)
      expect(screen.getByText('$75.50')).toBeInTheDocument()
    })

    it('should show balance label', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      expect(screen.getByText('Current Fee Balance')).toBeInTheDocument()
    })
  })

  describe('form fields', () => {
    it('should render amount input', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      expect(screen.getByLabelText(/waiver amount/i)).toBeInTheDocument()
    })

    it('should render reason textarea', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      expect(screen.getByLabelText(/reason/i)).toBeInTheDocument()
    })

    it('should render confirm button', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      expect(screen.getByRole('button', { name: /confirm waive/i })).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('should have required indicators', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      // Check for asterisks indicating required fields
      const labels = screen.getAllByText('*')
      expect(labels.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('interactions', () => {
    it('should call onClose when cancel is clicked', () => {
      const onClose = vi.fn()
      render(<WaiveFeeDrawer {...defaultProps} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should allow entering amount', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      const input = screen.getByLabelText(/waiver amount/i)

      fireEvent.change(input, { target: { value: '25.50' } })
      expect(input).toHaveValue(25.5)
    })

    it('should allow entering reason', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      const textarea = screen.getByLabelText(/reason/i)

      fireEvent.change(textarea, { target: { value: 'Customer goodwill' } })
      expect(textarea).toHaveValue('Customer goodwill')
    })

    it('should disable submit when form is empty', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      const submitBtn = screen.getByRole('button', { name: /confirm waive/i })
      expect(submitBtn).toBeDisabled()
    })
  })

  describe('validation', () => {
    it('should show error for invalid amount', async () => {
      render(<WaiveFeeDrawer {...defaultProps} />)

      const amountInput = screen.getByLabelText(/waiver amount/i)
      const reasonInput = screen.getByLabelText(/reason/i)
      const form = screen.getByRole('button', { name: /confirm waive/i }).closest('form')!

      fireEvent.change(amountInput, { target: { value: '-5' } })
      fireEvent.change(reasonInput, { target: { value: 'Test reason' } })
      fireEvent.submit(form)

      expect(await screen.findByRole('alert')).toBeInTheDocument()
    })

    it('should submit an amount above the current fee balance (retroactive waiver)', () => {
      // The ledger now accepts waivers above the fee balance — the paid portion
      // is reallocated against principal — so the client no longer caps the amount.
      const onClose = vi.fn()
      render(<WaiveFeeDrawer {...defaultProps} onClose={onClose} currentFeeBalance={0} />)

      const amountInput = screen.getByLabelText(/waiver amount/i)
      const reasonInput = screen.getByLabelText(/reason/i)
      const form = screen.getByRole('button', { name: /confirm waive/i }).closest('form')!

      fireEvent.change(amountInput, { target: { value: '7.65' } })
      fireEvent.change(reasonInput, { target: { value: 'Waive fee settled by repayment' } })
      fireEvent.submit(form)

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mockWaiveFeeState.waiveFee).toHaveBeenCalledWith(
        expect.objectContaining({ waiverAmount: 7.65 }),
      )
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should not cap the amount input at the current fee balance', () => {
      render(<WaiveFeeDrawer {...defaultProps} currentFeeBalance={99.99} />)
      const input = screen.getByLabelText(/waiver amount/i)
      expect(input).not.toHaveAttribute('max')
    })

    it('should have min constraint on amount input', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      const input = screen.getByLabelText(/waiver amount/i)
      expect(input).toHaveAttribute('min', '0.01')
    })
  })

  describe('read-only mode', () => {
    it('should show the read-only warning and disable submission', () => {
      mockWaiveFeeState.isReadOnlyMode = true
      render(<WaiveFeeDrawer {...defaultProps} />)

      expect(screen.getByRole('alert')).toHaveTextContent(/read-only mode/i)
      expect(screen.getByLabelText(/waiver amount/i)).toBeDisabled()
      expect(screen.getByRole('button', { name: /confirm waive/i })).toBeDisabled()
    })
  })

  describe('accessibility', () => {
    it('should have accessible form labels', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)

      expect(screen.getByLabelText(/waiver amount/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/reason/i)).toBeInTheDocument()
    })

    it('should have form role', () => {
      render(<WaiveFeeDrawer {...defaultProps} />)
      // The ContextDrawer wraps the form
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
