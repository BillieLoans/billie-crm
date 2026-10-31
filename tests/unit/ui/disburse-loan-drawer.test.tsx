import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import React from 'react'
import { DisburseLoanDrawer } from '@/components/ServicingView/DisburseLoanDrawer'

vi.mock('@/components/ui/ContextDrawer', () => ({
  ContextDrawer: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean
    title: string
    children: React.ReactNode
  }) =>
    isOpen ? (
      <div data-testid="context-drawer">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}))

const fetchMock = vi.fn()

function renderDrawer() {
  const onClose = vi.fn()
  const onSuccess = vi.fn()
  render(
    <DisburseLoanDrawer
      isOpen
      onClose={onClose}
      onSuccess={onSuccess}
      loanAccountId="LA-1"
      accountNumber="1000001"
      loanAmount={500}
    />,
  )
  return { onClose, onSuccess }
}

async function submit() {
  fireEvent.change(screen.getByLabelText(/bank reference/i), { target: { value: 'TRF-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Disburse Loan' }))
}

const reply = (status: number, body: Record<string, unknown>) =>
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DisburseLoanDrawer: a cancelled loan', () => {
  it('shows the cancelled rejection as an error, never as success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    reply(409, { error: 'LOAN_CANCELLED', message: 'Loan is CANCELLED — cannot disburse.' })
    const { onClose, onSuccess } = renderDrawer()

    await submit()

    const alert = await screen.findByText('Loan is CANCELLED — cannot disburse.')
    expect(alert.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(/disbursed successfully/i)).toBeNull()
    expect(screen.queryByText(/already been disbursed/i)).toBeNull()
    expect(onSuccess).not.toHaveBeenCalled()
    // The drawer stays open on the error so the operator can read it: the
    // success path would have closed it after 1.5 s.
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('falls back to the fixed copy when the response carries no message', async () => {
    reply(409, { error: 'LOAN_CANCELLED' })
    const { onSuccess } = renderDrawer()

    await submit()

    expect(await screen.findByText('Loan is CANCELLED — cannot disburse.')).toBeTruthy()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('DisburseLoanDrawer: an already disbursed loan', () => {
  it('still treats ALREADY_DISBURSED as done', async () => {
    reply(409, { error: 'ALREADY_DISBURSED', message: 'This account has already been disbursed.' })
    const { onSuccess } = renderDrawer()

    await submit()

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(screen.getByText('This account has already been disbursed.')).toBeTruthy()
  })
})

describe('DisburseLoanDrawer: refreshes the stale view after LOAN_CANCELLED (BTB-517)', () => {
  it('asks the parent to re-read the account, so the stale Disburse button goes', async () => {
    reply(409, { error: 'LOAN_CANCELLED', message: 'Loan is CANCELLED — cannot disburse.' })
    const onLoanCancelled = vi.fn()
    const onSuccess = vi.fn()
    render(
      <DisburseLoanDrawer
        isOpen
        onClose={vi.fn()}
        onSuccess={onSuccess}
        onLoanCancelled={onLoanCancelled}
        loanAccountId="LA-1"
        accountNumber="1000001"
        loanAmount={500}
      />,
    )
    await submit()
    await screen.findByText('Loan is CANCELLED — cannot disburse.')
    expect(onLoanCancelled).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
