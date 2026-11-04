/**
 * SetManualBlockButton (BTB-517): "Set manual block" in the customer header, so
 * a supervisor can block a customer from re-applying without cancelling a loan.
 *
 * Drives the real button, the real SetManualBlockModal and the real hook; only
 * `fetch` and the signed-in user are stubbed. The block reaches the customer
 * record later, so the "answer" in these tests is a rerender with a new
 * `reapplicationBlock`, as ServicingView's refetch would deliver it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  SetManualBlockButton,
  type SetManualBlockButtonProps,
} from '@/components/BlockSet/SetManualBlockButton'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const auth = vi.hoisted(() => ({
  user: { id: 'sup-1', role: 'supervisor' } as { id: string; role: string } | null,
}))
vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: auth.user }) }))

const fetchMock = vi.fn()

function renderButton(over: Partial<SetManualBlockButtonProps> = {}) {
  const props: SetManualBlockButtonProps = {
    canonicalCustomerId: 'CUS-1',
    customerName: 'Cass Customer',
    reapplicationBlock: null,
    onRefresh: vi.fn(),
    ...over,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (p: SetManualBlockButtonProps) => (
    <QueryClientProvider client={client}>
      <SetManualBlockButton {...p} />
    </QueryClientProvider>
  )
  const utils = render(tree(props))
  const rerender = (next: Partial<SetManualBlockButtonProps>) =>
    utils.rerender(tree({ ...props, ...next }))
  return { props, rerender, unmount: utils.unmount }
}

const trigger = () => screen.getByRole('button', { name: 'Set manual block' })
const modal = () => screen.getByRole('dialog', { name: 'Set manual block' })

/** Open the modal, write a note, and send; the route answers 202 with `requestId`. */
async function requestBlock(requestId: string) {
  fireEvent.click(trigger())
  fireEvent.change(within(modal()).getByLabelText('Note'), {
    target: { value: 'Credit file under review.' },
  })
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 202,
    json: async () => ({ requestId, eventId: 'evt-1', status: 'accepted' }),
  })
  fireEvent.click(within(modal()).getByRole('button', { name: 'Set manual block' }))
  await screen.findByText('Manual block requested. Waiting for confirmation…')
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  auth.user = { id: 'sup-1', role: 'supervisor' }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SetManualBlockButton: who sees it', () => {
  it.each(['supervisor', 'admin'])('shows the button to a %s', (role) => {
    auth.user = { id: 'u-1', role }
    renderButton()
    expect(trigger()).toBeEnabled()
  })

  it.each(['operations', 'readonly', 'service', 'unknown-role'])(
    'shows nothing to a %s user',
    (role) => {
      auth.user = { id: 'u-1', role }
      renderButton()
      expect(screen.queryByRole('button')).toBeNull()
    },
  )

  it('shows nothing when no one is signed in', () => {
    auth.user = null
    renderButton()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows nothing without the canonical customer id', () => {
    renderButton({ canonicalCustomerId: '' })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('SetManualBlockButton: asking for a block', () => {
  it('opens the modal on "Credit review hold", since no loan is being cancelled', () => {
    renderButton()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger())
    expect(within(modal()).getByLabelText('Reason')).toHaveValue('credit_review_hold')
    expect(
      within(modal()).getByText(/Stops Cass Customer from starting a new application/),
    ).toBeInTheDocument()
  })

  it('opens a fresh form each time, and Back closes it without sending anything', () => {
    renderButton()
    fireEvent.click(trigger())
    fireEvent.change(within(modal()).getByLabelText('Note'), { target: { value: 'Half written' } })
    fireEvent.click(within(modal()).getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(trigger())
    expect(within(modal()).getByLabelText('Note')).toHaveValue('')
  })

  it('sends the request for the canonical customer, then waits and disables the button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props } = renderButton()
    await requestBlock('req-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commands/reapp-block-set')
    expect(JSON.parse(init.body as string)).toEqual({
      canonicalCustomerId: 'CUS-1',
      reasonCode: 'credit_review_hold',
      note: 'Credit file under review.',
      blockUntil: null,
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Manual block requested. Waiting for confirmation…',
    )
    expect(trigger()).toBeDisabled()

    // Nothing is re-read until the first interval, then every 3 s.
    expect(props.onRefresh).not.toHaveBeenCalled()
    await advance(3_100)
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    await advance(3_000)
    expect(props.onRefresh).toHaveBeenCalledTimes(2)
    expect(trigger()).toBeDisabled()
  })

  it('stays on the modal, with the route’s error, when the request is not sent', async () => {
    const { props } = renderButton()
    fireEvent.click(trigger())
    fireEvent.change(within(modal()).getByLabelText('Note'), { target: { value: 'Hold' } })
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({
        error: {
          code: 'EVENT_PUBLISH_FAILED',
          message: 'The block request was not sent. Try again.',
        },
      }),
    })
    fireEvent.click(within(modal()).getByRole('button', { name: 'Set manual block' }))
    expect(await within(modal()).findByRole('alert')).toHaveTextContent(
      'The block request was not sent. Try again.',
    )
    // Not waiting: no status text, nothing polled, and the trigger is not disabled.
    expect(screen.queryByText(/Waiting for confirmation/)).toBeNull()
    expect(props.onRefresh).not.toHaveBeenCalled()
  })
})

describe('SetManualBlockButton: the answer', () => {
  it('says the block is set once the record names this request, then stops polling and clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, rerender } = renderButton()
    await requestBlock('req-9')
    await advance(3_100)
    expect(props.onRefresh).toHaveBeenCalledTimes(1)

    rerender({
      reapplicationBlock: {
        reason: 'MANUAL_ADMIN',
        blockedUntil: null,
        manualBlockRequestId: 'req-9',
        manualSetRequestId: 'req-9',
        manualSetReasonCode: 'credit_review_hold',
      },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Manual block set.')
    expect(screen.queryByText(/Waiting for confirmation/)).toBeNull()
    expect(trigger()).toBeEnabled()

    // Polling has stopped.
    await advance(3_000)
    expect(props.onRefresh).toHaveBeenCalledTimes(1)

    // The confirmation goes after a few seconds; the attention chip carries on.
    await advance(5_100)
    expect(screen.queryByText('Manual block set.')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not take an older set’s request id for this one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, rerender } = renderButton({
      reapplicationBlock: {
        reason: 'MANUAL_ADMIN',
        blockedUntil: null,
        manualBlockRequestId: 'req-old',
        manualSetRequestId: 'req-old',
        manualSetReasonCode: 'fraud_hold',
      },
    })
    await requestBlock('req-new')

    // The record still shows the older set (and an older refusal): not ours.
    rerender({
      reapplicationBlock: {
        reason: 'MANUAL_ADMIN',
        blockedUntil: null,
        manualBlockRequestId: 'req-old',
        manualSetRequestId: 'req-old',
        manualSetReasonCode: 'fraud_hold',
        manualSetRejectedRequestId: 'req-older-still',
        manualSetRejection: 'INVALID_EXPIRY',
      },
    })
    expect(screen.queryByText('Manual block set.')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for confirmation')
    expect(trigger()).toBeDisabled()

    await advance(3_100)
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('shows billieChat’s refusal in words, then stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, rerender } = renderButton()
    await requestBlock('req-5')
    await advance(3_100)
    expect(props.onRefresh).toHaveBeenCalledTimes(1)

    rerender({
      reapplicationBlock: {
        reason: 'MANUAL_ADMIN',
        blockedUntil: null,
        manualSetRejectedRequestId: 'req-5',
        manualSetRejection: 'WOULD_SHORTEN_ACTIVE_BLOCK',
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The manual block was not set: a longer manual block is already in place',
    )
    expect(screen.queryByText(/Waiting for confirmation/)).toBeNull()
    expect(screen.queryByText('Manual block set.')).toBeNull()
    expect(trigger()).toBeEnabled()

    await advance(10_000)
    expect(props.onRefresh).toHaveBeenCalledTimes(1)
    // A refusal stays until the supervisor acts again.
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it.each([
    [
      'INVALID_EXPIRY: expires_at must be an ISO-8601 timestamp or null',
      "the end date isn't valid",
    ],
    ['INVALID_REASON', "the reason isn't valid"],
    ['MISSING_FIELDS', 'details were missing'],
    ['SOMETHING_NEW', 'SOMETHING_NEW'],
  ])('words the refusal %s as "%s"', async (rejection, text) => {
    const { rerender } = renderButton()
    await requestBlock('req-6')
    rerender({
      reapplicationBlock: {
        reason: null,
        manualSetRejectedRequestId: 'req-6',
        manualSetRejection: rejection,
      },
    })
    expect(screen.getByRole('alert')).toHaveTextContent(`The manual block was not set: ${text}`)
  })

  it('clears a refusal when the supervisor opens the form again', async () => {
    const { rerender } = renderButton()
    await requestBlock('req-7')
    rerender({
      reapplicationBlock: {
        reason: null,
        manualSetRejectedRequestId: 'req-7',
        manualSetRejection: 'MISSING_FIELDS',
      },
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(trigger())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('gives up after two minutes, says so, and stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props } = renderButton()
    await requestBlock('req-8')

    await advance(119_000)
    expect(screen.getByText(/Waiting for confirmation/)).toBeInTheDocument()
    expect(trigger()).toBeDisabled()

    await advance(2_000)
    expect(screen.getByRole('status')).toHaveTextContent(
      "The block hasn't reached the customer record yet. Refresh in a minute; if it still isn't there, the block service may be off.",
    )
    expect(screen.queryByText(/Waiting for confirmation/)).toBeNull()
    // Not stuck: the supervisor can ask again.
    expect(trigger()).toBeEnabled()

    const calls = vi.mocked(props.onRefresh).mock.calls.length
    expect(calls).toBeGreaterThan(0)
    await advance(30_000)
    expect(vi.mocked(props.onRefresh).mock.calls.length).toBe(calls)
  })

  it('still reports the block if it arrives after the wait gave up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { rerender } = renderButton()
    await requestBlock('req-3')
    await advance(125_000)
    expect(screen.getByRole('status')).toHaveTextContent("The block hasn't reached")

    rerender({
      reapplicationBlock: {
        reason: 'MANUAL_ADMIN',
        blockedUntil: null,
        manualBlockRequestId: 'req-3',
        manualSetRequestId: 'req-3',
        manualSetReasonCode: 'credit_review_hold',
      },
    })
    expect(screen.getByRole('status')).toHaveTextContent('Manual block set.')
  })

  it('stops its timers when the header goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { props, unmount } = renderButton()
    await requestBlock('req-2')
    unmount()
    await advance(130_000)
    expect(props.onRefresh).not.toHaveBeenCalled()
  })
})
