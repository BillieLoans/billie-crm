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

// The request id the stubbed modal reports for a clear (ids are unique per
// request in the real route).
const { clearRequest } = vi.hoisted(() => ({ clearRequest: { id: 'req-new' } }))

// Stub the modal: a button that reports a sent request, and its props on show.
vi.mock('@/components/BlockClear/ClearDifferentPersonModal', () => ({
  ClearDifferentPersonModal: (props: {
    mode?: 'clear' | 'undo'
    onRequested: (id: string) => void
    conversationId: string
    matchedCustomerId: string
    contactLabel: string
  }) => (
    <div data-testid="different-person-modal-stub">
      <span data-testid="modal-props">
        {props.conversationId}|{props.matchedCustomerId}|{props.contactLabel}
      </span>
      <span data-testid="modal-mode">{props.mode}</span>
      <button
        type="button"
        onClick={() => props.onRequested(props.mode === 'undo' ? 'req-undo-new' : clearRequest.id)}
      >
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
  clearRequest.id = 'req-new'
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
      expect(screen.getByTestId('modal-mode')).toHaveTextContent('clear')
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

  describe('undo: same person after all', () => {
    const clearedBlock = (overrides: Record<string, unknown> = {}) =>
      contactMatchBlock({
        clearStatus: 'cleared',
        clearedAt: '2026-11-11T02:00:00.000Z',
        clearedBy: '7',
        clearedByName: 'Sam Support',
        clearJustification: 'Recycled number, different person',
        clearRequestId: 'req-clear-1',
        ...overrides,
      })

    /** The record after billieChat applied an undo of that clear. */
    const undoneBlock = (overrides: Record<string, unknown> = {}) =>
      contactMatchBlock({
        clearStatus: null,
        clearRequestId: 'req-clear-1',
        clearRevokeStatus: 'revoked',
        clearRevokeRequestId: 'req-undo-1',
        clearRevokedAt: '2026-11-12T03:00:00.000Z',
        clearRevokedBy: '9',
        clearRevokedByName: 'Una Supervisor',
        clearRevokeJustification: 'Matching licence on the new application',
        revokedClearAt: '2026-11-11T02:00:00.000Z',
        revokedClearBy: '7',
        revokedClearByName: 'Sam Support',
        revokedClearJustification: 'Recycled number, different person',
        ...overrides,
      })

    it('is offered only while the clear is in effect', () => {
      const { rerender } = render(
        <ClearDifferentPersonButton block={clearedBlock()} conversationId="conv-1" />,
      )
      const btn = screen.getByTestId('undo-different-person-clear-btn')
      expect(btn).toHaveTextContent('Undo: same person after all')
      expect(btn).not.toBeDisabled()
      expect(screen.queryByTestId('clear-different-person-btn')).not.toBeInTheDocument()

      for (const clearStatus of [null, 'pending', 'rejected']) {
        rerender(
          <ClearDifferentPersonButton
            block={contactMatchBlock({ clearStatus })}
            conversationId="conv-1"
          />,
        )
        expect(screen.queryByTestId('undo-different-person-clear-btn')).not.toBeInTheDocument()
        expect(screen.getByTestId('clear-different-person-btn')).toBeInTheDocument()
      }
    })

    it('is not offered on an ordinary cleared block', () => {
      const { container } = render(
        <ClearDifferentPersonButton
          block={clearedBlock({ recognition: null })}
          conversationId="conv-1"
        />,
      )
      expect(container).toBeEmptyDOMElement()
    })

    it('is hidden from a user who may not clear, who still sees the clear', () => {
      vi.mocked(canService).mockReturnValue(false)
      render(<ClearDifferentPersonButton block={clearedBlock()} conversationId="conv-1" />)
      expect(screen.queryByTestId('undo-different-person-clear-btn')).not.toBeInTheDocument()
      expect(screen.getByTestId('different-person-cleared')).toBeInTheDocument()
    })

    it('is disabled when the stop names no matched customer', () => {
      render(
        <ClearDifferentPersonButton
          block={clearedBlock({ canonicalCustomerId: null })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('undo-different-person-clear-btn-disabled')).toBeDisabled()
    })

    it('opens the modal in undo mode for the stopped conversation', () => {
      render(<ClearDifferentPersonButton block={clearedBlock()} conversationId="conv-1" />)
      fireEvent.click(screen.getByTestId('undo-different-person-clear-btn'))

      expect(screen.getByTestId('modal-mode')).toHaveTextContent('undo')
      expect(screen.getByTestId('modal-props')).toHaveTextContent('conv-1|MATCHED-1|mobile')
    })

    it('shows "undo requested" and disables the action once sent; the clear still shows', () => {
      render(<ClearDifferentPersonButton block={clearedBlock()} conversationId="conv-1" />)
      fireEvent.click(screen.getByTestId('undo-different-person-clear-btn'))
      fireEvent.click(screen.getByText('send'))

      expect(screen.queryByTestId('different-person-modal-stub')).not.toBeInTheDocument()
      expect(screen.getByTestId('different-person-undo-pending')).toHaveTextContent(
        'Undo requested — waiting for confirmation…',
      )
      expect(screen.getByTestId('undo-different-person-clear-btn')).toBeDisabled()
      expect(screen.getByTestId('different-person-cleared')).toBeInTheDocument()
    })

    it('stops waiting after two minutes and lets the operator try again', () => {
      vi.useFakeTimers()
      render(<ClearDifferentPersonButton block={clearedBlock()} conversationId="conv-1" />)
      fireEvent.click(screen.getByTestId('undo-different-person-clear-btn'))
      fireEvent.click(screen.getByText('send'))

      act(() => {
        vi.advanceTimersByTime(120_000)
      })

      expect(screen.getByTestId('different-person-undo-pending')).toHaveTextContent('no answer yet')
      expect(screen.getByTestId('undo-different-person-clear-btn')).not.toBeDisabled()
    })

    it("shows a pending undo from the record without locking someone else's action", () => {
      render(
        <ClearDifferentPersonButton
          block={clearedBlock({ clearRevokeStatus: 'pending', clearRevokeRequestId: 'req-other' })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-undo-pending')).toHaveTextContent(
        'Undo requested — waiting for confirmation…',
      )
      expect(screen.getByTestId('undo-different-person-clear-btn')).not.toBeDisabled()
    })

    it('after the undo: an uncleared stop again, the clear offered, and the record of both', () => {
      const { rerender } = render(
        <ClearDifferentPersonButton block={clearedBlock()} conversationId="conv-1" />,
      )
      fireEvent.click(screen.getByTestId('undo-different-person-clear-btn'))
      fireEvent.click(screen.getByText('send'))

      rerender(
        <ClearDifferentPersonButton
          block={undoneBlock({ clearRevokeRequestId: 'req-undo-new' })}
          conversationId="conv-1"
        />,
      )

      // No longer cleared: the clear is offered again, the undo is not.
      expect(screen.queryByTestId('different-person-cleared')).not.toBeInTheDocument()
      expect(screen.queryByTestId('undo-different-person-clear-btn')).not.toBeInTheDocument()
      expect(screen.queryByTestId('different-person-undo-pending')).not.toBeInTheDocument()
      const clearBtn = screen.getByTestId('clear-different-person-btn')
      expect(clearBtn).not.toBeDisabled()
      expect(screen.queryByTestId('different-person-pending')).not.toBeInTheDocument()

      // Who undid it, when and why.
      const record = screen.getByTestId('different-person-clear-undone')
      expect(record).toHaveTextContent('Clear undone: same person after all by Una Supervisor on')
      expect(record).toHaveTextContent('this contact match stops applications again')
      expect(record).toHaveTextContent('Matching licence on the new application')
      // And the clear that was undone.
      const original = screen.getByTestId('different-person-undone-clear')
      expect(original).toHaveTextContent('The clear that was undone was made by Sam Support on')
      expect(original).toHaveTextContent('Recycled number, different person')
    })

    it('a clear sent and then undone in the same view does not read as still requested', () => {
      const { rerender } = render(
        <ClearDifferentPersonButton block={contactMatchBlock()} conversationId="conv-1" />,
      )
      fireEvent.click(screen.getByTestId('clear-different-person-btn'))
      fireEvent.click(screen.getByText('send'))
      rerender(
        <ClearDifferentPersonButton
          block={clearedBlock({ clearRequestId: 'req-new' })}
          conversationId="conv-1"
        />,
      )
      fireEvent.click(screen.getByTestId('undo-different-person-clear-btn'))
      fireEvent.click(screen.getByText('send'))

      // The undo keeps the removed clear's request id on the record.
      rerender(
        <ClearDifferentPersonButton
          block={undoneBlock({ clearRequestId: 'req-new', clearRevokeRequestId: 'req-undo-new' })}
          conversationId="conv-1"
        />,
      )
      expect(screen.queryByTestId('different-person-pending')).not.toBeInTheDocument()
      expect(screen.getByTestId('clear-different-person-btn')).not.toBeDisabled()

      // Cleared a second time: the undo is offered again, not stuck waiting.
      clearRequest.id = 'req-new-2'
      fireEvent.click(screen.getByTestId('clear-different-person-btn'))
      fireEvent.click(screen.getByText('send'))
      expect(screen.getByTestId('different-person-pending')).toBeInTheDocument()
      rerender(
        <ClearDifferentPersonButton
          block={undoneBlock({
            clearStatus: 'cleared',
            clearRequestId: 'req-new-2',
            clearedByName: 'Sam Support',
            clearRevokeRequestId: 'req-undo-new',
          })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('undo-different-person-clear-btn')).not.toBeDisabled()
      expect(screen.queryByTestId('different-person-undo-pending')).not.toBeInTheDocument()
      // The earlier undo stays on show as history.
      expect(screen.getByTestId('different-person-clear-undone')).toHaveTextContent(
        'An earlier clear was undone by Una Supervisor on',
      )
    })

    it('falls back to operator ids when names are not known', () => {
      render(
        <ClearDifferentPersonButton
          block={undoneBlock({ clearRevokedByName: null, revokedClearByName: null })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-clear-undone')).toHaveTextContent('by 9 on')
      expect(screen.getByTestId('different-person-undone-clear')).toHaveTextContent('made by 7 on')
    })

    it('shows the undo record without the undone clear when that was never recorded', () => {
      render(
        <ClearDifferentPersonButton
          block={undoneBlock({
            revokedClearAt: null,
            revokedClearBy: null,
            revokedClearByName: null,
            revokedClearJustification: null,
          })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-clear-undone')).toBeInTheDocument()
      expect(screen.queryByTestId('different-person-undone-clear')).not.toBeInTheDocument()
    })

    it('shows why billieChat refused the undo, leaves the clear, and allows another try', () => {
      render(
        <ClearDifferentPersonButton
          block={clearedBlock({
            clearRevokeStatus: 'rejected',
            clearRevokeRequestId: 'req-undo-old',
            clearRevokeRejection: 'NOT_CLEARED: no different-person clear is in effect',
          })}
          conversationId="conv-1"
        />,
      )
      const alert = screen.getByTestId('different-person-undo-rejected')
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveTextContent(
        'The undo was not applied: this contact match is not currently cleared',
      )
      expect(screen.getByTestId('different-person-cleared')).toBeInTheDocument()
      expect(screen.getByTestId('undo-different-person-clear-btn')).not.toBeDisabled()
    })

    it('shows a refused undo to a user who may not act on it', () => {
      vi.mocked(canService).mockReturnValue(false)
      render(
        <ClearDifferentPersonButton
          block={clearedBlock({ clearRevokeStatus: 'rejected', clearRevokeRejection: 'X: y' })}
          conversationId="conv-1"
        />,
      )
      expect(screen.queryByTestId('undo-different-person-clear-btn')).not.toBeInTheDocument()
      expect(screen.getByTestId('different-person-undo-rejected')).toHaveTextContent('X: y')
    })

    it('replaces an older refusal with "requested", then shows its own refusal', () => {
      const { rerender } = render(
        <ClearDifferentPersonButton
          block={clearedBlock({
            clearRevokeStatus: 'rejected',
            clearRevokeRequestId: 'req-undo-old',
            clearRevokeRejection: 'MISSING_FIELDS: x',
          })}
          conversationId="conv-1"
        />,
      )
      fireEvent.click(screen.getByTestId('undo-different-person-clear-btn'))
      fireEvent.click(screen.getByText('send'))

      expect(screen.queryByTestId('different-person-undo-rejected')).not.toBeInTheDocument()
      expect(screen.getByTestId('different-person-undo-pending')).toBeInTheDocument()

      rerender(
        <ClearDifferentPersonButton
          block={clearedBlock({
            clearRevokeStatus: 'rejected',
            clearRevokeRequestId: 'req-undo-new',
            clearRevokeRejection: 'SOMETHING_NEW: unexpected',
          })}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('different-person-undo-rejected')).toHaveTextContent(
        'The undo was not applied: SOMETHING_NEW: unexpected',
      )
      expect(screen.queryByTestId('different-person-undo-pending')).not.toBeInTheDocument()
      expect(screen.getByTestId('undo-different-person-clear-btn')).not.toBeDisabled()
    })
  })
})
