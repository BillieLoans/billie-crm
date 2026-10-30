import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { PendingDisbursementsView } from '@/components/PendingDisbursementsView/PendingDisbursementsView'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/ServicingView/DisburseLoanDrawer', () => ({ DisburseLoanDrawer: () => null }))
vi.mock('@/components/DashboardView/CutoffCountdown', () => ({ CutoffCountdown: () => null }))

const account = {
  holder: 'Ms Kathryn F Shine',
  bsb: '923100',
  bsbFormatted: '923-100',
  number: '63764292',
  isComplete: true,
  missing: [] as string[],
}

const items = [
  {
    loanAccountId: 'a1',
    accountNumber: 'LN-1',
    applicationNumber: 'F92C001D-AB9',
    customerId: 'c1',
    customerName: 'Over Due',
    ekycVerifiedName: 'Over Due',
    ekycStatus: 'successful',
    loanAmount: 100,
    loanAmountFormatted: '$100.00',
    commencementDate: '2020-01-01',
    firstDueDate: '2020-02-01',
    bucket: 'overdue',
    disbursementAccount: account,
    oskoMessage: 'Billie Pay Advance F92C001D-AB9.',
  },
  {
    loanAccountId: 'a2',
    accountNumber: 'LN-2',
    applicationNumber: 'F92C002D-AB9',
    customerId: 'c2',
    customerName: 'To Day',
    ekycVerifiedName: 'To Day',
    ekycStatus: 'successful',
    loanAmount: 200,
    loanAmountFormatted: '$200.00',
    commencementDate: '2026-06-17',
    firstDueDate: '2026-07-17',
    bucket: 'today',
    disbursementAccount: account,
    oskoMessage: 'Billie Pay Advance F92C002D-AB9.',
  },
  {
    loanAccountId: 'a3',
    accountNumber: 'LN-3',
    applicationNumber: 'F92C003D-AB9',
    customerId: 'c3',
    customerName: 'Sched Uled',
    ekycVerifiedName: 'Sched Uled',
    ekycStatus: 'successful',
    loanAmount: 300,
    loanAmountFormatted: '$300.00',
    commencementDate: '2099-01-01',
    firstDueDate: '2099-02-01',
    bucket: 'scheduled',
    disbursementAccount: account,
    oskoMessage: 'Billie Pay Advance F92C003D-AB9.',
  },
]

const dailyLimit = {
  disbursedToday: 1000,
  pendingToday: 300,
  projectedTotal: 1300,
  limit: 1_000_000,
  ratio: 0.0013,
  status: 'ok' as const,
}

const DISBURSABLE = {
  disbursable: true,
  reason: 'DISBURSABLE',
  status: 'PENDING_DISBURSEMENT',
  message: '',
}

/** loanAccountId -> the platform's verdict. Anything unlisted is disbursable. */
let verdicts: Record<string, unknown>

beforeEach(() => {
  verdicts = {}
  // The queue endpoint and the per-loan platform check (BTB-517) share one fetch.
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/ledger/disbursable')) {
      const id = new URL(url, 'http://crm.test').searchParams.get('loanAccountId') ?? ''
      return { ok: true, status: 200, json: async () => verdicts[id] ?? DISBURSABLE }
    }
    return { ok: true, status: 200, json: async () => ({ totalCount: 3, items, dailyLimit }) }
  }) as unknown as typeof fetch
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PendingDisbursementsView', () => {
  it('renders all three bucket sections', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-overdue')).toBeInTheDocument())
    expect(screen.getByTestId('section-today')).toBeInTheDocument()
    expect(screen.getByTestId('section-scheduled')).toBeInTheDocument()
  })

  it('shows the customer-facing loan reference, not the internal account number', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-today')).toBeInTheDocument())
    const todaySection = screen.getByTestId('section-today')
    expect(within(todaySection).getByText('F92C002D-AB9')).toBeInTheDocument()
  })

  it('never renders a full account number in the queue list', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-today')).toBeInTheDocument())
    // ux-standards §4 — full identifiers are not rendered by default.
    expect(screen.queryByText('63764292')).not.toBeInTheDocument()
    expect(screen.getAllByText(/923-100 ···292/).length).toBeGreaterThan(0)
  })

  it('opens the payment panel for a today loan without warning', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-today')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('toggle-payment-a2'))
    expect(await screen.findByTestId('osko-message')).toBeInTheDocument()
    expect(screen.queryByText(/before the scheduled start date/i)).not.toBeInTheDocument()
  })

  it('warns BEFORE opening the panel for a scheduled loan', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-scheduled')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/SCHEDULED/i))
    fireEvent.click(screen.getByTestId('toggle-payment-a3'))

    // The guard must land before any bank detail is copyable.
    expect(screen.getByText(/before the scheduled start date/i)).toBeInTheDocument()
    expect(screen.queryByTestId('osko-message')).not.toBeInTheDocument()
  })

  it('opens the panel once the early-disbursement warning is confirmed', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-scheduled')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/SCHEDULED/i))
    fireEvent.click(screen.getByTestId('toggle-payment-a3'))
    fireEvent.click(screen.getByRole('button', { name: /disburse today anyway/i }))

    expect(await screen.findByTestId('osko-message')).toBeInTheDocument()
  })

  it('leaves the panel closed when the early warning is cancelled', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-scheduled')).toBeInTheDocument())
    fireEvent.click(screen.getByText(/SCHEDULED/i))
    fireEvent.click(screen.getByTestId('toggle-payment-a3'))
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.queryByTestId('osko-message')).not.toBeInTheDocument()
  })

  it('keeps only one payment panel open at a time', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-today')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('toggle-payment-a2'))
    expect(await screen.findAllByTestId('osko-message')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('toggle-payment-a1'))
    await waitFor(() => expect(screen.getAllByTestId('osko-message')).toHaveLength(1))
    // The second panel replaced the first: only a1's check is in play now.
    expect(screen.getAllByRole('button', { name: /mark disbursed/i })).toHaveLength(1)
  })

  it('asks the platform about the loan whose panel is opened', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-today')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('toggle-payment-a2'))
    await screen.findByTestId('osko-message')

    const checks = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith('/api/ledger/disbursable'))
    expect(checks).toEqual(['/api/ledger/disbursable?loanAccountId=a2'])
  })

  it('shows a stop, not payout details, for a loan the platform has cancelled', async () => {
    // The stale-queue case this guard exists for: the CRM still lists the loan
    // (a replayed account.updated put it back) but the platform has cancelled it.
    verdicts.a2 = {
      disbursable: false,
      reason: 'CANCELLED',
      status: 'CANCELLED',
      message: 'Loan is CANCELLED — cannot disburse.',
    }
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-today')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('toggle-payment-a2'))

    const panel = document.getElementById('payment-panel-a2') as HTMLElement
    const alert = await within(panel).findByRole('alert')
    expect(alert.textContent).toMatch(/do not pay/i)
    expect(alert.textContent).toMatch(/cancelled before disbursement/i)
    // None of what an operator could pay from. (The list row keeps its BSB and
    // last three digits, which are not enough to pay.)
    expect(within(panel).queryByText('BSB')).not.toBeInTheDocument()
    expect(within(panel).queryByText(/923-100/)).not.toBeInTheDocument()
    expect(within(panel).queryByTestId('osko-message')).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /copy all details/i })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /mark disbursed/i })).not.toBeInTheDocument()
  })

  it('renders the daily bank-limit indicator', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('daily-limit-indicator')).toBeInTheDocument())
    expect(screen.getByText(/Within daily limit/i)).toBeInTheDocument()
  })

  it('expands the scheduled section when deep-linked', async () => {
    window.history.replaceState({}, '', '/admin/pending-disbursements?bucket=scheduled')
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-scheduled')).toBeInTheDocument())
    expect(screen.getByTestId('toggle-payment-a3')).toBeInTheDocument()
    window.history.replaceState({}, '', '/admin/pending-disbursements') // reset for other tests
  })
})
