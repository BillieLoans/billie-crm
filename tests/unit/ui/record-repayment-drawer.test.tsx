/**
 * Unit tests for RecordRepaymentDrawer component
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { RecordRepaymentDrawer } from '@/components/ServicingView/RecordRepaymentDrawer'

// Mock the useRecordRepayment hook
vi.mock('@/hooks/mutations/useRecordRepayment', () => ({
  useRecordRepayment: () => ({
    recordRepayment: vi.fn(),
    recordRepaymentAsync: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    isReadOnlyMode: false,
  }),
}))

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('RecordRepaymentDrawer', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    loanAccountId: 'LA-12345',
    totalOutstanding: 500.0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('rendering', () => {
    it('should render when open', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByText('Record Repayment')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      render(<RecordRepaymentDrawer {...defaultProps} isOpen={false} />)
      expect(screen.queryByText('Record Repayment')).not.toBeInTheDocument()
    })

    it('should display outstanding balance', () => {
      render(<RecordRepaymentDrawer {...defaultProps} totalOutstanding={750.5} />)
      expect(screen.getByText('$750.50')).toBeInTheDocument()
    })

    it('should show balance label', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByText('Outstanding Balance')).toBeInTheDocument()
    })
  })

  describe('form fields', () => {
    it('should render amount input', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByLabelText(/payment amount/i)).toBeInTheDocument()
    })

    it('should render payment reference input', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByLabelText(/payment reference/i)).toBeInTheDocument()
    })

    it('should render payment method dropdown', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByLabelText(/payment method/i)).toBeInTheDocument()
    })

    it('should render notes textarea', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByLabelText(/notes/i)).toBeInTheDocument()
    })

    it('should render submit button', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByRole('button', { name: /record payment/i })).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('should have payment method options', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      const select = screen.getByLabelText(/payment method/i) as HTMLSelectElement
      expect(select.options.length).toBe(5) // Bank Transfer, Direct Debit, Card, BPAY, Cash
    })
  })

  describe('interactions', () => {
    it('should call onClose when cancel is clicked', () => {
      const onClose = vi.fn()
      render(<RecordRepaymentDrawer {...defaultProps} onClose={onClose} />)

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('should allow entering amount', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      const input = screen.getByLabelText(/payment amount/i)

      fireEvent.change(input, { target: { value: '150.00' } })
      expect(input).toHaveValue(150)
    })

    it('should allow entering payment reference', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      const input = screen.getByLabelText(/payment reference/i)

      fireEvent.change(input, { target: { value: 'DD-20240301-001' } })
      expect(input).toHaveValue('DD-20240301-001')
    })

    it('should allow selecting payment method', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      const select = screen.getByLabelText(/payment method/i)

      fireEvent.change(select, { target: { value: 'bpay' } })
      expect(select).toHaveValue('bpay')
    })

    it('should allow entering notes', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      const textarea = screen.getByLabelText(/notes/i)

      fireEvent.change(textarea, { target: { value: 'Branch payment' } })
      expect(textarea).toHaveValue('Branch payment')
    })

    // The ledger caps operator notes at 1000 chars; without the attribute the
    // operator writes a long note and gets a validation 400 on submit.
    it('should cap notes at the length the ledger accepts', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByLabelText(/notes/i)).toHaveAttribute('maxLength', '1000')
    })

    it('should disable submit when required fields are empty', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      const submitBtn = screen.getByRole('button', { name: /record payment/i })
      expect(submitBtn).toBeDisabled()
    })
  })

  describe('overpayment detection', () => {
    it('should show overpayment confirmation when amount exceeds balance', async () => {
      render(<RecordRepaymentDrawer {...defaultProps} totalOutstanding={100} />)

      const amountInput = screen.getByLabelText(/payment amount/i)
      const referenceInput = screen.getByLabelText(/payment reference/i)

      // Enter overpayment
      fireEvent.change(amountInput, { target: { value: '150' } })
      fireEvent.change(referenceInput, { target: { value: 'REF-001' } })

      // Submit form
      const form = screen.getByRole('button', { name: /record payment/i }).closest('form')!
      fireEvent.submit(form)

      // Should show overpayment confirmation
      expect(await screen.findByText('Overpayment Detected')).toBeInTheDocument()
    })

    it('should have continue button in overpayment dialog', async () => {
      render(<RecordRepaymentDrawer {...defaultProps} totalOutstanding={100} />)

      const amountInput = screen.getByLabelText(/payment amount/i)
      const referenceInput = screen.getByLabelText(/payment reference/i)

      fireEvent.change(amountInput, { target: { value: '150' } })
      fireEvent.change(referenceInput, { target: { value: 'REF-001' } })

      const form = screen.getByRole('button', { name: /record payment/i }).closest('form')!
      fireEvent.submit(form)

      expect(await screen.findByRole('button', { name: /continue anyway/i })).toBeInTheDocument()
    })

    it('should have cancel button in overpayment dialog', async () => {
      render(<RecordRepaymentDrawer {...defaultProps} totalOutstanding={100} />)

      const amountInput = screen.getByLabelText(/payment amount/i)
      const referenceInput = screen.getByLabelText(/payment reference/i)

      fireEvent.change(amountInput, { target: { value: '150' } })
      fireEvent.change(referenceInput, { target: { value: 'REF-001' } })

      const form = screen.getByRole('button', { name: /record payment/i }).closest('form')!
      fireEvent.submit(form)

      // Find Cancel button within overpayment dialog (not the main cancel)
      const cancelButtons = await screen.findAllByRole('button', { name: /cancel/i })
      expect(cancelButtons.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('accessibility', () => {
    it('should have accessible form labels', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)

      expect(screen.getByLabelText(/payment amount/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/payment reference/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/payment method/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/notes/i)).toBeInTheDocument()
    })

    it('should have dialog role', () => {
      render(<RecordRepaymentDrawer {...defaultProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
