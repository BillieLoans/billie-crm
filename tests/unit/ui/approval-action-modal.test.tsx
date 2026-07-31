import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ApprovalActionModal } from '@/components/ApprovalsView'

describe('ApprovalActionModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    actionType: 'approve' as const,
    requestNumber: 'WO-TEST-001',
    isPending: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('Rendering', () => {
    it('should render modal when isOpen is true', () => {
      render(<ApprovalActionModal {...defaultProps} />)
      expect(screen.getByTestId('approval-action-modal')).toBeInTheDocument()
    })

    it('should not render modal when isOpen is false', () => {
      render(<ApprovalActionModal {...defaultProps} isOpen={false} />)
      expect(screen.queryByTestId('approval-action-modal')).not.toBeInTheDocument()
    })

    it('should show approve title for approve action', () => {
      render(<ApprovalActionModal {...defaultProps} actionType="approve" />)
      expect(screen.getByText('Approve Write-Off')).toBeInTheDocument()
    })

    it('should show reject title for reject action', () => {
      render(<ApprovalActionModal {...defaultProps} actionType="reject" />)
      expect(screen.getByText('Reject Write-Off')).toBeInTheDocument()
    })

    it('should show request number', () => {
      render(<ApprovalActionModal {...defaultProps} />)
      expect(screen.getByText('WO-TEST-001')).toBeInTheDocument()
    })
  })

  describe('Comment Validation', () => {
    it('should disable confirm button when comment is too short', () => {
      render(<ApprovalActionModal {...defaultProps} />)
      
      const input = screen.getByTestId('approval-comment-input')
      fireEvent.change(input, { target: { value: 'Short' } })
      
      const confirmButton = screen.getByTestId('modal-confirm-button')
      expect(confirmButton).toBeDisabled()
    })

    it('should enable confirm button when comment is >= 10 characters', () => {
      render(<ApprovalActionModal {...defaultProps} />)
      
      const input = screen.getByTestId('approval-comment-input')
      fireEvent.change(input, { target: { value: 'This is a valid comment.' } })
      
      const confirmButton = screen.getByTestId('modal-confirm-button')
      expect(confirmButton).not.toBeDisabled()
    })

    it('should show character count', () => {
      render(<ApprovalActionModal {...defaultProps} />)
      
      const input = screen.getByTestId('approval-comment-input')
      fireEvent.change(input, { target: { value: 'Hello' } })
      
      expect(screen.getByText('5/10 characters minimum')).toBeInTheDocument()
    })

    it('should show checkmark when minimum reached', () => {
      render(<ApprovalActionModal {...defaultProps} />)
      
      const input = screen.getByTestId('approval-comment-input')
      fireEvent.change(input, { target: { value: 'This is valid' } })
      
      expect(screen.getByText(/13\/10 characters minimum/)).toBeInTheDocument()
      expect(screen.getByText(/✓/)).toBeInTheDocument()
    })
  })

  describe('Submission', () => {
    it('should call onConfirm with comment when form is submitted', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<ApprovalActionModal {...defaultProps} onConfirm={onConfirm} />)
      
      const input = screen.getByTestId('approval-comment-input')
      fireEvent.change(input, { target: { value: 'Valid approval comment here' } })
      
      const confirmButton = screen.getByTestId('modal-confirm-button')
      fireEvent.click(confirmButton)
      
      expect(onConfirm).toHaveBeenCalledWith('Valid approval comment here')
    })

    it('should show Processing... text when isPending', () => {
      render(<ApprovalActionModal {...defaultProps} isPending={true} />)
      
      const confirmButton = screen.getByTestId('modal-confirm-button')
      expect(confirmButton).toHaveTextContent('Processing...')
    })

    it('should disable buttons when isPending', () => {
      render(<ApprovalActionModal {...defaultProps} isPending={true} />)
      
      expect(screen.getByTestId('modal-confirm-button')).toBeDisabled()
      expect(screen.getByText('Cancel')).toBeDisabled()
    })
  })

  describe('Cancel', () => {
    it('should call onClose when Cancel is clicked', () => {
      const onClose = vi.fn()
      render(<ApprovalActionModal {...defaultProps} onClose={onClose} />)
      
      fireEvent.click(screen.getByText('Cancel'))
      
      expect(onClose).toHaveBeenCalled()
    })

    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(<ApprovalActionModal {...defaultProps} onClose={onClose} />)
      
      fireEvent.click(screen.getByLabelText('Close'))
      
      expect(onClose).toHaveBeenCalled()
    })

    it('should call onClose when Escape key is pressed', () => {
      const onClose = vi.fn()
      render(<ApprovalActionModal {...defaultProps} onClose={onClose} />)
      
      fireEvent.keyDown(screen.getByTestId('approval-action-modal'), { key: 'Escape' })
      
      expect(onClose).toHaveBeenCalled()
    })

    it('should not close on Escape when isPending', () => {
      const onClose = vi.fn()
      render(<ApprovalActionModal {...defaultProps} onClose={onClose} isPending={true} />)
      
      fireEvent.keyDown(screen.getByTestId('approval-action-modal'), { key: 'Escape' })
      
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('Action Type Variants', () => {
    it('should show Approve button text for approve action', () => {
      render(<ApprovalActionModal {...defaultProps} actionType="approve" />)
      expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('Approve')
    })

    it('should show Reject button text for reject action', () => {
      render(<ApprovalActionModal {...defaultProps} actionType="reject" />)
      expect(screen.getByTestId('modal-confirm-button')).toHaveTextContent('Reject')
    })
  })
})
