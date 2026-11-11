import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { ClearDifferentPersonButton } from '@/components/BlockClear/ClearDifferentPersonButton'
import { canService } from '@/lib/access'

// Mock useAuth — a canService-eligible user by default (same as ClearBlockButton.test)
vi.mock('@payloadcms/ui', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'ops-1', role: 'operations' },
  })),
}))

vi.mock('@/lib/access', () => ({
  canService: vi.fn(() => true),
}))

// Stub the modal: a button that reports a sent request, and its props on show.
vi.mock('@/components/BlockClear/ClearDifferentPersonModal', () => ({
  ClearDifferentPersonModal: (props: {
    onRequested: (id: string) => void
    conversationId: string
    matchedCustomerId: string
    contactLabel: string
  }) => (
    <div data-testid="different-person-modal-stub">
      <span data-testid="modal-props">
        {props.conversationId}|{props.matchedCustomerId}|{props.contactLabel}
      </span>
      <button type="button" onClick={() => props.onRequested('req-new')}>
        send
      </button>
    </div>
  ),
}))

const contactMatchBlock = (overrides: Record<string, unknown> = {}) => ({
  reason: 'ACTIVE_LOAN',
  canonicalCustomerId: 'MATCHED-1',
  recognition: { band: 'verified_contact', matched_contact_kinds: ['phone'] },
  clearStatus: null,
  ...overrides,
})

beforeEach(() => {
  vi.mocked(canService).mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ClearDifferentPersonButton', () => {
  describe('where it shows', () => {
    it('renders the action on a verified-contact stop', () => {
      render(<ClearDifferentPersonButton block={contactMatchBlock()} conversationId="conv-1" />)
      const btn = screen.getByTestId('clear-different-person-btn')
      expect(btn).toHaveTextContent('Clear: different person')
      expect(btn).not.toBeDisabled()
    })

    it.each([
      ['an ordinary block', { recognition: null }],
      ['a block with no band', { recognition: { band: null } }],
      ['a review halt', { recognition: { band: 'review' } }],
    ])('renders nothing for %s', (_name, overrides) => {
      const { container } = render(
        <ClearDifferentPersonButton block={contactMatchBlock(overrides)} conversationId="conv-1" />,
      )
      expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing without a block', () => {
      const { container } = render(<ClearDifferentPersonButton block={null} conversationId="conv-1" />)
      expect(container).toBeEmptyDOMElement()
    })

    it('hides the action from a user who may not clear, but still shows the record', () => {
      vi.mocked(canService).mockReturnValue(false)
      render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({ clearStatus: 'rejected', clearRejection: 'X: y' })}
          conversationId="conv-1"
        />,
      )
      expect(screen.queryByTestId('clear-different-person-btn')).not.toBeInTheDocument()
      expect(screen.getByTestId('different-person-rejected')).toBeInTheDocument()
    })

    it('disables the action when the stop names no matched customer', () => {
      render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({ canonicalCustomerId: null })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('clear-different-person-btn-disabled')).toBeDisabled()
    })
  })

  describe('the modal', () => {
    it('opens with the stopped conversation, the matched customer and the contact kind', () => {
      render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({
            recognition: { band: 'verified_contact', matched_contact_kinds: ['email', 'phone'] },
          })}
          conversationId="conv-1"
        />,
      )
      expect(screen.queryByTestId('different-person-modal-stub')).not.toBeInTheDocument()

      fireEvent.click(screen.getByTestId('clear-different-person-btn'))

      expect(screen.getByTestId('modal-props')).toHaveTextContent(
        'conv-1|MATCHED-1|email and mobile',
      )
    })
  })

  describe('the outcome', () => {
    it('shows "requested" and disables the action once a request is sent', () => {
      render(<ClearDifferentPersonButton block={contactMatchBlock()} conversationId="conv-1" />)
      fireEvent.click(screen.getByTestId('clear-different-person-btn'))
      fireEvent.click(screen.getByText('send'))

      expect(screen.queryByTestId('different-person-modal-stub')).not.toBeInTheDocument()
      expect(screen.getByTestId('different-person-pending')).toHaveTextContent(
        'Clear requested — waiting for confirmation…',
      )
      expect(screen.getByTestId('clear-different-person-btn')).toBeDisabled()
    })

    it('stops waiting after two minutes and lets the operator try again', () => {
      vi.useFakeTimers()
      render(<ClearDifferentPersonButton block={contactMatchBlock()} conversationId="conv-1" />)
      fireEvent.click(screen.getByTestId('clear-different-person-btn'))
      fireEvent.click(screen.getByText('send'))

      act(() => {
        vi.advanceTimersByTime(120_000)
      })

      expect(screen.getByTestId('different-person-pending')).toHaveTextContent('no answer yet')
      expect(screen.getByTestId('clear-different-person-btn')).not.toBeDisabled()
    })

    it('shows a pending request from the record, with who asked', () => {
      render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({
            clearStatus: 'pending',
            clearedBy: '7',
            clearedByName: 'Sam Support',
            clearRequestId: 'req-other',
          })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-pending')).toHaveTextContent(
        'Clear requested by Sam Support — waiting for confirmation…',
      )
      // Someone else's (or an earlier session's) request does not lock the action.
      expect(screen.getByTestId('clear-different-person-btn')).not.toBeDisabled()
    })

    it('shows who cleared it, when and why, and removes the action', () => {
      render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({
            clearStatus: 'cleared',
            clearedAt: '2026-11-11T02:00:00.000Z',
            clearedBy: '7',
            clearedByName: 'Sam Support',
            clearJustification: 'Recycled number, different person',
          })}
          conversationId="conv-1"
        />,
      )
      const record = screen.getByTestId('different-person-cleared')
      expect(record).toHaveTextContent('Cleared as a different person by Sam Support on')
      expect(record).toHaveTextContent('2026')
      expect(record).toHaveTextContent('Recycled number, different person')
      expect(screen.queryByTestId('clear-different-person-btn')).not.toBeInTheDocument()
    })

    it('falls back to the operator id when the name is not known', () => {
      render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({ clearStatus: 'cleared', clearedBy: '7' })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-cleared')).toHaveTextContent('by 7')
    })

    it('shows why billieChat refused, and keeps the action for another try', () => {
      render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({
            clearStatus: 'rejected',
            clearRequestId: 'req-old',
            clearRejection:
              'UNKNOWN_STOPPED_CONVERSATION: no verified-contact stop is recorded for that conversation against this customer',
          })}
          conversationId="conv-1"
        />,
      )
      const alert = screen.getByTestId('different-person-rejected')
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveTextContent(
        'The clear was not applied: no contact match is on record for this application against that customer',
      )
      expect(screen.getByTestId('clear-different-person-btn')).not.toBeDisabled()
    })

    it('replaces an older refusal with "requested" when a new request is sent, then shows its own refusal', () => {
      const { rerender } = render(
        <ClearDifferentPersonButton
          block={contactMatchBlock({
            clearStatus: 'rejected',
            clearRequestId: 'req-old',
            clearRejection: 'MISSING_FIELDS: x',
          })}
          conversationId="conv-1"
        />,
      )
      fireEvent.click(screen.getByTestId('clear-different-person-btn'))
      fireEvent.click(screen.getByText('send'))

      expect(screen.queryByTestId('different-person-rejected')).not.toBeInTheDocument()
      expect(screen.getByTestId('different-person-pending')).toBeInTheDocument()

      // The record now names the request this button sent as refused.
      rerender(
        <ClearDifferentPersonButton
          block={contactMatchBlock({
            clearStatus: 'rejected',
            clearRequestId: 'req-new',
            clearRejection: 'SOMETHING_NEW: unexpected',
          })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-rejected')).toHaveTextContent(
        'The clear was not applied: SOMETHING_NEW: unexpected',
      )
      expect(screen.queryByTestId('different-person-pending')).not.toBeInTheDocument()
      expect(screen.getByTestId('clear-different-person-btn')).not.toBeDisabled()
    })

    it('shows the clear once the record has it, after a request from this button', () => {
      const { rerender } = render(
        <ClearDifferentPersonButton block={contactMatchBlock()} conversationId="conv-1" />,
      )
      fireEvent.click(screen.getByTestId('clear-different-person-btn'))
      fireEvent.click(screen.getByText('send'))

      rerender(
        <ClearDifferentPersonButton
          block={contactMatchBlock({
            clearStatus: 'cleared',
            clearRequestId: 'req-new',
            clearedByName: 'Op One',
            clearJustification: 'Different person',
          })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-cleared')).toHaveTextContent('by Op One')
      expect(screen.queryByTestId('different-person-pending')).not.toBeInTheDocument()
    })
  })
})
