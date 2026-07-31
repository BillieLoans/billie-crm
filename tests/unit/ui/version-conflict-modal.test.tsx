import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { VersionConflictModal } from '@/components/VersionConflictModal'
import { ERROR_MESSAGES } from '@/lib/errors/messages'

describe('VersionConflictModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  describe('rendering', () => {
    it('should render when open', () => {
      render(<VersionConflictModal {...defaultProps} />)

      expect(screen.getByTestId('version-conflict-modal')).toBeInTheDocument()
      expect(screen.getByText('Data Changed')).toBeInTheDocument()
    })

    it('should not render when closed', () => {
      render(<VersionConflictModal {...defaultProps} isOpen={false} />)

      expect(screen.queryByTestId('version-conflict-modal')).not.toBeInTheDocument()
    })

    it('should display the version conflict error message', () => {
      render(<VersionConflictModal {...defaultProps} />)

      expect(screen.getByText(ERROR_MESSAGES.VERSION_CONFLICT)).toBeInTheDocument()
    })

    it('should display warning icon', () => {
      render(<VersionConflictModal {...defaultProps} />)

      expect(screen.getByText('⚠️')).toBeInTheDocument()
    })
  })

  describe('preserved changes', () => {
    it('should display preserved changes when provided', () => {
      const preservedChanges = {
        items: [
          { label: 'Amount', value: '$150.00' },
          { label: 'Reason', value: 'Customer goodwill' },
        ],
      }

      render(<VersionConflictModal {...defaultProps} preservedChanges={preservedChanges} />)

      expect(screen.getByText('Your Changes (for reference):')).toBeInTheDocument()
      expect(screen.getByText('Amount:')).toBeInTheDocument()
      expect(screen.getByText('$150.00')).toBeInTheDocument()
      expect(screen.getByText('Reason:')).toBeInTheDocument()
      expect(screen.getByText('Customer goodwill')).toBeInTheDocument()
    })

    it('should not display changes section when no changes provided', () => {
      render(<VersionConflictModal {...defaultProps} />)

      expect(screen.queryByText('Your Changes (for reference):')).not.toBeInTheDocument()
    })

    it('should not display changes section when items array is empty', () => {
      render(<VersionConflictModal {...defaultProps} preservedChanges={{ items: [] }} />)

      expect(screen.queryByText('Your Changes (for reference):')).not.toBeInTheDocument()
    })
  })

  describe('buttons', () => {
    it('should have Cancel and Refresh & Retry buttons', () => {
      render(<VersionConflictModal {...defaultProps} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByTestId('refresh-button')).toBeInTheDocument()
      expect(screen.getByText('🔄 Refresh & Retry')).toBeInTheDocument()
    })

    it('should call onClose when Cancel is clicked', () => {
      render(<VersionConflictModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should call onRefresh when Refresh & Retry is clicked', () => {
      render(<VersionConflictModal {...defaultProps} />)

      fireEvent.click(screen.getByTestId('refresh-button'))

      expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when X button is clicked', () => {
      render(<VersionConflictModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('button', { name: 'Close' }))

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('refreshing state', () => {
    it('should show "Refreshing..." text when isRefreshing is true', () => {
      render(<VersionConflictModal {...defaultProps} isRefreshing />)

      expect(screen.getByText('🔄 Refreshing...')).toBeInTheDocument()
    })

    it('should disable buttons when isRefreshing is true', () => {
      render(<VersionConflictModal {...defaultProps} isRefreshing />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      expect(screen.getByTestId('refresh-button')).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    })

    it('should not call onClose on overlay click when isRefreshing', () => {
      render(<VersionConflictModal {...defaultProps} isRefreshing />)

      // Click the backdrop, which is the dialog's parent element
      fireEvent.click(screen.getByTestId('version-conflict-modal').parentElement!)

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('keyboard interactions', () => {
    it('should close on Escape key press', async () => {
      render(<VersionConflictModal {...defaultProps} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should not close on Escape when isRefreshing', async () => {
      render(<VersionConflictModal {...defaultProps} isRefreshing />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('overlay interaction', () => {
    it('should close when clicking overlay', () => {
      render(<VersionConflictModal {...defaultProps} />)

      // Click the backdrop (not the modal content)
      fireEvent.click(screen.getByTestId('version-conflict-modal').parentElement!)

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    })

    it('should not close when clicking modal content', () => {
      render(<VersionConflictModal {...defaultProps} />)

      // Click inside the modal (the message text)
      fireEvent.click(screen.getByText(ERROR_MESSAGES.VERSION_CONFLICT))

      expect(defaultProps.onClose).not.toHaveBeenCalled()
    })
  })

  describe('accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<VersionConflictModal {...defaultProps} />)

      const modal = screen.getByTestId('version-conflict-modal')
      expect(modal).toHaveAttribute('role', 'dialog')
      expect(modal).toHaveAttribute('aria-modal', 'true')
      expect(modal).toHaveAccessibleName('Data Changed')
      // The backdrop must not carry the dialog role.
      expect(modal.parentElement).toHaveAttribute('role', 'presentation')
    })

    it('should have refresh button focusable when modal opens', () => {
      render(<VersionConflictModal {...defaultProps} />)

      const refreshButton = screen.getByTestId('refresh-button')
      expect(refreshButton).not.toBeDisabled()
      // The button should be focusable (no tabindex=-1)
      expect(refreshButton).not.toHaveAttribute('tabindex', '-1')
    })
  })
})
