import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { ClearDifferentPersonModal } from '@/components/BlockClear/ClearDifferentPersonModal'
import { MIN_APPROVAL_COMMENT_LENGTH } from '@/lib/constants'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockClearAsync = vi.fn()

vi.mock('@/hooks/mutations/useClearDifferentPerson', () => ({
  useClearDifferentPerson: () => ({
    clearAsync: mockClearAsync,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}))

const mockUndoAsync = vi.fn()

vi.mock('@/hooks/mutations/useUndoDifferentPersonClear', () => ({
  useUndoDifferentPersonClear: () => ({
    undoAsync: mockUndoAsync,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}))

const VALID_JUSTIFICATION = 'x'.repeat(MIN_APPROVAL_COMMENT_LENGTH)

const defaultProps = {
  onClose: vi.fn(),
  onRequested: vi.fn(),
  conversationId: 'conv-stopped-1',
  matchedCustomerId: 'MATCHED-1',
  contactLabel: 'mobile',
}

describe('ClearDifferentPersonModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClearAsync.mockResolvedValue({ requestId: 'req-1', eventId: 'evt-1' })
    mockUndoAsync.mockResolvedValue({ requestId: 'req-undo-1', eventId: 'evt-2' })
  })

  afterEach(() => {
    cleanup()
  })

  it('says what will be cleared and that the earlier customer stays blocked', () => {
    render(<ClearDifferentPersonModal {...defaultProps} />)

    expect(screen.getByTestId('clear-different-person-modal')).toBeInTheDocument()
    expect(screen.getByText('Clear: different person')).toBeInTheDocument()
    expect(screen.getByTestId('different-person-notice')).toHaveTextContent(
      'shares the mobile with customer MATCHED-1',
    )
    const target = screen.getByTestId('match-to-clear')
    expect(target).toHaveTextContent('The mobile match with customer MATCHED-1')
    expect(target).toHaveTextContent('Customer MATCHED-1 stays blocked')
  })

  it('has no approval step', () => {
    render(<ClearDifferentPersonModal {...defaultProps} />)
    expect(screen.queryByTestId('approval-notice')).not.toBeInTheDocument()
    expect(screen.getByTestId('submit-button')).toHaveTextContent('Clear match')
  })

  it('requires a justification of the minimum length', () => {
    render(<ClearDifferentPersonModal {...defaultProps} />)
    const submit = screen.getByTestId('submit-button')
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: 'x'.repeat(MIN_APPROVAL_COMMENT_LENGTH - 1) },
    })
    expect(submit).toBeDisabled()

    // Spaces do not count towards the minimum.
    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: ' '.repeat(MIN_APPROVAL_COMMENT_LENGTH + 5) },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: VALID_JUSTIFICATION },
    })
    expect(submit).not.toBeDisabled()
  })

  it('sends the stopped conversation and the trimmed justification, then reports the request id', async () => {
    render(<ClearDifferentPersonModal {...defaultProps} />)
    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: `  ${VALID_JUSTIFICATION}  ` },
    })
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(defaultProps.onRequested).toHaveBeenCalledWith('req-1'))
    expect(mockClearAsync).toHaveBeenCalledWith({
      conversationId: 'conv-stopped-1',
      justification: VALID_JUSTIFICATION,
    })
    expect(mockUndoAsync).not.toHaveBeenCalled()
  })

  it('stays open when the request fails', async () => {
    mockClearAsync.mockRejectedValueOnce(new Error('The clear was not sent.'))
    render(<ClearDifferentPersonModal {...defaultProps} />)
    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: VALID_JUSTIFICATION },
    })
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(mockClearAsync).toHaveBeenCalled())
    expect(defaultProps.onRequested).not.toHaveBeenCalled()
    expect(defaultProps.onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('clear-different-person-modal')).toBeInTheDocument()
  })

  it('closes on Cancel without sending', () => {
    render(<ClearDifferentPersonModal {...defaultProps} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(defaultProps.onClose).toHaveBeenCalled()
    expect(mockClearAsync).not.toHaveBeenCalled()
  })
})

describe('ClearDifferentPersonModal in undo mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClearAsync.mockResolvedValue({ requestId: 'req-1', eventId: 'evt-1' })
    mockUndoAsync.mockResolvedValue({ requestId: 'req-undo-1', eventId: 'evt-2' })
  })

  afterEach(() => {
    cleanup()
  })

  it('says the clear will be undone and the contact will stop applications again', () => {
    render(<ClearDifferentPersonModal {...defaultProps} mode="undo" />)

    expect(screen.getByTestId('undo-different-person-clear-modal')).toBeInTheDocument()
    expect(screen.getByText('Undo: same person after all')).toBeInTheDocument()
    expect(screen.getByTestId('different-person-notice')).toHaveTextContent(
      'the applicant turned out to be customer MATCHED-1 after all',
    )
    expect(screen.getByText('This will undo')).toBeInTheDocument()
    const target = screen.getByTestId('match-to-clear')
    expect(target).toHaveTextContent('The clear of the mobile match with customer MATCHED-1')
    expect(target).toHaveTextContent('The mobile will stop applications again')
    expect(target).toHaveTextContent('Customer MATCHED-1 stays blocked')
    expect(screen.getByTestId('submit-button')).toHaveTextContent('Undo clear')
  })

  it('requires the same justification minimum as the clear', () => {
    render(<ClearDifferentPersonModal {...defaultProps} mode="undo" />)
    const submit = screen.getByTestId('submit-button')
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: 'x'.repeat(MIN_APPROVAL_COMMENT_LENGTH - 1) },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: ' '.repeat(MIN_APPROVAL_COMMENT_LENGTH + 5) },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: VALID_JUSTIFICATION },
    })
    expect(submit).not.toBeDisabled()
  })

  it('sends the undo, never the clear, and reports the request id', async () => {
    render(<ClearDifferentPersonModal {...defaultProps} mode="undo" />)
    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: `  ${VALID_JUSTIFICATION}  ` },
    })
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(defaultProps.onRequested).toHaveBeenCalledWith('req-undo-1'))
    expect(mockUndoAsync).toHaveBeenCalledWith({
      conversationId: 'conv-stopped-1',
      justification: VALID_JUSTIFICATION,
    })
    expect(mockClearAsync).not.toHaveBeenCalled()
  })

  it('stays open when the request fails', async () => {
    mockUndoAsync.mockRejectedValueOnce(new Error('The undo was not sent.'))
    render(<ClearDifferentPersonModal {...defaultProps} mode="undo" />)
    fireEvent.change(screen.getByTestId('justification-input'), {
      target: { value: VALID_JUSTIFICATION },
    })
    fireEvent.click(screen.getByTestId('submit-button'))

    await waitFor(() => expect(mockUndoAsync).toHaveBeenCalled())
    expect(defaultProps.onRequested).not.toHaveBeenCalled()
    expect(defaultProps.onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('undo-different-person-clear-modal')).toBeInTheDocument()
  })
})
