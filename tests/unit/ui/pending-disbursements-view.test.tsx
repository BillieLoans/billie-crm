import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { PendingDisbursementsView } from '@/components/PendingDisbursementsView/PendingDisbursementsView'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/ServicingView/DisburseLoanDrawer', () => ({ DisburseLoanDrawer: () => null }))
vi.mock('@/components/DashboardView/CutoffCountdown', () => ({ CutoffCountdown: () => null }))

const items = [
  {
    loanAccountId: 'a1',
    accountNumber: 'LN-1',
    customerId: 'c1',
    customerName: 'Over Due',
    loanAmount: 100,
    loanAmountFormatted: '$100.00',
    commencementDate: '2020-01-01',
    bucket: 'overdue',
  },
  {
    loanAccountId: 'a2',
    accountNumber: 'LN-2',
    customerId: 'c2',
    customerName: 'To Day',
    loanAmount: 200,
    loanAmountFormatted: '$200.00',
    commencementDate: '2026-06-17',
    bucket: 'today',
  },
  {
    loanAccountId: 'a3',
    accountNumber: 'LN-3',
    customerId: 'c3',
    customerName: 'Sched Uled',
    loanAmount: 300,
    loanAmountFormatted: '$300.00',
    commencementDate: '2099-01-01',
    bucket: 'scheduled',
  },
]

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ totalCount: 3, items }),
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

  it('guards early disbursement of a scheduled loan', async () => {
    render(<PendingDisbursementsView />)
    await waitFor(() => expect(screen.getByTestId('section-scheduled')).toBeInTheDocument())
    // scheduled section is collapsed by default — expand it
    fireEvent.click(screen.getByText(/SCHEDULED/i))
    fireEvent.click(screen.getByRole('button', { name: /disburse early/i }))
    expect(screen.getByText(/before the scheduled start date/i)).toBeInTheDocument()
  })
})
