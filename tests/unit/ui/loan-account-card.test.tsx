import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LoanAccountCard } from '@/components/ServicingView/LoanAccountCard'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const createMockAccount = (overrides: Partial<LoanAccountData> = {}): LoanAccountData => ({
  id: 'acc-1',
  loanAccountId: 'LOAN-001',
  accountNumber: 'ACC-12345',
  accountStatus: 'active',
  loanTerms: {
    loanAmount: 5000,
    loanFee: 500,
    totalPayable: 5500,
    openedDate: '2024-01-15',
  },
  balances: {
    currentBalance: 3500,
    totalOutstanding: 3750,
    totalPaid: 1750,
  },
  liveBalance: null,
  lastPayment: {
    date: '2024-06-01',
    amount: 250,
  },
  repaymentSchedule: {
    scheduleId: 'sched-1',
    numberOfPayments: 12,
    paymentFrequency: 'monthly',
    payments: [],
    createdDate: null,
  },
  createdAt: '2024-01-15T00:00:00Z',
  updatedAt: '2024-01-15T00:00:00Z',
  ...overrides,
})

describe('LoanAccountCard component', () => {
  afterEach(() => {
    cleanup()
  })

  test('renders account number', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} />)
    expect(screen.getByText('ACC-12345')).toBeInTheDocument()
  })

  test('renders status badge for active account', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'active' })} onSelect={vi.fn()} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  test('renders status badge for in_arrears account', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'in_arrears' })} onSelect={vi.fn()} />)
    expect(screen.getByText('In Arrears')).toBeInTheDocument()
  })

  test('renders status badge for paid_off account', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'paid_off' })} onSelect={vi.fn()} />)
    expect(screen.getByText('Paid Off')).toBeInTheDocument()
  })

  test('renders status badge for written_off account', () => {
    render(<LoanAccountCard account={createMockAccount({ accountStatus: 'written_off' })} onSelect={vi.fn()} />)
    expect(screen.getByText('Written Off')).toBeInTheDocument()
  })

  test('displays cached indicator when no live balance', () => {
    render(<LoanAccountCard account={createMockAccount({ liveBalance: null })} onSelect={vi.fn()} />)
    expect(screen.getByText('Cached')).toBeInTheDocument()
  })

  test('displays live indicator when live balance available', () => {
    const account = createMockAccount({
      liveBalance: {
        principalBalance: 3200,
        feeBalance: 150,
        totalOutstanding: 3350,
        asOf: '2024-06-15T10:00:00Z',
      },
    })
    render(<LoanAccountCard account={account} onSelect={vi.fn()} />)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  test('displays cached balance when no live balance', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} />)
    expect(screen.getByText('$3,500.00')).toBeInTheDocument() // Principal from cached
    expect(screen.getByText('$3,750.00')).toBeInTheDocument() // Total Outstanding from cached
  })

  test('displays live balance when available', () => {
    const account = createMockAccount({
      liveBalance: {
        principalBalance: 3200,
        feeBalance: 150,
        totalOutstanding: 3350,
        asOf: '2024-06-15T10:00:00Z',
      },
    })
    render(<LoanAccountCard account={account} onSelect={vi.fn()} />)
    expect(screen.getByText('$3,200.00')).toBeInTheDocument() // Live principal
    expect(screen.getByText('$150.00')).toBeInTheDocument() // Live fees
    expect(screen.getByText('$3,350.00')).toBeInTheDocument() // Live total
  })

  test('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    const account = createMockAccount()
    render(<LoanAccountCard account={account} onSelect={onSelect} />)
    
    fireEvent.click(screen.getByTestId('loan-account-card-LOAN-001'))
    expect(onSelect).toHaveBeenCalledWith(account)
  })

  test('has correct test id', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} />)
    expect(screen.getByTestId('loan-account-card-LOAN-001')).toBeInTheDocument()
  })

  test('renders "Click for details" hint', () => {
    render(<LoanAccountCard account={createMockAccount()} onSelect={vi.fn()} />)
    expect(screen.getByText('Click for details →')).toBeInTheDocument()
  })
})
