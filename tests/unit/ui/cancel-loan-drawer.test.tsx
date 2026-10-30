/**
 * CancelLoanDrawer (BTB-517): a supervisor cancels a loan before disbursement.
 *
 * Drives the real drawer, the real confirm Modal and the real "Set manual
 * block" modal; only `fetch` is stubbed. The request/response contract is the
 * one POST /api/ledger/cancel-account (C2) answers with.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  CancelLoanDrawer,
  type CancelLoanDrawerProps,
} from '@/components/ServicingView/CancelLoanDrawer'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// The signed-in CRM user: a frozen cancel belongs to the user who made it (R26).
const auth = vi.hoisted(() => ({
  user: { id: 'sup-1', role: 'supervisor' } as { id: string; role: string } | null,
}))
vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: auth.user }) }))

const fetchMock = vi.fn()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NOTE = 'Customer rang to withdraw before the money moved.'

const reply = (status: number, body: Record<string, unknown>) =>
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

const SUCCESS = {
  success: true,
  message: 'Account cancelled',
  eventId: 'evt-1',
  cancelledAt: '2026-10-30T04:45:00+00:00',
  previousStatus: 'PENDING_DISBURSEMENT',
  idempotentReplay: false,
  noteError: false,
}

const MANUAL_BLOCK = {
  reason: 'MANUAL_ADMIN',
  blockedUntil: null,
  manualBlockRequestId: 'req-1',
  manualSetRequestId: 'req-1',
  manualSetReasonCode: 'cancelled_pre_disbursement',
}

function renderDrawer(over: Partial<CancelLoanDrawerProps> = {}) {
  const props: CancelLoanDrawerProps = {
    isOpen: true,
    onClose: vi.fn(),
    onRefresh: vi.fn(),
    loanAccountId: 'LA-1',
    accountNumber: '1000001',
    customerId: 'CUS-1',
    customerName: 'Cass Customer',
    reapplicationBlock: null,
    ...over,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <CancelLoanDrawer {...props} />
    </QueryClientProvider>,
  )
  const rerender = (next: Partial<CancelLoanDrawerProps>) =>
    utils.rerender(
      <QueryClientProvider client={client}>
        <CancelLoanDrawer {...props} {...next} />
      </QueryClientProvider>,
    )
  return { props, rerender }
}

const submitButton = () => screen.getByRole('button', { name: 'Cancel loan' })
const chooseReason = (value: string) =>
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value } })
const writeNote = (value: string) =>
  fireEvent.change(screen.getByLabelText('Note'), { target: { value } })
const confirmNoBlock = (reason = 'Customer is a duplicate application of an open loan.') => {
  fireEvent.click(screen.getByLabelText('No block needed'))
  fireEvent.change(screen.getByLabelText('Why no block is needed'), { target: { value: reason } })
}

/** Fill a valid customer_withdrew form with "no block needed". */
function fillValidForm() {
  chooseReason('customer_withdrew')
  writeNote(NOTE)
  confirmNoBlock()
}

const dialog = () => screen.getByRole('dialog', { name: 'Cancel this loan?' })
const confirm = () => fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel loan' }))

const lastCancelBody = () => {
  const call = [...fetchMock.mock.calls]
    .reverse()
    .find(([url]) => url === '/api/ledger/cancel-account')
  return JSON.parse(call![1].body as string)
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  sessionStorage.clear()
  auth.user = { id: 'sup-1', role: 'supervisor' }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CancelLoanDrawer: the form', () => {
  it('drawer submit disabled until reason+note≥20+evidence(mutual)+block confirmation', () => {
    renderDrawer()
    expect(submitButton()).toBeDisabled()

    chooseReason('mutual_cancellation')
    expect(submitButton()).toBeDisabled()

    writeNote('x'.repeat(19))
    expect(screen.getByText('19/20 characters minimum')).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()

    // Padding does not count: the server trims.
    writeNote(`  ${'x'.repeat(19)}  `)
    expect(submitButton()).toBeDisabled()

    writeNote(NOTE)
    expect(submitButton()).toBeDisabled() // evidence + block still missing

    fireEvent.change(screen.getByLabelText('Evidence reference'), {
      target: { value: 'Signed variation, ticket 4411' },
    })
    expect(submitButton()).toBeDisabled() // block confirmation still missing

    fireEvent.click(screen.getByLabelText('No block needed'))
    fireEvent.change(screen.getByLabelText('Why no block is needed'), {
      target: { value: 'too short' },
    })
    expect(submitButton()).toBeDisabled() // 9 chars, 10 needed

    fireEvent.change(screen.getByLabelText('Why no block is needed'), {
      target: { value: 'Customer remains eligible to reapply.' },
    })
    expect(submitButton()).toBeEnabled()
  })

  it('asks for evidence only for a mutual cancellation', () => {
    renderDrawer()
    chooseReason('customer_withdrew')
    expect(screen.queryByLabelText('Evidence reference')).toBeNull()
    writeNote(NOTE)
    confirmNoBlock()
    expect(submitButton()).toBeEnabled()

    chooseReason('mutual_cancellation')
    expect(screen.getByLabelText('Evidence reference')).toBeRequired()
    expect(submitButton()).toBeDisabled()
  })

  it('offers the five reason codes by their staff labels, never the reserved one', () => {
    renderDrawer()
    const options = within(screen.getByLabelText('Reason'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean)
    expect(options).toEqual([
      'mutual_cancellation',
      'customer_withdrew',
      'offer_lapsed',
      'fraud_hold',
      'duplicate',
    ])
    expect(screen.getByRole('option', { name: 'Customer withdrew' })).toBeInTheDocument()
  })

  it('lists what is still missing, linking to each field', () => {
    renderDrawer()
    const missing = screen.getByRole('list', { name: 'Still needed' })
    const links = within(missing).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '#cancel-loan-reason',
      '#cancel-loan-note',
      '#cancel-loan-block',
    ])
    fillValidForm()
    expect(screen.queryByRole('list', { name: 'Still needed' })).toBeNull()
  })

  it('an active manual block confirms the block itself (manual_block_active)', async () => {
    renderDrawer({ reapplicationBlock: MANUAL_BLOCK })
    expect(
      screen.getByText('Manual block — cancelled before disbursement (permanent)'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set manual block' })).toBeNull()
    expect(screen.queryByLabelText('No block needed')).toBeNull()

    chooseReason('customer_withdrew')
    writeNote(NOTE)
    expect(submitButton()).toBeEnabled()

    reply(200, SUCCESS)
    fireEvent.click(submitButton())
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody().blockConfirmation).toEqual({ kind: 'manual_block_active' })
  })

  // Final-review M4: only no block, or ACTIVE_LOAN (which the cancel itself
  // ends), lets the customer apply again straight away.
  it.each([
    ['no block', null],
    ['ACTIVE_LOAN', { reason: 'ACTIVE_LOAN', blockedUntil: null }],
  ])('with %s, says they could apply again once the loan is cancelled', (_label, block) => {
    renderDrawer({ reapplicationBlock: block })
    expect(screen.getByText(/they could apply again straight away/)).toBeInTheDocument()
    expect(screen.queryByText(/existing block still applies/)).toBeNull()
  })

  it('with another block in force, says that block still applies instead', () => {
    renderDrawer({ reapplicationBlock: { reason: 'PRIOR_DEFAULT', blockedUntil: null } })
    expect(
      screen.getByText(
        'This customer has no active manual block. Their existing block still applies after the cancel: Prior default (permanent).',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/straight away/)).toBeNull()
    // A manual block can still be set or declined.
    expect(screen.getByRole('button', { name: 'Set manual block' })).toBeInTheDocument()
    expect(screen.getByLabelText('No block needed')).toBeInTheDocument()
  })

  it('a lapsed other block does not count as in force', () => {
    renderDrawer({
      reapplicationBlock: { reason: 'SERVICEABILITY', blockedUntil: '2020-01-01T00:00:00Z' },
    })
    expect(screen.getByText(/they could apply again straight away/)).toBeInTheDocument()
  })

  it('an expired manual block does not count', () => {
    renderDrawer({ reapplicationBlock: { ...MANUAL_BLOCK, blockedUntil: '2020-01-01T00:00:00Z' } })
    expect(screen.getByRole('button', { name: 'Set manual block' })).toBeInTheDocument()
    expect(screen.getByLabelText('No block needed')).toBeInTheDocument()
  })
})

describe('CancelLoanDrawer: confirm and submit', () => {
  it('confirm dialog shows "This cannot be undone"', () => {
    renderDrawer()
    fillValidForm()
    fireEvent.click(submitButton())
    expect(within(dialog()).getByText('This cannot be undone')).toBeInTheDocument()
    expect(within(dialog()).getByText('1000001')).toBeInTheDocument()
    expect(within(dialog()).getByText('Customer withdrew')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Go back' }))
    expect(screen.queryByRole('dialog', { name: 'Cancel this loan?' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Escape closes the confirm dialog, not the drawer', () => {
    const { props } = renderDrawer()
    fillValidForm()
    fireEvent.click(submitButton())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Cancel this loan?' })).toBeNull()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('posts the cancel-account contract with a client uuid idempotency key', async () => {
    const { props } = renderDrawer()
    chooseReason('mutual_cancellation')
    writeNote(`  ${NOTE}  `)
    fireEvent.change(screen.getByLabelText('Evidence reference'), { target: { value: ' DOC-77 ' } })
    confirmNoBlock('  Customer remains eligible to reapply.  ')
    reply(200, SUCCESS)
    fireEvent.click(submitButton())
    confirm()

    await screen.findByText('Loan 1000001 cancelled.')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/ledger/cancel-account')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      loanAccountId: 'LA-1',
      reason: 'mutual_cancellation',
      note: NOTE,
      evidenceRef: 'DOC-77',
      blockConfirmation: {
        kind: 'no_block_needed',
        reason: 'Customer remains eligible to reapply.',
      },
      idempotencyKey: expect.stringMatching(UUID),
    })
    expect(props.onRefresh).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Loan 1000001 cancelled.')
  })

  it('omits the evidence reference for other reasons', async () => {
    renderDrawer()
    fillValidForm()
    reply(200, SUCCESS)
    fireEvent.click(submitButton())
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody()).not.toHaveProperty('evidenceRef')
  })

  it('tells the operator when the cancel is recorded but the note was not written', async () => {
    renderDrawer()
    fillValidForm()
    reply(200, { ...SUCCESS, noteError: true })
    fireEvent.click(submitButton())
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The cancellation is recorded, but the contact note was not written. Add a note to the customer’s timeline.',
    )
  })

  it('a 503 keeps the same key and the same request: retrying completes the cancel', async () => {
    renderDrawer()
    fillValidForm()
    reply(503, {
      error: 'LEDGER_UNAVAILABLE',
      message:
        'The cancellation was not completed. Try again: sending the same request again completes it without cancelling twice.',
    })
    fireEvent.click(submitButton())
    confirm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The cancellation was not completed.')
    const first = lastCancelBody()

    // The request is frozen: editing could make the retry a different cancel.
    expect(screen.getByLabelText('Reason')).toBeDisabled()
    expect(screen.getByLabelText('Note')).toBeDisabled()

    reply(200, { ...SUCCESS, idempotentReplay: true })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody()).toEqual(first)
    expect(lastCancelBody().idempotencyKey).toMatch(UUID)
  })

  it('a network failure is treated like a 503: same key on retry', async () => {
    renderDrawer()
    fillValidForm()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fireEvent.click(submitButton())
    confirm()
    await screen.findByRole('alert')
    const first = lastCancelBody()
    reply(200, SUCCESS)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody().idempotencyKey).toBe(first.idempotencyKey)
  })

  // Fix round 1 (review finding 1). After an outcome-unknown failure the
  // platform may hold a cancellation claim for this key: only a retry with the
  // SAME key finishes it, and any other key is refused, leaving the loan
  // neither cancelled nor disbursable. So the frozen request outlives the
  // drawer, until an answer that settles it.
  async function failWith503() {
    reply(503, { error: 'LEDGER_UNAVAILABLE', message: 'The cancellation was not completed.' })
    fireEvent.click(submitButton())
    confirm()
    await screen.findByRole('alert')
    return lastCancelBody()
  }

  it('says to retry after an outcome-unknown failure, never to start again', async () => {
    renderDrawer()
    fillValidForm()
    await failWith503()
    expect(screen.getByText(/Try again to finish it/)).toBeInTheDocument()
    expect(screen.queryByText(/start again/i)).toBeNull()
  })

  it('a 503, then close and reopen: the same cancel is offered and retried with the same key and body', async () => {
    const { rerender } = renderDrawer()
    fillValidForm()
    const first = await failWith503()
    // Closing is safe: the frozen request is kept for this loan.
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()

    rerender({ isOpen: false })
    rerender({ isOpen: true })
    expect(
      screen.getByText('A cancellation for this loan is in progress — retry to finish it.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toHaveValue('customer_withdrew')
    expect(screen.getByLabelText('Reason')).toBeDisabled()
    expect(screen.getByLabelText('Note')).toHaveValue(NOTE)

    reply(200, { ...SUCCESS, idempotentReplay: true })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody()).toEqual(first)
  })

  it('success clears the stored cancel: the next opening is a new cancel with a new key', async () => {
    const { rerender } = renderDrawer()
    fillValidForm()
    const first = await failWith503()
    reply(200, SUCCESS)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')

    rerender({ isOpen: false })
    rerender({ isOpen: true })
    expect(screen.getByLabelText('Reason')).toHaveValue('')
    expect(screen.queryByText(/in progress/)).toBeNull()
    fillValidForm()
    reply(200, SUCCESS)
    fireEvent.click(submitButton())
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody().idempotencyKey).not.toBe(first.idempotencyKey)
  })

  it('a 422 NOT_CANCELLABLE on the retry clears it: the platform holds nothing for this key', async () => {
    const { rerender } = renderDrawer()
    fillValidForm()
    await failWith503()
    reply(422, { error: 'NOT_CANCELLABLE', message: 'account is not cancellable in status ACTIVE' })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This loan can’t be cancelled: account is not cancellable in status ACTIVE',
    )
    expect(screen.getByLabelText('Reason')).toBeEnabled()

    rerender({ isOpen: false })
    rerender({ isOpen: true })
    expect(screen.getByLabelText('Reason')).toHaveValue('')
    expect(screen.queryByText(/in progress/)).toBeNull()
  })

  it('a refusal from the CRM itself on the retry keeps it: the platform was not asked', async () => {
    const { rerender } = renderDrawer()
    fillValidForm()
    const first = await failWith503()
    reply(422, { error: 'BLOCK_REQUIRED', message: 'This customer has no active manual block.' })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    expect(await screen.findByRole('alert')).toHaveTextContent('no active manual block')
    expect(screen.getByLabelText('Reason')).toBeDisabled()

    rerender({ isOpen: false })
    rerender({ isOpen: true })
    expect(screen.getByText(/in progress/)).toBeInTheDocument()
    reply(200, SUCCESS)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody()).toEqual(first)
  })

  it('a stored cancel belongs to its own loan only', async () => {
    const { rerender } = renderDrawer()
    fillValidForm()
    await failWith503()
    rerender({ isOpen: false })
    rerender({ isOpen: true, loanAccountId: 'LA-2', accountNumber: '1000002' })
    expect(screen.getByLabelText('Reason')).toHaveValue('')
    expect(screen.queryByText(/in progress/)).toBeNull()
  })

  it('a frozen cancel that relied on a manual block now gone offers to set the block again', () => {
    sessionStorage.setItem(
      'btb517:cancel:LA-1',
      JSON.stringify({
        ownerId: 'sup-1',
        request: {
          loanAccountId: 'LA-1',
          reason: 'customer_withdrew',
          note: NOTE,
          blockConfirmation: { kind: 'manual_block_active' },
          idempotencyKey: '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b',
        },
      }),
    )
    renderDrawer({ reapplicationBlock: null })
    expect(screen.getByText(/in progress/)).toBeInTheDocument()
    expect(
      screen.getByText(/relies on a manual block that is no longer on the customer record/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set manual block' })).toBeInTheDocument()
    expect(screen.queryByLabelText('No block needed')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('a frozen cancel is not offered to another signed-in user, and stays theirs', async () => {
    const { rerender } = renderDrawer()
    fillValidForm()
    await failWith503()
    rerender({ isOpen: false })

    auth.user = { id: 'sup-2', role: 'supervisor' }
    rerender({ isOpen: true })
    expect(screen.queryByText(/in progress/)).toBeNull()
    expect(screen.getByLabelText('Reason')).toHaveValue('')
    expect(screen.getByLabelText('Note')).toHaveValue('')
    // Left in place for its owner, never shown to anyone else.
    expect(sessionStorage.getItem('btb517:cancel:LA-1')).not.toBeNull()
  })

  // Fix round 3: two users against ONE store (a tab that changed user
  // without its own sweep). User A left an unfinished cancel for LA-1.
  describe('another user’s unfinished cancel for this loan in this tab', () => {
    const A_ENTRY = JSON.stringify({
      ownerId: 'sup-a',
      request: {
        loanAccountId: 'LA-1',
        reason: 'duplicate',
        note: 'Operator A’s note: duplicate of an open application.',
        blockConfirmation: {
          kind: 'no_block_needed',
          reason: 'Duplicate; customer still eligible.',
        },
        idempotencyKey: 'a3c1e2f4-1b2c-4d5e-8f90-123456789abc',
      },
    })

    beforeEach(() => {
      sessionStorage.setItem('btb517:cancel:LA-1', A_ENTRY)
      auth.user = { id: 'sup-b', role: 'supervisor' }
    })

    it('B is not shown it, and B’s outcome-unknown failure leaves it intact and keeps B’s drawer open', async () => {
      const { props } = renderDrawer()
      expect(screen.queryByText(/in progress/)).toBeNull()
      fillValidForm()
      await failWith503()
      expect(sessionStorage.getItem('btb517:cancel:LA-1')).toBe(A_ENTRY)
      expect(
        screen.getByText(
          'Another operator has an unfinished cancellation for this loan in this browser, so this one cannot be kept here.',
        ),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Keep this drawer open and try again to finish it/),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(props.onClose).not.toHaveBeenCalled()
    })

    it('B’s NOT_CANCELLABLE leaves it intact', async () => {
      renderDrawer()
      fillValidForm()
      await failWith503()
      reply(422, {
        error: 'NOT_CANCELLABLE',
        message: 'account is not cancellable in status ACTIVE',
      })
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      confirm()
      await screen.findByText(/This loan can’t be cancelled/)
      expect(sessionStorage.getItem('btb517:cancel:LA-1')).toBe(A_ENTRY)
    })

    it('B’s success leaves it intact', async () => {
      renderDrawer()
      fillValidForm()
      reply(200, SUCCESS)
      fireEvent.click(submitButton())
      confirm()
      await screen.findByText('Loan 1000001 cancelled.')
      expect(sessionStorage.getItem('btb517:cancel:LA-1')).toBe(A_ENTRY)
    })
  })

  it('the success screen can be closed even when the frozen cancel could not be kept', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      const { props } = renderDrawer()
      fillValidForm()
      await failWith503()
      reply(200, SUCCESS)
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      confirm()
      await screen.findByText('Loan 1000001 cancelled.')
      expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled()
      // The answer arrived outside React's act(), so the drawer's guard settles
      // on the next scheduler tick: wait for it, as a person pressing Escape would.
      await waitFor(() => {
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(props.onClose).toHaveBeenCalled()
      })
    } finally {
      setItem.mockRestore()
    }
  })

  it('without browser storage, the drawer cannot be closed while a cancel is frozen', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    try {
      const { props } = renderDrawer()
      fillValidForm()
      await failWith503()
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
      expect(
        screen.getByText(/Keep this drawer open and try again to finish it/),
      ).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(props.onClose).not.toHaveBeenCalled()
    } finally {
      setItem.mockRestore()
    }
  })
})

describe('CancelLoanDrawer: refusals', () => {
  async function submitWith(
    status: number,
    body: Record<string, unknown>,
    over: Partial<CancelLoanDrawerProps> = {},
  ) {
    const r = renderDrawer(over)
    if (over.reapplicationBlock) {
      // The active block is the confirmation: no "No block needed" to tick.
      chooseReason('customer_withdrew')
      writeNote(NOTE)
    } else {
      fillValidForm()
    }
    reply(status, body)
    fireEvent.click(submitButton())
    confirm()
    const alert = await screen.findByRole('alert')
    return { ...r, alert }
  }

  it('422 NOT_CANCELLABLE shows the platform message and refreshes the account', async () => {
    const { alert, props } = await submitWith(422, {
      error: 'NOT_CANCELLABLE',
      message: 'account is not cancellable in status ACTIVE',
    })
    expect(alert).toHaveTextContent(
      'This loan can’t be cancelled: account is not cancellable in status ACTIVE',
    )
    expect(props.onRefresh).toHaveBeenCalled()
    expect(screen.queryByText('Loan 1000001 cancelled.')).toBeNull()
  })

  it('409 ACCOUNT_BUSY says to try again, and retries the same cancel', async () => {
    const { alert } = await submitWith(409, {
      error: 'ACCOUNT_BUSY',
      message: 'Another change is being applied to this account. Try again in a moment.',
    })
    expect(alert).toHaveTextContent(
      'Another change is being applied to this account. Try again in a moment.',
    )
    expect(screen.getByLabelText('Note')).toBeDisabled()
    const first = lastCancelBody()
    reply(200, SUCCESS)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    confirm()
    await screen.findByText('Loan 1000001 cancelled.')
    expect(lastCancelBody()).toEqual(first)
  })

  it('422 BLOCK_REQUIRED shows the message and re-reads the customer', async () => {
    const { alert, props } = await submitWith(
      422,
      {
        error: 'BLOCK_REQUIRED',
        message:
          'This customer has no active manual re-application block. Set the block before cancelling, or confirm that none is needed.',
      },
      { reapplicationBlock: MANUAL_BLOCK },
    )
    expect(alert).toHaveTextContent('This customer has no active manual re-application block.')
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('400 VALIDATION shows the ledger message', async () => {
    const { alert } = await submitWith(400, {
      error: 'VALIDATION',
      message: 'reason_code lender_declined_pre_disbursement is reserved',
    })
    expect(alert).toHaveTextContent('reason_code lender_declined_pre_disbursement is reserved')
  })

  it('400 field errors are listed', async () => {
    const { alert } = await submitWith(400, {
      error: 'Validation failed',
      details: { note: ['Note must be at least 20 characters'] },
    })
    expect(alert).toHaveTextContent('Note must be at least 20 characters')
  })

  it('403 says the operator may not cancel loans', async () => {
    const { alert } = await submitWith(403, {
      error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
    })
    expect(alert).toHaveTextContent('You do not have permission to perform this action.')
  })
})

describe('CancelLoanDrawer: setting a manual block first', () => {
  it('requests a manual block, shows it as requested, and polls until it reaches the customer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, rerender } = renderDrawer()
    chooseReason('fraud_hold')
    writeNote(NOTE)

    fireEvent.click(screen.getByRole('button', { name: 'Set manual block' }))
    const modal = screen.getByRole('dialog', { name: 'Set manual block' })
    // A fraud-hold cancellation suggests a fraud-hold block.
    expect(within(modal).getByLabelText('Reason')).toHaveValue('fraud_hold')
    fireEvent.change(within(modal).getByLabelText('Note'), {
      target: { value: 'Identity documents did not match the applicant.' },
    })
    reply(202, { requestId: 'req-9', eventId: 'evt-9', status: 'accepted' })
    fireEvent.click(within(modal).getByRole('button', { name: 'Set manual block' }))

    expect(await screen.findByText(/Manual block requested/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Set manual block' })).toBeNull()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commands/reapp-block-set')
    expect(JSON.parse(init.body as string)).toEqual({
      canonicalCustomerId: 'CUS-1',
      reasonCode: 'fraud_hold',
      note: 'Identity documents did not match the applicant.',
      blockUntil: null,
    })
    // Requested is not in place: still no block confirmation.
    expect(submitButton()).toBeDisabled()

    const before = vi.mocked(props.onRefresh!).mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })
    expect(vi.mocked(props.onRefresh!).mock.calls.length).toBeGreaterThan(before)

    // The block lands on the customer record (state.changed + applied).
    rerender({
      reapplicationBlock: {
        reason: 'MANUAL_ADMIN',
        blockedUntil: null,
        manualBlockRequestId: 'req-9',
        manualSetRequestId: 'req-9',
        manualSetReasonCode: 'fraud_hold',
      },
    })
    expect(screen.getByText('Manual block — fraud hold (permanent)')).toBeInTheDocument()
    expect(screen.queryByText(/Manual block requested/)).toBeNull()
    expect(submitButton()).toBeEnabled()
  })

  it('shows the block service’s rejection for this request', async () => {
    const { rerender } = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Set manual block' }))
    const modal = screen.getByRole('dialog', { name: 'Set manual block' })
    fireEvent.change(within(modal).getByLabelText('Note'), {
      target: { value: 'Hold pending review.' },
    })
    reply(202, { requestId: 'req-5', eventId: 'evt-5', status: 'accepted' })
    fireEvent.click(within(modal).getByRole('button', { name: 'Set manual block' }))
    await screen.findByText(/Manual block requested/)

    rerender({
      reapplicationBlock: {
        reason: null,
        manualSetRejectedRequestId: 'req-5',
        manualSetRejection: 'INVALID_EXPIRY: expires_at must be an ISO-8601 timestamp or null',
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The manual block was not set: INVALID_EXPIRY: expires_at must be an ISO-8601 timestamp or null',
    )
    expect(screen.getByRole('button', { name: 'Set manual block' })).toBeInTheDocument()
  })

  it('stops polling after two minutes and says the block has not arrived', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props } = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Set manual block' }))
    const modal = screen.getByRole('dialog', { name: 'Set manual block' })
    fireEvent.change(within(modal).getByLabelText('Note'), {
      target: { value: 'Hold pending review.' },
    })
    reply(202, { requestId: 'req-6', eventId: 'evt-6', status: 'accepted' })
    fireEvent.click(within(modal).getByRole('button', { name: 'Set manual block' }))
    await screen.findByText(/Manual block requested/)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(125_000)
    })
    expect(screen.getByText(/has not reached the customer record yet/)).toBeInTheDocument()
    const calls = vi.mocked(props.onRefresh!).mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(vi.mocked(props.onRefresh!).mock.calls.length).toBe(calls)
    // The operator is not stuck: "No block needed" is still there.
    expect(screen.getByLabelText('No block needed')).toBeInTheDocument()
  })
})

describe('CancelLoanDrawer: closed', () => {
  it('renders nothing when closed', () => {
    renderDrawer({ isOpen: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the drawer open while a cancel is in flight', async () => {
    const { props } = renderDrawer()
    fillValidForm()
    let resolve!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    fireEvent.click(submitButton())
    confirm()
    await waitFor(() =>
      expect(within(dialog()).getByRole('button', { name: 'Cancelling…' })).toBeDisabled(),
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).not.toHaveBeenCalled()
    resolve({ ok: true, status: 200, json: async () => SUCCESS })
    await screen.findByText('Loan 1000001 cancelled.')
  })
})
