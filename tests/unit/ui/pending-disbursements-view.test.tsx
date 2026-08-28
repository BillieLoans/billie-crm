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

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ totalCount: 3, items, dailyLimit }),
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
    expect(screen.getByTestId('osko-message')).toBeInTheDocument()
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

    expect(screen.getByTestId('osko-message')).toBeInTheDocument()
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
    expect(screen.getAllByTestId('osko-message')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('toggle-payment-a1'))
    expect(screen.getAllByTestId('osko-message')).toHaveLength(1)
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
