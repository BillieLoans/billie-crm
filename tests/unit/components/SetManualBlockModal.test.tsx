/**
 * SetManualBlockModal (BTB-517): a supervisor asks billieChat to put a
 * MANUAL_ADMIN re-application block on the customer. The route answers 202;
 * the block itself arrives later on the customer record.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { SetManualBlockModal } from '@/components/BlockSet/SetManualBlockModal'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const fetchMock = vi.fn()

function renderModal(over: Partial<React.ComponentProps<typeof SetManualBlockModal>> = {}) {
  const props = {
    onClose: vi.fn(),
    onRequested: vi.fn(),
    canonicalCustomerId: 'CUS-1',
    customerName: 'Cass Customer',
    ...over,
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SetManualBlockModal {...props} />
    </QueryClientProvider>,
  )
  return props
}

const modal = () => screen.getByRole('dialog', { name: 'Set manual block' })
const submit = () => within(modal()).getByRole('button', { name: 'Set manual block' })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SetManualBlockModal', () => {
  it('offers the three manual block reasons by label', () => {
    renderModal()
    const select = within(modal()).getByLabelText('Reason')
    const values = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
    expect(values).toEqual(['credit_review_hold', 'cancelled_pre_disbursement', 'fraud_hold'])
    expect(within(select).getByRole('option', { name: 'Credit review hold' })).toBeInTheDocument()
    expect(
      within(select).getByRole('option', { name: 'Cancelled before disbursement' }),
    ).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Fraud hold' })).toBeInTheDocument()
  })

  it('starts on the suggested reason', () => {
    renderModal({ defaultReasonCode: 'cancelled_pre_disbursement' })
    expect(within(modal()).getByLabelText('Reason')).toHaveValue('cancelled_pre_disbursement')
  })

  it('requires a note', () => {
    renderModal()
    expect(submit()).toBeDisabled()
    fireEvent.change(within(modal()).getByLabelText('Note'), { target: { value: '   ' } })
    expect(submit()).toBeDisabled()
    fireEvent.change(within(modal()).getByLabelText('Note'), { target: { value: 'Credit review' } })
    expect(submit()).toBeEnabled()
  })

  it('sends the block with no expiry by default, and hands back the request id', async () => {
    const props = renderModal()
    fireEvent.change(within(modal()).getByLabelText('Reason'), {
      target: { value: 'credit_review_hold' },
    })
    fireEvent.change(within(modal()).getByLabelText('Note'), {
      target: { value: '  Credit file under review.  ' },
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ requestId: 'req-1', eventId: 'evt-1', status: 'accepted' }),
    })
    fireEvent.click(submit())

    await vi.waitFor(() => expect(props.onRequested).toHaveBeenCalledWith('req-1'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/commands/reapp-block-set')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      canonicalCustomerId: 'CUS-1',
      reasonCode: 'credit_review_hold',
      note: 'Credit file under review.',
      blockUntil: null,
    })
  })

  it('sends an optional end date as the last day of the block', async () => {
    const props = renderModal()
    fireEvent.change(within(modal()).getByLabelText('Note'), { target: { value: 'Review hold' } })
    fireEvent.change(within(modal()).getByLabelText('Block until (optional)'), {
      target: { value: '2099-03-31' },
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: async () => ({ requestId: 'req-2', eventId: 'evt-2', status: 'accepted' }),
    })
    fireEvent.click(submit())
    await vi.waitFor(() => expect(props.onRequested).toHaveBeenCalledWith('req-2'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).blockUntil).toBe('2099-03-31')
  })

  it('shows the route’s error and stays open', async () => {
    const props = renderModal()
    fireEvent.change(within(modal()).getByLabelText('Note'), { target: { value: 'Review hold' } })
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
    fireEvent.click(submit())
    expect(await within(modal()).findByRole('alert')).toHaveTextContent(
      'The block request was not sent. Try again.',
    )
    expect(props.onRequested).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
