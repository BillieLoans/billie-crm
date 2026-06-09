import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LoanAccountCard } from '@/components/ServicingView/LoanAccountCard'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

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
})
