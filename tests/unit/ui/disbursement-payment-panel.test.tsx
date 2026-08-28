import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { DisbursementPaymentPanel } from '@/components/PendingDisbursementsView/DisbursementPaymentPanel'
import type { QueueItem } from '@/components/PendingDisbursementsView/DisbursementSection'

const writeText = vi.fn().mockResolvedValue(undefined)

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    loanAccountId: 'a1',
    accountNumber: 'LN-1',
    applicationNumber: 'F92C001D-AB9',
    customerId: 'c1',
    customerName: 'Kathryn Shine',
    ekycVerifiedName: 'Kathryn Shine',
    ekycStatus: 'successful' as const,
    loanAmount: 200,
    loanAmountFormatted: '$200.00',
    commencementDate: '2026-08-28',
    firstDueDate: '2026-09-04',
    bucket: 'today',
    signedLoanAgreementUrl: 's3://bucket/agreement.pdf',
    disbursementAccount: {
      holder: 'Mr Rohan C Sharp & Ms Kathryn F Shine',
      bsb: '923100',
      bsbFormatted: '923-100',
      number: '63764292',
      isComplete: true,
      missing: [],
    },
    oskoMessage: 'Billie Pay Advance F92C001D-AB9. First repayment 04/09/2026.',
    ...overrides,
  }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DisbursementPaymentPanel', () => {
  it('masks the account number until it is explicitly revealed', () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    const value = screen.getByTestId('payout-value-accountNumber')
    expect(value.textContent).not.toContain('63764292')
    expect(value.textContent).toContain('4292')
  })

  it('reveals the account number on explicit action and audits it', async () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))

    expect(screen.getByTestId('payout-value-accountNumber').textContent).toContain('63764292')
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/pending-disbursements/access-log')
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      action: 'reveal',
      field: 'accountNumber',
      loanAccountId: 'a1',
    })
  })

  it('copies the full account number without needing to reveal it', async () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    fireEvent.click(screen.getByTestId('payout-copy-accountNumber'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('63764292'))
    // Still masked on screen — copying does not expose it.
    expect(screen.getByTestId('payout-value-accountNumber').textContent).not.toContain('63764292')
  })

  it('audits a copy, because the clipboard discloses just as effectively', async () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    fireEvent.click(screen.getByTestId('payout-copy-accountNumber'))

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      action: 'copy',
      field: 'accountNumber',
    })
  })

  it('disables Mark disbursed until the payee name is confirmed', () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    expect(screen.getByTestId('panel-disburse')).toBeDisabled()
  })

  it('enables Mark disbursed once the names are confirmed to match', () => {
    const onDisburse = vi.fn()
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={onDisburse} />)
    fireEvent.click(screen.getByLabelText(/names match/i))

    const btn = screen.getByTestId('panel-disburse')
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onDisburse).toHaveBeenCalledTimes(1)
  })

  it('stops the disbursement and says why when the names differ', () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    fireEvent.click(screen.getByLabelText(/names differ/i))

    expect(screen.getByTestId('panel-disburse')).toBeDisabled()
    expect(screen.getByRole('alert').textContent).toMatch(/do not disburse/i)
  })

  it('still lets an incomplete record be recorded once the name is confirmed', () => {
    // "Mark disbursed" records a payment already made by hand in ANZ; it does not
    // move money. Blocking it here would strand the payment outside the ledger.
    const onDisburse = vi.fn()
    const item = makeItem({
      disbursementAccount: {
        holder: null,
        bsb: '923100',
        bsbFormatted: '923-100',
        number: null,
        isComplete: false,
        missing: ['account name', 'account number'],
      },
    })
    render(<DisbursementPaymentPanel item={item} onDisburse={onDisburse} />)
    expect(screen.getByText(/do not pay from a partial record/i)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/names match/i))
    expect(screen.getByTestId('panel-disburse')).toBeEnabled()
    fireEvent.click(screen.getByTestId('panel-disburse'))
    expect(onDisburse).toHaveBeenCalledTimes(1)
  })

  it('lets a legacy loan with no payout details be recorded after the name check', () => {
    // Every loan created before the payout details rode the account event looks
    // like this. They still have to be disbursable.
    const onDisburse = vi.fn()
    render(
      <DisbursementPaymentPanel
        item={makeItem({ disbursementAccount: null })}
        onDisburse={onDisburse}
      />,
    )
    expect(screen.getByText(/no nominated account on this loan/i)).toBeInTheDocument()
    expect(screen.getByTestId('panel-disburse')).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/names match/i))
    expect(screen.getByTestId('panel-disburse')).toBeEnabled()
    fireEvent.click(screen.getByTestId('panel-disburse'))
    expect(onDisburse).toHaveBeenCalledTimes(1)
  })

  it('says why Mark disbursed is disabled even with no account on file', () => {
    // A disabled button with no stated reason is a dead end for the operator.
    render(
      <DisbursementPaymentPanel
        item={makeItem({ disbursementAccount: null })}
        onDisburse={vi.fn()}
      />,
    )
    expect(screen.getByText(/confirm the payee name/i)).toBeInTheDocument()
  })

  it('does not warn when eKYC succeeded', () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    expect(screen.getByText(/eKYC-verified identity/i)).toBeInTheDocument()
    expect(screen.queryByText(/not verified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/eKYC failed/i)).not.toBeInTheDocument()
  })

  it('distinguishes a FAILED identity check from one that never ran', () => {
    // These must not read alike: one is a fraud signal, the other is missing data.
    const { unmount } = render(
      <DisbursementPaymentPanel item={makeItem({ ekycStatus: 'failed' })} onDisburse={vi.fn()} />,
    )
    expect(screen.getByText(/eKYC failed/i)).toBeInTheDocument()
    expect(screen.getByText(/Identity check FAILED/i)).toBeInTheDocument()
    unmount()

    render(
      <DisbursementPaymentPanel item={makeItem({ ekycStatus: 'unknown' })} onDisburse={vi.fn()} />,
    )
    expect(screen.queryByText(/eKYC failed/i)).not.toBeInTheDocument()
    expect(screen.getByText(/not verified/i)).toBeInTheDocument()
  })

  it('marks a pending eKYC check as incomplete rather than failed', () => {
    render(
      <DisbursementPaymentPanel item={makeItem({ ekycStatus: 'pending' })} onDisburse={vi.fn()} />,
    )
    expect(screen.getByText(/check not complete/i)).toBeInTheDocument()
    expect(screen.queryByText(/eKYC failed/i)).not.toBeInTheDocument()
  })

  it('still shows the payee name to compare when eKYC has not succeeded', () => {
    // The operator has to check the bank's answer against something either way.
    render(
      <DisbursementPaymentPanel item={makeItem({ ekycStatus: 'unknown' })} onDisburse={vi.fn()} />,
    )
    expect(screen.getByText(/Kathryn Shine/)).toBeInTheDocument()
  })

  it('shows the payment message with its length against the Osko limit', () => {
    const item = makeItem()
    render(<DisbursementPaymentPanel item={item} onDisburse={vi.fn()} />)
    expect(screen.getByTestId('osko-message').textContent).toBe(item.oskoMessage)
    expect(screen.getByText(`${item.oskoMessage.length}/280`)).toBeInTheDocument()
  })

  it('copies every payment detail as one block', async () => {
    render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /copy all details/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain('923-100')
    expect(copied).toContain('63764292')
    expect(copied).toContain('$200.00')
    expect(copied).toContain('Billie Pay Advance')
  })
})
