import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LoanAccountCard } from '@/components/ServicingView/LoanAccountCard'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import type { CollectionsCaseRow } from '@/types/collections'

// jsdom doesn't implement navigation — mock next/link to a plain anchor
// (matching the pattern used elsewhere, e.g. tests/unit/ui/breadcrumb.test.tsx)
// so clicking the deep link doesn't emit "Not implemented: navigation" noise.
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const TODAY = new Date('2026-06-09T12:00:00Z')

const createMockAccount = (overrides: Partial<LoanAccountData> = {}): LoanAccountData =>
  ({
    id: 'acc-1',
    loanAccountId: 'LOAN-001',
    accountNumber: 'ACC-12345',
    accountStatus: 'active',
    loanTerms: { loanAmount: 5000, loanFee: 500, totalPayable: 5500, openedDate: '2024-01-15' },
    balances: { currentBalance: 3500, totalOutstanding: 3750, totalPaid: 1750 },
    liveBalance: null,
    lastPayment: { date: '2024-06-01', amount: 250 },
    repaymentSchedule: { scheduleId: 'sched-1', numberOfPayments: 12, paymentFrequency: 'monthly', payments: [], createdDate: null },
    createdAt: '2024-01-15T00:00:00Z',
    updatedAt: '2024-01-15T00:00:00Z',
    ...overrides,
  }) as LoanAccountData

const createMockCase = (overrides: Partial<CollectionsCaseRow> = {}): CollectionsCaseRow => ({
  accountId: 'LOAN-001',
  customerId: 'cust-1',
  customerName: 'Test Customer',
  accountNumber: 'ACC-12345',
  state: 'open',
  rung: 2,
  hardshipPaused: false,
  stoppedContact: false,
  overdueAmount: 100,
  daysOverdue: 10,
  lastStep: 2,
  openedAt: '2026-06-01T00:00:00.000Z',
  curedAt: null,
  exhaustedAt: null,
  pausedAt: null,
  resumedAt: null,
  stopContactAt: null,
  updatedAt: '2026-06-20T00:00:00.000Z',
  aging: null,
  ...overrides,
})

describe('LoanAccountCard (compact rail row)', () => {
  afterEach(() => cleanup())

  test('renders account number and outstanding balance', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText('ACC-12345')).toBeInTheDocument()
    expect(screen.getByText('$3,750.00')).toBeInTheDocument()
  })

  test('shows "Pending disbursement" status line for pending accounts', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'pending_disbursement' })} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/Pending disbursement/i)).toBeInTheDocument()
  })

  test('shows days-overdue line for an overdue account', () => {
    const account = createMockAccount({
      repaymentSchedule: { scheduleId: 's', numberOfPayments: 1, paymentFrequency: 'fortnightly', createdDate: null,
        payments: [{ paymentNumber: 1, dueDate: '2026-05-28', amount: 80, status: 'scheduled' } as never] },
    })
    render(<LoanAccountCard account={account} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/12 days overdue/i)).toBeInTheDocument()
  })

  test('shows "Paid off" for closed accounts', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'paid_off' })} onSelect={vi.fn()} today={TODAY} />)
    expect(screen.getByText(/Paid off/i)).toBeInTheDocument()
  })

  test('marks the selected row via aria-pressed', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} isSelected today={TODAY} />)
    expect(screen.getByTestId('loan-account-card-LOAN-001')).toHaveAttribute('aria-pressed', 'true')
  })

  test('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    const account = createMockAccount()
    render(<LoanAccountCard account={account} onSelect={onSelect} today={TODAY} />)
    fireEvent.click(screen.getByTestId('loan-account-card-LOAN-001'))
    expect(onSelect).toHaveBeenCalledWith(account)
  })

  // ─── Collections badge + deep link (BTB-197 WS4) ───────────────────────────

  test('renders no collections badge/link when collectionsCase is null', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} today={TODAY} collectionsCase={null} />)
    expect(screen.queryByTestId('collections-badge-LOAN-001')).not.toBeInTheDocument()
    expect(screen.queryByTestId('collections-link-LOAN-001')).not.toBeInTheDocument()
  })

  test('renders no collections badge/link when the case is cured', () => {
    render(
      <LoanAccountCard
        account={createMockAccount()}
        onSelect={vi.fn()}
        today={TODAY}
        collectionsCase={createMockCase({ state: 'cured' })}
      />,
    )
    expect(screen.queryByTestId('collections-badge-LOAN-001')).not.toBeInTheDocument()
    expect(screen.queryByTestId('collections-link-LOAN-001')).not.toBeInTheDocument()
  })

  test('renders the badge and deep link for a non-cured case', () => {
    render(
      <LoanAccountCard
        account={createMockAccount()}
        onSelect={vi.fn()}
        today={TODAY}
        collectionsCase={createMockCase({ state: 'open', rung: 3 })}
      />,
    )
    expect(screen.getByTestId('collections-badge-LOAN-001')).toHaveTextContent('Collections · Step 3/5 · Open')
    const link = screen.getByTestId('collections-link-LOAN-001')
    expect(link).toHaveTextContent('View collections case →')
    expect(link).toHaveAttribute('href', '/admin/collections-queue/LOAN-001')
  })

  test('shows an "Awaiting human" state label and falls back to "?" when rung is null', () => {
    render(
      <LoanAccountCard
        account={createMockAccount()}
        onSelect={vi.fn()}
        today={TODAY}
        collectionsCase={createMockCase({ state: 'awaiting_human', rung: null })}
      />,
    )
    expect(screen.getByTestId('collections-badge-LOAN-001')).toHaveTextContent('Collections · Step ?/5 · Awaiting human')
  })

  test('renders Hardship and Stop contact flag chips when set', () => {
    render(
      <LoanAccountCard
        account={createMockAccount()}
        onSelect={vi.fn()}
        today={TODAY}
        collectionsCase={createMockCase({ hardshipPaused: true, stoppedContact: true })}
      />,
    )
    expect(screen.getByText('Hardship')).toBeInTheDocument()
    expect(screen.getByText('Stop contact')).toBeInTheDocument()
  })

  test('clicking the deep link does not trigger onSelect', () => {
    const onSelect = vi.fn()
    render(
      <LoanAccountCard
        account={createMockAccount()}
        onSelect={onSelect}
        today={TODAY}
        collectionsCase={createMockCase()}
      />,
    )
    fireEvent.click(screen.getByTestId('collections-link-LOAN-001'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})
