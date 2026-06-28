import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { ClearBlockModal } from '@/components/BlockClear/ClearBlockModal'
import { CLEARABLE_REASONS, REASONS_REQUIRING_APPROVAL } from '@/lib/events/config'

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock useRequestBlockClear
const mockRequestAsync = vi.fn()

vi.mock('@/hooks/mutations/useRequestBlockClear', () => ({
  useRequestBlockClear: () => ({
    requestAsync: mockRequestAsync,
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

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  canonicalCustomerId: 'cust-abc-123',
  currentReason: null as string | null,
}

describe('ClearBlockModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Rendering', () => {
    it('renders when isOpen=true', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)
      expect(screen.getByTestId('clear-block-modal')).toBeInTheDocument()
      expect(screen.getByText('Clear Re-application Block')).toBeInTheDocument()
    })

    it('does not render when isOpen=false', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} isOpen={false} />)
      expect(screen.queryByTestId('clear-block-modal')).not.toBeInTheDocument()
    })

    it('renders all clearable reasons as checkboxes', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)
      for (const reason of CLEARABLE_REASONS) {
        expect(screen.getByTestId(`reason-checkbox-${reason}`)).toBeInTheDocument()
      }
    })
  })

  describe('Submit guard', () => {
    it('submit is disabled with no reasons selected and no justification', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)
      expect(screen.getByTestId('submit-button')).toBeDisabled()
    })

    it('submit is disabled with a reason but short justification (< 10 chars)', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId(`reason-checkbox-${CLEARABLE_REASONS[0]}`))
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: 'Short' },
      })

      expect(screen.getByTestId('submit-button')).toBeDisabled()
    })

    it('submit is disabled with valid justification but no reason selected', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)

      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: 'This is a valid justification text' },
      })

      expect(screen.getByTestId('submit-button')).toBeDisabled()
    })

    it('submit is enabled with a reason and justification >= 10 chars', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId(`reason-checkbox-${CLEARABLE_REASONS[0]}`))
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: 'This is a valid justification' },
      })

      expect(screen.getByTestId('submit-button')).not.toBeDisabled()
    })
  })

  describe('Submission', () => {
    it('calls requestAsync with canonicalCustomerId, reasons, and justification on submit', async () => {
      mockRequestAsync.mockResolvedValueOnce({ status: 'accepted' })
      const onClose = vi.fn()

      renderWithProviders(
        <ClearBlockModal
          {...defaultProps}
          onClose={onClose}
          canonicalCustomerId="cust-test-456"
          conversationId="conv-xyz"
          customerName="Jane Doe"
        />,
      )

      fireEvent.click(screen.getByTestId(`reason-checkbox-${CLEARABLE_REASONS[0]}`))
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: 'Customer situation has improved sufficiently' },
      })
      fireEvent.submit(screen.getByTestId('submit-button').closest('form')!)

      await waitFor(() => {
        expect(mockRequestAsync).toHaveBeenCalledWith({
          canonicalCustomerId: 'cust-test-456',
          reasons: [CLEARABLE_REASONS[0]],
          justification: 'Customer situation has improved sufficiently',
          conversationId: 'conv-xyz',
          customerName: 'Jane Doe',
        })
      })
    })

    it('calls onClose after successful submission', async () => {
      mockRequestAsync.mockResolvedValueOnce({ status: 'accepted' })
      const onClose = vi.fn()

      renderWithProviders(
        <ClearBlockModal
          {...defaultProps}
          onClose={onClose}
          canonicalCustomerId="cust-close-test"
        />,
      )

      fireEvent.click(screen.getByTestId(`reason-checkbox-${CLEARABLE_REASONS[0]}`))
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: 'Sufficient justification text here' },
      })
      fireEvent.submit(screen.getByTestId('submit-button').closest('form')!)

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('Approval notice', () => {
    it('does not show approval notice initially', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)
      expect(screen.queryByTestId('approval-notice')).not.toBeInTheDocument()
    })

    it('shows approval notice when a REASONS_REQUIRING_APPROVAL reason is selected', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId(`reason-checkbox-${REASONS_REQUIRING_APPROVAL[0]}`))

      expect(screen.getByTestId('approval-notice')).toBeInTheDocument()
    })

    it('hides approval notice when approval-required reason is deselected', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)

      // Select then deselect
      fireEvent.click(screen.getByTestId(`reason-checkbox-${REASONS_REQUIRING_APPROVAL[0]}`))
      expect(screen.getByTestId('approval-notice')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId(`reason-checkbox-${REASONS_REQUIRING_APPROVAL[0]}`))
      expect(screen.queryByTestId('approval-notice')).not.toBeInTheDocument()
    })
  })

  describe('Pre-selection', () => {
    it('pre-selects current reason when it is clearable', () => {
      const clearableReason = 'ID_VERIFICATION'
      renderWithProviders(<ClearBlockModal {...defaultProps} currentReason={clearableReason} />)

      expect(screen.getByTestId(`reason-checkbox-${clearableReason}`)).toBeChecked()
    })

    it('does not pre-select when current reason is not clearable', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} currentReason="ACTIVE_LOAN" />)

      for (const reason of CLEARABLE_REASONS) {
        expect(screen.getByTestId(`reason-checkbox-${reason}`)).not.toBeChecked()
      }
    })

    it('does not pre-select when currentReason is null', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} currentReason={null} />)

      for (const reason of CLEARABLE_REASONS) {
        expect(screen.getByTestId(`reason-checkbox-${reason}`)).not.toBeChecked()
      }
    })
  })
})
