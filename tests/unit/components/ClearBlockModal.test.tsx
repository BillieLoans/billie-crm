import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { ClearBlockModal } from '@/components/BlockClear/ClearBlockModal'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'

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

const VALID_JUSTIFICATION = 'x'.repeat(MIN_APPROVAL_COMMENT_LENGTH)

// The modal has no reason picker: it clears exactly the block's current reason.
const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  canonicalCustomerId: 'cust-abc-123',
  currentReason: 'SERVICEABILITY' as string | null,
}

describe('ClearBlockModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestAsync.mockResolvedValue({ requestId: 'req-1', status: 'accepted' })
  })

  afterEach(() => {
    cleanup()
  })

  describe('Rendering', () => {
    it('renders when isOpen=true with a clearable reason', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)
      expect(screen.getByTestId('clear-block-modal')).toBeInTheDocument()
      expect(screen.getByText('Clear Re-application Block')).toBeInTheDocument()
    })

    it('does not render when isOpen=false', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} isOpen={false} />)
      expect(screen.queryByTestId('clear-block-modal')).not.toBeInTheDocument()
    })

    it('does not render for a missing or non-clearable reason (defensive)', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} currentReason={null} />)
      expect(screen.queryByTestId('clear-block-modal')).not.toBeInTheDocument()
      cleanup()
      renderWithProviders(<ClearBlockModal {...defaultProps} currentReason="ACTIVE_LOAN" />)
      expect(screen.queryByTestId('clear-block-modal')).not.toBeInTheDocument()
    })

    it('states the fixed reason it will clear — no picker rendered', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)
      expect(screen.getByTestId('reason-to-clear')).toBeInTheDocument()
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })
  })

  describe('Approval tiering', () => {
    it('shows no approval notice and a "Clear block" submit for a single-operator reason', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} currentReason="SERVICEABILITY" />)
      expect(screen.queryByTestId('approval-notice')).not.toBeInTheDocument()
      expect(screen.getByTestId('submit-button').textContent).toBe('Clear block')
    })

    it('shows the approval notice and a "Request approval" submit for a default-class reason', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} currentReason="PRIOR_DEFAULT" />)
      expect(screen.getByTestId('approval-notice')).toBeInTheDocument()
      expect(screen.getByTestId('submit-button').textContent).toBe('Request approval')
    })
  })

  describe('Validation', () => {
    it('disables submit until the justification meets the minimum length', () => {
      renderWithProviders(<ClearBlockModal {...defaultProps} />)
      const submit = screen.getByTestId('submit-button')
      expect(submit).toBeDisabled()
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: 'short' },
      })
      expect(submit).toBeDisabled()
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: VALID_JUSTIFICATION },
      })
      expect(submit).not.toBeDisabled()
    })
  })

  describe('Submission', () => {
    it('submits exactly the current block reason', async () => {
      renderWithProviders(
        <ClearBlockModal
          {...defaultProps}
          currentReason="PRIOR_DEFAULT"
          conversationId="conv-1"
          customerName="Test Person"
        />,
      )
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: VALID_JUSTIFICATION },
      })
      fireEvent.click(screen.getByTestId('submit-button'))
      await waitFor(() => expect(mockRequestAsync).toHaveBeenCalledTimes(1))
      expect(mockRequestAsync).toHaveBeenCalledWith({
        canonicalCustomerId: 'cust-abc-123',
        reasons: ['PRIOR_DEFAULT'],
        justification: VALID_JUSTIFICATION,
        conversationId: 'conv-1',
        customerName: 'Test Person',
      })
    })

    it('closes on success', async () => {
      const onClose = vi.fn()
      renderWithProviders(<ClearBlockModal {...defaultProps} onClose={onClose} />)
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: VALID_JUSTIFICATION },
      })
      fireEvent.click(screen.getByTestId('submit-button'))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    it('stays open when the request fails', async () => {
      mockRequestAsync.mockRejectedValueOnce(new Error('boom'))
      const onClose = vi.fn()
      renderWithProviders(<ClearBlockModal {...defaultProps} onClose={onClose} />)
      fireEvent.change(screen.getByTestId('justification-input'), {
        target: { value: VALID_JUSTIFICATION },
      })
      fireEvent.click(screen.getByTestId('submit-button'))
      await waitFor(() => expect(mockRequestAsync).toHaveBeenCalled())
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('clear-block-modal')).toBeInTheDocument()
    })
  })

  describe('Dismissal', () => {
    it('calls onClose when the cancel button is clicked', () => {
      const onClose = vi.fn()
      renderWithProviders(<ClearBlockModal {...defaultProps} onClose={onClose} />)
      fireEvent.click(screen.getByText('Cancel'))
      expect(onClose).toHaveBeenCalled()
    })
  })
})
